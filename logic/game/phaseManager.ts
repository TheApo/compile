/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, GamePhase, PlayedCard, ActionRequired, EffectContext } from '../../types';
import { executeStartPhaseEffects, executeEndPhaseEffects, executeOnPlayEffect } from '../effectExecutor';
import { calculateCompilableLanes, recalculateAllLaneValues } from './stateManager';
import { findCardOnBoard, internalShiftCard } from './helpers/actionUtils';
import { drawForPlayer, findAndFlipCards } from '../../utils/gameStateModifiers';
import { log } from '../utils/log';

const checkControlPhase = (state: GameState): GameState => {
    if (!state.useControlMechanic) {
        return state;
    }

    const player = state.turn;
    const opponent = player === 'player' ? 'opponent' : 'player';
    
    const playerState = state[player];
    const opponentState = state[opponent];

    let playerWins = 0;

    const playerValue0 = playerState.laneValues[0];
    const playerValue1 = playerState.laneValues[1];
    const playerValue2 = playerState.laneValues[2];

    // A "line" is a direct vertical comparison of protocols and their lanes.
    const opponentValue0 = opponentState.laneValues[0];
    const opponentValue1 = opponentState.laneValues[1];
    const opponentValue2 = opponentState.laneValues[2];

    if (playerValue0 > opponentValue0) playerWins++;
    if (playerValue1 > opponentValue1) playerWins++;
    if (playerValue2 > opponentValue2) playerWins++;

    if (playerWins >= 2) {
        if (state.controlCardHolder !== player) {
            const playerName = player === 'player' ? 'Player' : 'Opponent';
            const newState = log(state, player, `${playerName} gains the Control Component.`);
            return { ...newState, controlCardHolder: player };
        }
    }
    
    return state;
}

export const advancePhase = (state: GameState): GameState => {
    if (state.winner) return state;

    const turnPlayer = state.turn;
    let nextState = { ...state };

    switch (state.phase) {
        case 'start':
            nextState = executeStartPhaseEffects(nextState).newState;
            // If the start phase required an action, it will be set. Don't advance phase.
            if (nextState.actionRequired) return nextState;
            return { ...nextState, phase: 'control' };

        case 'control': {
            const stateAfterControl = checkControlPhase(nextState);
            return { ...stateAfterControl, phase: 'compile' };
        }

        case 'compile': {
            const compilableLanes = calculateCompilableLanes(nextState, turnPlayer);
            if (compilableLanes.length > 0) {
                return { ...nextState, compilableLanes }; // Stay in compile phase, wait for input
            }
            return { ...nextState, phase: 'action', compilableLanes: [] }; // Move to action phase
        }

        case 'action':
             // This transition is triggered manually by other functions after an action is completed.
             return { ...nextState, phase: 'hand_limit' };
        
        case 'hand_limit': {
            const playerState = nextState[turnPlayer];

            // Check for Spirit-0 (must be face-up and uncovered)
            const hasSpirit0 = playerState.lanes.some(lane => 
                lane.length > 0 && 
                lane[lane.length - 1].isFaceUp && 
                lane[lane.length - 1].protocol === 'Spirit' && 
                lane[lane.length - 1].value === 0
            );

            if (hasSpirit0) {
                let stateWithLog = log(nextState, turnPlayer, "Spirit-0: Skipping Check Cache phase.");
                return { ...stateWithLog, phase: 'end' };
            }

            if (playerState.hand.length > 5) {
                return {
                    ...nextState,
                    actionRequired: { type: 'discard', actor: turnPlayer, count: playerState.hand.length - 5 }
                };
            }
            
            // Hand limit is fine, move to end phase.
            return { ...nextState, phase: 'end' };
        }

        case 'end': {
            const stateBeforeEffects = { ...nextState };
            nextState = executeEndPhaseEffects(nextState).newState;

            const actionBefore = stateBeforeEffects.actionRequired;
            const actionAfter = nextState.actionRequired;

            // If the end phase effects created a NEW action, we should pause and wait for it.
            if (actionAfter && actionAfter !== actionBefore) {
                 return nextState;
            }

            // FIX: Check if there are queued actions before ending the turn.
            // Process the queue to pop the next action.
            if (nextState.queuedActions && nextState.queuedActions.length > 0) {
                nextState = processEndOfAction(nextState);
                // If processEndOfAction created an action, return it
                if (nextState.actionRequired) {
                    return nextState;
                }
                // Otherwise, the queue was cleared, continue to end the turn
            }

            // If no new action was generated, the turn is over.
            const nextTurn: Player = turnPlayer === 'player' ? 'opponent' : 'player';
            // The `cannotCompile` flag applies for one turn. Now that this player's turn is over,
            // we can reset their flag so they are able to compile on their *next* turn.
            const endingPlayerState = {...nextState[turnPlayer], cannotCompile: false}; 
            
            return { 
                ...nextState, 
                [turnPlayer]: endingPlayerState, // Apply the reset to the player whose turn just ended
                turn: nextTurn, 
                phase: 'start',
                processedStartEffectIds: [],
                processedEndEffectIds: [],
                processedSpeed1TriggerThisTurn: false,
                processedUncoverEventIds: [],
            };
        }
    }
    return state; // Should not be reached
}

/**
 * Process only the queued actions without advancing phases.
 * Use this when you want to resolve queued effects but stay in the current phase.
 */
export const processQueuedActions = (state: GameState): GameState => {
    // Check for a queued ACTION first.
    if (!state.queuedActions || state.queuedActions.length === 0) {
        return state;
    }

    let mutableState = { ...state };
    let queuedActions = [...mutableState.queuedActions];

    while (queuedActions.length > 0) {
        const nextAction = queuedActions.shift()!;

        // Rule: An effect is cancelled if its source card is no longer on the board or face-up.
        if (nextAction.sourceCardId) {
            const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                mutableState = log(mutableState, nextAction.actor, `Queued effect from ${cardName} was cancelled because the source is no longer active.`);
                continue; // Skip this action
            }
        }

        // --- Auto-resolving actions ---
        if (nextAction.type === 'flip_self_for_water_0') {
            const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_water_0', sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

            // CRITICAL CHECK: Ensure Water-0 is still on the board and face-up before it flips itself.
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
            } else {
                // If the card was removed or flipped by an intermediate effect, cancel this part of the action.
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Water-0';
                mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because the source is no longer active.`);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        if (nextAction.type === 'flip_self_for_psychic_4') {
            const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_psychic_4', sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

            // FIX: Auto-resolve Psychic-4 self-flip after interrupt (e.g., from uncover effect)
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Psychic-4';
                mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because the source is no longer active.`);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        if (nextAction.type === 'reveal_opponent_hand') {
            const opponentId = mutableState.turn === 'player' ? 'opponent' : 'player';
            const opponentState = { ...mutableState[opponentId] };

            if (opponentState.hand.length > 0) {
                opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
                mutableState[opponentId] = opponentState;
                const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent reveals their hand.`);
            } else {
                const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent has no cards to reveal.`);
            }
            continue; // Action resolved, move to next in queue
        }

        if (nextAction.type === 'gravity_2_shift_after_flip') {
            const { cardToShiftId, targetLaneIndex, cardOwner, actor, sourceCardId } = nextAction;

            // Validate that both cards still exist AND source is still face-up before performing the shift
            const flippedCardStillExists = findCardOnBoard(mutableState, cardToShiftId);
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceCardStillValid = sourceCardInfo && sourceCardInfo.card.isFaceUp;

            if (!flippedCardStillExists || !sourceCardStillValid) {
                // One of the cards was deleted/returned, or source was flipped face-down → Cancel the shift
                const sourceName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Gravity-2';
                mutableState = log(mutableState, actor, `${sourceName}: Shift cancelled because the card no longer exists or is face-down.`);
            } else {
                // Perform the shift
                const shiftResult = internalShiftCard(mutableState, cardToShiftId, cardOwner, targetLaneIndex, actor);
                mutableState = shiftResult.newState;
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        // --- Conditional actions (check if possible) ---
        if (nextAction.type === 'select_any_opponent_card_to_shift') {
            const opponent = nextAction.actor === 'player' ? 'opponent' : 'player';
            if (mutableState[opponent].lanes.flat().length === 0) {
                const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                mutableState = log(mutableState, nextAction.actor, `${sourceName}: Opponent has no cards to shift, skipping effect.`);
                continue; // Action impossible, skip and move to next in queue
            }
        }

        // CRITICAL: For shift_flipped_card_optional, validate that the source card still exists AND is face-up!
        if (nextAction.type === 'shift_flipped_card_optional') {
            const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                // Source card was deleted/returned/flipped face-down → Cancel the shift
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                mutableState = log(mutableState, nextAction.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);
                continue; // Action cancelled, move to next in queue
            }
        }

        // --- If we reach here, the action is not auto-resolving and is possible ---
        mutableState.actionRequired = nextAction;
        mutableState.queuedActions = queuedActions; // Update the state with the rest of the queue
        return mutableState; // Break loop and return to wait for user/AI input
    }

    // All queued actions were auto-resolved or impossible.
    return { ...mutableState, queuedActions: [], actionRequired: null };
};

export const processEndOfAction = (state: GameState): GameState => {
    if (state.winner) return state;

    // This is the crucial check. If an action is required, the turn cannot end.
    // This handles both actions for the current turn player (which the AI manager will loop on)
    // and interrupt actions for the other player (which the useGameState hook will trigger the AI for).
    if (state.actionRequired) {
        return state;
    }

    // CRITICAL FIX: Process queued actions BEFORE checking for interrupts.
    // This ensures actions like gravity_2_shift_after_flip are processed even when
    // there's no interrupt (e.g., opponent flips their own card, triggering their own discard).
    if (state.queuedActions && state.queuedActions.length > 0) {
        const stateAfterQueue = processQueuedActions(state);
        // If queued actions created a new actionRequired, return immediately
        if (stateAfterQueue.actionRequired) {
            return stateAfterQueue;
        }
        // Continue with the processed state
        state = stateAfterQueue;
    }

    // Check for a completed interrupt first.
    if (state._interruptedTurn) {
        const originalTurnPlayer = state._interruptedTurn;
        const originalPhase = state._interruptedPhase || state.phase;
        let restoredState = { ...state };
        delete restoredState._interruptedTurn;
        delete restoredState._interruptedPhase;
        restoredState.turn = originalTurnPlayer;
        restoredState.phase = originalPhase;

        // CRITICAL FIX: If interrupt happened during start/end phase, process queued actions first,
        // then return to let the normal phase progression continue (via runOpponentTurn).
        // Otherwise the while-loop below will advance phases without giving the AI a chance to act.
        if (originalPhase === 'start' || originalPhase === 'end') {
            // FIX: Process queued actions (like flip_self_for_psychic_4) before returning
            if (restoredState.queuedActions && restoredState.queuedActions.length > 0) {
                restoredState = processQueuedActions(restoredState);
            }
            // If queued actions were processed and no new actionRequired was created,
            // AND we're in end phase, we need to end the turn now (even if animation is playing).
            if (!restoredState.actionRequired && originalPhase === 'end') {
                // End the turn: switch turn and reset to start phase
                const nextTurn: Player = restoredState.turn === 'player' ? 'opponent' : 'player';
                const endingPlayerState = {...restoredState[restoredState.turn], cannotCompile: false};
                return {
                    ...restoredState,
                    [restoredState.turn]: endingPlayerState,
                    turn: nextTurn,
                    phase: 'start',
                    processedStartEffectIds: [],
                    processedEndEffectIds: [],
                    processedSpeed1TriggerThisTurn: false,
                    processedUncoverEventIds: [],
                };
            }
            return restoredState;
        }

        // The interrupt is over. The original turn player's action that was
        // interrupted is now considered complete. Continue processing the rest
        // of their turn from this restored state, without returning early.
        state = restoredState;
    }
    
    // If the original action that caused the control prompt is stored, execute it now.
    if (state.actionRequired?.type === 'prompt_rearrange_protocols' && state.actionRequired.originalAction) {
        const originalAction = state.actionRequired.originalAction;
        let stateAfterRearrange = { ...state, actionRequired: null, controlCardHolder: null }; // Reset control
        
        if (originalAction.type === 'compile') {
            // Re-trigger the compile logic
            // Note: This part might need the compile function from useGameState, which isn't available here.
            // A potential refactor would be to handle this in useGameState. For now, we assume it continues the turn.
            return continueTurnProgression(stateAfterRearrange); // Simplified for now
        } else if (originalAction.type === 'fill_hand') {
            // Re-trigger the fill hand logic
            // FIX: Access hand.length to get the number of cards, not length on the PlayerState object.
            const stateAfterFill = drawForPlayer(stateAfterRearrange, stateAfterRearrange.turn, 5 - stateAfterRearrange[stateAfterRearrange.turn].hand.length);
            return continueTurnProgression(stateAfterFill);
        }
    }

    // Check for a queued effect before advancing phase.
    if (state.queuedEffect) {
        const { card, laneIndex } = state.queuedEffect;
        const stateWithoutQueue = { ...state, queuedEffect: undefined };
        const cardLocation = findCardOnBoard(stateWithoutQueue, card.id);

        if (cardLocation) {
            const { card: cardOnBoard, owner: cardOwner } = cardLocation;
            const queuedEffectContext: EffectContext = {
                cardOwner: cardOwner,
                actor: cardOwner,
                currentTurn: stateWithoutQueue.turn,
                opponent: cardOwner === 'player' ? 'opponent' : 'player',
                triggerType: 'play'
            };
            const { newState } = executeOnPlayEffect(cardOnBoard, laneIndex, stateWithoutQueue, queuedEffectContext);
            if (newState.actionRequired) {
                // The queued effect produced an action. Return this new state and wait.
                return newState;
            }
            // If no action, continue with the rest of the turn logic from this new state.
            state = newState;
        } else {
            // Card was removed from board before its on-play effect could trigger.
            // This is valid (e.g. on-cover effect returns the card). Just log and continue.
            console.warn(`Skipping queued effect for ${card.protocol}-${card.value} as it is no longer on the board.`);
            state = log(state, state.turn, `Skipping queued effect for ${card.protocol}-${card.value} as it is no longer on the board.`);
            // The state to continue from is the one without the queued effect.
            state = stateWithoutQueue;
        }
    }


    // Check for a queued ACTION first.
    if (state.queuedActions && state.queuedActions.length > 0) {
        let mutableState = { ...state };
        let queuedActions = [...mutableState.queuedActions];

        while (queuedActions.length > 0) {
            const nextAction = queuedActions.shift()!;

            // Rule: An effect is cancelled if its source card is no longer on the board or face-up.
            if (nextAction.sourceCardId) {
                const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                    mutableState = log(mutableState, nextAction.actor, `Queued effect from ${cardName} was cancelled because the source is no longer active.`);
                    continue; // Skip this action
                }
            }

            // --- Auto-resolving actions ---
            if (nextAction.type === 'flip_self_for_water_0') {
                const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_water_0', sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

                // CRITICAL CHECK: Ensure Water-0 is still on the board and face-up before it flips itself.
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                    mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                    mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    // If the card was removed or flipped by an intermediate effect, cancel this part of the action.
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Water-0';
                    mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because the source is no longer active.`);
                }
                continue; // Action resolved (or cancelled), move to next in queue
            }

            if (nextAction.type === 'flip_self_for_psychic_4') {
                const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_psychic_4', sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

                // FIX: Auto-resolve Psychic-4 self-flip after interrupt (e.g., from uncover effect)
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                    mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                    mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Psychic-4';
                    mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because the source is no longer active.`);
                }
                continue; // Action resolved (or cancelled), move to next in queue
            }
            
            if (nextAction.type === 'reveal_opponent_hand') {
                const opponentId = mutableState.turn === 'player' ? 'opponent' : 'player';
                const opponentState = { ...mutableState[opponentId] };

                if (opponentState.hand.length > 0) {
                    opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
                    mutableState[opponentId] = opponentState;
                    const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                    const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                    mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent reveals their hand.`);
                } else {
                    const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                    const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                    mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent has no cards to reveal.`);
                }
                continue; // Action resolved, move to next in queue
            }

            // --- Conditional actions (check if possible) ---
            if (nextAction.type === 'select_any_opponent_card_to_shift') {
                const opponent = nextAction.actor === 'player' ? 'opponent' : 'player';
                if (mutableState[opponent].lanes.flat().length === 0) {
                    const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                    const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                    mutableState = log(mutableState, nextAction.actor, `${sourceName}: Opponent has no cards to shift, skipping effect.`);
                    continue; // Action impossible, skip and move to next in queue
                }
            }

            // CRITICAL: For shift_flipped_card_optional, validate that the source card still exists AND is face-up!
            if (nextAction.type === 'shift_flipped_card_optional') {
                const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                    // Source card was deleted/returned/flipped face-down → Cancel the shift
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                    mutableState = log(mutableState, nextAction.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);
                    continue; // Action cancelled, move to next in queue
                }
            }

            // --- If we reach here, the action is not auto-resolving and is possible ---
            mutableState.actionRequired = nextAction;
            mutableState.queuedActions = queuedActions; // Update the state with the rest of the queue
            return mutableState; // Break loop and return to wait for user/AI input
        }
        
        // All queued actions were auto-resolved or impossible.
        state = { ...mutableState, queuedActions: [], actionRequired: null };
    }
    
    // If a resolver has already advanced the phase (e.g., Speed-1 trigger), respect it.
    // Otherwise, start the end-of-turn sequence from the hand_limit phase.
    const startingPhase = state.phase === 'action' ? 'hand_limit' : state.phase;
    // FIX: Explicitly type `nextState` to prevent a type inference mismatch.
    let nextState: GameState = { ...state, phase: startingPhase as GamePhase, compilableLanes: [], processedUncoverEventIds: [] };
    
    const originalTurn = state.turn;

    // This loop will process the rest of the current player's turn (hand_limit, end)
    // and stop either when the turn has been passed to the next player,
    // or if a new action is required from the current player.
    while (nextState.turn === originalTurn && !nextState.winner) {
        const actionBeforeAdvance = nextState.actionRequired;
        const phaseBeforeAdvance = nextState.phase;

        nextState = advancePhase(nextState);
        
        const actionAfterAdvance = nextState.actionRequired;

        // If advancePhase generated a new action that didn't exist before,
        // it must be for the current player (from hand_limit or end phase effects),
        // so we should break the loop and wait for that action to be resolved.
        if (actionAfterAdvance && actionAfterAdvance !== actionBeforeAdvance) {
            break;
        }
        
        // Safety break to prevent infinite loops if advancePhase fails to change phase,
        // which can happen if it's waiting for an action that this loop doesn't account for.
        if (nextState.phase === phaseBeforeAdvance && nextState.turn === originalTurn) {
             console.error("Game is stuck in a phase loop:", nextState.phase);
             break;
        }
    }
    
    return nextState;
};

export const continueTurnProgression = (state: GameState): GameState => {
    if (state.winner) return state;

    let nextState = { ...state };

    // Check for a completed interrupt first.
    if (nextState._interruptedTurn) {
        const originalTurnPlayer = nextState._interruptedTurn;
        const originalPhase = nextState._interruptedPhase || nextState.phase;
        delete nextState._interruptedTurn;
        delete nextState._interruptedPhase;
        nextState.turn = originalTurnPlayer;
        nextState.phase = originalPhase;
    }

    const originalTurn = nextState.turn;

    // Process all automatic phases until an action is required or the turn ends.
    while (nextState.turn === originalTurn && !nextState.actionRequired && !nextState.winner) {
        const currentPhase = nextState.phase;

        // Stop if we reach a phase that requires user input.
        if (currentPhase === 'action') {
            break;
        }

        // The 'compile' phase is special: it only requires input if lanes are compilable.
        if (currentPhase === 'compile') {
            const compilableLanes = calculateCompilableLanes(nextState, originalTurn);
            if (compilableLanes.length > 0) {
                // Update state with compilable lanes and stop to wait for user input.
                nextState = { ...nextState, compilableLanes };
                break;
            }
        }
        
        const oldPhase = nextState.phase;
        nextState = advancePhase(nextState);

        // Safety break to prevent infinite loops.
        if (oldPhase === nextState.phase && !nextState.actionRequired) {
            console.error("Game is stuck in an automatic phase loop:", oldPhase);
            console.error("State:", {
                phase: nextState.phase,
                turn: nextState.turn,
                actionRequired: nextState.actionRequired,
                queuedActions: nextState.queuedActions,
                interruptedTurn: nextState._interruptedTurn
            });
            break;
        }
    }
    return nextState;
};

export const continueTurnAfterStartPhaseAction = (state: GameState): GameState => {
    // The previous action has been resolved, clear it.
    let stateAfterAction = { ...state, actionRequired: null };

    // Now, re-evaluate the start phase to see if there are other start effects to process.
    // The `processedStartEffectIds` will prevent the same effect from running again.
    const stateAfterRecheck = executeStartPhaseEffects(stateAfterAction).newState;

    // If re-checking triggered another prompt (e.g., a second start-phase card),
    // then return the state immediately and wait for the new action.
    if (stateAfterRecheck.actionRequired) {
        return stateAfterRecheck;
    }

    // If there are no more start-phase actions, manually advance to the next interactive phase.
    // This prevents skipping the main Action phase.
    let nextState = stateAfterRecheck;
    if (nextState.phase !== 'control') {
        nextState = { ...nextState, phase: 'control' };
    }
    
    nextState = advancePhase(nextState); // -> compile
    if(nextState.actionRequired) return nextState;

    nextState = advancePhase(nextState); // -> action OR stays in compile if compilableLanes > 0
    return nextState;
};

export const processStartOfTurn = (state: GameState): GameState => {
    if (state.winner) return state;

    let stateAfterStartEffects = { ...state, phase: 'start' as GamePhase };
    
    stateAfterStartEffects = advancePhase(stateAfterStartEffects);
    
    if (stateAfterStartEffects.actionRequired) {
        return stateAfterStartEffects;
    }

    return continueTurnProgression(stateAfterStartEffects);
};