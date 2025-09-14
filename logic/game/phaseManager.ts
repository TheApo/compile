/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, GamePhase, PlayedCard } from '../../types';
import { executeStartPhaseEffects, executeEndPhaseEffects, executeOnPlayEffect } from '../effectExecutor';
import { calculateCompilableLanes, recalculateAllLaneValues } from './stateManager';
import { findCardOnBoard } from './helpers/actionUtils';
import { drawForPlayer } from '../../utils/gameStateModifiers';
import { log } from '../utils/log';

const checkForSpeed1Trigger = (state: GameState, player: Player): GameState => {
    const playerState = state[player];
    const hasSpeed1 = playerState.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Speed' && c.value === 1);
    
    if (hasSpeed1) {
        let newState = { ...state };
        newState = log(newState, player, "Speed-1 triggers after clearing cache: Draw 1 card.");
        newState = drawForPlayer(newState, player, 1);
        return newState;
    }
    
    return state;
};

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

        case 'control':
            // Future logic for control card
            return { ...nextState, phase: 'compile' };

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

            // Step 1: Enforce the hand limit. If player has more than 5 cards, require discard and stop.
            if (playerState.hand.length > 5) {
                return {
                    ...nextState,
                    actionRequired: { type: 'discard', player: turnPlayer, count: playerState.hand.length - 5 }
                };
            }
            
            // Step 2: If we reach here, the hand limit is satisfied. Now, trigger "after clear cache" effects.
            const stateAfterTriggerCheck = checkForSpeed1Trigger(nextState, turnPlayer);
            
            // Step 3: Move to the end phase. The card drawn from Speed-1 is safe from this turn's hand limit check.
            return { ...stateAfterTriggerCheck, phase: 'end' };
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
            };
        }
    }
    return state; // Should not be reached
}

export const processEndOfAction = (state: GameState): GameState => {
    if (state.winner) return state;

    // Check for a completed interrupt first.
    if (state._interruptedTurn) {
        const originalTurnPlayer = state._interruptedTurn;
        let restoredState = { ...state };
        delete restoredState._interruptedTurn;
        restoredState.turn = originalTurnPlayer;
        
        // The interrupt is over. The original turn player's action that was
        // interrupted is now considered complete. Continue processing the rest
        // of their turn from this restored state, without returning early.
        state = restoredState;
    }

    // Check for a queued ACTION first.
    if (state.queuedActions && state.queuedActions.length > 0) {
        const queuedActions = [...state.queuedActions];
        const nextAction = queuedActions.shift();
        // Return immediately with the new action required.
        return { ...state, actionRequired: nextAction, queuedActions };
    }

    // Check for a queued effect before advancing phase.
    if (state.queuedEffect) {
        const { card, laneIndex } = state.queuedEffect;
        const stateWithoutQueue = { ...state, queuedEffect: undefined };
        const cardLocation = findCardOnBoard(stateWithoutQueue, card.id);

        if (cardLocation) {
            const { card: cardOnBoard, owner: cardOwner } = cardLocation;
            const { newState } = executeOnPlayEffect(cardOnBoard, laneIndex, stateWithoutQueue, cardOwner);
            if (newState.actionRequired) {
                // The queued effect produced an action. Return this new state and wait.
                return newState;
            }
            // If no action, continue with the rest of the turn logic from this new state.
            state = newState;
        } else {
            console.error("Queued effect card not found on board!");
        }
    }

    let nextState = { ...state, phase: 'hand_limit' as GamePhase, compilableLanes: [] };
    
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
    nextState = advancePhase({ ...nextState, phase: 'control' }); // -> compile
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