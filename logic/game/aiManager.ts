/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, Difficulty, EffectResult, AnimationRequest, EffectContext, GamePhase } from '../../types';
import { easyAI } from '../ai/easy';
import { normalAI } from '../ai/normal';
import { hardAI } from '../ai/hardImproved';
import { Dispatch, SetStateAction } from 'react';
import * as resolvers from './resolvers';
import { executeOnPlayEffect } from '../effectExecutor';
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
    resolveDeath1Prompt: (s: GameState, a: boolean) => GameState,
    resolveLove1Prompt: (s: GameState, a: boolean) => GameState,
    resolvePlague2Discard: (s: GameState, cardIds: string[]) => GameState,
    resolvePlague4Flip: (s: GameState, a: boolean, p: Player) => GameState,
    resolveFire3Prompt: (s: GameState, a: boolean) => GameState,
    resolveSpeed3Prompt: (s: GameState, a: boolean) => GameState,
    resolveFire4Discard: (s: GameState, cardIds: string[]) => GameState,
    resolveHate1Discard: (s: GameState, cardIds: string[]) => GameState,
    resolveLight2Prompt: (s: GameState, choice: 'shift' | 'flip' | 'skip') => GameState,
    resolveRearrangeProtocols: (s: GameState, newOrder: string[]) => GameState,
    resolveActionWithHandCard: (s: GameState, cardId: string) => GameState,
    resolvePsychic4Prompt: (s: GameState, a: boolean) => GameState,
    resolveSpirit1Prompt: (s: GameState, choice: 'discard' | 'flip') => GameState,
    resolveSpirit3Prompt: (s: GameState, accept: boolean) => GameState,
    resolveSwapProtocols: (s: GameState, indices: [number, number]) => GameState,
    revealOpponentHand: (s: GameState) => GameState,
}

type OpponentActionDispatchers = Pick<ActionDispatchers, 'discardCards' | 'flipCard' | 'returnCard' | 'deleteCard' | 'resolveActionWithHandCard' | 'resolveLove1Prompt' | 'resolveHate1Discard' | 'revealOpponentHand' | 'resolveRearrangeProtocols'>;


type PhaseManager = {
    processEndOfAction: (s: GameState) => GameState,
    processStartOfTurn: (s: GameState) => GameState,
    continueTurnAfterStartPhaseAction: (s: GameState) => GameState,
}

const getAIAction = (state: GameState, action: ActionRequired | null, difficulty: Difficulty): AIAction => {
    switch (difficulty) {
        case 'normal':
            return normalAI(state, action);
        case 'hard':
            return hardAI(state, action);
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
    resolveActionWithLane: (s: GameState, l: number) => LaneActionResult
) => {
    setGameState(state => {
        const action = state.actionRequired;
        if (!action) return state;

        // CRITICAL FIX: Determine if the AI ('opponent') needs to act during the player's turn OR during an interrupt.
        // If _interruptedTurn === 'player', the opponent can have actions even though turn === 'opponent'.
        const isPlayerTurnOrInterrupt = state.turn === 'player' || state._interruptedTurn === 'player';
        const isOpponentInterrupt = isPlayerTurnOrInterrupt && 'actor' in action && action.actor === 'opponent';

        if (!isOpponentInterrupt) return state;

        const aiDecision = getAIAction(state, action, difficulty);
        
        // --- Specific Handlers First ---
        if (aiDecision.type === 'discardCards' && action.type === 'discard') {
            const newState = actions.discardCards(state, aiDecision.cardIds, 'opponent');
            if (newState.actionRequired) {
                return newState;
            }
            return phaseManager.processEndOfAction(newState);
        }

        if (aiDecision.type === 'resolveHate1Discard' && action.type === 'select_cards_from_hand_to_discard_for_hate_1') {
            const newState = actions.resolveHate1Discard(state, aiDecision.cardIds);
            // The Hate-1 discard action chains into a delete action, which is still for the opponent.
            // So we return the new state, and the AI manager will loop on the new action.
            return newState;
        }

        if (aiDecision.type === 'rearrangeProtocols' && action.type === 'prompt_rearrange_protocols') {
            const newState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
            return phaseManager.processEndOfAction(newState);
        }

        if (action.type === 'reveal_opponent_hand') {
            const newState = actions.revealOpponentHand(state);
            return phaseManager.processEndOfAction(newState);
        }

        // --- Generic Lane Selection Handler ---
        if (aiDecision.type === 'selectLane') {
            const { nextState, requiresAnimation } = resolveActionWithLane(state, aiDecision.laneIndex);
            if (requiresAnimation) {
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        const finalState = requiresAnimation.onCompleteCallback(s, s2 => s2);
                        if (finalState.actionRequired && finalState.actionRequired.actor === 'opponent') {
                            return finalState;
                        }
                        return phaseManager.processEndOfAction(finalState);
                    });
                });
                return nextState;
            }
            return phaseManager.processEndOfAction(nextState);
        }

        // --- Generic Card Selection Handler ---
        if (aiDecision.type === 'deleteCard' || aiDecision.type === 'flipCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard') {
            const { nextState, requiresAnimation } = resolveActionWithCard(state, aiDecision.cardId);

            if (requiresAnimation) {
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        const finalState = requiresAnimation.onCompleteCallback(s, s2 => s2);
                        if (finalState.actionRequired && finalState.actionRequired.actor === 'opponent') {
                            return finalState;
                        }
                        return phaseManager.processEndOfAction(finalState);
                    });
                });
                return nextState;
            }

            if (nextState.actionRequired && nextState.actionRequired.actor === 'opponent') {
                return nextState;
            }
            return phaseManager.processEndOfAction(nextState);
        }
        
        console.warn(`AI has no logic for mandatory action during player turn, clearing it: ${action.type}`);
        const stateWithClearedAction = { ...state, actionRequired: null };
        return phaseManager.processEndOfAction(stateWithClearedAction);
    });
};


const handleRequiredAction = (
    state: GameState,
    setGameState: Dispatch<SetStateAction<GameState>>,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    processAnimationQueue: (queue: AnimationRequest[], onComplete: () => void) => void,
    phaseManager: PhaseManager
): GameState => {

    const aiDecision = getAIAction(state, state.actionRequired, difficulty);
    const action = state.actionRequired!; // Action is guaranteed to exist here
    
    if (aiDecision.type === 'skip') {
        const newState = actions.skipAction(state);
        return state.phase === 'start' ? phaseManager.continueTurnAfterStartPhaseAction(newState) : phaseManager.processEndOfAction(newState);
    }

    if (aiDecision.type === 'resolveControlMechanicPrompt' && action.type === 'prompt_use_control_mechanic') {
        const { choice } = aiDecision;
        const { originalAction, actor } = action;

        if (choice === 'skip') {
            let stateAfterSkip = log(state, actor, "Opponent skips rearranging protocols.");
            stateAfterSkip.actionRequired = null;

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
    
    if (aiDecision.type === 'resolveDeath1Prompt' && action.type === 'prompt_death_1_effect') {
        const nextState = actions.resolveDeath1Prompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState; // Accepted, now needs to select card
        return phaseManager.continueTurnAfterStartPhaseAction(nextState); // Skipped, continue turn
    }
    
    if (aiDecision.type === 'resolveLove1Prompt' && action.type === 'prompt_give_card_for_love_1') {
        const nextState = actions.resolveLove1Prompt(state, aiDecision.accept);
        if (nextState.actionRequired) { // AI accepted the prompt and now has to choose a card.
            return nextState; // The AI manager will loop and handle the 'select_card_from_hand_to_give' action.
        }
        // AI skipped the prompt. The action is cleared. We can now proceed with the end of the turn.
        return phaseManager.processEndOfAction(nextState);
    }
    
    if (aiDecision.type === 'resolvePlague2Discard' && action.type === 'plague_2_opponent_discard') {
        return resolvers.resolvePlague2OpponentDiscard(state, aiDecision.cardIds);
    }

    if (aiDecision.type === 'resolvePlague4Flip' && action.type === 'plague_4_player_flip_optional') {
        return actions.resolvePlague4Flip(state, aiDecision.accept, 'opponent');
    }

    if (aiDecision.type === 'resolveFire3Prompt' && action.type === 'prompt_fire_3_discard') {
        const nextState = actions.resolveFire3Prompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState; // New action (discard), re-run processor
        return phaseManager.processEndOfAction(nextState); // Skipped, so end turn
    }
    
    if (aiDecision.type === 'resolveSpeed3Prompt' && action.type === 'prompt_shift_for_speed_3') {
        const nextState = actions.resolveSpeed3Prompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState; // New action (select card), re-run
        return phaseManager.processEndOfAction(nextState);
    }
    
    if (aiDecision.type === 'resolvePsychic4Prompt' && action.type === 'prompt_return_for_psychic_4') {
        const nextState = actions.resolvePsychic4Prompt(state, aiDecision.accept);
        if(nextState.actionRequired) return nextState;
        return phaseManager.processEndOfAction(nextState);
    }
    
    if (aiDecision.type === 'resolveSpirit1Prompt' && action.type === 'prompt_spirit_1_start') {
        const nextState = actions.resolveSpirit1Prompt(state, aiDecision.choice);
        if(nextState.actionRequired) return nextState;
        return phaseManager.continueTurnAfterStartPhaseAction(nextState);
    }

    if (aiDecision.type === 'resolveSpirit3Prompt' && action.type === 'prompt_shift_for_spirit_3') {
        const nextState = actions.resolveSpirit3Prompt(state, aiDecision.accept);
        if(nextState.actionRequired) return nextState;
        return phaseManager.processEndOfAction(nextState);
    }

    if (aiDecision.type === 'resolveSwapProtocols' && action.type === 'prompt_swap_protocols') {
        const nextState = actions.resolveSwapProtocols(state, aiDecision.indices);
        return phaseManager.processEndOfAction(nextState);
    }

    if (aiDecision.type === 'resolveFire4Discard' && action.type === 'select_cards_from_hand_to_discard_for_fire_4') {
        const nextState = actions.resolveFire4Discard(state, aiDecision.cardIds);
        return phaseManager.processEndOfAction(nextState);
    }

    if (aiDecision.type === 'resolveHate1Discard' && action.type === 'select_cards_from_hand_to_discard_for_hate_1') {
        const nextState = actions.resolveHate1Discard(state, aiDecision.cardIds);
        // This action chains, so we return the new state for the AI to process the delete action.
        return nextState;
    }
    
    if (aiDecision.type === 'resolveLight2Prompt' && action.type === 'prompt_shift_or_flip_for_light_2') {
        const nextState = actions.resolveLight2Prompt(state, aiDecision.choice);
        if (nextState.actionRequired) return nextState; // may need to select a lane to shift
        return phaseManager.processEndOfAction(nextState);
    }

    if (aiDecision.type === 'rearrangeProtocols' && action.type === 'prompt_rearrange_protocols') {
        const nextState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
        return phaseManager.processEndOfAction(nextState);
    }

    if (aiDecision.type === 'selectLane' && (
        action.type === 'select_lane_for_shift' ||
        action.type === 'select_lane_for_death_2' ||
        action.type === 'select_lane_for_play' ||
        action.type === 'select_lane_for_water_3' ||
        action.type === 'select_lane_for_metal_3_delete' ||
        action.type === 'select_lane_for_life_3_play' ||
        action.type === 'shift_flipped_card_optional' ||
        action.type === 'gravity_2_shift_after_flip' ||
        action.type === 'select_lane_to_shift_revealed_card_for_light_2' ||
        action.type === 'select_lane_to_shift_cards_for_light_3'
    )) {
        const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(state, aiDecision.laneIndex);
         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            processAnimationQueue(animationRequests, () => {
                setGameState(s => onCompleteCallback(s, (finalState) => {
                    return state.phase === 'start' 
                        ? phaseManager.continueTurnAfterStartPhaseAction(finalState)
                        : phaseManager.processEndOfAction(finalState);
                }));
            });
            return nextState;
        }
        return phaseManager.processEndOfAction(nextState);
    }

    if (aiDecision.type === 'flipCard' || aiDecision.type === 'deleteCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard') {
        const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(state, aiDecision.cardId);
         if (requiresAnimation) {
            const { animationRequests, onCompleteCallback } = requiresAnimation;
            processAnimationQueue(animationRequests, () => {
                setGameState(s => onCompleteCallback(s, (finalState) => {
                    if (finalState.actionRequired) {
                        runOpponentTurn(finalState, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                        return finalState;
                    }
                    if (finalState.phase === 'start') {
                        return phaseManager.continueTurnAfterStartPhaseAction(finalState);
                    } else {
                        return phaseManager.processEndOfAction(finalState);
                    }
                }));
            });
            return nextState;
        }

        if (requiresTurnEnd) {
            return phaseManager.processEndOfAction(nextState);
        } else {
            return nextState; // Action has a follow up, re-run manager
        }
    }

    if (aiDecision.type === 'playCard' && action.type === 'select_card_from_hand_to_play') {
        const { cardId, laneIndex, isFaceUp } = aiDecision;
        const { newState: stateAfterPlayLogic, animationRequests: onCoverAnims } = actions.playCard(
            {...state, actionRequired: null}, 
            cardId, 
            laneIndex, 
            isFaceUp, 
            'opponent'
        );
        
        // FIX: Replaced undefined variable 'newState' with 'stateAfterPlayLogic'.
        const stateWithPlayAnimation = { ...stateAfterPlayLogic, animationState: { type: 'playCard' as const, cardId: cardId, owner: 'opponent' as Player }};
        
        setTimeout(() => {
            setGameState(s => {
                let stateToProcess = { ...s, animationState: null };
                
                // FIX: Replaced undefined variable 'animationRequests' with 'onCoverAnims'.
                if (onCoverAnims && onCoverAnims.length > 0) {
                    // FIX: Replaced undefined variable 'animationRequests' with 'onCoverAnims'.
                    processAnimationQueue(onCoverAnims, () => setGameState(s2 => phaseManager.processEndOfAction(s2)));
                    return stateToProcess;
                }

                if (stateToProcess.actionRequired) {
                    runOpponentTurn(stateToProcess, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
                    return stateToProcess;
                } else {
                    return phaseManager.processEndOfAction(stateToProcess);
                }
            });
        }, 500);
        
        return stateWithPlayAnimation;
    }

    if (aiDecision.type === 'discardCards' && action.type === 'discard') {
        const newState = actions.discardCards(state, aiDecision.cardIds, 'opponent');
        if (newState.actionRequired) return newState; // Handle chained effects
        return phaseManager.processEndOfAction(newState);
    }
    
    if (aiDecision.type === 'giveCard' && action.type === 'select_card_from_hand_to_give') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        if (newState.actionRequired) return newState; // Love-3 has a follow up
        return phaseManager.processEndOfAction(newState);
    }
    
    if (aiDecision.type === 'revealCard' && action.type === 'select_card_from_hand_to_reveal') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        return newState; // Should create a new action to flip
    }

    console.warn(`AI has no logic for mandatory action, clearing it: ${action.type}`);
    const stateWithClearedAction = { ...state, actionRequired: null };
    return phaseManager.processEndOfAction(stateWithClearedAction);
};


export const runOpponentTurn = (
    currentGameState: GameState,
    setGameState: Dispatch<SetStateAction<GameState>>,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    processAnimationQueue: (queue: AnimationRequest[], onComplete: () => void) => void,
    phaseManager: PhaseManager,
) => {
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
            return handleRequiredAction(state, setGameState, difficulty, actions, processAnimationQueue, phaseManager);
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
        return phaseManager.processEndOfAction(state);
    });
};