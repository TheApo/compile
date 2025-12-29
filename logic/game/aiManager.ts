/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, Difficulty, EffectResult, AnimationRequest, EffectContext, GamePhase } from '../../types';
import { easyAI } from '../ai/easy';
import { normalAI } from '../ai/normal';
// TEMPORARILY DISABLED: hardAI is being completely rewritten
// import { hardAI } from '../ai/hardImproved';
import { Dispatch, SetStateAction } from 'react';
import * as resolvers from './resolvers';
import { executeOnPlayEffect } from '../effectExecutor';
import { findCardOnBoard } from './helpers/actionUtils';
import { performShuffleTrash } from '../effects/actions/shuffleExecutor';
import { CardActionResult } from './resolvers/cardResolver';
import { LaneActionResult } from './resolvers/laneResolver';
import { log } from '../utils/log';
import { executeCustomEffect } from '../customProtocols/effectInterpreter';
import { AnimationQueueItem } from '../../types/animation';
import { createPlayAnimation, createDrawAnimation, createSequentialDrawAnimations, createSequentialDiscardAnimations, createShiftAnimation, createDiscardAnimation, findCardInLanes, createDeleteAnimation, createReturnAnimation } from '../animation/animationHelpers';

// Feature flag for new animation queue system in AI
const USE_NEW_AI_ANIMATION_SYSTEM = true;

/**
 * Convert AnimationRequest[] to AnimationQueueItem[] and enqueue them
 * This bridges the old animationRequests system with the new animation queue
 */
function enqueueAnimationsFromRequests(
    state: GameState,
    animationRequests: AnimationRequest[],
    enqueueAnimation: (animation: Omit<AnimationQueueItem, 'id'>) => void
): void {
    for (const request of animationRequests) {
        if (request.type === 'play' && request.fromDeck && request.toLane !== undefined) {
            // Play from deck animation
            const playCard = state[request.owner].lanes[request.toLane]?.find(c => c.id === request.cardId);
            if (playCard) {
                const animation = createPlayAnimation(
                    state,
                    playCard,
                    request.owner,
                    request.toLane,
                    false,  // fromHand = false (from deck)
                    undefined,  // no handIndex
                    request.isFaceUp ?? false,
                    request.owner === 'opponent'
                );
                enqueueAnimation(animation);
            }
        } else if (request.type === 'shift') {
            const shiftCard = state[request.owner].lanes.flat().find(c => c.id === request.cardId);
            const fromCardIndex = state[request.owner].lanes[request.fromLane]?.findIndex(c => c.id === request.cardId) ?? -1;
            if (shiftCard && fromCardIndex >= 0) {
                const animation = createShiftAnimation(
                    state,
                    shiftCard,
                    request.owner,
                    request.fromLane,
                    fromCardIndex,
                    request.toLane
                );
                enqueueAnimation(animation);
            }
        } else if (request.type === 'delete') {
            const deleteCard = state[request.owner].lanes.flat().find(c => c.id === request.cardId);
            const cardPosition = findCardInLanes(state, request.cardId, request.owner);
            if (deleteCard && cardPosition) {
                const animation = createDeleteAnimation(
                    state,
                    deleteCard,
                    request.owner,
                    cardPosition.laneIndex,
                    cardPosition.cardIndex
                );
                enqueueAnimation(animation);
            }
        } else if (request.type === 'draw') {
            // Draw X cards animation (from effects like "Draw 2 cards")
            const hand = state[request.player].hand;
            const newCards = hand.slice(-request.count);
            const startIndex = hand.length - request.count;

            if (newCards.length > 0) {
                const animations = createSequentialDrawAnimations(
                    state,  // Use current state - cards are already in hand
                    newCards,
                    request.player,
                    startIndex
                );
                animations.forEach(anim => enqueueAnimation(anim));
            }
        } else if (request.type === 'return') {
            // Return card animation (from effects like "Return 1 card")
            const cardPosition = findCardInLanes(state, request.cardId, request.owner);
            const card = state[request.owner].lanes.flat().find(c => c.id === request.cardId);
            if (card && cardPosition) {
                const animation = createReturnAnimation(
                    state,
                    card,
                    request.owner,
                    cardPosition.laneIndex,
                    cardPosition.cardIndex,
                    true  // setFaceDown
                );
                enqueueAnimation(animation);
            }
        }
        // Other types (flip, discard) can be added as needed
    }
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
    resolveDeath1Prompt: (s: GameState, a: boolean) => GameState,
    resolveLove1Prompt: (s: GameState, a: boolean) => GameState,
    resolvePlague2Discard: (s: GameState, cardIds: string[]) => GameState,
    resolvePlague2OpponentDiscard: (s: GameState, cardIds: string[]) => GameState,
    resolvePlague4Flip: (s: GameState, a: boolean, p: Player) => GameState,
    resolveFire3Prompt: (s: GameState, a: boolean) => GameState,
    resolveOptionalDiscardCustomPrompt: (s: GameState, a: boolean) => GameState,
    resolveOptionalEffectPrompt: (s: GameState, a: boolean) => GameState,
    resolveFire4Discard: (s: GameState, cardIds: string[]) => GameState,
    resolveHate1Discard: (s: GameState, cardIds: string[]) => GameState,
    resolveRearrangeProtocols: (s: GameState, newOrder: string[]) => GameState,
    resolveActionWithHandCard: (s: GameState, cardId: string) => GameState,
    resolvePsychic4Prompt: (s: GameState, a: boolean) => GameState,
    resolveSpirit1Prompt: (s: GameState, choice: 'discard' | 'flip') => GameState,
    resolveSwapProtocols: (s: GameState, indices: [number, number]) => GameState,
    revealOpponentHand: (s: GameState) => GameState,
    resolveCustomChoice: (s: GameState, choiceIndex: number) => GameState,
}

type OpponentActionDispatchers = Pick<ActionDispatchers, 'playCard' | 'discardCards' | 'flipCard' | 'returnCard' | 'deleteCard' | 'resolveActionWithHandCard' | 'resolveLove1Prompt' | 'resolveHate1Discard' | 'resolvePlague2OpponentDiscard' | 'revealOpponentHand' | 'resolveRearrangeProtocols' | 'resolveSpirit1Prompt' | 'resolvePsychic4Prompt'>;


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
    isDuringOpponentTurn: boolean
): GameState => {
    const { cardId, laneIndex, isFaceUp } = aiDecision;
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
        animationState: { type: 'playCard' as const, cardId: cardId, owner: 'opponent' as Player },
        _cardPlayedThisActionPhase: true
    };

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
                runOpponentTurn(stateToProcess, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
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
            console.warn('[AI] Hard AI temporarily disabled, using Normal AI');
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

        const aiDecision = getAIAction(state, action, difficulty);

        // --- Specific Handlers First ---
        if (aiDecision.type === 'discardCards' && action.type === 'discard') {
            // CRITICAL FIX: Ensure AI only discards exactly action.count cards
            // This prevents bugs where AI might try to discard more than allowed
            const isVariableCount = (action as any).variableCount === true;
            const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
            const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

            if (cardIdsToDiscard.length !== aiDecision.cardIds.length) {
                console.warn(`[AI-DEBUG] Fixed discard count: AI wanted ${aiDecision.cardIds.length} but action.count=${action.count}`);
            }

            // NEW: Enqueue sequential discard animations
            if (enqueueAnimation) {
                const cardsToDiscard = cardIdsToDiscard
                    .map(id => state.opponent.hand.find(c => c.id === id))
                    .filter((c): c is typeof state.opponent.hand[0] => c !== undefined);

                if (cardsToDiscard.length > 0) {
                    const animations = createSequentialDiscardAnimations(state, cardsToDiscard, 'opponent');
                    queueMicrotask(() => {
                        animations.forEach(anim => enqueueAnimation(anim));
                    });
                }
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
            const { nextState, requiresAnimation } = resolveActionWithLane(state, aiDecision.laneIndex);
            if (requiresAnimation) {
                const wasStartPhase = state.phase === 'start';
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        // CRITICAL: Ensure animationState is cleared before processing
                        const stateWithoutAnimation = { ...s, animationState: null };
                        const finalState = requiresAnimation.onCompleteCallback(stateWithoutAnimation, s2 => s2);
                        if (finalState.actionRequired && finalState.actionRequired.actor === 'opponent') {
                            return { ...finalState, animationState: null };
                        }
                        // Use saved phase info since state might have changed
                        const resultState = wasStartPhase ? phaseManager.continueTurnAfterStartPhaseAction(finalState) : phaseManager.processEndOfAction(finalState);
                        return { ...resultState, animationState: null };
                    });
                });
                return nextState;
            }
            return endActionForPhase(nextState, phaseManager);
        }

        // --- Generic Card Selection Handler ---
        if (aiDecision.type === 'deleteCard' || aiDecision.type === 'flipCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard' || aiDecision.type === 'selectCard') {
            // NEW ANIMATION SYSTEM: Create return animation for opponent during interrupts
            if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation && aiDecision.type === 'returnCard') {
                const cardPosition = findCardInLanes(state, aiDecision.cardId, 'player') || findCardInLanes(state, aiDecision.cardId, 'opponent');
                if (cardPosition) {
                    const owner = state.player.lanes.flat().some(c => c.id === aiDecision.cardId) ? 'player' : 'opponent';
                    const card = state[owner].lanes[cardPosition.laneIndex][cardPosition.cardIndex];
                    if (card) {
                        const animation = createReturnAnimation(
                            state,
                            card,
                            owner,
                            cardPosition.laneIndex,
                            cardPosition.cardIndex,
                            true,  // setFaceDown
                            true   // isOpponentAction - triggers highlight phase
                        );
                        enqueueAnimation(animation);
                    }
                }
            }

            const { nextState, requiresAnimation } = resolveActionWithCard(state, aiDecision.cardId);

            if (requiresAnimation) {
                const wasStartPhase = state.phase === 'start';
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        // CRITICAL: Ensure animationState is cleared before processing
                        const stateWithoutAnimation = { ...s, animationState: null };
                        const finalState = requiresAnimation.onCompleteCallback(stateWithoutAnimation, s2 => s2);
                        if (finalState.actionRequired && finalState.actionRequired.actor === 'opponent') {
                            return { ...finalState, animationState: null };
                        }
                        // Use saved phase info since state might have changed
                        const resultState = wasStartPhase ? phaseManager.continueTurnAfterStartPhaseAction(finalState) : phaseManager.processEndOfAction(finalState);
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
            return handleAIPlayCard(state, aiDecision, setGameState, difficulty, actions, processAnimationQueue, phaseManager, false);
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

        console.warn(`AI has no logic for mandatory action during player turn, clearing it: ${action.type}, aiDecision: ${JSON.stringify(aiDecision)}`);
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
                runOpponentTurn(stateAfterSkip, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
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
        if (nextState.actionRequired) return nextState; // New action created, re-run processor
        // Use endActionForPhase which correctly handles both start and action phases
        // The useEffect in useGameState will trigger runOpponentTurn when needed
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
        // NEW ANIMATION SYSTEM: Create shift animation for opponent
        if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation && action.type === 'select_lane_for_shift') {
            const { cardToShiftId, cardOwner, originalLaneIndex } = action;
            const targetLaneIndex = aiDecision.laneIndex;

            // Only animate if shift is valid (not same lane)
            if (originalLaneIndex !== targetLaneIndex) {
                const cardToShift = state[cardOwner].lanes.flat().find(c => c.id === cardToShiftId);
                const cardIndex = state[cardOwner].lanes[originalLaneIndex].findIndex(c => c.id === cardToShiftId);
                if (cardToShift && cardIndex >= 0) {
                    const animation = createShiftAnimation(
                        state,
                        cardToShift,
                        cardOwner,
                        originalLaneIndex,
                        cardIndex,
                        targetLaneIndex,
                        true // isOpponentAction - triggers highlight phase
                    );
                    enqueueAnimation(animation);
                }
            }
        }

        const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(state, aiDecision.laneIndex);
         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            processAnimationQueue(animationRequests, () => {
                setGameState(s => {
                    // CRITICAL: Clear animationState before processing to prevent softlock
                    const stateWithoutAnim = { ...s, animationState: null };
                    return onCompleteCallback(stateWithoutAnim, (finalState) => {
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
                                runOpponentTurn(cleanAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
                            }, 500);
                        } else if (cleanAfterAction.actionRequired && cleanAfterAction.turn === 'opponent') {
                            // There's another action to handle
                            setTimeout(() => {
                                runOpponentTurn(cleanAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
                            }, 300);
                        }
                        return cleanAfterAction;
                    });
                });
            });
            return nextState;
        }
        // Non-animated case: return state, runOpponentTurn will handle continuation
        return endActionForPhase(nextState, phaseManager);
    }

    if (aiDecision.type === 'flipCard' || aiDecision.type === 'deleteCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard' || aiDecision.type === 'selectCard') {
        // NEW ANIMATION SYSTEM: Create return animation for opponent
        if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation && aiDecision.type === 'returnCard') {
            const cardPosition = findCardInLanes(state, aiDecision.cardId, 'player') || findCardInLanes(state, aiDecision.cardId, 'opponent');
            if (cardPosition) {
                const owner = state.player.lanes.flat().some(c => c.id === aiDecision.cardId) ? 'player' : 'opponent';
                const card = state[owner].lanes[cardPosition.laneIndex][cardPosition.cardIndex];
                if (card) {
                    const animation = createReturnAnimation(
                        state,
                        card,
                        owner,
                        cardPosition.laneIndex,
                        cardPosition.cardIndex,
                        true,  // setFaceDown
                        true   // isOpponentAction - triggers highlight phase
                    );
                    enqueueAnimation(animation);
                }
            }
        }

        const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(state, aiDecision.cardId);
         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            processAnimationQueue(animationRequests, () => {
                setGameState(s => {
                    // CRITICAL: Clear animationState before processing to prevent softlock
                    const stateWithoutAnim = { ...s, animationState: null };
                    return onCompleteCallback(stateWithoutAnim, (finalState) => {
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
        return handleAIPlayCard(state, aiDecision, setGameState, difficulty, actions, processAnimationQueue, phaseManager, true);
    }

    if (aiDecision.type === 'discardCards' && action.type === 'discard') {
        // CRITICAL FIX: Ensure AI only discards exactly action.count cards
        const isVariableCount = (action as any).variableCount === true;
        const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
        const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

        if (cardIdsToDiscard.length !== aiDecision.cardIds.length) {
            console.warn(`[AI-DEBUG] Fixed discard count: AI wanted ${aiDecision.cardIds.length} but action.count=${action.count}`);
        }

        // NEW: Enqueue sequential discard animations
        if (enqueueAnimation) {
            const cardsToDiscard = cardIdsToDiscard
                .map(id => state.opponent.hand.find(c => c.id === id))
                .filter((c): c is typeof state.opponent.hand[0] => c !== undefined);

            if (cardsToDiscard.length > 0) {
                const animations = createSequentialDiscardAnimations(state, cardsToDiscard, 'opponent');
                queueMicrotask(() => {
                    animations.forEach(anim => enqueueAnimation(anim));
                });
            }
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

    console.warn(`AI has no logic for mandatory action, clearing it: ${action.type}`);
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
    // CRITICAL FIX: For new animation system, we need to enqueue animation BEFORE setGameState
    // because React 18 batches state updates, causing the animation to appear "instant"

    // First, check if we should handle a playCard action with new animation system
    // We do this OUTSIDE of setGameState to ensure proper animation timing
    if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation) {
        const state = currentGameState;

        // Check all conditions that would allow us to play a card
        // CRITICAL: _cardPlayedThisActionPhase prevents double-play bug when effects trigger runOpponentTurn
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
                // Find the card and its position in opponent's hand BEFORE state update
                const card = state.opponent.hand.find(c => c.id === mainAction.cardId);
                const handIndex = state.opponent.hand.findIndex(c => c.id === mainAction.cardId);

                // Enqueue animation BEFORE setGameState - this is the key fix!
                if (card) {
                    const animation = createPlayAnimation(
                        state,
                        card,
                        'opponent',
                        mainAction.laneIndex,
                        true, // fromHand
                        handIndex,
                        mainAction.isFaceUp, // Pass through face-up state for animation
                        true // isOpponentAction - triggers highlight phase
                    );
                    enqueueAnimation(animation);
                }

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
                    if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation) {
                        enqueueAnimationsFromRequests(stateAfterOnPlayLogic, allAnims, enqueueAnimation);
                    }

                    if (allAnims.length > 0) {
                        processAnimationQueue(allAnims, () => {
                            setGameState(s => {
                                // CRITICAL FIX: Check if turn already switched to player
                                if (s.turn !== 'opponent') {
                                    return s;
                                }
                                if (s.queuedActions && s.queuedActions.length > 0) {
                                    const stateAfterQueue = phaseManager.processEndOfAction(s);
                                    if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                        // CRITICAL: Use setTimeout to prevent synchronous double-play
                                        setTimeout(() => {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                        }, 0);
                                    }
                                    return stateAfterQueue;
                                }
                                if (s.actionRequired && s.turn === 'opponent') {
                                    // CRITICAL: Use setTimeout to prevent synchronous double-play
                                    setTimeout(() => {
                                        runOpponentTurn(s, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                    }, 0);
                                    return s;
                                }
                                return phaseManager.processEndOfAction(s);
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
            } else if (action.type === 'plague_4_opponent_delete' && action.actor === 'opponent') {
                // The AI's card makes the player delete a card.
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
        // This might result in a new state that needs further processing.
        if (state.actionRequired) {
            const stateAfterAction = handleRequiredAction(state, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);

            // CRITICAL FIX: After handling required action, AI turn must continue!
            // Schedule continuation if AI is still active and no immediate action required
            // (handlers with animations already schedule their own continuations)
            if (!stateAfterAction.actionRequired && stateAfterAction.turn === 'opponent' && !stateAfterAction.winner) {
                // Don't continue if we just finished the turn (hand_limit phase)
                if (stateAfterAction.phase !== 'hand_limit') {
                    setTimeout(() => {
                        runOpponentTurn(stateAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
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
                if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation) {
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
                        // Enqueue all animations
                        queueMicrotask(() => {
                            animations.forEach(anim => enqueueAnimation(anim));
                        });

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
                if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation) {

                    // Find the card and create animation BEFORE playing
                    const card = state.opponent.hand.find(c => c.id === mainAction.cardId);
                    const handIndex = state.opponent.hand.findIndex(c => c.id === mainAction.cardId);

                    if (card) {
                        const animation = createPlayAnimation(
                            state,
                            card,
                            'opponent',
                            mainAction.laneIndex,
                            true, // fromHand
                            handIndex,
                            mainAction.isFaceUp,
                            true // isOpponentAction - triggers highlight phase
                        );
                        // Enqueue animation via queueMicrotask to avoid React batching issues
                        // The snapshot is already captured, so the animation data is correct
                        queueMicrotask(() => {
                            enqueueAnimation(animation);
                        });
                    }

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
                    if (USE_NEW_AI_ANIMATION_SYSTEM && enqueueAnimation) {
                        enqueueAnimationsFromRequests(stateAfterOnPlayLogic, allAnims, enqueueAnimation);
                    }

                    if (allAnims.length > 0) {
                        processAnimationQueue(allAnims, () => {
                            setGameState(s => {
                                // CRITICAL FIX: Check if turn already switched to player
                                if (s.turn !== 'opponent') {
                                    return s;
                                }
                                if (s.queuedActions && s.queuedActions.length > 0) {
                                    const stateAfterQueue = phaseManager.processEndOfAction(s);
                                    if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                        // CRITICAL: Use setTimeout to prevent synchronous double-play
                                        setTimeout(() => {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                        }, 0);
                                    }
                                    return stateAfterQueue;
                                }
                                if (s.actionRequired && s.turn === 'opponent') {
                                    // CRITICAL: Use setTimeout to prevent synchronous double-play
                                    setTimeout(() => {
                                        runOpponentTurn(s, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
                                    }, 0);
                                    return s;
                                }
                                return phaseManager.processEndOfAction(s);
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
                            let stateForOnPlay = { ...s_after_cover_anims };
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
                                    // CRITICAL FIX: Check if turn already switched to player
                                    if (s_after_all_anims.turn !== 'opponent') {
                                        return s_after_all_anims;
                                    }
                                    // CRITICAL FIX: Process queuedActions before checking actionRequired
                                    // This ensures multi-effect cards (like Gravity-2) complete all effects
                                    if (s_after_all_anims.queuedActions && s_after_all_anims.queuedActions.length > 0) {
                                        const stateAfterQueue = phaseManager.processEndOfAction(s_after_all_anims);
                                        // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                        if (stateAfterQueue.actionRequired && stateAfterQueue.turn === 'opponent') {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                        }
                                        return stateAfterQueue;
                                    }
                                    // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                    if (s_after_all_anims.actionRequired && s_after_all_anims.turn === 'opponent') {
                                        runOpponentTurn(s_after_all_anims, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                        return s_after_all_anims;
                                    } else {
                                        // CRITICAL FIX: Return the phase-advanced state directly instead of
                                        // calling nested setGameState. This prevents race conditions where
                                        // the old state (still in 'action' phase) triggers another AI turn.
                                        return phaseManager.processEndOfAction(s_after_all_anims);
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
                                        runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                    }
                                    return stateAfterQueue;
                                }
                                // BUG FIX: Only continue opponent turn if it's still opponent's turn
                                if (stateAfterOnPlayLogic.actionRequired && stateAfterOnPlayLogic.turn === 'opponent') {
                                    runOpponentTurn(stateAfterOnPlayLogic, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
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
                        const stateAfterPlayAnim = { ...s, animationState: null };
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