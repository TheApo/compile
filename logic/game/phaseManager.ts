/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, GamePhase, PlayedCard, ActionRequired, EffectContext } from '../../types';
import { executeStartPhaseEffects, executeEndPhaseEffects, executeOnPlayEffect } from '../effectExecutor';
import { calculateCompilableLanes, recalculateAllLaneValues } from './stateManager';
import { findCardOnBoard, isCardUncovered, internalShiftCard } from './helpers/actionUtils';
import { drawForPlayer, findAndFlipCards } from '../../utils/gameStateModifiers';
import { log, setLogSource, setLogPhase, decreaseLogIndent } from '../utils/log';
import { handleAnarchyConditionalDraw } from '../effects/anarchy/Anarchy-0';
import { getActivePassiveRules } from './passiveRuleChecker';
import { executeCustomEffect } from '../customProtocols/effectInterpreter';

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
            // IMPORTANT: Clear effect context before logging control phase changes
            let newState = setLogSource(state, undefined);
            newState = setLogPhase(newState, undefined);
            newState = { ...newState, _logIndentLevel: 0 };

            const playerName = player === 'player' ? 'Player' : 'Opponent';
            newState = log(newState, player, `${playerName} gains the Control Component.`);
            return { ...newState, controlCardHolder: player };
        }
    }

    return state;
}

export const advancePhase = (state: GameState): GameState => {
    if (state.winner) return state;

    const turnPlayer = state.turn;
    let nextState = { ...state };

    // CRITICAL: Clear ALL effect context (indent, source, phase) at EVERY phase boundary
    // This ensures that phase-level logs are never indented or prefixed with card names
    nextState = setLogSource(nextState, undefined);
    nextState = setLogPhase(nextState, undefined);
    nextState = { ...nextState, _logIndentLevel: 0 };

    switch (state.phase) {
        case 'start':
            nextState = executeStartPhaseEffects(nextState).newState;
            // If the start phase required an action, it will be set. Don't advance phase.
            if (nextState.actionRequired) return nextState;

            // Clear context again before transitioning to control phase
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };
            return { ...nextState, phase: 'control' };

        case 'control': {
            const stateAfterControl = checkControlPhase(nextState);

            // Clear context again before transitioning to compile phase
            let cleanState = setLogSource(stateAfterControl, undefined);
            cleanState = setLogPhase(cleanState, undefined);
            cleanState = { ...cleanState, _logIndentLevel: 0 };
            return { ...cleanState, phase: 'compile' };
        }

        case 'compile': {
            const compilableLanes = calculateCompilableLanes(nextState, turnPlayer);
            if (compilableLanes.length > 0) {
                return { ...nextState, compilableLanes }; // Stay in compile phase, wait for input
            }

            // Clear context again before transitioning to action phase
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };
            return { ...nextState, phase: 'action', compilableLanes: [] }; // Move to action phase
        }

        case 'action':
             // This transition is triggered manually by other functions after an action is completed.
             // Clear context again before transitioning to hand_limit phase
             nextState = setLogSource(nextState, undefined);
             nextState = setLogPhase(nextState, undefined);
             nextState = { ...nextState, _logIndentLevel: 0 };
             return { ...nextState, phase: 'hand_limit' };

        case 'hand_limit': {
            const playerState = nextState[turnPlayer];

            // Check for Spirit-0 (hardcoded - must be face-up and uncovered)
            const hasSpirit0 = playerState.lanes.some(lane =>
                lane.length > 0 &&
                lane[lane.length - 1].isFaceUp &&
                lane[lane.length - 1].protocol === 'Spirit' &&
                lane[lane.length - 1].value === 0
            );

            // Check for custom cards with skip_check_cache_phase passive rule
            const passiveRules = getActivePassiveRules(nextState);
            const hasSkipCacheRule = passiveRules.some(({ rule, cardOwner }) =>
                rule.type === 'skip_check_cache_phase' &&
                (rule.target === 'self' && cardOwner === turnPlayer || rule.target === 'all') &&
                cardOwner === turnPlayer
            );

            if (hasSpirit0 || hasSkipCacheRule) {
                let stateWithLog = log(nextState, turnPlayer, "Skipping Check Cache phase.");

                // Clear context again before transitioning to end phase
                stateWithLog = setLogSource(stateWithLog, undefined);
                stateWithLog = setLogPhase(stateWithLog, undefined);
                stateWithLog = { ...stateWithLog, _logIndentLevel: 0 };
                return { ...stateWithLog, phase: 'end' };
            }

            if (playerState.hand.length > 5) {
                const cardsToDiscard = playerState.hand.length - 5;
                const playerName = turnPlayer === 'player' ? 'Player' : 'Opponent';
                let stateWithLog = log(nextState, turnPlayer, `Check Cache: ${playerName} has ${playerState.hand.length} cards, must discard ${cardsToDiscard}.`);
                return {
                    ...stateWithLog,
                    actionRequired: { type: 'discard', actor: turnPlayer, count: cardsToDiscard }
                };
            }

            // Hand limit is fine, move to end phase.
            // Clear context again before transitioning to end phase
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };
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

            // CRITICAL: Clear ALL context before transitioning to the next turn
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };

            return {
                ...nextState,
                [turnPlayer]: endingPlayerState, // Apply the reset to the player whose turn just ended
                turn: nextTurn,
                phase: 'start',
                processedStartEffectIds: [],
                processedEndEffectIds: [],
                processedSpeed1TriggerThisTurn: false,
                processedUncoverEventIds: [],
                // CRITICAL: Clear interrupt state when starting a new turn
                _interruptedTurn: undefined,
                _interruptedPhase: undefined,
            };
        }
    }
    return state; // Should not be reached
};

/**
 * CENTRAL QUEUE HELPER: Automatically queue pending custom effects
 * This ensures that multi-effect cards (like Chaos-1) always work correctly
 * regardless of which resolver was used.
 */
export function queuePendingCustomEffects(state: GameState): GameState {
    const pendingEffects = (state as any)._pendingCustomEffects;
    if (!pendingEffects || pendingEffects.effects.length === 0) {
        return state; // No pending effects, nothing to do
    }

    const pendingAction: any = {
        type: 'execute_remaining_custom_effects',
        sourceCardId: pendingEffects.sourceCardId,
        laneIndex: pendingEffects.laneIndex,
        effects: pendingEffects.effects,
        context: pendingEffects.context,
        actor: pendingEffects.context.cardOwner,
        selectedCardFromPreviousEffect: pendingEffects.selectedCardFromPreviousEffect,
    };

    // Queue the pending effects
    const newState = {
        ...state,
        queuedActions: [
            ...(state.queuedActions || []),
            pendingAction
        ]
    };

    // Clear from state after queueing
    delete (newState as any)._pendingCustomEffects;

    return newState;
}

/**
 * Process only the queued actions without advancing phases.
 * Use this when you want to resolve queued effects but stay in the current phase.
 */
export const processQueuedActions = (state: GameState): GameState => {
    // CRITICAL: Check for pending custom effects FIRST before processing queue
    let mutableState = queuePendingCustomEffects(state);

    // Check for a queued ACTION first.
    if (!mutableState.queuedActions || mutableState.queuedActions.length === 0) {
        return mutableState;
    }

    let queuedActions = [...mutableState.queuedActions];

    while (queuedActions.length > 0) {
        const nextAction = queuedActions.shift()!;

        // Rule: An effect is cancelled if its source card is no longer on the board or face-up.
        // EXCEPTION: flip_self_for_water_0 and flip_self_for_psychic_4 have their own specific checks
        if (nextAction.sourceCardId && nextAction.type !== 'flip_self_for_water_0' && nextAction.type !== 'flip_self_for_psychic_4') {
            const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                mutableState = log(mutableState, nextAction.actor, `Queued effect from ${cardName} was cancelled because the source is no longer active.`);
                continue; // Skip this action
            }
        }

        // --- Auto-resolving actions ---
        // NOTE: "discard all" is now auto-executed in effectInterpreter.ts

        if (nextAction.type === 'flip_self_for_water_0') {
            console.log('[WATER-0 FLIP] Processing flip_self_for_water_0 in processQueuedActions');
            const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_water_0', sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

            // DEBUG: Log what we found
            console.log('[DEBUG] Water-0 self-flip queue processing:', {
                sourceCardId,
                foundCard: !!sourceCardInfo,
                cardName: sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'NOT_FOUND',
                isFaceUp: sourceCardInfo?.card.isFaceUp,
                isUncovered: sourceIsUncovered,
                willExecute: !!(sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered)
            });

            // CRITICAL: Only execute if Water-0 is still on the board, face-up AND uncovered
            // Middle commands are only active when uncovered, so the self-flip must be cancelled if Water-0 is covered
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                console.log('[WATER-0 FLIP] Executing self-flip');
                mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Water-0';
                const reason = !sourceCardInfo ? 'deleted' :
                              !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                              'now covered';
                console.log('[WATER-0 FLIP] Cancelling self-flip - reason:', reason);
                mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        if (nextAction.type === 'flip_self_for_psychic_4') {
            const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_psychic_4', sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

            // CRITICAL: Only execute if Psychic-4 is still on the board, face-up AND uncovered
            // Bottom commands are only active when uncovered, so the self-flip must be cancelled if Psychic-4 is covered
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Psychic-4';
                const reason = !sourceCardInfo ? 'deleted' :
                              !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                              'now covered';
                mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        if (nextAction.type === 'anarchy_0_conditional_draw') {
            const { sourceCardId, actor } = nextAction as { type: 'anarchy_0_conditional_draw', sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

            // CRITICAL: Only execute if Anarchy-0 is still on the board and face-up
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                mutableState = handleAnarchyConditionalDraw(mutableState, actor);
                // Decrease log indent after queued effect completes (was increased when effect started)
                mutableState = decreaseLogIndent(mutableState);
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Anarchy-0';
                mutableState = log(mutableState, actor, `The conditional draw from ${cardName} was cancelled because the source is no longer active.`);
                // Decrease log indent even when cancelled (was increased when effect started)
                mutableState = decreaseLogIndent(mutableState);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        if (nextAction.type === 'execute_remaining_custom_effects') {
            const { sourceCardId, laneIndex, effects, context, selectedCardFromPreviousEffect } = nextAction as any;
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

            // CRITICAL: Check if source card still exists and is active
            if (!sourceCardInfo) {
                mutableState = log(mutableState, context.cardOwner, `Remaining effects cancelled because the source card was deleted or returned.`);
                continue;
            }

            if (!sourceCardInfo.card.isFaceUp) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, context.cardOwner, `Remaining effects from ${cardName} cancelled because it was flipped face-down.`);
                continue;
            }

            // Check if source card is still uncovered (required for middle/bottom box effects)
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);
            if (!sourceIsUncovered) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, context.cardOwner, `Remaining effects from ${cardName} cancelled because it is now covered.`);
                continue;
            }

            // If we have a selected card from previous effect (e.g., "Flip 1 card. Shift THAT card"), store it
            if (selectedCardFromPreviousEffect) {
                (mutableState as any)._selectedCardFromPreviousEffect = selectedCardFromPreviousEffect;
            }

            // Execute remaining effects sequentially
            for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
                const effectDef = effects[effectIndex];
                const result = executeCustomEffect(sourceCardInfo.card, laneIndex, mutableState, context, effectDef);
                mutableState = result.newState;

                // CRITICAL: If this effect has animations AND no actionRequired, show them
                // But if actionRequired is set, prioritize it over animations
                if (result.animationRequests && result.animationRequests.length > 0 && !mutableState.actionRequired) {
                    console.log(`[execute_remaining_custom_effects] Effect ${effectIndex + 1} has ${result.animationRequests.length} animations - stopping to show them`);

                    const remainingEffects = effects.slice(effectIndex + 1);

                    // If there are more effects after this one, queue them to execute AFTER animations
                    if (remainingEffects.length > 0) {
                        const nextAction: any = {
                            type: 'execute_remaining_custom_effects',
                            sourceCardId,
                            laneIndex,
                            effects: remainingEffects,
                            context,
                            actor: context.cardOwner,
                        };
                        mutableState.queuedActions = [nextAction, ...(queuedActions || [])];
                    } else {
                        // No more effects - restore original queue
                        mutableState.queuedActions = queuedActions;
                    }

                    // Set animation state so it displays
                    // Take the FIRST animation request (show one at a time)
                    const firstAnimation = result.animationRequests[0];
                    if (firstAnimation.type === 'draw') {
                        mutableState.animationState = {
                            type: 'draw',
                            player: firstAnimation.player as Player,
                            count: firstAnimation.count
                        };
                    } else if (firstAnimation.type === 'play') {
                        mutableState.animationState = {
                            type: 'playCard',
                            cardId: firstAnimation.cardId
                        };
                    } else if (firstAnimation.type === 'delete') {
                        mutableState.animationState = {
                            type: 'deleteCard',
                            cardId: firstAnimation.cardId
                        };
                    }

                    // Return to trigger animation display - queue will continue after animation
                    return mutableState;
                }

                // If an action is required, stop and save remaining effects
                if (mutableState.actionRequired) {
                    const remainingEffects = effects.slice(effectIndex + 1);

                    // CRITICAL: Save remaining effects to be executed after this action completes
                    if (remainingEffects.length > 0) {
                        console.log(`[processQueuedActions] Stopping at effect ${effectIndex + 1}/${effects.length}, ${remainingEffects.length} effects remaining`);
                        (mutableState as any)._pendingCustomEffects = {
                            sourceCardId,
                            laneIndex,
                            context,
                            effects: remainingEffects
                        };
                    }

                    // CRITICAL: If there's an interrupted turn, restore it before returning
                    // This ensures the turn is correct when the action is displayed to the user
                    if (mutableState._interruptedTurn) {
                        const originalTurnPlayer = mutableState._interruptedTurn;
                        const originalPhase = mutableState._interruptedPhase || mutableState.phase;
                        delete mutableState._interruptedTurn;
                        delete mutableState._interruptedPhase;
                        mutableState.turn = originalTurnPlayer;
                        mutableState.phase = originalPhase;
                    }

                    mutableState.queuedActions = queuedActions; // Save remaining queue
                    return mutableState;
                }
            }

            continue; // Action resolved, move to next in queue
        }

        if (nextAction.type === 'speed_3_self_flip_after_shift') {
            const { sourceCardId, actor } = nextAction as { type: 'speed_3_self_flip_after_shift', sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

            // CRITICAL: Only execute if Speed-3 is still on the board, face-up AND uncovered
            // Bottom commands are only active when uncovered, so the self-flip must be cancelled if Speed-3 is covered
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                mutableState = log(mutableState, actor, `Speed-3: Flipping itself after shifting a card.`);
                mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Speed-3';
                const reason = !sourceCardInfo ? 'deleted' :
                              !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                              'now covered';
                mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
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

            // Validate that both cards still exist AND source is still face-up AND uncovered before performing the shift
            const flippedCardStillExists = findCardOnBoard(mutableState, cardToShiftId);
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);
            const sourceCardStillValid = sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered;

            if (!flippedCardStillExists || !sourceCardStillValid) {
                // One of the cards was deleted/returned, or source was flipped face-down/covered → Cancel the shift
                const sourceName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Gravity-2';
                mutableState = log(mutableState, actor, `${sourceName}: Shift cancelled because the card no longer exists or is not active.`);
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

        // CRITICAL: For shift_flipped_card_optional, validate that the source card still exists, is face-up, AND uncovered!
        if (nextAction.type === 'shift_flipped_card_optional') {
            const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, nextAction.sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp || !sourceIsUncovered) {
                // Source card was deleted/returned/flipped face-down/covered → Cancel the shift
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

    // CRITICAL FIX: If execute_remaining_custom_effects is set as actionRequired (not in queue),
    // we need to process it immediately by calling processQueuedActions.
    if (state.actionRequired?.type === 'execute_remaining_custom_effects') {
        // Move to queue and process immediately
        const action = state.actionRequired;
        const stateWithQueue = {
            ...state,
            actionRequired: null,
            queuedActions: [action, ...(state.queuedActions || [])]
        };
        return processQueuedActions(stateWithQueue);
    }

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

                // CRITICAL: Clear ALL context before transitioning to the next turn
                restoredState = setLogSource(restoredState, undefined);
                restoredState = setLogPhase(restoredState, undefined);
                restoredState = { ...restoredState, _logIndentLevel: 0 };

                return {
                    ...restoredState,
                    [restoredState.turn]: endingPlayerState,
                    turn: nextTurn,
                    phase: 'start',
                    processedStartEffectIds: [],
                    processedEndEffectIds: [],
                    processedSpeed1TriggerThisTurn: false,
                    processedUncoverEventIds: [],
                    // CRITICAL: Clear interrupt state when starting a new turn
                    _interruptedTurn: undefined,
                    _interruptedPhase: undefined,
                };
            }
            return restoredState;
        }

        // The interrupt is over. The original turn player's action that was
        // interrupted is now considered complete. Continue processing the rest
        // of their turn from this restored state, without returning early.
        // This will fall through to phase advancement (hand_limit → end → turn switch)
        state = restoredState;
    }

    // If the original action that caused the control prompt is stored, execute it now.
    if (state.actionRequired?.type === 'prompt_rearrange_protocols' && state.actionRequired.originalAction) {
        console.log('[DEBUG processEndOfAction] FALLBACK HANDLER TRIGGERED - This should NOT happen if resolveRearrangeProtocols was called!');
        console.log('[DEBUG processEndOfAction] originalAction:', state.actionRequired.originalAction);
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
            console.log('[DEBUG processEndOfAction] Using fallback drawForPlayer, hand before:', stateAfterRearrange[stateAfterRearrange.turn].hand.length);
            const stateAfterFill = drawForPlayer(stateAfterRearrange, stateAfterRearrange.turn, 5 - stateAfterRearrange[stateAfterRearrange.turn].hand.length);
            console.log('[DEBUG processEndOfAction] After fallback drawForPlayer, hand:', stateAfterFill[stateAfterFill.turn].hand.length);
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
            // EXCEPTION: flip_self_for_water_0 and flip_self_for_psychic_4 have their own specific checks
            if (nextAction.sourceCardId && nextAction.type !== 'flip_self_for_water_0' && nextAction.type !== 'flip_self_for_psychic_4') {
                const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                    mutableState = log(mutableState, nextAction.actor, `Queued effect from ${cardName} was cancelled because the source is no longer active.`);
                    continue; // Skip this action
                }
            }

            // --- Auto-resolving actions ---
            if (nextAction.type === 'flip_self_for_water_0') {
                console.log('[WATER-0 FLIP] Processing flip_self_for_water_0 in processEndOfAction (SECOND LOCATION - SHOULD NOT BE CALLED)');
                const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_water_0', sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
                const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

                // DEBUG: Log what we found (SECOND LOCATION - processEndOfAction)
                console.log('[DEBUG] Water-0 self-flip queue processing (processEndOfAction):', {
                    sourceCardId,
                    foundCard: !!sourceCardInfo,
                    cardName: sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'NOT_FOUND',
                    isFaceUp: sourceCardInfo?.card.isFaceUp,
                    isUncovered: sourceIsUncovered,
                    willExecute: !!(sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered)
                });

                // CRITICAL: Only execute if Water-0 is still on the board, face-up AND uncovered
                // Middle commands are only active when uncovered, so the self-flip must be cancelled if Water-0 is covered
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    console.log('[WATER-0 FLIP] Executing self-flip (processEndOfAction)');
                    mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                    mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                    mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Water-0';
                    const reason = !sourceCardInfo ? 'deleted' :
                                  !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                                  'now covered';
                    console.log('[WATER-0 FLIP] Cancelling self-flip (processEndOfAction) - reason:', reason);
                    mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
                }
                continue; // Action resolved (or cancelled), move to next in queue
            }

            if (nextAction.type === 'flip_self_for_psychic_4') {
                const { sourceCardId, actor } = nextAction as { type: 'flip_self_for_psychic_4', sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
                const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

                // CRITICAL: Only execute if Psychic-4 is still on the board, face-up AND uncovered
                // Bottom commands are only active when uncovered, so the self-flip must be cancelled if Psychic-4 is covered
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                    mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                    mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Psychic-4';
                    const reason = !sourceCardInfo ? 'deleted' :
                                  !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                                  'now covered';
                    mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
                }
                continue; // Action resolved (or cancelled), move to next in queue
            }

            if (nextAction.type === 'anarchy_0_conditional_draw') {
                const { sourceCardId, actor } = nextAction as { type: 'anarchy_0_conditional_draw', sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

                // CRITICAL: Only execute if Anarchy-0 is still on the board and face-up
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                    mutableState = handleAnarchyConditionalDraw(mutableState, actor);
                    // Decrease log indent after queued effect completes (was increased when effect started)
                    mutableState = decreaseLogIndent(mutableState);
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Anarchy-0';
                    mutableState = log(mutableState, actor, `The conditional draw from ${cardName} was cancelled because the source is no longer active.`);
                    // Decrease log indent even when cancelled (was increased when effect started)
                    mutableState = decreaseLogIndent(mutableState);
                }
                continue; // Action resolved (or cancelled), move to next in queue
            }

            if (nextAction.type === 'speed_3_self_flip_after_shift') {
                const { sourceCardId, actor } = nextAction as { type: 'speed_3_self_flip_after_shift', sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
                const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

                // CRITICAL: Only execute if Speed-3 is still on the board, face-up AND uncovered
                // Bottom commands are only active when uncovered, so the self-flip must be cancelled if Speed-3 is covered
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                    mutableState = log(mutableState, actor, `Speed-3: Flipping itself after shifting a card.`);
                    mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                    mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Speed-3';
                    const reason = !sourceCardInfo ? 'deleted' :
                                  !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                                  'now covered';
                    mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
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

            // CRITICAL: For shift_flipped_card_optional, validate that the source card still exists, is face-up, AND uncovered!
            if (nextAction.type === 'shift_flipped_card_optional') {
                const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
                const sourceIsUncovered = isCardUncovered(mutableState, nextAction.sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp || !sourceIsUncovered) {
                    // Source card was deleted/returned/flipped face-down/covered → Cancel the shift
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
