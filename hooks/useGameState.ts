/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, Difficulty, PlayedCard, AnimationRequest, GamePhase, ActionRequired } from '../types';
import * as stateManager from '../logic/game/stateManager';
import * as phaseManager from '../logic/game/phaseManager';
import * as resolvers from '../logic/game/resolvers';
import * as aiManager from '../logic/game/aiManager';
import { deleteCardFromBoard } from '../logic/utils/boardModifiers';
import { handleChainedEffectsOnDiscard } from '../logic/game/helpers/actionUtils';

export const useGameState = (
    playerProtocols: string[], 
    opponentProtocols: string[],
    onEndGame: (winner: Player, finalState: GameState) => void,
    difficulty: Difficulty
) => {
    const [gameState, setGameState] = useState<GameState>(() => {
        const initialState = stateManager.createInitialState(playerProtocols, opponentProtocols);
        return stateManager.recalculateAllLaneValues(initialState);
    });
    
    const [selectedCard, setSelectedCard] = useState<string | null>(null);

    const getTurnProgressionCallback = useCallback((phase: GamePhase): ((s: GameState) => GameState) => {
        switch (phase) {
            case 'start':
                // An action was resolved in the start phase (e.g. Death-1)
                // This function moves to 'control' and then continues automatic progression
                return phaseManager.continueTurnAfterStartPhaseAction;
            case 'end':
                // An action was resolved in the end phase (e.g. Fire-3)
                // This function continues processing from the 'end' phase (checking for more effects, then ending turn)
                return phaseManager.continueTurnProgression;
            case 'action':
            case 'hand_limit':
            case 'compile':
            case 'control':
            default:
                // An action was resolved in the action phase (playing a card, filling hand)
                // This function moves to 'hand_limit' and processes the rest of the turn automatically.
                return phaseManager.processEndOfAction;
        }
    }, []);

    const processAnimationQueue = useCallback((queue: AnimationRequest[], onComplete: () => void) => {
        if (queue.length === 0) {
            onComplete();
            return;
        }

        const [nextRequest, ...rest] = queue;
        
        setGameState(s => ({ ...s, animationState: { type: 'deleteCard', cardId: nextRequest.cardId, owner: nextRequest.owner } }));

        setTimeout(() => {
            setGameState(s => {
                const stateAfterDelete = deleteCardFromBoard(s, nextRequest.cardId);
                const stateWithNewValues = stateManager.recalculateAllLaneValues(stateAfterDelete);
                return { ...stateWithNewValues, animationState: null };
            });

            // Recurse AFTER the timeout completes to ensure state updates are somewhat sequential.
            if (rest.length > 0) {
                // This recursive call is problematic in hooks, but for this specific game loop it works.
                // A more robust solution might use a queue managed in a ref.
                processAnimationQueue(rest, onComplete);
            } else {
                onComplete(); // This is the final animation
            }
        }, 500);
    }, []); // Note: leaving dependency array empty for intended recursive behavior without re-creation.

    const playSelectedCard = (laneIndex: number, isFaceUp: boolean) => {
        if (!selectedCard || gameState.turn !== 'player' || gameState.phase !== 'action') return;
        const cardId = selectedCard;
        setSelectedCard(null);

        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { newState, animationRequests } = resolvers.playCard(prev, cardId, laneIndex, isFaceUp, 'player');
            
            const stateWithAnimation = { ...newState, animationState: { type: 'playCard' as const, cardId, owner: 'player' as Player }};

            setTimeout(() => {
                setGameState(s => {
                    let stateToProcess = { ...s, animationState: null };

                    if (animationRequests && animationRequests.length > 0) {
                        processAnimationQueue(animationRequests, () => setGameState(s2 => s2.actionRequired ? s2 : turnProgressionCb(s2)));
                        return stateToProcess;
                    }
                    
                    if (stateToProcess.actionRequired) {
                         return stateToProcess;
                    }

                    return turnProgressionCb(stateToProcess);
                });
            }, 500);

            return stateWithAnimation;
        });
    };

    const fillHand = () => {
        if (gameState.turn !== 'player' || gameState.phase !== 'action' || gameState.actionRequired) return;
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const newState = resolvers.fillHand(prev, 'player');
            return turnProgressionCb(newState);
        });
    };

    const discardCardFromHand = useCallback((cardId: string) => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'discard' || prev.actionRequired.actor !== 'player') return prev;
            return {
                ...prev,
                animationState: { type: 'discardCard', owner: 'player', cardIds: [cardId], originalAction: prev.actionRequired }
            }
        });
    }, []);

    const compileLane = useCallback((laneIndex: number) => {
        setGameState(prev => {
            if (prev.winner || prev.phase !== 'compile') return prev;
            
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);

            const stateWithAnimation = { 
                ...prev, 
                animationState: { type: 'compile' as const, laneIndex },
                compilableLanes: []
            };

            setTimeout(() => {
                setGameState(currentState => {
                    const nextState = resolvers.compileLane(currentState, laneIndex, onEndGame);
                    if (nextState.winner) {
                        return nextState; // Stop progression if game is over
                    }
                    const finalState = turnProgressionCb(nextState);
                    // Clear the animation state as we transition to the next turn/action.
                    return { ...finalState, animationState: null };
                });
            }, 1000);

            return stateWithAnimation;
        });
    }, [onEndGame, getTurnProgressionCallback]);

    const resolveActionWithCard = (targetCardId: string) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(prev, targetCardId);
    
            if (requiresAnimation) {
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        // The resolver's callback is now fully responsible for handling triggers
                        // and calling the appropriate turn progression function. This simplifies
                        // the hook's logic and prevents race conditions/double calls.
                        return requiresAnimation.onCompleteCallback(s, turnProgressionCb);
                    });
                });
                return nextState;
            }
    
            if (nextState.actionRequired) {
                return nextState;
            }
    
            if (requiresTurnEnd) {
                return turnProgressionCb(nextState);
            }
            
            return nextState;
        });
    };
    
    const resolveActionWithLane = (targetLaneIndex: number) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(prev, targetLaneIndex);
            
            if (requiresAnimation) {
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        const finalState = requiresAnimation.onCompleteCallback(s, s2 => s2);
                        if (finalState.actionRequired) {
                            return finalState;
                        }
                        return turnProgressionCb(finalState);
                    });
                });
                return nextState;
            }
    
            if (nextState.actionRequired) {
                return nextState;
            }
            
            return turnProgressionCb(nextState);
        });
    };

    const resolveActionWithHandCard = (cardId: string) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveActionWithHandCard(prev, cardId);

            if(nextState.actionRequired) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    };

    const selectHandCardForAction = (cardId: string) => {
        setGameState(prev => resolvers.selectHandCardForAction(prev, cardId));
    };

    const skipAction = () => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            let stateWithoutAnimation = { ...prev, animationState: null };

            // Special case for Light-2 prompt
            if (stateWithoutAnimation.actionRequired?.type === 'prompt_shift_or_flip_for_light_2') {
                stateWithoutAnimation = resolvers.resolveLight2Prompt(stateWithoutAnimation, 'skip');
            } else {
                stateWithoutAnimation = resolvers.skipAction(stateWithoutAnimation);
            }
            
            if (stateWithoutAnimation.actionRequired?.type === 'plague_4_player_flip_optional') {
                return stateWithoutAnimation;
            }
            return turnProgressionCb(stateWithoutAnimation);
        });
    };

    const resolveDeath1Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveDeath1Prompt(prev, accept);
            // If the player skips, the action is cleared, and we can continue the turn.
            if (!nextState.actionRequired) {
                // Since this happens in the start phase, we need a special continuation.
                return phaseManager.continueTurnAfterStartPhaseAction(nextState);
            }
            // If the player accepts, a new action is set, so we just update the state.
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    const resolveLove1Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveLove1Prompt(prev, accept);
            if (!accept) { // Player skipped
                return turnProgressionCb(nextState);
            }
            return nextState; // Player accepted, new action is set
        });
    }, [getTurnProgressionCallback]);

    const resolvePlague2Discard = useCallback((cardIdsToDiscard: string[]) => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'plague_2_player_discard') return prev;
            return {
                ...prev,
                animationState: { type: 'discardCard', owner: 'player', cardIds: cardIdsToDiscard, originalAction: prev.actionRequired }
            };
        });
    }, []);

    const resolvePlague4Flip = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolvePlague4Flip(prev, accept, 'player');
            // Whether the player accepts or skips, the prompt is resolved and the turn should continue.
            // The resolver handles clearing the actionRequired.
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);
    
    const resolveFire3Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveFire3Prompt(prev, accept);
            if (!accept) {
                return turnProgressionCb(nextState);
            }
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    const resolveSpeed3Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSpeed3Prompt(prev, accept);
            if (!accept) {
                return turnProgressionCb(nextState);
            }
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    const resolveFire4Discard = useCallback((cardIds: string[]) => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_fire_4') return prev;
             return {
                ...prev,
                animationState: { type: 'discardCard', owner: 'player', cardIds: cardIds, originalAction: prev.actionRequired }
            };
        });
    }, []);

    const resolveHate1Discard = useCallback((cardIds: string[]) => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_hate_1') return prev;
             return {
                ...prev,
                animationState: { type: 'discardCard', owner: 'player', cardIds: cardIds, originalAction: prev.actionRequired }
            };
        });
    }, []);

    const resolveLight2Prompt = useCallback((choice: 'shift' | 'flip' | 'skip') => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveLight2Prompt(prev, choice);
            if (nextState.actionRequired) {
                return nextState;
            }
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    const resolveRearrangeProtocols = useCallback((newOrder: string[]) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveRearrangeProtocols(prev, newOrder);
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);
    
    const resolvePsychic4Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolvePsychic4Prompt(prev, accept);
            if (!accept) {
                return turnProgressionCb(nextState);
            }
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    const resolveSpirit1Prompt = useCallback((choice: 'discard' | 'flip') => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSpirit1Prompt(prev, choice);
            if (nextState.actionRequired) {
                return nextState; // new discard action
            }
            return phaseManager.continueTurnAfterStartPhaseAction(nextState); // continue turn from start phase
        });
    }, [getTurnProgressionCallback]);

    const resolveSpirit3Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSpirit3Prompt(prev, accept);
            if (nextState.actionRequired) {
                return nextState; // new shift action
            }
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    const resolveSwapProtocols = useCallback((indices: [number, number]) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSwapProtocols(prev, indices);
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    useEffect(() => {
        const animState = gameState.animationState;
        if (!animState) return;

        let duration = 0;
        let shouldClear = false;

        if (animState.type === 'flipCard') {
            duration = 600;
            shouldClear = true;
        } else if (animState.type === 'drawCard') {
            duration = 1000;
            shouldClear = true;
        } else if (animState.type === 'discardCard') {
            duration = 800;
            shouldClear = true;
        }

        if (shouldClear) {
            const timer = setTimeout(() => {
                setGameState(s => ({ ...s, animationState: null }));
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [gameState.animationState]);

    useEffect(() => {
        const animState = gameState.animationState;
        if (animState?.type === 'discardCard' && animState.owner === 'player') {
            const timer = setTimeout(() => {
                setGameState(s => {
                    const currentAnim = s.animationState;
                    if (currentAnim?.type !== 'discardCard' || !currentAnim.originalAction) return s;
                    
                    const { cardIds, originalAction } = currentAnim;
                    const turnProgressionCb = getTurnProgressionCallback(s.phase);
                    
                    let stateAfterDiscard;
                    if (originalAction.type === 'plague_2_player_discard') {
                        stateAfterDiscard = resolvers.resolvePlague2Discard(s, cardIds);
                    } else if (originalAction.type === 'select_cards_from_hand_to_discard_for_fire_4') {
                        stateAfterDiscard = resolvers.resolveFire4Discard(s, cardIds);
                    } else if (originalAction.type === 'select_cards_from_hand_to_discard_for_hate_1') {
                        stateAfterDiscard = resolvers.resolveHate1Discard(s, cardIds);
                    } else {
                        // Pass the full state `s` so the resolver can see the originalAction in the animationState
                        stateAfterDiscard = resolvers.discardCards(s, cardIds, 'player');
                    }
    
                    stateAfterDiscard.animationState = null;

                    if (stateAfterDiscard.actionRequired) {
                        return stateAfterDiscard;
                    }
    
                    return turnProgressionCb(stateAfterDiscard);
                });
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [gameState.animationState, getTurnProgressionCallback]);


    useEffect(() => {
        if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState) {
            const timer = setTimeout(() => {
                aiManager.runOpponentTurn(gameState, setGameState, difficulty, {
                    compileLane: (s, l) => resolvers.compileLane(s, l, onEndGame),
                    playCard: resolvers.playCard,
                    fillHand: resolvers.fillHand,
                    discardCards: resolvers.discardCards,
                    flipCard: resolvers.flipCard,
                    deleteCard: (s, c) => {
                       return {
                           newState: s,
                           animationRequests: [{ type: 'delete', cardId: c, owner: 'opponent'}]
                       }
                    },
                    returnCard: resolvers.returnCard,
                    skipAction: resolvers.skipAction,
                    resolveDeath1Prompt: resolvers.resolveDeath1Prompt,
                    resolveLove1Prompt: resolvers.resolveLove1Prompt,
                    resolvePlague4Flip: (s, a) => resolvers.resolvePlague4Flip(s, a, 'opponent'),
                    resolvePlague2Discard: resolvers.resolvePlague2OpponentDiscard,
                    resolveFire3Prompt: resolvers.resolveFire3Prompt,
                    resolveSpeed3Prompt: resolvers.resolveSpeed3Prompt,
                    resolveFire4Discard: resolvers.resolveFire4Discard,
                    resolveHate1Discard: resolvers.resolveHate1Discard,
                    resolveLight2Prompt: resolvers.resolveLight2Prompt,
                    resolveRearrangeProtocols: resolvers.resolveRearrangeProtocols,
                    resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                    resolvePsychic4Prompt: resolvers.resolvePsychic4Prompt,
                    resolveSpirit1Prompt: resolvers.resolveSpirit1Prompt,
                    resolveSpirit3Prompt: resolvers.resolveSpirit3Prompt,
                    resolveSwapProtocols: resolvers.resolveSwapProtocols,
                    revealOpponentHand: resolvers.revealOpponentHand,
                }, processAnimationQueue, phaseManager);
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [gameState.turn, gameState.winner, gameState.animationState, difficulty, onEndGame, processAnimationQueue, gameState.actionRequired]);

    useEffect(() => {
        const action = gameState.actionRequired;
        const isOpponentActionDuringPlayerTurn = 
            gameState.turn === 'player' &&
            !gameState.animationState &&
            action && (
                (action.type === 'discard' && action.actor === 'opponent') ||
                (action.type === 'select_lane_for_shift' && action.actor === 'opponent') ||
                action.type === 'plague_4_opponent_delete' ||
                action.type === 'reveal_opponent_hand'
            );

        if (isOpponentActionDuringPlayerTurn) {
            const timer = setTimeout(() => {
                aiManager.resolveRequiredOpponentAction(
                    gameState, 
                    setGameState, 
                    difficulty, 
                    {
                        discardCards: resolvers.discardCards,
                        flipCard: resolvers.flipCard,
                        returnCard: resolvers.returnCard,
                        deleteCard: (s, c) => ({
                            newState: s,
                            animationRequests: [{ type: 'delete', cardId: c, owner: 'opponent'}]
                        }),
                        resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                        resolveLove1Prompt: resolvers.resolveLove1Prompt,
                        resolveHate1Discard: resolvers.resolveHate1Discard,
                        revealOpponentHand: resolvers.revealOpponentHand,
                    }, 
                    phaseManager, 
                    processAnimationQueue
                );
            }, 1500); // AI "thinking" time
            return () => clearTimeout(timer);
        }
    }, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue]);

    useEffect(() => {
        setGameState(currentState => {
            if (currentState.turn === 'player' && currentState.phase === 'start' && !currentState.actionRequired) {
                return phaseManager.processStartOfTurn(currentState);
            }
            return currentState;
        });
    }, [gameState.turn, gameState.phase]);

    return { 
        gameState, selectedCard, setSelectedCard, playSelectedCard, fillHand, 
        discardCardFromHand, compileLane, resolveActionWithCard, resolveActionWithLane,
        selectHandCardForAction, skipAction, resolvePlague2Discard, resolveActionWithHandCard,
        resolvePlague4Flip, resolveFire3Prompt, resolveFire4Discard, resolveHate1Discard, resolveLight2Prompt,
        resolveRearrangeProtocols, resolveSpeed3Prompt, resolveDeath1Prompt, resolveLove1Prompt,
        resolvePsychic4Prompt, resolveSpirit1Prompt, resolveSpirit3Prompt, resolveSwapProtocols,
    };
};