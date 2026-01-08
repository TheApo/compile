/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, Difficulty, EffectResult, AnimationRequest, EffectContext, GamePhase, PlayedCard } from '../../types';
import { easyAI } from '../ai/easy';
import { normalAI } from '../ai/normal';
// TEMPORARILY DISABLED: hardAI is being completely rewritten
// import { hardAI } from '../ai/hardImproved';
import { Dispatch, SetStateAction } from 'react';
import * as resolvers from './resolvers';
import { executeOnPlayEffect } from '../effectExecutor';
import { findCardOnBoard } from './helpers/actionUtils';
import { performShuffleTrash } from '../effects/actions/shuffleExecutor';
import { CardActionResult, applyCardActionResult } from './resolvers/cardResolver';
import { LaneActionResult } from './resolvers/laneResolver';
import { log } from '../utils/log';
import { executeCustomEffect } from '../customProtocols/effectInterpreter';
import { AnimationQueueItem } from '../../types/animation';
import {
    createSequentialDrawAnimations,
    createDelayAnimation,
    enqueueAnimationsFromRequests,
} from '../animation/animationHelpers';
import {
    createAnimationForAIDecision,
    filterAlreadyCreatedAnimations,
    createAndEnqueueDiscardAnimations,
    createAndEnqueueDrawAnimations,
    createAndEnqueueShiftAnimation,
    createAndEnqueuePlayAnimation,
    processCompileAnimations,
} from '../animation/aiAnimationCreators';
import {
    refreshHandMessage,
} from '../utils/logMessages';

// NOTE: createAndEnqueueShiftAnimation moved to aiAnimationCreators.ts (DRY)
// NOTE: enqueueAnimationsFromRequests moved to animationHelpers.ts (DRY - Single Point of Truth)
// NOTE: Draw animations now use animationRequests like all other effects (DRY - consistent pattern)

/**
 * Helper: Process and clear pending animation requests accumulated on state
 * Call this after onCompleteCallback to enqueue animations from reactive effects
 */
function processPendingAnimationRequests(
    state: GameState,
    enqueueAnimation?: (animation: Omit<AnimationQueueItem, 'id'>) => void
): GameState {
    const pending = (state as any)._pendingAnimationRequests;
    if (pending && pending.length > 0 && enqueueAnimation) {
        enqueueAnimationsFromRequests(state, pending, enqueueAnimation);
    }
    // Clear the pending requests
    const newState = { ...state };
    delete (newState as any)._pendingAnimationRequests;
    return newState;
}

type ActionDispatchers = {
    compileLane: (s: GameState, l: number) => GameState,
    playCard: (s: GameState, c: string, l: number, f: boolean, p: Player) => EffectResult,
    fillHand: (s: GameState, p: Player) => GameState,
    discardCards: (s: GameState, c: string[], p: Player) => GameState,
    flipCard: (s: GameState, c: string) => GameState,
    deleteCard: (s: GameState, c: string) => { newState: GameState, animationRequests: AnimationRequest[] },
    returnCard: (s: GameState, c: string) => GameState,
    skipAction: (s: GameState) => GameState,
    resolveOptionalDrawPrompt: (s: GameState, a: boolean) => GameState,
    resolveOptionalDiscardCustomPrompt: (s: GameState, a: boolean) => GameState,
    resolveOptionalEffectPrompt: (s: GameState, a: boolean) => GameState,
    resolveVariableDiscard: (s: GameState, cardIds: string[]) => GameState,
    resolveRearrangeProtocols: (s: GameState, newOrder: string[]) => GameState,
    resolveActionWithHandCard: (s: GameState, cardId: string) => GameState,
    resolveSwapProtocols: (s: GameState, indices: [number, number]) => GameState,
    revealOpponentHand: (s: GameState) => GameState,
    resolveCustomChoice: (s: GameState, choiceIndex: number) => GameState,
}

type OpponentActionDispatchers = Pick<ActionDispatchers, 'playCard' | 'discardCards' | 'flipCard' | 'returnCard' | 'deleteCard' | 'resolveActionWithHandCard' | 'revealOpponentHand' | 'resolveRearrangeProtocols'>;


type PhaseManager = {
    processEndOfAction: (s: GameState) => GameState,
    processStartOfTurn: (s: GameState) => GameState,
    continueTurnAfterStartPhaseAction: (s: GameState) => GameState,
    continueTurnProgression: (s: GameState) => GameState,
}

type TrackPlayerRearrange = (actor: 'player' | 'opponent') => void;

// Helper function to correctly end an action based on current phase
// CRITICAL: Start phase actions must use continueTurnAfterStartPhaseAction
// Otherwise the turn gets stuck (e.g., after Spirit-1's "discard or flip" choice)
const endActionForPhase = (state: GameState, phaseManager: PhaseManager): GameState => {
    if (state.phase === 'start') {
        return phaseManager.continueTurnAfterStartPhaseAction(state);
    }
    return phaseManager.processEndOfAction(state);
};

// Helper function to handle AI playing a card (used by both handleMandatoryPlayerTurnAction and handleRequiredAction)
// isDuringOpponentTurn: true = during opponent's turn (may need to call runOpponentTurn for follow-ups)
//                       false = during player's turn (interrupt scenario, just endActionForPhase)
const handleAIPlayCard = (
    state: GameState,
    aiDecision: { cardId: string; laneIndex: number; isFaceUp: boolean },
    setGameState: Dispatch<SetStateAction<GameState>>,
    difficulty: Difficulty,
    actions: Pick<ActionDispatchers, 'playCard'>,
    processAnimationQueue: (queue: AnimationRequest[], onComplete: () => void) => void,
    phaseManager: PhaseManager,
    isDuringOpponentTurn: boolean,
    enqueueAnimation?: (animation: Omit<AnimationQueueItem, 'id'>) => void
): GameState => {
    const { cardId, laneIndex, isFaceUp } = aiDecision;

    // DRY: Create play animation BEFORE state update using centralized helper
    if (enqueueAnimation) {
        createAndEnqueuePlayAnimation(state, cardId, laneIndex, isFaceUp, 'opponent', enqueueAnimation, true);
    }

    const { newState: stateAfterPlayLogic, animationRequests: onCoverAnims } = actions.playCard(
        { ...state, actionRequired: null },
        cardId,
        laneIndex,
        isFaceUp,
        'opponent'
    );

    // CRITICAL: Set flag to prevent double-play when effects trigger runOpponentTurn
    const stateWithPlayAnimation = {
        ...stateAfterPlayLogic,
        animationState: null,
        _cardPlayedThisActionPhase: true
    };

    // NEW: Use new animation system for on-cover effects
    if (enqueueAnimation && onCoverAnims && onCoverAnims.length > 0) {
        enqueueAnimationsFromRequests(stateAfterPlayLogic, onCoverAnims, enqueueAnimation);
        // Return state - Hook 1 will continue after animations complete
        if (stateWithPlayAnimation.actionRequired) {
            return stateWithPlayAnimation;
        }
        return endActionForPhase(stateWithPlayAnimation, phaseManager);
    }

    // FALLBACK: Old animation system with setTimeout
    setTimeout(() => {
        setGameState(s => {
            let stateToProcess = { ...s, animationState: null };

            if (onCoverAnims && onCoverAnims.length > 0) {
                processAnimationQueue(onCoverAnims, () => setGameState(s2 => {
                    // CRITICAL: Ensure animationState is cleared
                    const cleanState = { ...s2, animationState: null };
                    // CRITICAL FIX: If there's still an actionRequired after cover effects,
                    // handle it via handleRequiredAction, NOT runOpponentTurn!
                    // runOpponentTurn allows playing another card, which causes the double-play bug.
                    if (cleanState.actionRequired && cleanState.actionRequired.actor === 'opponent') {
                        // Let the effect handling continue - don't start a new turn
                        return cleanState;
                    }
                    // No more actionRequired - end the action phase (don't allow another card play)
                    const result = endActionForPhase(cleanState, phaseManager);
                    return { ...result, animationState: null };
                }));
                return stateToProcess;
            }

            if (isDuringOpponentTurn && stateToProcess.actionRequired) {
                runOpponentTurn(stateToProcess, setGameState, difficulty, actions as ActionDispatchers, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                return stateToProcess;
            }
            if (stateToProcess.actionRequired && stateToProcess.actionRequired.actor === 'opponent') {
                return stateToProcess;
            }
            return endActionForPhase(stateToProcess, phaseManager);
        });
    }, 500);

    return stateWithPlayAnimation;
};

const getAIAction = (state: GameState, action: ActionRequired | null, difficulty: Difficulty): AIAction => {
    switch (difficulty) {
        case 'normal':
            return normalAI(state, action);
        case 'hard':
            // TEMPORARILY: Hard AI falls back to normal AI until rewritten
            return normalAI(state, action);
        default:
            return easyAI(state, action);
    }
};

export const resolveRequiredOpponentAction = (
    currentGameState: GameState,
    setGameState: Dispatch<SetStateAction<GameState>>,
    difficulty: Difficulty,
    actions: OpponentActionDispatchers,
    phaseManager: PhaseManager,
    processAnimationQueue: (queue: AnimationRequest[], onComplete: () => void) => void,
    resolveActionWithCard: (s: GameState, c: string) => CardActionResult,
    resolveActionWithLane: (s: GameState, l: number) => LaneActionResult,
    trackPlayerRearrange?: TrackPlayerRearrange,
    enqueueAnimation?: (item: Omit<AnimationQueueItem, 'id'>) => void
) => {
    setGameState(state => {
        const action = state.actionRequired;
        if (!action) return state;

        // CRITICAL FIX: Determine if the AI ('opponent') needs to act during the player's turn OR during an interrupt.
        // If _interruptedTurn === 'player', the opponent can have actions even though turn === 'opponent'.
        const isPlayerTurnOrInterrupt = state.turn === 'player' || state._interruptedTurn === 'player';
        const isOpponentInterrupt = isPlayerTurnOrInterrupt && 'actor' in action && action.actor === 'opponent';

        if (!isOpponentInterrupt) return state;

        // NOTE: discard_completed is now handled directly in discardResolver via executeFollowUpAfterDiscard

        // --- EXECUTE FOLLOW UP EFFECT (AUTOMATIC - NO AI DECISION NEEDED) ---
        // CRITICAL: Must come BEFORE getAIAction because this is an automatic effect!
        if (action.type === 'execute_follow_up_effect') {
            const { sourceCardId, followUpEffect, actor, logContext } = action as any;
            const sourceCardInfo = findCardOnBoard(state, sourceCardId);

            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                let newState = { ...state };
                if (logContext?.sourceCardName) newState._currentEffectSource = logContext.sourceCardName;
                if (logContext?.phase) newState._currentPhaseContext = logContext.phase;
                if (logContext?.indentLevel !== undefined) newState._logIndentLevel = logContext.indentLevel;
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                const reason = !sourceCardInfo ? 'deleted' : 'flipped face-down';
                newState = log(newState, actor, `Follow-up effect from ${cardName} skipped (${reason}).`);
                newState.actionRequired = null;
                return endActionForPhase(newState, phaseManager);
            }

            const lane = state[sourceCardInfo.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
            const laneIdx = state[sourceCardInfo.owner].lanes.indexOf(lane!);
            const context = {
                cardOwner: sourceCardInfo.owner,
                actor: actor,
                currentTurn: state.turn,
                opponent: (sourceCardInfo.owner === 'player' ? 'opponent' : 'player') as Player,
            };

            let newState = { ...state, actionRequired: null };
            if (logContext?.sourceCardName) newState._currentEffectSource = logContext.sourceCardName;
            if (logContext?.phase) newState._currentPhaseContext = logContext.phase;
            if (logContext?.indentLevel !== undefined) newState._logIndentLevel = logContext.indentLevel;

            const result = executeCustomEffect(sourceCardInfo.card, laneIdx, newState, context, followUpEffect);
            newState = result.newState;

            if (newState.actionRequired) return newState;
            return endActionForPhase(newState, phaseManager);
        }

        const aiDecision = getAIAction(state, action, difficulty);

        // --- Specific Handlers First ---
        if (aiDecision.type === 'discardCards' && action.type === 'discard') {
            // CRITICAL FIX: Ensure AI only discards exactly action.count cards
            // This prevents bugs where AI might try to discard more than allowed
            const isVariableCount = (action as any).variableCount === true;
            const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
            const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

            // DRY: Create discard animations using centralized helper
            if (enqueueAnimation) {
                createAndEnqueueDiscardAnimations(state, cardIdsToDiscard, 'opponent', enqueueAnimation);
            }

            const newState = actions.discardCards(state, cardIdsToDiscard, 'opponent');
            if (newState.actionRequired) {
                return newState;
            }
            return endActionForPhase(newState, phaseManager);
        }

        // NOTE: Legacy plague/hate handlers removed - now use generic discard handler above

        if (aiDecision.type === 'rearrangeProtocols' && action.type === 'prompt_rearrange_protocols') {
            // Track AI rearrange in statistics ONLY if from Control Mechanic
            if (trackPlayerRearrange && action.sourceCardId === 'CONTROL_MECHANIC' && action.actor) {
                trackPlayerRearrange(action.actor);
            }

            const newState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
            const finalState = endActionForPhase(newState, phaseManager);
            return finalState;
        }

        if (action.type === 'reveal_opponent_hand') {
            const newState = actions.revealOpponentHand(state);
            return endActionForPhase(newState, phaseManager);
        }

        // CRITICAL: Handle prompt_optional_draw during interrupts (Death-1, etc.)
        if (aiDecision.type === 'resolveOptionalEffectPrompt' && action.type === 'prompt_optional_draw') {
            const nextState = resolvers.resolveOptionalDrawPrompt(state, aiDecision.accept);
            if (nextState.actionRequired) return nextState; // New action created (e.g., War-0 reactive)
            return endActionForPhase(nextState, phaseManager);
        }

        // GENERIC: Handle ALL optional effect prompts (Spirit-2, Spirit-3, etc. during interrupts)
        if (aiDecision.type === 'resolveOptionalEffectPrompt' && action.type === 'prompt_optional_effect') {
            const nextState = resolvers.resolveOptionalEffectPrompt(state, aiDecision.accept);
            if (nextState.actionRequired) return nextState; // New action created, re-run processor
            return endActionForPhase(nextState, phaseManager);
        }

        // GENERIC: Handle custom choice prompts during interrupts
        if (aiDecision.type === 'resolveCustomChoice' && action.type === 'custom_choice') {
            const nextState = resolvers.resolveCustomChoice(state, aiDecision.optionIndex);
            if (nextState.actionRequired) return nextState;
            return endActionForPhase(nextState, phaseManager);
        }

        // --- Generic Lane Selection Handler ---
        if (aiDecision.type === 'selectLane') {
            // CRITICAL FIX: Create shift animation BEFORE state change using DRY helper
            const shiftAnimationCreated = enqueueAnimation
                ? createAndEnqueueShiftAnimation(state, action, aiDecision.laneIndex, enqueueAnimation, true)
                : false;

            const { nextState, requiresAnimation } = resolveActionWithLane(state, aiDecision.laneIndex);
            if (requiresAnimation) {
                const wasStartPhase = state.phase === 'start';
                const originalTurn = state.turn;

                // Filter out shift requests if we already created the animation above
                const filteredRequests = shiftAnimationCreated
                    ? requiresAnimation.animationRequests.filter(r => r.type !== 'shift')
                    : requiresAnimation.animationRequests;

                processAnimationQueue(filteredRequests, () => {
                    setGameState(s => {
                        // CRITICAL: Ensure animationState is cleared before processing
                        const stateWithoutAnimation = { ...s, animationState: null };

                        // FIX: Create real turn progression callback (like useGameState.ts)
                        const endTurnCb = (stateToProgress: GameState): GameState => {
                            if (stateToProgress.actionRequired && stateToProgress.actionRequired.actor === 'opponent') {
                                return stateToProgress;
                            }
                            if (stateToProgress.turn !== originalTurn) {
                                return stateToProgress;
                            }
                            return wasStartPhase
                                ? phaseManager.continueTurnAfterStartPhaseAction(stateToProgress)
                                : phaseManager.processEndOfAction(stateToProgress);
                        };

                        const callbackResult = requiresAnimation.onCompleteCallback(stateWithoutAnimation, endTurnCb);
                        // CRITICAL: Process pending animation requests from reactive effects
                        const finalState = processPendingAnimationRequests(callbackResult, enqueueAnimation);

                        if (finalState.actionRequired) {
                            return { ...finalState, animationState: null };
                        }
                        if (finalState.turn !== originalTurn) {
                            return { ...finalState, animationState: null };
                        }

                        const resultState = wasStartPhase
                            ? phaseManager.continueTurnAfterStartPhaseAction(finalState)
                            : phaseManager.processEndOfAction(finalState);
                        return { ...resultState, animationState: null };
                    });
                });
                return nextState;
            }
            return endActionForPhase(nextState, phaseManager);
        }

        // --- Generic Card Selection Handler ---
        if (aiDecision.type === 'deleteCard' || aiDecision.type === 'flipCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard' || aiDecision.type === 'selectCard') {
            // DRY: Create animation using centralized helper
            const createdTypes = enqueueAnimation
                ? createAnimationForAIDecision(state, aiDecision, enqueueAnimation)
                : new Set<string>();

            // Don't pass enqueueAnimation if we already created the animation - prevents double creation
            const { nextState, requiresAnimation } = resolvers.resolveActionWithCard(
                state,
                aiDecision.cardId,
                createdTypes.size > 0 ? undefined : enqueueAnimation
            );

            if (requiresAnimation) {
                const wasStartPhase = state.phase === 'start';
                const originalTurn = state.turn;
                // DRY: Filter out already created animations
                const filteredRequests = filterAlreadyCreatedAnimations(
                    requiresAnimation.animationRequests,
                    createdTypes
                );
                processAnimationQueue(filteredRequests, () => {
                    setGameState(s => {
                        const stateWithoutAnimation = { ...s, animationState: null };

                        const endTurnCb = (stateToProgress: GameState): GameState => {
                            if (stateToProgress.actionRequired && stateToProgress.actionRequired.actor === 'opponent') {
                                return stateToProgress;
                            }
                            if (stateToProgress.turn !== originalTurn) {
                                return stateToProgress;
                            }
                            return wasStartPhase
                                ? phaseManager.continueTurnAfterStartPhaseAction(stateToProgress)
                                : phaseManager.processEndOfAction(stateToProgress);
                        };

                        const callbackResult = requiresAnimation.onCompleteCallback(stateWithoutAnimation, endTurnCb);
                        // CRITICAL: Process pending animation requests from reactive effects
                        const finalState = processPendingAnimationRequests(callbackResult, enqueueAnimation);

                        if (finalState.actionRequired) {
                            return { ...finalState, animationState: null };
                        }
                        if (finalState.turn !== originalTurn) {
                            return { ...finalState, animationState: null };
                        }

                        const resultState = wasStartPhase
                            ? phaseManager.continueTurnAfterStartPhaseAction(finalState)
                            : phaseManager.processEndOfAction(finalState);
                        return { ...resultState, animationState: null };
                    });
                });
                return nextState;
            }
            if (nextState.actionRequired && nextState.actionRequired.actor === 'opponent') {
                return nextState;
            }
            return endActionForPhase(nextState, phaseManager);
        }

        // --- Play Card from Hand Handler (Speed-0, Darkness-3 interrupt during player turn) ---
        if (aiDecision.type === 'playCard' && action.type === 'select_card_from_hand_to_play') {
            return handleAIPlayCard(state, aiDecision, setGameState, difficulty, actions, processAnimationQueue, phaseManager, false, enqueueAnimation);
        }

        // --- Luck Protocol Handlers (during interrupts) ---
        // State a number
        if (aiDecision.type === 'stateNumber' && action.type === 'state_number') {
            const newState = resolvers.resolveStateNumberAction(state, aiDecision.number);
            if (newState.actionRequired && newState.actionRequired.actor === 'opponent') return newState;
            return endActionForPhase(newState, phaseManager);
        }

        // State a protocol
        if (aiDecision.type === 'stateProtocol' && action.type === 'state_protocol') {
            const newState = resolvers.resolveStateProtocolAction(state, aiDecision.protocol);
            if (newState.actionRequired && newState.actionRequired.actor === 'opponent') return newState;
            return endActionForPhase(newState, phaseManager);
        }

        // Select from drawn cards to reveal
        if (aiDecision.type === 'selectFromDrawnToReveal' && action.type === 'select_from_drawn_to_reveal') {
            const newState = resolvers.resolveSelectFromDrawnToReveal(state, aiDecision.cardId);
            if (newState.actionRequired && newState.actionRequired.actor === 'opponent') return newState;
            return endActionForPhase(newState, phaseManager);
        }

        // Confirm deck discard (informational modal)
        if (aiDecision.type === 'confirmDeckDiscard' && action.type === 'confirm_deck_discard') {
            const newState = resolvers.resolveConfirmDeckDiscard(state);
            if (newState.actionRequired && newState.actionRequired.actor === 'opponent') return newState;
            return endActionForPhase(newState, phaseManager);
        }

        // Confirm deck play preview (transitions to lane selection)
        if (aiDecision.type === 'confirmDeckPlayPreview' && action.type === 'confirm_deck_play_preview') {
            const newState = resolvers.resolveConfirmDeckPlayPreview(state);
            if (newState.actionRequired && newState.actionRequired.actor === 'opponent') return newState;
            return endActionForPhase(newState, phaseManager);
        }

        // CRITICAL: Handle execute_conditional_followup during interrupts
        // This happens when a reactive effect (War-0's after_opponent_draw) interrupts
        // a conditional chain (Death-1's "if you do, delete other then delete self")
        if (action.type === 'execute_conditional_followup') {
            const { sourceCardId, laneIndex, followUpEffect, context: effectContext, actor, logSource, logPhase, logIndentLevel } = action as any;

            // Find the source card
            const sourceCard = findCardOnBoard(state, sourceCardId);

            if (!sourceCard) {
                // Card no longer exists (was deleted) - skip the followUp and log
                // CRITICAL: Restore the ORIGINAL log context before logging
                let newState = { ...state };
                if (logSource !== undefined) newState._currentEffectSource = logSource;
                if (logPhase !== undefined) newState._currentPhaseContext = logPhase;
                if (logIndentLevel !== undefined) newState._logIndentLevel = logIndentLevel;

                newState = log(newState, actor, `Follow-up effect skipped (source no longer active).`);
                newState.actionRequired = null;
                return endActionForPhase(newState, phaseManager);
            }

            // Source card still exists - execute the follow-up effect
            let newState = { ...state, actionRequired: null };
            const result = executeCustomEffect(sourceCard.card, laneIndex, newState, effectContext, followUpEffect);
            newState = result.newState;

            if (newState.actionRequired) return newState;
            return endActionForPhase(newState, phaseManager);
        }

        const stateWithClearedAction = { ...state, actionRequired: null };
        return endActionForPhase(stateWithClearedAction, phaseManager);
    });
};


const handleRequiredAction = (
    state: GameState,
    setGameState: Dispatch<SetStateAction<GameState>>,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    processAnimationQueue: (queue: AnimationRequest[], onComplete: () => void) => void,
    phaseManager: PhaseManager,
    trackPlayerRearrange?: TrackPlayerRearrange,
    enqueueAnimation?: (item: Omit<AnimationQueueItem, 'id'>) => void
): GameState => {

    const action = state.actionRequired!; // Action is guaranteed to exist here

    // NOTE: discard_completed is now handled directly in discardResolver via executeFollowUpAfterDiscard

    const aiDecision = getAIAction(state, state.actionRequired, difficulty);
    if (aiDecision.type === 'skip') {
        const newState = actions.skipAction(state);
        const stateAfterSkip = state.phase === 'start' ? phaseManager.continueTurnAfterStartPhaseAction(newState) : phaseManager.processEndOfAction(newState);

        // CRITICAL FIX: After skipping a start-phase action, the turn should continue!
        // If there's no actionRequired and it's still opponent's turn, we need to continue processing.
        // Schedule a recursive call to runOpponentTurn to handle the next phase (action/compile).
        if (!stateAfterSkip.actionRequired && stateAfterSkip.turn === 'opponent' && !stateAfterSkip.winner) {
            setTimeout(() => {
                runOpponentTurn(stateAfterSkip, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
            }, 500);
        } else {
        }
        return stateAfterSkip;
    }

    if (aiDecision.type === 'resolveControlMechanicPrompt' && action.type === 'prompt_use_control_mechanic') {
        const { choice } = aiDecision;
        const { originalAction, actor } = action;

        if (choice === 'skip') {
            let stateAfterSkip = log(state, actor, "Opponent skips rearranging protocols.");
            stateAfterSkip.actionRequired = null;
            // Reset indent to 0 before resuming the main action (compile/refresh)
            stateAfterSkip = { ...stateAfterSkip, _logIndentLevel: 0 };

            if (originalAction.type === 'compile') {
                const laneIndex = originalAction.laneIndex;
                setTimeout(() => {
                    setGameState(s => {
                        const nextState = actions.compileLane(s, laneIndex);
                        if (nextState.winner) return nextState;
                        const finalState = phaseManager.processEndOfAction(nextState);
                        return { ...finalState, animationState: null };
                    });
                }, 1000);
                return { ...stateAfterSkip, animationState: { type: 'compile' as const, laneIndex }, compilableLanes: [] };
            } else if (originalAction.type === 'fill_hand') {
                // Only fill hand if the original action was fill_hand
                const stateAfterFill = actions.fillHand(stateAfterSkip, actor);
                return phaseManager.processEndOfAction(stateAfterFill);
            } else {
                // For continue_turn or resume_interrupted_turn after compile: just process end of action
                // Do NOT automatically fill hand!
                return phaseManager.processEndOfAction(stateAfterSkip);
            }
        } else { // 'player' or 'opponent'
            const target = choice;
            const actorName = 'Opponent';
            const targetName = target === 'opponent' ? "the player's" : "their own";
            let stateWithChoice = log(state, actor, `${actorName} chooses to rearrange ${targetName} protocols.`);
            
            stateWithChoice.actionRequired = {
                type: 'prompt_rearrange_protocols',
                sourceCardId: 'CONTROL_MECHANIC',
                target,
                actor,
                originalAction,
            };
            return stateWithChoice;
        }
    }
    
    // NOTE: Legacy Death-1, Love-1, Plague-2, Plague-4, Fire-3 prompt handlers removed
    // These now use generic prompt_optional_effect and resolveOptionalEffectPrompt

    if (aiDecision.type === 'resolveOptionalDiscardCustomPrompt' && action.type === 'prompt_optional_discard_custom') {
        const nextState = actions.resolveOptionalDiscardCustomPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState; // New action (discard), re-run processor
        return endActionForPhase(nextState, phaseManager); // Skipped, so end turn
    }

    // CRITICAL: Handle prompt_optional_draw specifically (Death-1, etc.)
    // This MUST come before the generic resolveOptionalEffectPrompt handler!
    if (aiDecision.type === 'resolveOptionalEffectPrompt' && action.type === 'prompt_optional_draw') {
        const nextState = actions.resolveOptionalDrawPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState; // New action created (e.g., War-0 reactive)
        return endActionForPhase(nextState, phaseManager);
    }

    // GENERIC: Handle ALL optional effect prompts
    if (aiDecision.type === 'resolveOptionalEffectPrompt') {
        const nextState = actions.resolveOptionalEffectPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) {
            return nextState;
        }
        return endActionForPhase(nextState, phaseManager);
    }

    // Clarity-4: "You may shuffle your trash into your deck."
    if (aiDecision.type === 'resolvePrompt' && action.type === 'prompt_optional_shuffle_trash') {
        if (!aiDecision.accept) {
            // AI declined - skip the shuffle
            let skippedState = { ...state };
            skippedState.actionRequired = null;
            skippedState = log(skippedState, action.actor, `${action.actor === 'player' ? 'Player' : 'Opponent'} skips shuffling trash into deck.`);
            return endActionForPhase(skippedState, phaseManager);
        }
        const nextState = performShuffleTrash(state, action.actor, `Clarity-4`);
        return endActionForPhase(nextState.newState, phaseManager);
    }

    // NOTE: Legacy Speed-3, Psychic-4, Spirit-1, Spirit-3 prompt handlers removed
    // These now use generic prompt_optional_effect and resolveOptionalEffectPrompt

    if (aiDecision.type === 'resolveSwapProtocols' && action.type === 'prompt_swap_protocols') {
        const nextState = actions.resolveSwapProtocols(state, aiDecision.indices);
        return endActionForPhase(nextState, phaseManager);
    }

    if (aiDecision.type === 'resolveCustomChoice' && action.type === 'custom_choice') {
        const nextState = actions.resolveCustomChoice(state, aiDecision.optionIndex);
        if (nextState.actionRequired) return nextState; // Choice may create follow-up action
        return endActionForPhase(nextState, phaseManager);
    }

    // NOTE: Legacy Fire-4 and Hate-1 discard handlers removed
    // These now use generic discard handler

    // GENERIC: Handle shift/flip/skip choice prompts (both legacy and custom protocol versions)
    if (aiDecision.type === 'resolveRevealBoardCardPrompt' &&
        (action.type === 'prompt_shift_or_flip_revealed_card' || action.type === 'prompt_shift_or_flip_board_card_custom')) {
        const nextState = resolvers.resolveRevealBoardCardPrompt(state, aiDecision.choice);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    if (aiDecision.type === 'rearrangeProtocols' && action.type === 'prompt_rearrange_protocols') {
        // Track AI rearrange in statistics ONLY if from Control Mechanic
        if (trackPlayerRearrange && action.sourceCardId === 'CONTROL_MECHANIC' && action.actor) {
            trackPlayerRearrange(action.actor);
        }

        const nextState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
        const finalState = endActionForPhase(nextState, phaseManager);
        return finalState;
    }

    // GENERIC: Handle ALL selectLane decisions - no whitelist needed
    // The AI returns selectLane for any lane selection action, and resolveActionWithLane handles it
    if (aiDecision.type === 'selectLane') {
        // CRITICAL FIX: Create shift animation BEFORE state change using DRY helper
        const shiftAnimationCreated = enqueueAnimation
            ? createAndEnqueueShiftAnimation(state, action, aiDecision.laneIndex, enqueueAnimation, true)
            : false;

        const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(state, aiDecision.laneIndex);

        // CRITICAL FIX: Capture flag BEFORE animation to prevent React state race condition
        const preserveCardPlayedFlagLane = state._cardPlayedThisActionPhase;

         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;

            // NEW: Filter out shift requests if we already created the animation
            const filteredRequests = shiftAnimationCreated
                ? animationRequests.filter(r => r.type !== 'shift')
                : animationRequests;

            // If using new system and we have filtered requests, use new system
            if (enqueueAnimation && filteredRequests.length > 0) {
                // Convert remaining requests to new animation system
                enqueueAnimationsFromRequests(state, filteredRequests, enqueueAnimation);
            }

            // Still need old system for callback timing (but skip if all requests filtered)
            if (filteredRequests.length === 0 && shiftAnimationCreated) {
                // All animations handled by new system - just call callback after animation completes
                // The callback will be triggered when isAnimating becomes false
                setGameState(s => {
                    const stateWithFlag = preserveCardPlayedFlagLane
                        ? { ...s, _cardPlayedThisActionPhase: true }
                        : s;
                    const callbackResult = onCompleteCallback(stateWithFlag, (finalState) => {
                        if (finalState.turn !== 'opponent') return finalState;
                        const stateAfterAction = finalState.phase === 'start'
                            ? phaseManager.continueTurnAfterStartPhaseAction(finalState)
                            : phaseManager.processEndOfAction(finalState);
                        return stateAfterAction;
                    });
                    // CRITICAL: Process pending animation requests from reactive effects
                    return processPendingAnimationRequests(callbackResult, enqueueAnimation);
                });
                return nextState;
            }

            processAnimationQueue(filteredRequests, () => {
                setGameState(s => {
                    // CRITICAL FIX: Restore flag that may have been lost due to React batching
                    const stateWithFlag = preserveCardPlayedFlagLane
                        ? { ...s, _cardPlayedThisActionPhase: true }
                        : s;
                    // CRITICAL: Clear animationState before processing to prevent softlock
                    const stateWithoutAnim = { ...stateWithFlag, animationState: null };
                    const callbackResult = onCompleteCallback(stateWithoutAnim, (finalState) => {
                        const cleanState = { ...finalState, animationState: null };
                        // CRITICAL FIX: Use cleanState.phase, not the closure's state.phase!
                        // Also check if turn already switched to prevent double-processing
                        if (cleanState.turn !== 'opponent') {
                            return cleanState;
                        }
                        const stateAfterAction = cleanState.phase === 'start'
                            ? phaseManager.continueTurnAfterStartPhaseAction(cleanState)
                            : phaseManager.processEndOfAction(cleanState);
                        const cleanAfterAction = { ...stateAfterAction, animationState: null };
                        // Schedule continuation after animated action completes
                        if (!cleanAfterAction.actionRequired && cleanAfterAction.turn === 'opponent' && !cleanAfterAction.winner) {
                            setTimeout(() => {
                                runOpponentTurn(cleanAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                            }, 500);
                        } else if (cleanAfterAction.actionRequired && cleanAfterAction.turn === 'opponent') {
                            // There's another action to handle
                            setTimeout(() => {
                                runOpponentTurn(cleanAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                            }, 300);
                        }
                        return cleanAfterAction;
                    });
                    // CRITICAL: Process pending animation requests from reactive effects (e.g., Hate-3's draw after delete)
                    return processPendingAnimationRequests(callbackResult, enqueueAnimation);
                });
            });
            return nextState;
        }
        // Non-animated case: return state, runOpponentTurn will handle continuation
        return endActionForPhase(nextState, phaseManager);
    }

    if (aiDecision.type === 'flipCard' || aiDecision.type === 'deleteCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard' || aiDecision.type === 'selectCard') {
        // DRY: Create animation using centralized helper
        const createdTypes = enqueueAnimation
            ? createAnimationForAIDecision(state, aiDecision, enqueueAnimation)
            : new Set<string>();

        // Don't pass enqueueAnimation if we already created the animation - prevents double creation
        const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(
            state,
            aiDecision.cardId,
            createdTypes.size > 0 ? undefined : enqueueAnimation
        );

        // CRITICAL FIX: Capture flag BEFORE animation to prevent React state race condition
        // When React batches state updates, the callback's `s` may lose _cardPlayedThisActionPhase
        const preserveCardPlayedFlag = state._cardPlayedThisActionPhase;

        if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            // DRY: Filter out already created animations
            const filteredRequestsAction = filterAlreadyCreatedAnimations(animationRequests, createdTypes);
            processAnimationQueue(filteredRequestsAction, () => {
                setGameState(s => {
                    const stateWithFlag = preserveCardPlayedFlag
                        ? { ...s, _cardPlayedThisActionPhase: true }
                        : s;
                    const stateWithoutAnim = { ...stateWithFlag, animationState: null };
                    const callbackResult = onCompleteCallback(stateWithoutAnim, (finalState) => {
                        // Ensure animationState stays null through all paths
                        const cleanState = { ...finalState, animationState: null };

                        // CRITICAL FIX: Check if turn already switched to player
                        if (cleanState.turn !== 'opponent') {
                            return cleanState;
                        }

                        // CRITICAL FIX: Check for queuedActions BEFORE checking actionRequired
                        // Otherwise Gravity-2's shift gets skipped and AI plays another card
                        if (cleanState.queuedActions && cleanState.queuedActions.length > 0) {
                            const stateAfterQueue = phaseManager.processEndOfAction(cleanState);
                            if (stateAfterQueue.actionRequired) {
                                runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                return { ...stateAfterQueue, animationState: null };
                            }
                            return { ...stateAfterQueue, animationState: null };
                        }
                        if (cleanState.actionRequired) {
                            runOpponentTurn(cleanState, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                            return cleanState;
                        }
                        if (cleanState.phase === 'start') {
                            const stateAfterAction = phaseManager.continueTurnAfterStartPhaseAction(cleanState);
                            const cleanAfterAction = { ...stateAfterAction, animationState: null };
                            // CRITICAL FIX: Schedule continuation of opponent's turn after start phase action
                            if (!cleanAfterAction.actionRequired && cleanAfterAction.turn === 'opponent' && !cleanAfterAction.winner) {
                                setTimeout(() => {
                                    runOpponentTurn(cleanAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                }, 500);
                            }
                            return cleanAfterAction;
                        } else {
                            const result = phaseManager.processEndOfAction(cleanState);
                            return { ...result, animationState: null };
                        }
                    });
                    // CRITICAL: Process pending animation requests from reactive effects
                    return processPendingAnimationRequests(callbackResult, enqueueAnimation);
                });
            });
            return nextState;
        }

        if (requiresTurnEnd) {
            return endActionForPhase(nextState, phaseManager);
        } else {
            // CRITICAL FIX: If there are queuedActions (e.g., Gravity-2 shift after flip),
            // we MUST process them via endActionForPhase. Otherwise the turn continues
            // without executing the queued effects, causing the AI to play another card!
            if (nextState.queuedActions && nextState.queuedActions.length > 0) {
                return endActionForPhase(nextState, phaseManager);
            }
            return nextState; // Action has a follow up actionRequired, re-run manager
        }
    }

    if (aiDecision.type === 'playCard' && action.type === 'select_card_from_hand_to_play') {
        return handleAIPlayCard(state, aiDecision, setGameState, difficulty, actions, processAnimationQueue, phaseManager, true, enqueueAnimation);
    }

    if (aiDecision.type === 'discardCards' && action.type === 'discard') {
        // CRITICAL FIX: Ensure AI only discards exactly action.count cards
        const isVariableCount = (action as any).variableCount === true;
        const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
        const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

        // DRY: Create discard animations using centralized helper
        if (enqueueAnimation) {
            createAndEnqueueDiscardAnimations(state, cardIdsToDiscard, 'opponent', enqueueAnimation);
        }

        const newState = actions.discardCards(state, cardIdsToDiscard, 'opponent');
        if (newState.actionRequired) return newState; // Handle chained effects
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'giveCard' && action.type === 'select_card_from_hand_to_give') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        if (newState.actionRequired) return newState; // Love-3 has a follow up
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'revealCard' && action.type === 'select_card_from_hand_to_reveal') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        return newState; // Should create a new action to flip
    }

    // Clarity-2/3: "Draw 1 card with a value of X revealed this way."
    if (aiDecision.type === 'selectRevealedDeckCard' && action.type === 'select_card_from_revealed_deck') {
        const newState = resolvers.resolveSelectRevealedDeckCard(state, aiDecision.cardId);
        return endActionForPhase(newState, phaseManager);
    }

    // Unity-4: "Reveal deck, draw all Unity cards, shuffle"
    if (aiDecision.type === 'confirmRevealDeckDrawProtocol' && action.type === 'reveal_deck_draw_protocol') {
        const newState = resolvers.resolveRevealDeckDrawProtocol(state);
        return endActionForPhase(newState, phaseManager);
    }

    // Luck-0: "State a number"
    if (aiDecision.type === 'stateNumber' && action.type === 'state_number') {
        const newState = resolvers.resolveStateNumberAction(state, aiDecision.number);
        if (newState.actionRequired) return newState; // Follow-up action (draw with reveal)
        return endActionForPhase(newState, phaseManager);
    }

    // Luck-3: "State a protocol"
    if (aiDecision.type === 'stateProtocol' && action.type === 'state_protocol') {
        const newState = resolvers.resolveStateProtocolAction(state, aiDecision.protocol);
        if (newState.actionRequired) return newState; // Follow-up action (discard from deck)
        return endActionForPhase(newState, phaseManager);
    }

    // Luck-0: "Reveal 1 card drawn with the stated number"
    if (aiDecision.type === 'selectFromDrawnToReveal' && action.type === 'select_from_drawn_to_reveal') {
        const newState = resolvers.resolveSelectFromDrawnToReveal(state, aiDecision.cardId);
        if (newState.actionRequired) return newState; // Follow-up action (may play it)
        return endActionForPhase(newState, phaseManager);
    }

    // Luck-2/3/4: Confirm deck discard (informational modal)
    if (aiDecision.type === 'confirmDeckDiscard' && action.type === 'confirm_deck_discard') {
        const newState = resolvers.resolveConfirmDeckDiscard(state);
        if (newState.actionRequired) return newState; // Follow-up effects
        return endActionForPhase(newState, phaseManager);
    }

    // Luck-1: Confirm deck play preview (transitions to lane selection)
    if (aiDecision.type === 'confirmDeckPlayPreview' && action.type === 'confirm_deck_play_preview') {
        const newState = resolvers.resolveConfirmDeckPlayPreview(state);
        if (newState.actionRequired) return newState; // Transitions to select_lane_for_play
        return endActionForPhase(newState, phaseManager);
    }

    // Time-0: Select card from trash to play
    if (aiDecision.type === 'selectTrashCard' && action.type === 'select_card_from_trash_to_play') {
        const newState = resolvers.resolveSelectTrashCardToPlay(state, aiDecision.cardIndex);
        if (newState.actionRequired) return newState; // Transitions to select_lane_for_play
        return endActionForPhase(newState, phaseManager);
    }

    // Time-3: Select card from trash to reveal
    if (aiDecision.type === 'selectTrashCard' && action.type === 'select_card_from_trash_to_reveal') {
        const newState = resolvers.resolveSelectTrashCardToReveal(state, aiDecision.cardIndex);
        if (newState.actionRequired) return newState; // Transitions to select_lane_for_play
        return endActionForPhase(newState, phaseManager);
    }

    const stateWithClearedAction = { ...state, actionRequired: null };
    return endActionForPhase(stateWithClearedAction, phaseManager);
};


export const runOpponentTurn = (
    currentGameState: GameState,
    setGameState: Dispatch<SetStateAction<GameState>>,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    processAnimationQueue: (queue: AnimationRequest[], onComplete: () => void) => void,
    phaseManager: PhaseManager,
    trackPlayerRearrange?: TrackPlayerRearrange,
    enqueueAnimation?: (item: Omit<AnimationQueueItem, 'id'>) => void
) => {
    if (enqueueAnimation) {
        const state = currentGameState;

        const canPlayCard =
            state.turn === 'opponent' &&
            !state.winner &&
            !state.animationState &&
            state.phase === 'action' &&
            !state.actionRequired &&
            !state._cardPlayedThisActionPhase;

        if (canPlayCard) {
            const mainAction = getAIAction(state, null, difficulty);

            if (mainAction.type === 'playCard') {
                // DRY: Create play animation BEFORE state update using centralized helper
                createAndEnqueuePlayAnimation(
                    state, mainAction.cardId, mainAction.laneIndex, mainAction.isFaceUp, 'opponent', enqueueAnimation, true
                );

                // Now update the game state
                setGameState(currentState => {
                    // Re-verify we're still in the right state
                    if (currentState.turn !== 'opponent' || currentState.winner || currentState.phase !== 'action') {
                        return currentState;
                    }

                    // Run the play logic
                    const { newState: stateAfterPlayLogic, animationRequests: onCoverAnims } = actions.playCard(currentState, mainAction.cardId, mainAction.laneIndex, mainAction.isFaceUp, 'opponent');

                    // CRITICAL: Set flag to prevent double-play when effects trigger runOpponentTurn
                    const stateWithPlayFlag = { ...stateAfterPlayLogic, _cardPlayedThisActionPhase: true };

                    // Process on-play effect immediately
                    let stateForOnPlay = { ...stateWithPlayFlag };
                    let onPlayResult: EffectResult = { newState: stateForOnPlay };

                    if (!stateForOnPlay.actionRequired && stateForOnPlay.queuedEffect) {
                        const { card: effectCard, laneIndex } = stateForOnPlay.queuedEffect;
                        const onPlayContext: EffectContext = {
                            cardOwner: 'opponent',
                            actor: 'opponent',
                            currentTurn: stateForOnPlay.turn,
                            opponent: 'player',
                            triggerType: 'play'
                        };
                        onPlayResult = executeOnPlayEffect(effectCard, laneIndex, stateForOnPlay, onPlayContext);
                        onPlayResult.newState.queuedEffect = undefined;
                    }

                    const stateAfterOnPlayLogic = onPlayResult.newState;

                    // Handle on-cover animations with old system for now
                    const allAnims = [...(onCoverAnims || []), ...(onPlayResult.animationRequests || [])];

                    // NEW: Convert animationRequests to new animation queue system
                    if (enqueueAnimation && allAnims.length > 0) {
                        enqueueAnimationsFromRequests(stateAfterOnPlayLogic, allAnims, enqueueAnimation);
                        // WICHTIG: Early return - NICHT auch processAnimationQueue aufrufen!
                        // Das würde doppelte Animationen erzeugen.
                        // State-Progression passiert über Hook 1 wenn isAnimating false wird.
                        return stateAfterOnPlayLogic;
                    }

                    // FALLBACK: Altes System nur wenn neues nicht verfügbar
                    if (allAnims.length > 0) {
                        processAnimationQueue(allAnims, () => {
                            setGameState(s => {
                                // CRITICAL FIX: Restore flag - AI just played a card, so flag must be true
                                // React batching may have lost this flag
                                const stateWithFlag = { ...s, _cardPlayedThisActionPhase: true };
                                // CRITICAL FIX: Check if turn already switched to player
                                if (stateWithFlag.turn !== 'opponent') {
                                    return stateWithFlag;
                                }
                                if (stateWithFlag.queuedActions && stateWithFlag.queuedActions.length > 0) {
                                    const stateAfterQueue = phaseManager.processEndOfAction(stateWithFlag);
                                    if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                        // CRITICAL: Use setTimeout to prevent synchronous double-play
                                        setTimeout(() => {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                        }, 0);
                                    }
                                    return stateAfterQueue;
                                }
                                if (stateWithFlag.actionRequired && stateWithFlag.turn === 'opponent') {
                                    // CRITICAL: Use setTimeout to prevent synchronous double-play
                                    setTimeout(() => {
                                        runOpponentTurn(stateWithFlag, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                    }, 0);
                                    return stateWithFlag;
                                }
                                return phaseManager.processEndOfAction(stateWithFlag);
                            });
                        });
                        return stateAfterOnPlayLogic;
                    }

                    // No effect animations - process end of action
                    // CRITICAL FIX: Check if turn already switched to player
                    if (stateAfterOnPlayLogic.turn !== 'opponent') {
                        return stateAfterOnPlayLogic;
                    }
                    if (stateAfterOnPlayLogic.queuedActions && stateAfterOnPlayLogic.queuedActions.length > 0) {
                        const stateAfterQueue = phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                        if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                            setTimeout(() => {
                                runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                            }, 100);
                        }
                        return stateAfterQueue;
                    }

                    if (stateAfterOnPlayLogic.actionRequired && stateAfterOnPlayLogic.turn === 'opponent') {
                        setTimeout(() => {
                            runOpponentTurn(stateAfterOnPlayLogic, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                        }, 100);
                        return stateAfterOnPlayLogic;
                    }

                    return phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                });

                // Return early - we've handled the playCard action
                return;
            }
        }
    }

    // Standard path (non-playCard actions or old animation system)
    setGameState(currentState => {
        if (currentState.turn !== 'opponent' || currentState.winner || currentState.animationState) {
            return currentState;
        }

        // CRITICAL FIX: runOpponentTurn should only act in specific phases where opponent makes decisions
        // start: Start-phase effects can create prompts for AI (e.g., Death-1)
        // compile: AI decides whether to compile
        // action: AI plays card or refreshes hand (ONLY ONCE per turn!)
        // hand_limit: AI must discard cards if > 5
        // end: End-phase effects can create prompts for AI (e.g., Love-1, Fire-3)
        // NOT included: control (automatic phase)
        const validPhases: GamePhase[] = ['start', 'compile', 'action', 'hand_limit', 'end'];
        if (!validPhases.includes(currentState.phase)) {
            return currentState; // Not a phase where opponent makes active decisions
        }

        if (currentState.actionRequired) {
            const action = currentState.actionRequired;
            // Determine if this action requires the human player to act. If so, AI must wait.
            let isPlayerAction = false;
            if (action.type === 'discard' && action.actor === 'player') {
                isPlayerAction = true;
            } else if ('actor' in action && action.actor === 'player') {
                // General case: The action is for the human player to resolve.
                isPlayerAction = true;
            }

            if (isPlayerAction) {
                return currentState; // Wait for player input.
            }
        }

        let state = { ...currentState };

        // Handle resolution-type actions that don't require AI decisions first
        if (state.actionRequired) {
            if (state.actionRequired.type === 'reveal_opponent_hand') {
                const stateAfterReveal = actions.revealOpponentHand(state);
                // After revealing, the AI's action is complete and it should proceed to the hand_limit phase.
                return phaseManager.processEndOfAction(stateAfterReveal);
            }
        }

        // --- Linear Turn Processing ---

        // 1. Process start phase effects. This may create an action.
        if (state.phase === 'start') {
            state = phaseManager.processStartOfTurn(state);
        }

        // 2. If an action is required (e.g. from start phase), handle it.
        if (state.actionRequired) {
            const stateAfterAction = handleRequiredAction(state, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);

            // Schedule continuation if AI is still active and no immediate action required
            if (!stateAfterAction.actionRequired && stateAfterAction.turn === 'opponent' && !stateAfterAction.winner) {
                if (stateAfterAction.phase !== 'hand_limit') {
                    setTimeout(() => {
                        runOpponentTurn(stateAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                    }, 300);
                }
            }
            return stateAfterAction;
        }

        // 3. Handle Compile Phase
        if (state.phase === 'compile' && state.compilableLanes.length > 0) {
            const compileAction = getAIAction(state, null, difficulty);
            if (compileAction.type === 'compile') {
                const laneIndex = compileAction.laneIndex;
                const stateBeforeCompile = resolvers.compileLane(state, laneIndex);

                if (stateBeforeCompile.actionRequired) {
                    return stateBeforeCompile;
                }

                setTimeout(() => {
                    setGameState(s => {
                        const nextState = actions.compileLane(s, laneIndex);
                        if (nextState.winner) {
                            return nextState;
                        }
                        const finalState = phaseManager.processEndOfAction(nextState);
                        return { ...finalState, animationState: null };
                    });
                }, 1000);
                return {
                    ...stateBeforeCompile,
                    animationState: { type: 'compile' as const, laneIndex },
                    compilableLanes: []
                };
            }
        }

        // 4. Handle Action Phase
        // CRITICAL: Check _cardPlayedThisActionPhase to prevent double-play bug.
        // The NEW animation path (lines 795-924) already checks canPlayCard which includes this flag,
        // but if that path doesn't return early (e.g., canPlayCard was false), we reach here.
        // Without this check, the AI would play another card after effects complete.
        if (state.phase === 'action' && !state._cardPlayedThisActionPhase) {
            const mainAction = getAIAction(state, null, difficulty);

            if (mainAction.type === 'fillHand') {
                // NEW ANIMATION SYSTEM: Create SEQUENTIAL draw animations for opponent
                // Each card gets its own animation with proper snapshot showing cards that already landed
                if (enqueueAnimation) {
                    const prevHandIds = new Set(state.opponent.hand.map(c => c.id));
                    let stateAfterAction = resolvers.fillHand(state, 'opponent');

                    // Find newly drawn cards and create sequential animations
                    const newCards = stateAfterAction.opponent.hand.filter(c => !prevHandIds.has(c.id));
                    if (newCards.length > 0) {
                        const animations = createSequentialDrawAnimations(
                            state,  // Use pre-draw state for initial snapshot
                            newCards,
                            'opponent',
                            state.opponent.hand.length  // Starting index in hand
                        );
                        // Add logMessage to first animation (refresh hand)
                        if (animations.length > 0) {
                            const logMsg = refreshHandMessage('opponent', newCards.length);
                            animations[0] = { ...animations[0], logMessage: { message: logMsg, player: 'opponent' } };
                        }
                        // FIXED: Enqueue synchronously instead of via queueMicrotask
                        animations.forEach(anim => enqueueAnimation(anim));

                        // CRITICAL: Clear animationState to prevent double-animation from useEffect
                        // (drawForPlayer sets animationState, but we already created the animation here)
                        stateAfterAction = { ...stateAfterAction, animationState: null };
                    }

                    if (stateAfterAction.actionRequired) {
                        return stateAfterAction;
                    }
                    return phaseManager.processEndOfAction(stateAfterAction);
                }

                // FALLBACK: Old system without animation
                const stateAfterAction = resolvers.fillHand(state, 'opponent');
                if (stateAfterAction.actionRequired) {
                    return stateAfterAction;
                }
                return phaseManager.processEndOfAction(stateAfterAction);
            }

            if (mainAction.type === 'playCard') {
                // Check if we can use the new animation system
                if (enqueueAnimation) {
                    // DRY: Create play animation BEFORE state update using centralized helper
                    createAndEnqueuePlayAnimation(
                        state, mainAction.cardId, mainAction.laneIndex, mainAction.isFaceUp, 'opponent', enqueueAnimation, true
                    );

                    // Now run the play logic - no animationState, state updates immediately
                    const { newState: stateAfterPlayLogic, animationRequests: onCoverAnims } = actions.playCard(state, mainAction.cardId, mainAction.laneIndex, mainAction.isFaceUp, 'opponent');

                    // CRITICAL: Set flag to prevent double-play when effects trigger runOpponentTurn
                    const stateWithPlayFlag = { ...stateAfterPlayLogic, _cardPlayedThisActionPhase: true };

                    // Process on-play effect immediately
                    let stateForOnPlay = { ...stateWithPlayFlag };
                    let onPlayResult: EffectResult = { newState: stateForOnPlay };

                    if (!stateForOnPlay.actionRequired && stateForOnPlay.queuedEffect) {
                        const { card: effectCard, laneIndex } = stateForOnPlay.queuedEffect;
                        const onPlayContext: EffectContext = {
                            cardOwner: 'opponent',
                            actor: 'opponent',
                            currentTurn: stateForOnPlay.turn,
                            opponent: 'player',
                            triggerType: 'play'
                        };
                        onPlayResult = executeOnPlayEffect(effectCard, laneIndex, stateForOnPlay, onPlayContext);
                        onPlayResult.newState.queuedEffect = undefined;
                    }

                    const stateAfterOnPlayLogic = onPlayResult.newState;

                    // Handle on-cover animations with old system for now
                    const allAnims = [...(onCoverAnims || []), ...(onPlayResult.animationRequests || [])];

                    // NEW: Convert animationRequests to new animation queue system
                    if (enqueueAnimation && allAnims.length > 0) {
                        enqueueAnimationsFromRequests(stateAfterOnPlayLogic, allAnims, enqueueAnimation);
                        // WICHTIG: Early return - NICHT auch processAnimationQueue aufrufen!
                        // Das würde doppelte Animationen erzeugen.
                        // State-Progression passiert über Hook 1 wenn isAnimating false wird.
                        return stateAfterOnPlayLogic;
                    }

                    // FALLBACK: Altes System nur wenn neues nicht verfügbar
                    if (allAnims.length > 0) {
                        processAnimationQueue(allAnims, () => {
                            setGameState(s => {
                                // CRITICAL FIX: Restore flag - AI just played a card, so flag must be true
                                // React batching may have lost this flag
                                const stateWithFlag = { ...s, _cardPlayedThisActionPhase: true };
                                // CRITICAL FIX: Check if turn already switched to player
                                if (stateWithFlag.turn !== 'opponent') {
                                    return stateWithFlag;
                                }
                                if (stateWithFlag.queuedActions && stateWithFlag.queuedActions.length > 0) {
                                    const stateAfterQueue = phaseManager.processEndOfAction(stateWithFlag);
                                    if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                        // CRITICAL: Use setTimeout to prevent synchronous double-play
                                        setTimeout(() => {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                        }, 0);
                                    }
                                    return stateAfterQueue;
                                }
                                if (stateWithFlag.actionRequired && stateWithFlag.turn === 'opponent') {
                                    // CRITICAL: Use setTimeout to prevent synchronous double-play
                                    setTimeout(() => {
                                        runOpponentTurn(stateWithFlag, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                    }, 0);
                                    return stateWithFlag;
                                }
                                return phaseManager.processEndOfAction(stateWithFlag);
                            });
                        });
                        return stateAfterOnPlayLogic;
                    }

                    // No effect animations - process end of action
                    // CRITICAL FIX: Check if turn already switched to player
                    if (stateAfterOnPlayLogic.turn !== 'opponent') {
                        return stateAfterOnPlayLogic;
                    }
                    if (stateAfterOnPlayLogic.queuedActions && stateAfterOnPlayLogic.queuedActions.length > 0) {
                        const stateAfterQueue = phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                        if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                            setTimeout(() => {
                                runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                            }, 100);
                        }
                        return stateAfterQueue;
                    }

                    if (stateAfterOnPlayLogic.actionRequired && stateAfterOnPlayLogic.turn === 'opponent') {
                        setTimeout(() => {
                            runOpponentTurn(stateAfterOnPlayLogic, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                        }, 100);
                        return stateAfterOnPlayLogic;
                    }

                    return phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                }

                // FALLBACK: Old animation system
                const { newState: stateAfterPlayLogic, animationRequests: onCoverAnims } = actions.playCard(state, mainAction.cardId, mainAction.laneIndex, mainAction.isFaceUp, 'opponent');
                // CRITICAL: Set flag to prevent double-play when effects trigger runOpponentTurn
                const stateWithPlayAnimation = { ...stateAfterPlayLogic, animationState: { type: 'playCard' as const, cardId: mainAction.cardId, owner: 'opponent' as Player }, _cardPlayedThisActionPhase: true };

                setTimeout(() => { // Play card animation delay
                    const onAnimsComplete = () => {
                        setGameState(s_after_cover_anims => { // Renamed for clarity
                            // CRITICAL FIX: Restore flag - AI just played a card, so flag must be true
                            // React batching may have lost this flag
                            let stateForOnPlay = { ...s_after_cover_anims, _cardPlayedThisActionPhase: true };
                            let onPlayResult: EffectResult = { newState: stateForOnPlay };

                            if (stateForOnPlay.actionRequired) {
                                // An on-cover effect created an action. Do not process the on-play effect.
                            } else if (stateForOnPlay.queuedEffect) {
                                const { card, laneIndex } = stateForOnPlay.queuedEffect;
                                const onPlayContext: EffectContext = {
                                    cardOwner: 'opponent',
                                    actor: 'opponent',
                                    currentTurn: stateForOnPlay.turn,
                                    opponent: 'player',
                                    triggerType: 'play'
                                };
                                onPlayResult = executeOnPlayEffect(card, laneIndex, stateForOnPlay, onPlayContext);
                                onPlayResult.newState.queuedEffect = undefined;
                            }

                            const onPlayAnims = onPlayResult.animationRequests;
                            const stateAfterOnPlayLogic = onPlayResult.newState;

                            const onAllAnimsComplete = () => {
                                setGameState(s_after_all_anims => {
                                    // CRITICAL FIX: Restore flag - AI just played a card, so flag must be true
                                    const stateWithFlag = { ...s_after_all_anims, _cardPlayedThisActionPhase: true };
                                    // CRITICAL FIX: Check if turn already switched to player
                                    if (stateWithFlag.turn !== 'opponent') {
                                        return stateWithFlag;
                                    }
                                    // CRITICAL FIX: Process queuedActions before checking actionRequired
                                    // This ensures multi-effect cards (like Gravity-2) complete all effects
                                    if (stateWithFlag.queuedActions && stateWithFlag.queuedActions.length > 0) {
                                        const stateAfterQueue = phaseManager.processEndOfAction(stateWithFlag);
                                        // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                        if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                        }
                                        return stateAfterQueue;
                                    }
                                    // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                    if (stateWithFlag.actionRequired && stateWithFlag.turn === 'opponent') {
                                        runOpponentTurn(stateWithFlag, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                        return stateWithFlag;
                                    } else {
                                        // CRITICAL FIX: Return the phase-advanced state directly instead of
                                        // calling nested setGameState. This prevents race conditions where
                                        // the old state (still in 'action' phase) triggers another AI turn.
                                        return phaseManager.processEndOfAction(stateWithFlag);
                                    }
                                });
                            };

                            if (onPlayAnims && onPlayAnims.length > 0) {
                                processAnimationQueue(onPlayAnims, onAllAnimsComplete);
                                return stateAfterOnPlayLogic;
                            } else {
                                // CRITICAL FIX: Check if turn already switched to player
                                if (stateAfterOnPlayLogic.turn !== 'opponent') {
                                    return stateAfterOnPlayLogic;
                                }
                                // CRITICAL FIX: Process queuedActions before checking actionRequired
                                if (stateAfterOnPlayLogic.queuedActions && stateAfterOnPlayLogic.queuedActions.length > 0) {
                                    const stateAfterQueue = phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                                    // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                    if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                        runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                    }
                                    return stateAfterQueue;
                                }
                                // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                if (stateAfterOnPlayLogic.actionRequired && stateAfterOnPlayLogic.turn === 'opponent') {
                                    runOpponentTurn(stateAfterOnPlayLogic, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                    return stateAfterOnPlayLogic;
                                } else {
                                    // CRITICAL FIX: Return the phase-advanced state directly instead of
                                    // calling nested setGameState. This prevents race conditions where
                                    // the old state (still in 'action' phase) triggers another AI turn.
                                    return phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                                }
                            }
                        });
                    };

                    setGameState(s => {
                        // CRITICAL FIX: Restore flag - AI just played a card, so flag must be true
                        const stateAfterPlayAnim = { ...s, animationState: null, _cardPlayedThisActionPhase: true };
                        if (onCoverAnims && onCoverAnims.length > 0) {
                            processAnimationQueue(onCoverAnims, onAnimsComplete);
                        } else {
                            onAnimsComplete();
                        }
                        return stateAfterPlayAnim;
                    });

                }, 500);

                return stateWithPlayAnimation;
            }
        }

        // 5. If we reach here, no action was taken in compile/action phase.
        // CRITICAL FIX: For end phase, use continueTurnProgression instead of processEndOfAction.
        // This ensures end-phase effects (like Psychic-4's End effect) are executed via advancePhase.
        // processEndOfAction doesn't call advancePhase for the 'end' case, it only handles post-action cleanup.
        if (state.phase === 'end' || state.phase === 'hand_limit') {
            return phaseManager.continueTurnProgression(state);
        }

        // CRITICAL FIX: If we're in action phase but the flag is set (AI already played),
        // we should advance to hand_limit phase but NOT trigger runOpponentTurn again.
        // The issue was that processEndOfAction would process through ALL phases,
        // then useGameState sees it's opponent's turn and calls runOpponentTurn again!
        if (state.phase === 'action' && state._cardPlayedThisActionPhase) {
            const nextState = { ...state, phase: 'hand_limit' as const, _cardPlayedThisActionPhase: undefined };
            return phaseManager.continueTurnProgression(nextState);
        }

        return phaseManager.processEndOfAction(state);
    });
};

// =============================================================================
// NEW SYNCHRONOUS AI SYSTEM
// =============================================================================

/**
 * SYNCHRONOUS version of handleRequiredAction.
 * Handles a single actionRequired and returns the new state.
 * Does NOT use setTimeout or callbacks - all logic is synchronous.
 * Animations are enqueued but NOT waited for.
 */
const handleRequiredActionSync = (
    state: GameState,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    phaseManager: PhaseManager,
    enqueueAnimation: (item: Omit<AnimationQueueItem, 'id'>) => void
): GameState => {
    const action = state.actionRequired!;

    // --- EXECUTE FOLLOW UP EFFECT (AUTOMATIC - NO AI DECISION NEEDED) ---
    // CRITICAL: Must come BEFORE getAIAction because this is an automatic effect!
    if (action.type === 'execute_follow_up_effect') {
        const { sourceCardId, followUpEffect, actor, logContext } = action as any;
        const sourceCardInfo = findCardOnBoard(state, sourceCardId);

        if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
            let newState = { ...state };
            if (logContext?.sourceCardName) newState._currentEffectSource = logContext.sourceCardName;
            if (logContext?.phase) newState._currentPhaseContext = logContext.phase;
            if (logContext?.indentLevel !== undefined) newState._logIndentLevel = logContext.indentLevel;
            const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
            const reason = !sourceCardInfo ? 'deleted' : 'flipped face-down';
            newState = log(newState, actor, `Follow-up effect from ${cardName} skipped (${reason}).`);
            newState.actionRequired = null;
            return endActionForPhase(newState, phaseManager);
        }

        const lane = state[sourceCardInfo.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
        const laneIdx = state[sourceCardInfo.owner].lanes.indexOf(lane!);
        const context = {
            cardOwner: sourceCardInfo.owner,
            actor: actor,
            currentTurn: state.turn,
            opponent: (sourceCardInfo.owner === 'player' ? 'opponent' : 'player') as Player,
        };

        // Restore log context
        let newState = { ...state, actionRequired: null };
        if (logContext?.sourceCardName) newState._currentEffectSource = logContext.sourceCardName;
        if (logContext?.phase) newState._currentPhaseContext = logContext.phase;
        if (logContext?.indentLevel !== undefined) newState._logIndentLevel = logContext.indentLevel;

        const result = executeCustomEffect(sourceCardInfo.card, laneIdx, newState, context, followUpEffect);
        newState = result.newState;

        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    const aiDecision = getAIAction(state, action, difficulty);

    // --- SKIP ---
    if (aiDecision.type === 'skip') {
        const newState = actions.skipAction(state);
        return state.phase === 'start'
            ? phaseManager.continueTurnAfterStartPhaseAction(newState)
            : phaseManager.processEndOfAction(newState);
    }

    // --- SELECT LANE (for shift, play from deck, etc.) ---
    if (aiDecision.type === 'selectLane') {
        // CRITICAL FIX: Create shift animation BEFORE state change using DRY helper
        createAndEnqueueShiftAnimation(state, action, aiDecision.laneIndex, enqueueAnimation, true);

        // Execute lane selection synchronously
        const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(state, aiDecision.laneIndex);

        // CRITICAL FIX: Process animations for select_lane actions (Death-2 delete, Water-3 return, etc.)
        // Use enqueueAnimationsFromRequests for DRY - it handles all animation types
        if (requiresAnimation && enqueueAnimation) {
            enqueueAnimationsFromRequests(state, requiresAnimation.animationRequests, enqueueAnimation);
        }

        if (nextState.actionRequired && nextState.actionRequired.actor === 'opponent') {
            return nextState; // More actions to handle - loop will continue
        }
        return endActionForPhase(nextState, phaseManager);
    }

    // --- SELECT CARD (flip, delete, return, shift) ---
    if (aiDecision.type === 'flipCard' || aiDecision.type === 'deleteCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard' || aiDecision.type === 'selectCard') {
        // DRY: Create animation BEFORE state change using centralized helper
        createAnimationForAIDecision(state, aiDecision, enqueueAnimation);

        // Execute card action synchronously (don't pass enqueueAnimation - we already created animation)
        const result = resolvers.resolveActionWithCard(state, aiDecision.cardId);

        // CRITICAL: Use applyCardActionResult to ensure followUpEffects are ALWAYS processed
        // This is where Death-1's "then delete this card" etc. gets executed
        const endTurnCb = (stateToProgress: GameState): GameState => {
            if (stateToProgress.actionRequired && stateToProgress.actionRequired.actor === 'opponent') {
                return stateToProgress;
            }
            return state.phase === 'start'
                ? phaseManager.continueTurnAfterStartPhaseAction(stateToProgress)
                : phaseManager.processEndOfAction(stateToProgress);
        };
        let stateAfterCallback = applyCardActionResult(result, endTurnCb);

        // Enqueue any pending animations collected during sync execution
        if (stateAfterCallback._pendingAnimations && stateAfterCallback._pendingAnimations.length > 0) {
            for (const animItem of stateAfterCallback._pendingAnimations) {
                const { id, ...itemWithoutId } = animItem;
                enqueueAnimation(itemWithoutId);
            }
            stateAfterCallback = { ...stateAfterCallback, _pendingAnimations: undefined };
        }

        if (stateAfterCallback.actionRequired && stateAfterCallback.actionRequired.actor === 'opponent') {
            return stateAfterCallback;
        }
        if (result.requiresTurnEnd || (stateAfterCallback.queuedActions && stateAfterCallback.queuedActions.length > 0)) {
            return endActionForPhase(stateAfterCallback, phaseManager);
        }
        return stateAfterCallback;
    }

    // --- DISCARD CARDS ---
    if (aiDecision.type === 'discardCards' && action.type === 'discard') {
        const isVariableCount = (action as any).variableCount === true;
        const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
        const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

        // DRY: Create discard animations using centralized helper
        createAndEnqueueDiscardAnimations(state, cardIdsToDiscard, 'opponent', enqueueAnimation);

        const newState = actions.discardCards(state, cardIdsToDiscard, 'opponent');
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- REARRANGE PROTOCOLS ---
    if (aiDecision.type === 'rearrangeProtocols' && action.type === 'prompt_rearrange_protocols') {
        const newState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
        return endActionForPhase(newState, phaseManager);
    }

    // --- OPTIONAL PROMPTS ---
    if (aiDecision.type === 'resolveOptionalEffectPrompt') {
        if (action.type === 'prompt_optional_draw') {
            const nextState = actions.resolveOptionalDrawPrompt(state, aiDecision.accept);
            if (nextState.actionRequired) return nextState;
            return endActionForPhase(nextState, phaseManager);
        }
        const nextState = actions.resolveOptionalEffectPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- CUSTOM CHOICE ---
    if (aiDecision.type === 'resolveCustomChoice' && action.type === 'custom_choice') {
        const nextState = actions.resolveCustomChoice(state, aiDecision.optionIndex);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- SWAP PROTOCOLS ---
    if (aiDecision.type === 'resolveSwapProtocols' && action.type === 'prompt_swap_protocols') {
        const nextState = actions.resolveSwapProtocols(state, aiDecision.indices);
        return endActionForPhase(nextState, phaseManager);
    }

    // --- CONTROL MECHANIC ---
    if (aiDecision.type === 'resolveControlMechanicPrompt' && action.type === 'prompt_use_control_mechanic') {
        const { choice } = aiDecision;
        const { originalAction, actor } = action;

        if (choice === 'skip') {
            let stateAfterSkip = log(state, actor, "Opponent skips rearranging protocols.");
            stateAfterSkip.actionRequired = null;
            stateAfterSkip = { ...stateAfterSkip, _logIndentLevel: 0 };

            if (originalAction.type === 'compile') {
                // Return state - compile will be handled by main loop
                return { ...stateAfterSkip, phase: 'compile' as GamePhase };
            } else if (originalAction.type === 'fill_hand') {
                const stateAfterFill = actions.fillHand(stateAfterSkip, actor);
                return phaseManager.processEndOfAction(stateAfterFill);
            } else {
                return phaseManager.processEndOfAction(stateAfterSkip);
            }
        } else {
            const target = choice;
            const actorName = 'Opponent';
            const targetName = target === 'opponent' ? "the player's" : "their own";
            let stateWithChoice = log(state, actor, `${actorName} chooses to rearrange ${targetName} protocols.`);
            stateWithChoice.actionRequired = {
                type: 'prompt_rearrange_protocols',
                sourceCardId: 'CONTROL_MECHANIC',
                target,
                actor,
                originalAction,
            };
            return stateWithChoice;
        }
    }

    // --- PLAY CARD FROM HAND (Speed-0, Darkness-3) ---
    if (aiDecision.type === 'playCard' && action.type === 'select_card_from_hand_to_play') {
        const { cardId, laneIndex, isFaceUp } = aiDecision;

        // DRY: Create play animation BEFORE state change using centralized helper
        createAndEnqueuePlayAnimation(state, cardId, laneIndex, isFaceUp, 'opponent', enqueueAnimation, true);

        // Execute play logic
        const { newState: stateAfterPlay, animationRequests } = actions.playCard(
            { ...state, actionRequired: null },
            cardId, laneIndex, isFaceUp, 'opponent'
        );

        // Enqueue effect animations
        if (animationRequests && animationRequests.length > 0) {
            enqueueAnimationsFromRequests(stateAfterPlay, animationRequests, enqueueAnimation);
        }

        const stateWithFlag = { ...stateAfterPlay, _cardPlayedThisActionPhase: true };

        if (stateWithFlag.actionRequired) {
            return stateWithFlag;
        }
        return endActionForPhase(stateWithFlag, phaseManager);
    }

    // --- LUCK PROTOCOL HANDLERS ---
    if (aiDecision.type === 'stateNumber' && action.type === 'state_number') {
        const newState = resolvers.resolveStateNumberAction(state, aiDecision.number);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'stateProtocol' && action.type === 'state_protocol') {
        const newState = resolvers.resolveStateProtocolAction(state, aiDecision.protocol);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'selectFromDrawnToReveal' && action.type === 'select_from_drawn_to_reveal') {
        const newState = resolvers.resolveSelectFromDrawnToReveal(state, aiDecision.cardId);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'confirmDeckDiscard' && action.type === 'confirm_deck_discard') {
        const newState = resolvers.resolveConfirmDeckDiscard(state);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'confirmDeckPlayPreview' && action.type === 'confirm_deck_play_preview') {
        const newState = resolvers.resolveConfirmDeckPlayPreview(state);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- TIME PROTOCOL HANDLERS ---
    if (aiDecision.type === 'selectTrashCard' && action.type === 'select_card_from_trash_to_play') {
        const newState = resolvers.resolveSelectTrashCardToPlay(state, aiDecision.cardIndex);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'selectTrashCard' && action.type === 'select_card_from_trash_to_reveal') {
        const newState = resolvers.resolveSelectTrashCardToReveal(state, aiDecision.cardIndex);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- GIVE CARD ---
    if (aiDecision.type === 'giveCard' && action.type === 'select_card_from_hand_to_give') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- REVEAL CARD ---
    if (aiDecision.type === 'revealCard' && action.type === 'select_card_from_hand_to_reveal') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        return newState; // Should create a new action to flip
    }

    // --- REVEAL DECK DRAW PROTOCOL (Unity-4) ---
    if (aiDecision.type === 'confirmRevealDeckDrawProtocol' && action.type === 'reveal_deck_draw_protocol') {
        const newState = resolvers.resolveRevealDeckDrawProtocol(state);
        return endActionForPhase(newState, phaseManager);
    }

    // --- SELECT REVEALED DECK CARD (Clarity-2/3) ---
    if (aiDecision.type === 'selectRevealedDeckCard' && action.type === 'select_card_from_revealed_deck') {
        const newState = resolvers.resolveSelectRevealedDeckCard(state, aiDecision.cardId);
        return endActionForPhase(newState, phaseManager);
    }

    // --- REVEAL BOARD CARD PROMPT (shift or flip) ---
    if (aiDecision.type === 'resolveRevealBoardCardPrompt' &&
        (action.type === 'prompt_shift_or_flip_revealed_card' || action.type === 'prompt_shift_or_flip_board_card_custom')) {
        const nextState = resolvers.resolveRevealBoardCardPrompt(state, aiDecision.choice);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- OPTIONAL SHUFFLE TRASH (Clarity-4) ---
    if (aiDecision.type === 'resolvePrompt' && action.type === 'prompt_optional_shuffle_trash') {
        if (!aiDecision.accept) {
            let skippedState = { ...state, actionRequired: null };
            skippedState = log(skippedState, action.actor, `Opponent skips shuffling trash into deck.`);
            return endActionForPhase(skippedState, phaseManager);
        }
        const nextState = performShuffleTrash(state, action.actor, `Clarity-4`);
        return endActionForPhase(nextState.newState, phaseManager);
    }

    // --- OPTIONAL DISCARD CUSTOM ---
    if (aiDecision.type === 'resolveOptionalDiscardCustomPrompt' && action.type === 'prompt_optional_discard_custom') {
        const nextState = actions.resolveOptionalDiscardCustomPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- EXECUTE CONDITIONAL FOLLOWUP ---
    if (action.type === 'execute_conditional_followup') {
        const { sourceCardId, laneIndex, followUpEffect, context: effectContext, actor, logSource, logPhase, logIndentLevel } = action as any;
        const sourceCard = findCardOnBoard(state, sourceCardId);

        if (!sourceCard) {
            let newState = { ...state };
            if (logSource !== undefined) newState._currentEffectSource = logSource;
            if (logPhase !== undefined) newState._currentPhaseContext = logPhase;
            if (logIndentLevel !== undefined) newState._logIndentLevel = logIndentLevel;
            newState = log(newState, actor, `Follow-up effect skipped (source no longer active).`);
            newState.actionRequired = null;
            return endActionForPhase(newState, phaseManager);
        }

        let newState = { ...state, actionRequired: null };
        const result = executeCustomEffect(sourceCard.card, laneIndex, newState, effectContext, followUpEffect);
        newState = result.newState;

        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- UNKNOWN ACTION ---
    return endActionForPhase({ ...state, actionRequired: null }, phaseManager);
};

/**
 * SYNCHRONOUS version of runOpponentTurn.
 * Processes the ENTIRE AI turn in one synchronous call.
 * Returns the final state after all AI actions are complete.
 * Animations are enqueued but NOT waited for.
 *
 * This function uses a while loop to handle all AI actions:
 * 1. Start phase effects
 * 2. actionRequired handling (shift, flip, etc.)
 * 3. Compile phase
 * 4. Action phase (play card or fill hand)
 * 5. End phase
 *
 * The loop continues until no more AI actions are needed.
 */
export const runOpponentTurnSync = (
    initialState: GameState,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    phaseManager: PhaseManager,
    enqueueAnimation: (item: Omit<AnimationQueueItem, 'id'>) => void,
    onCompileLane?: (state: GameState, laneIndex: number) => GameState
): GameState => {
    let state = { ...initialState };

    // Enqueue a delay animation at the start of opponent's turn (AI "thinking" time)
    // This replaces the old 1500ms setTimeout delay and shows the correct game state during the wait
    const delayAnimation = createDelayAnimation(state, 1000);
    enqueueAnimation(delayAnimation);

    // Safety counter to prevent infinite loops
    let iterations = 0;
    const MAX_ITERATIONS = 50;

    while (iterations < MAX_ITERATIONS) {
        iterations++;

        // Exit conditions
        if (state.winner) return state;
        if (state.turn !== 'opponent') return state;

        // 1. Process start phase effects (first iteration only)
        if (state.phase === 'start' && !state.actionRequired) {
            state = phaseManager.processStartOfTurn(state);
            // After start phase, continue to check for actions
        }

        // 2. Handle actionRequired for opponent
        if (state.actionRequired) {
            const action = state.actionRequired;

            // Check if this action is for the player (opponent should wait)
            const isPlayerAction = 'actor' in action && action.actor === 'player';

            if (isPlayerAction) {
                // Player needs to act - return current state
                return state;
            }

            // Handle opponent action synchronously
            state = handleRequiredActionSync(state, difficulty, actions, phaseManager, enqueueAnimation);
            continue; // Loop back to check for more actions
        }

        // 3. Handle compile phase
        if (state.phase === 'compile' && state.compilableLanes.length > 0) {
            const decision = getAIAction(state, null, difficulty);
            if (decision.type === 'compile') {
                const laneIndex = decision.laneIndex;

                // CRITICAL: Save state BEFORE compile for animation snapshot
                const stateBeforeCompile = state;

                // Use provided compile function or default
                if (onCompileLane) {
                    state = onCompileLane(state, laneIndex);
                } else {
                    state = actions.compileLane(state, laneIndex);
                }

                // DRY: Use central helper for compile animations
                state = processCompileAnimations(state, stateBeforeCompile, laneIndex, 'opponent', enqueueAnimation);

                if (state.winner) return state;

                // Process end of compile action
                state = phaseManager.processEndOfAction(state);
                continue; // Check for control mechanic prompt
            }
        }

        // 4. Handle action phase
        if (state.phase === 'action' && !state._cardPlayedThisActionPhase) {
            const decision = getAIAction(state, null, difficulty);

            // Fill hand
            if (decision.type === 'fillHand') {
                const prevHandIds = new Set(state.opponent.hand.map(c => c.id));
                state = resolvers.fillHand(state, 'opponent');

                // Create draw animations
                const newCards = state.opponent.hand.filter(c => !prevHandIds.has(c.id));
                if (newCards.length > 0) {
                    const animations = createSequentialDrawAnimations(
                        initialState, // Use pre-draw state for snapshot
                        newCards,
                        'opponent',
                        initialState.opponent.hand.length
                    );
                    // Add logMessage to first animation (refresh hand)
                    if (animations.length > 0) {
                        const logMsg = refreshHandMessage('opponent', newCards.length);
                        animations[0] = { ...animations[0], logMessage: { message: logMsg, player: 'opponent' } };
                    }
                    animations.forEach(anim => enqueueAnimation(anim));
                }

                // Clear animationState since we handle animations directly
                state = { ...state, animationState: null };

                if (state.actionRequired) continue;
                state = phaseManager.processEndOfAction(state);
                continue;
            }

            // Play card
            if (decision.type === 'playCard') {
                const { cardId, laneIndex, isFaceUp } = decision;

                // DRY: Create play animation BEFORE state change using centralized helper
                createAndEnqueuePlayAnimation(state, cardId, laneIndex, isFaceUp, 'opponent', enqueueAnimation, true);

                // Execute play logic
                const { newState: stateAfterPlay, animationRequests } = actions.playCard(
                    state, cardId, laneIndex, isFaceUp, 'opponent'
                );

                state = { ...stateAfterPlay, _cardPlayedThisActionPhase: true };

                // Enqueue effect animations (on-cover)
                if (animationRequests && animationRequests.length > 0) {
                    enqueueAnimationsFromRequests(state, animationRequests, enqueueAnimation);
                }

                // Process on-play effect if queued
                if (!state.actionRequired && state.queuedEffect) {
                    const { card: effectCard, laneIndex: effectLane } = state.queuedEffect;
                    const onPlayContext: EffectContext = {
                        cardOwner: 'opponent',
                        actor: 'opponent',
                        currentTurn: state.turn,
                        opponent: 'player',
                        triggerType: 'play'
                    };
                    const onPlayResult = executeOnPlayEffect(effectCard, effectLane, state, onPlayContext);
                    state = { ...onPlayResult.newState, queuedEffect: undefined };

                    // Enqueue on-play effect animations (including draw animations - now uses animationRequests like all effects)
                    if (onPlayResult.animationRequests && onPlayResult.animationRequests.length > 0) {
                        enqueueAnimationsFromRequests(state, onPlayResult.animationRequests, enqueueAnimation);
                    }
                }

                // Continue to check for actionRequired from effects
                continue;
            }
        }

        // 5. No more actions in current phase - advance phase
        // Check if we need to process queuedActions
        if (state.queuedActions && state.queuedActions.length > 0) {
            state = phaseManager.processEndOfAction(state);
            continue;
        }

        // Process end of action/phase
        if (state.phase === 'action' && state._cardPlayedThisActionPhase) {
            // Card was played, advance to hand_limit
            state = { ...state, phase: 'hand_limit' as GamePhase, _cardPlayedThisActionPhase: undefined };
        }

        // Continue turn progression
        // CRITICAL: Clear animationState before calling continueTurnProgression
        // AI handles animations via enqueueAnimation, not via animationState.
        // If we don't clear it, the AI loop can get stuck because continueTurnProgression
        // now preserves animationState (fix for player draw animations).
        state = { ...state, animationState: null };
        state = phaseManager.continueTurnProgression(state);

        // If turn switched to player, we're done
        if (state.turn === 'player') {
            return state;
        }

        // If we're still in opponent's turn but no action to take, continue loop
        // (This handles phase transitions like end -> start of next turn)
    }

    console.error('[SYNC] AI turn exceeded max iterations, returning current state');
    return state;
};