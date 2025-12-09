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

    const stateWithPlayAnimation = {
        ...stateAfterPlayLogic,
        animationState: { type: 'playCard' as const, cardId: cardId, owner: 'opponent' as Player }
    };

    setTimeout(() => {
        setGameState(s => {
            let stateToProcess = { ...s, animationState: null };

            if (onCoverAnims && onCoverAnims.length > 0) {
                processAnimationQueue(onCoverAnims, () => setGameState(s2 => {
                    if (isDuringOpponentTurn && s2.actionRequired) {
                        runOpponentTurn(s2, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                        return s2;
                    }
                    if (s2.actionRequired && s2.actionRequired.actor === 'opponent') {
                        return s2;
                    }
                    return endActionForPhase(s2, phaseManager);
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
    trackPlayerRearrange?: TrackPlayerRearrange
) => {
    setGameState(state => {
        const action = state.actionRequired;
        if (!action) return state;

        // CRITICAL FIX: Determine if the AI ('opponent') needs to act during the player's turn OR during an interrupt.
        // If _interruptedTurn === 'player', the opponent can have actions even though turn === 'opponent'.
        const isPlayerTurnOrInterrupt = state.turn === 'player' || state._interruptedTurn === 'player';
        const isOpponentInterrupt = isPlayerTurnOrInterrupt && 'actor' in action && action.actor === 'opponent';

        if (!isOpponentInterrupt) return state;

        // CRITICAL: Handle 'discard_completed' automatically - execute the followUp effect
        if (action.type === 'discard_completed') {
            const { followUpEffect, conditionalType, previousHandSize, sourceCardId, actor } = action as any;

            if (followUpEffect && sourceCardId) {
                const sourceCardInfo = findCardOnBoard(state, sourceCardId);
                if (sourceCardInfo) {
                    const currentHandSize = state[actor].hand.length;
                    const discardedCount = Math.max(0, (previousHandSize || 0) - currentHandSize);
                    const shouldExecute = conditionalType === 'then' || (conditionalType === 'if_executed' && discardedCount > 0);

                    if (shouldExecute) {
                        console.log(`[AI Interrupt discard_completed] Executing follow-up effect, discardedCount: ${discardedCount}`);

                        let laneIndex = -1;
                        for (let i = 0; i < state[sourceCardInfo.owner].lanes.length; i++) {
                            if (state[sourceCardInfo.owner].lanes[i].some((c: any) => c.id === sourceCardId)) {
                                laneIndex = i;
                                break;
                            }
                        }

                        if (laneIndex !== -1) {
                            const context: EffectContext = {
                                cardOwner: sourceCardInfo.owner,
                                opponent: sourceCardInfo.owner === 'player' ? 'opponent' as Player : 'player' as Player,
                                currentTurn: state.turn,
                                actor: actor,
                                discardedCount: discardedCount,
                            };

                            const { executeCustomEffect } = require('../customProtocols/effectInterpreter');
                            const result = executeCustomEffect(sourceCardInfo.card, laneIndex, { ...state, actionRequired: null }, context, followUpEffect);
                            return result.newState;
                        }
                    }
                }
            }
            return { ...state, actionRequired: null };
        }

        const aiDecision = getAIAction(state, action, difficulty);

        // --- Specific Handlers First ---
        if (aiDecision.type === 'discardCards' && action.type === 'discard') {
            // CRITICAL FIX: Ensure AI only discards exactly action.count cards
            // This prevents bugs where AI might try to discard more than allowed
            const isVariableCount = (action as any).variableCount === true;
            const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
            const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

            if (cardIdsToDiscard.length !== aiDecision.cardIds.length) {
                console.warn(`[AI Manager] Fixed discard count: AI wanted ${aiDecision.cardIds.length} but action.count=${action.count}`);
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

            console.log('[DEBUG aiManager] Before resolveRearrangeProtocols, actor hand:', state[action.actor].hand.length);
            const newState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
            console.log('[DEBUG aiManager] After resolveRearrangeProtocols, actor hand:', newState[action.actor].hand.length);
            const finalState = endActionForPhase(newState, phaseManager);
            console.log('[DEBUG aiManager] After endActionForPhase, actor hand:', finalState[action.actor].hand.length);
            return finalState;
        }

        if (action.type === 'reveal_opponent_hand') {
            const newState = actions.revealOpponentHand(state);
            return endActionForPhase(newState, phaseManager);
        }

        // NOTE: Spirit-3 prompt now uses generic prompt_optional_effect handler

        // --- Generic Lane Selection Handler ---
        if (aiDecision.type === 'selectLane') {
            const { nextState, requiresAnimation } = resolveActionWithLane(state, aiDecision.laneIndex);
            if (requiresAnimation) {
                const wasStartPhase = state.phase === 'start';
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        const finalState = requiresAnimation.onCompleteCallback(s, s2 => s2);
                        if (finalState.actionRequired && finalState.actionRequired.actor === 'opponent') {
                            return finalState;
                        }
                        // Use saved phase info since state might have changed
                        return wasStartPhase ? phaseManager.continueTurnAfterStartPhaseAction(finalState) : phaseManager.processEndOfAction(finalState);
                    });
                });
                return nextState;
            }
            return endActionForPhase(nextState, phaseManager);
        }

        // --- Generic Card Selection Handler ---
        if (aiDecision.type === 'deleteCard' || aiDecision.type === 'flipCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard') {
            const { nextState, requiresAnimation } = resolveActionWithCard(state, aiDecision.cardId);

            if (requiresAnimation) {
                const wasStartPhase = state.phase === 'start';
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        const finalState = requiresAnimation.onCompleteCallback(s, s2 => s2);
                        if (finalState.actionRequired && finalState.actionRequired.actor === 'opponent') {
                            return finalState;
                        }
                        // Use saved phase info since state might have changed
                        return wasStartPhase ? phaseManager.continueTurnAfterStartPhaseAction(finalState) : phaseManager.processEndOfAction(finalState);
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

        console.warn(`AI has no logic for mandatory action during player turn, clearing it: ${action.type}`);
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
    trackPlayerRearrange?: TrackPlayerRearrange
): GameState => {

    const action = state.actionRequired!; // Action is guaranteed to exist here

    // CRITICAL: Handle 'discard_completed' automatically - execute the followUp effect
    if (action.type === 'discard_completed') {
        const { followUpEffect, conditionalType, previousHandSize, sourceCardId, actor } = action as any;

        if (followUpEffect && sourceCardId) {
            const sourceCardInfo = findCardOnBoard(state, sourceCardId);
            if (sourceCardInfo) {
                const currentHandSize = state[actor].hand.length;
                const discardedCount = Math.max(0, (previousHandSize || 0) - currentHandSize);
                const shouldExecute = conditionalType === 'then' || (conditionalType === 'if_executed' && discardedCount > 0);

                if (shouldExecute) {
                    console.log(`[AI runOpponentTurn discard_completed] Executing follow-up effect, discardedCount: ${discardedCount}`);

                    let laneIndex = -1;
                    for (let i = 0; i < state[sourceCardInfo.owner].lanes.length; i++) {
                        if (state[sourceCardInfo.owner].lanes[i].some((c: any) => c.id === sourceCardId)) {
                            laneIndex = i;
                            break;
                        }
                    }

                    if (laneIndex !== -1) {
                        const context: EffectContext = {
                            cardOwner: sourceCardInfo.owner,
                            opponent: sourceCardInfo.owner === 'player' ? 'opponent' as Player : 'player' as Player,
                            currentTurn: state.turn,
                            actor: actor,
                            discardedCount: discardedCount,
                        };

                        const { executeCustomEffect } = require('../customProtocols/effectInterpreter');
                        const result = executeCustomEffect(sourceCardInfo.card, laneIndex, { ...state, actionRequired: null }, context, followUpEffect);
                        return result.newState;
                    }
                }
            }
        }
        return { ...state, actionRequired: null };
    }

    const aiDecision = getAIAction(state, state.actionRequired, difficulty);

    if (aiDecision.type === 'skip') {
        console.log('[AI SKIP] Skipping action, phase:', state.phase, 'turn:', state.turn);
        const newState = actions.skipAction(state);
        const stateAfterSkip = state.phase === 'start' ? phaseManager.continueTurnAfterStartPhaseAction(newState) : phaseManager.processEndOfAction(newState);
        console.log('[AI SKIP] After skip processing, phase:', stateAfterSkip.phase, 'turn:', stateAfterSkip.turn, 'actionRequired:', stateAfterSkip.actionRequired?.type);

        // CRITICAL FIX: After skipping a start-phase action, the turn should continue!
        // If there's no actionRequired and it's still opponent's turn, we need to continue processing.
        // Schedule a recursive call to runOpponentTurn to handle the next phase (action/compile).
        if (!stateAfterSkip.actionRequired && stateAfterSkip.turn === 'opponent' && !stateAfterSkip.winner) {
            console.log('[AI SKIP] Scheduling runOpponentTurn continuation in 500ms');
            setTimeout(() => {
                console.log('[AI SKIP] Running scheduled runOpponentTurn');
                runOpponentTurn(stateAfterSkip, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
            }, 500);
        } else {
            console.log('[AI SKIP] NOT scheduling continuation - actionRequired:', !!stateAfterSkip.actionRequired, 'turn:', stateAfterSkip.turn, 'winner:', !!stateAfterSkip.winner);
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

    // GENERIC: Handle ALL optional effect prompts
    if (aiDecision.type === 'resolveOptionalEffectPrompt') {
        console.log('[AI resolveOptionalEffectPrompt] accept:', aiDecision.accept, 'phase:', state.phase);
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

        console.log('[DEBUG aiManager 2] Before resolveRearrangeProtocols, actor hand:', state[action.actor].hand.length);
        const nextState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
        console.log('[DEBUG aiManager 2] After resolveRearrangeProtocols, actor hand:', nextState[action.actor].hand.length);
        const finalState = endActionForPhase(nextState, phaseManager);
        console.log('[DEBUG aiManager 2] After endActionForPhase, actor hand:', finalState[action.actor].hand.length);
        return finalState;
    }

    // GENERIC: Handle ALL selectLane decisions - no whitelist needed
    // The AI returns selectLane for any lane selection action, and resolveActionWithLane handles it
    if (aiDecision.type === 'selectLane') {
        const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(state, aiDecision.laneIndex);
         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            processAnimationQueue(animationRequests, () => {
                setGameState(s => onCompleteCallback(s, (finalState) => {
                    const stateAfterAction = state.phase === 'start'
                        ? phaseManager.continueTurnAfterStartPhaseAction(finalState)
                        : phaseManager.processEndOfAction(finalState);
                    // Schedule continuation after animated action completes
                    if (!stateAfterAction.actionRequired && stateAfterAction.turn === 'opponent' && !stateAfterAction.winner) {
                        setTimeout(() => {
                            runOpponentTurn(stateAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
                        }, 500);
                    } else if (stateAfterAction.actionRequired && stateAfterAction.turn === 'opponent') {
                        // There's another action to handle
                        setTimeout(() => {
                            runOpponentTurn(stateAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
                        }, 300);
                    }
                    return stateAfterAction;
                }));
            });
            return nextState;
        }
        // Non-animated case: return state, runOpponentTurn will handle continuation
        return endActionForPhase(nextState, phaseManager);
    }

    if (aiDecision.type === 'flipCard' || aiDecision.type === 'deleteCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard') {
        const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(state, aiDecision.cardId);
         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            processAnimationQueue(animationRequests, () => {
                setGameState(s => onCompleteCallback(s, (finalState) => {
                    // CRITICAL FIX: Check for queuedActions BEFORE checking actionRequired
                    // Otherwise Gravity-2's shift gets skipped and AI plays another card
                    if (finalState.queuedActions && finalState.queuedActions.length > 0) {
                        const stateAfterQueue = phaseManager.processEndOfAction(finalState);
                        if (stateAfterQueue.actionRequired) {
                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                            return stateAfterQueue;
                        }
                        return stateAfterQueue;
                    }
                    if (finalState.actionRequired) {
                        runOpponentTurn(finalState, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                        return finalState;
                    }
                    if (finalState.phase === 'start') {
                        const stateAfterAction = phaseManager.continueTurnAfterStartPhaseAction(finalState);
                        // CRITICAL FIX: Schedule continuation of opponent's turn after start phase action
                        if (!stateAfterAction.actionRequired && stateAfterAction.turn === 'opponent' && !stateAfterAction.winner) {
                            setTimeout(() => {
                                runOpponentTurn(stateAfterAction, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);
                            }, 500);
                        }
                        return stateAfterAction;
                    } else {
                        return phaseManager.processEndOfAction(finalState);
                    }
                }));
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
            console.warn(`[AI Manager] Fixed discard count: AI wanted ${aiDecision.cardIds.length} but action.count=${action.count}`);
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
    trackPlayerRearrange?: TrackPlayerRearrange
) => {
    console.log('[runOpponentTurn] Called with currentGameState phase:', currentGameState.phase, 'turn:', currentGameState.turn);
    setGameState(currentState => {
        console.log('[runOpponentTurn] Inside setGameState, currentState phase:', currentState.phase, 'turn:', currentState.turn, 'actionRequired:', currentState.actionRequired?.type);
        if (currentState.turn !== 'opponent' || currentState.winner || currentState.animationState) {
            console.log('[runOpponentTurn] Early return - turn:', currentState.turn, 'winner:', !!currentState.winner, 'animationState:', !!currentState.animationState);
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
            const stateAfterAction = handleRequiredAction(state, setGameState, difficulty, actions, processAnimationQueue, phaseManager, trackPlayerRearrange);

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
        if (state.phase === 'action') {
            const mainAction = getAIAction(state, null, difficulty);
    
            if (mainAction.type === 'fillHand') {
                const stateAfterAction = resolvers.fillHand(state, 'opponent');
                if (stateAfterAction.actionRequired) {
                    return stateAfterAction;
                }
                return phaseManager.processEndOfAction(stateAfterAction);
            }
            
            if (mainAction.type === 'playCard') {
                const { newState: stateAfterPlayLogic, animationRequests: onCoverAnims } = actions.playCard(state, mainAction.cardId, mainAction.laneIndex, mainAction.isFaceUp, 'opponent');
                const stateWithPlayAnimation = { ...stateAfterPlayLogic, animationState: { type: 'playCard' as const, cardId: mainAction.cardId, owner: 'opponent' as Player }};

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
                                    // CRITICAL FIX: Process queuedActions before checking actionRequired
                                    // This ensures multi-effect cards (like Gravity-2) complete all effects
                                    if (s_after_all_anims.queuedActions && s_after_all_anims.queuedActions.length > 0) {
                                        const stateAfterQueue = phaseManager.processEndOfAction(s_after_all_anims);
                                        if (stateAfterQueue.actionRequired) {
                                            runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                        }
                                        return stateAfterQueue;
                                    }
                                    if (s_after_all_anims.actionRequired) {
                                        runOpponentTurn(s_after_all_anims, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                    } else {
                                        setGameState(phaseManager.processEndOfAction(s_after_all_anims));
                                    }
                                    return s_after_all_anims;
                                });
                            };

                            if (onPlayAnims && onPlayAnims.length > 0) {
                                processAnimationQueue(onPlayAnims, onAllAnimsComplete);
                                return stateAfterOnPlayLogic;
                            } else {
                                // CRITICAL FIX: Process queuedActions before checking actionRequired
                                if (stateAfterOnPlayLogic.queuedActions && stateAfterOnPlayLogic.queuedActions.length > 0) {
                                    const stateAfterQueue = phaseManager.processEndOfAction(stateAfterOnPlayLogic);
                                    if (stateAfterQueue.actionRequired) {
                                        runOpponentTurn(stateAfterQueue, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                    }
                                    return stateAfterQueue;
                                }
                                if (stateAfterOnPlayLogic.actionRequired) {
                                    runOpponentTurn(stateAfterOnPlayLogic, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                                } else {
                                    setGameState(phaseManager.processEndOfAction(stateAfterOnPlayLogic));
                                }
                                return stateAfterOnPlayLogic;
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
        return phaseManager.processEndOfAction(state);
    });
};