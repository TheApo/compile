/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, Difficulty, PlayedCard, AnimationRequest, GamePhase, ActionRequired, Card } from '../types';
import * as stateManager from '../logic/game/stateManager';
import * as phaseManager from '../logic/game/phaseManager';
import * as resolvers from '../logic/game/resolvers';
import * as aiManager from '../logic/game/aiManager';
import { deleteCardFromBoard } from '../logic/utils/boardModifiers';
import { cards } from '../data/cards';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../logic/utils/log';
import { buildDeck, shuffleDeck } from '../utils/gameLogic';
import { handleUncoverEffect, findCardOnBoard } from '../logic/game/helpers/actionUtils';
import { drawCards as drawCardsUtil } from '../utils/gameStateModifiers';
import { executeCustomEffect } from '../logic/customProtocols/effectInterpreter';
import { EffectContext } from '../types';
import { AnimationQueueItem } from '../types/animation';
import {
    createPlayAnimation,
    createDeleteAnimation,
    createDiscardAnimation,
    createDrawAnimation,
    createShiftAnimation,
    findCardInLanes,
} from '../logic/animation/animationHelpers';
// NOTE: Hate-3 trigger is now handled via custom protocol reactive effects

// Feature flag for new animation queue system
const USE_NEW_ANIMATION_SYSTEM = true;

export const useGameState = (
    playerProtocols: string[],
    opponentProtocols: string[],
    onEndGame: (winner: Player, finalState: GameState) => void,
    difficulty: Difficulty,
    useControlMechanic: boolean,
    startingPlayer: Player = 'player',
    trackPlayerRearrange?: (actor: 'player' | 'opponent') => void,
    // NEW: Animation queue functions for the new animation system
    enqueueAnimation?: (item: Omit<AnimationQueueItem, 'id'>) => void,
    enqueueAnimations?: (items: Omit<AnimationQueueItem, 'id'>[]) => void
) => {
    const [gameState, setGameState] = useState<GameState>(() => {
        const initialState = stateManager.createInitialState(playerProtocols, opponentProtocols, useControlMechanic, startingPlayer);
        return stateManager.recalculateAllLaneValues(initialState);
    });

    const [selectedCard, setSelectedCard] = useState<string | null>(null);

    // Ref-based lock to prevent race conditions between AI processing hooks
    const isProcessingAIRef = useRef<boolean>(false);

    // Scenario version counter - increments on each scenario change to invalidate old timers
    const scenarioVersionRef = useRef<number>(0);





    // Update turn when startingPlayer changes (from coin flip)
    useEffect(() => {
        // Fix the turn if it doesn't match the coin flip winner
        // This happens because useState initializes with the default 'player' before coin flip
        // Log length is now 4 because of protocol logging in createInitialState
        if (gameState.turn !== startingPlayer && gameState.log.length <= 4) {
            setGameState(prev => {
                // Update the last log entry to reflect the correct starting player
                const starterName = startingPlayer === 'player' ? 'Player' : 'Opponent';
                const updatedLog = [...prev.log];
                if (updatedLog.length > 0) {
                    // Replace the last "goes first" message
                    updatedLog[updatedLog.length - 1] = {
                        player: 'player',
                        message: `${starterName} goes first.`
                    };
                }

                return {
                    ...prev,
                    turn: startingPlayer,  // CRITICAL: Set turn to whoever won the coin flip
                    log: updatedLog
                };
            });
        }
    }, [startingPlayer, gameState.turn, gameState.log.length]);

    const getTurnProgressionCallback = useCallback((phase: GamePhase): ((s: GameState) => GameState) => {
        switch (phase) {
            case 'start':
                return phaseManager.continueTurnAfterStartPhaseAction;
            case 'end':
                return phaseManager.continueTurnProgression;
            default:
                return phaseManager.processEndOfAction;
        }
    }, []);

    const processAnimationQueue = useCallback((
        queue: AnimationRequest[],
        onComplete: () => void
    ) => {
        const processNext = (q: AnimationRequest[]) => {
            if (q.length === 0) {
                onComplete();
                return;
            }

            const [nextRequest, ...rest] = q;

            // Handle different animation types
            if (nextRequest.type === 'delete') {
                // NEW ANIMATION SYSTEM: Create and enqueue delete animation
                if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation) {
                    setGameState(currentState => {
                        const card = currentState.player.lanes.flat().find(c => c.id === nextRequest.cardId) ||
                                     currentState.opponent.lanes.flat().find(c => c.id === nextRequest.cardId);
                        if (card) {
                            const cardPosition = findCardInLanes(currentState, nextRequest.cardId, nextRequest.owner);
                            if (cardPosition) {
                                const animation = createDeleteAnimation(
                                    currentState,
                                    card,
                                    nextRequest.owner,
                                    cardPosition.laneIndex,
                                    cardPosition.cardIndex
                                );
                                queueMicrotask(() => enqueueAnimation(animation));
                            }
                        }
                        return currentState; // Don't modify state, just enqueue animation
                    });
                }

                // OLD ANIMATION SYSTEM - skip if new system is active
                if (!USE_NEW_ANIMATION_SYSTEM || !enqueueAnimation) {
                    setGameState(s => ({ ...s, animationState: { type: 'deleteCard', cardId: nextRequest.cardId, owner: nextRequest.owner } }));
                }

                setTimeout(() => {
                    setGameState(s => {
                        // CRITICAL: Check if card still exists on board
                        // Some effects (like deleteSelf in on_cover) already delete the card in the executor
                        // In that case, we just clear the animation without trying to delete again
                        const cardStillExists = s.player.lanes.flat().some(c => c.id === nextRequest.cardId) ||
                                                s.opponent.lanes.flat().some(c => c.id === nextRequest.cardId);

                        if (!cardStillExists) {
                            // Card already deleted - just clear animation
                            return { ...s, animationState: null };
                        }

                        // Card still exists - delete it now
                        let stateAfterDelete = deleteCardFromBoard(s, nextRequest.cardId);
                        stateAfterDelete = stateManager.recalculateAllLaneValues(stateAfterDelete);

                        // Clear animation - uncover effects are handled in onCompleteCallback
                        return { ...stateAfterDelete, animationState: null };
                    });

                    // After animation completes, immediately process next or call onComplete
                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, 10);
                }, 500); // Animation duration
            } else if (nextRequest.type === 'return') {
                // NEW: Handle return animation (Water_custom-3)
                setGameState(s => ({ ...s, animationState: { type: 'returnCard', cardId: nextRequest.cardId, owner: nextRequest.owner } as any }));

                setTimeout(() => {
                    setGameState(s => {
                        const laneIndex = s[nextRequest.owner].lanes.findIndex(l => l.some(c => c.id === nextRequest.cardId));
                        const wasTopCard = laneIndex !== -1 &&
                                           s[nextRequest.owner].lanes[laneIndex].length > 0 &&
                                           s[nextRequest.owner].lanes[laneIndex][s[nextRequest.owner].lanes[laneIndex].length - 1].id === nextRequest.cardId;

                        // Find and remove card from board, add to hand
                        const card = s[nextRequest.owner].lanes.flat().find(c => c.id === nextRequest.cardId);
                        if (!card) {
                            return { ...s, animationState: null };
                        }

                        const newLanes = s[nextRequest.owner].lanes.map(lane => lane.filter(c => c.id !== nextRequest.cardId));
                        let stateAfterReturn = {
                            ...s,
                            [nextRequest.owner]: {
                                ...s[nextRequest.owner],
                                lanes: newLanes,
                                hand: [...s[nextRequest.owner].hand, card]
                            }
                        };
                        stateAfterReturn = stateManager.recalculateAllLaneValues(stateAfterReturn);

                        // CRITICAL: Trigger uncover effect if the returned card was a top card
                        if (wasTopCard && laneIndex !== -1 && stateAfterReturn[nextRequest.owner].lanes[laneIndex].length > 0) {
                            const uncoverResult = handleUncoverEffect(stateAfterReturn, nextRequest.owner, laneIndex);
                            stateAfterReturn = uncoverResult.newState;
                        }

                        return { ...stateAfterReturn, animationState: null };
                    });

                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, 10);
                }, 500);
            } else if (nextRequest.type === 'play') {
                // NEW: Handle play animation (Life-0 multi-card effects, Life-3, etc.)
                setGameState(s => ({ ...s, animationState: { type: 'playCard', cardId: nextRequest.cardId, owner: nextRequest.owner } as any }));

                setTimeout(() => {
                    setGameState(s => ({ ...s, animationState: null }));

                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, 10);
                }, 500);
            } else if (nextRequest.type === 'draw') {
                // NEW: Handle draw animation (Life-4, refresh, custom protocol draws)
                setGameState(s => ({ ...s, animationState: { type: 'draw', player: nextRequest.player, count: nextRequest.count } as any }));

                setTimeout(() => {
                    setGameState(s => ({ ...s, animationState: null }));

                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, 10);
                }, 500);
            } else {
                // Skip unknown animation types
                setTimeout(() => {
                    if (rest.length > 0) {
                        processNext(rest);
                    } else {
                        onComplete();
                    }
                }, 10);
            }
        };

        processNext(queue);
    }, []);


    const playSelectedCard = (laneIndex: number, isFaceUp: boolean, targetOwner: Player = 'player') => {
        if (!selectedCard || gameState.turn !== 'player' || gameState.phase !== 'action') return;
        const cardId = selectedCard;
        setSelectedCard(null);

        // NEW: Use the new animation queue system if available and enabled
        if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation) {
            // Get the card and its position in hand BEFORE state update
            const card = gameState.player.hand.find(c => c.id === cardId);
            const handIndex = gameState.player.hand.findIndex(c => c.id === cardId);

            if (card) {
                // Create and enqueue the play animation with the PRE-action state snapshot
                const animation = createPlayAnimation(
                    gameState,
                    card,
                    'player',
                    laneIndex,
                    true, // fromHand
                    handIndex,
                    isFaceUp // Pass through face-up state for animation
                );
                enqueueAnimation(animation);
            }

            // Update state immediately to final state (no setTimeout, no animationState)
            setGameState(prev => {
                const turnProgressionCb = getTurnProgressionCallback(prev.phase);
                const { newState, animationRequests } = resolvers.playCard(prev, cardId, laneIndex, isFaceUp, 'player', targetOwner);

                // TODO: Handle animationRequests from effects (delete, flip, etc.) with new system
                // For now, fall back to old processing if there are effect animations
                if (animationRequests && animationRequests.length > 0) {
                    // Process effect animations with old system for now
                    const stateToProcess = { ...newState, animationState: null };
                    processAnimationQueue(animationRequests, () => {
                        setGameState(s_after_anim => turnProgressionCb(s_after_anim));
                    });
                    return stateToProcess;
                }

                if (newState.actionRequired) {
                    return newState;
                }

                return turnProgressionCb(newState);
            });
            return;
        }

        // FALLBACK: Old animation system
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            // targetOwner determines whose lane the card is played into (for Corruption-0 play on opponent's side)
            const { newState, animationRequests } = resolvers.playCard(prev, cardId, laneIndex, isFaceUp, 'player', targetOwner);

            const stateWithAnimation = { ...newState, animationState: { type: 'playCard' as const, cardId, owner: 'player' as Player }};

            setTimeout(() => {
                setGameState(s => {
                    let stateToProcess = { ...s, animationState: null };

                    if (animationRequests && animationRequests.length > 0) {
                        // The original action is the implicit 'play card' action.
                        // We pass a dummy action object here. This part could be improved if more complex
                        // post-animation logic is needed for on-cover effects.
                        const dummyPlayAction: ActionRequired = { type: 'select_card_from_hand_to_play', disallowedLaneIndex: -1, sourceCardId: cardId, actor: 'player' };
                        // FIX: Changed processAnimationQueue call to use a callback instead of originalAction, which is a more flexible pattern used elsewhere.
                        processAnimationQueue(animationRequests, () => {
                            setGameState(s_after_anim => turnProgressionCb(s_after_anim));
                        });
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
            const prevHandIds = new Set(prev.player.hand.map(c => c.id));
            const newState = resolvers.fillHand(prev, 'player');

            // NEW ANIMATION SYSTEM: Create draw animations for newly drawn cards
            if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation) {
                const newCards = newState.player.hand.filter(c => !prevHandIds.has(c.id));
                newCards.forEach((card, index) => {
                    const animation = createDrawAnimation(
                        prev,  // Use prev state for snapshot (before cards were added)
                        card,
                        'player',
                        prev.player.hand.length + index
                    );
                    queueMicrotask(() => enqueueAnimation(animation));
                });
            }

            if (newState.actionRequired) {
                return newState;
            }
            return turnProgressionCb(newState);
        });
    };

    const discardCardFromHand = useCallback((cardId: string) => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'discard' || prev.actionRequired.actor !== 'player') return prev;

            // NEW ANIMATION SYSTEM: Create and enqueue discard animation
            if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation) {
                const card = prev.player.hand.find(c => c.id === cardId);
                const handIndex = prev.player.hand.findIndex(c => c.id === cardId);
                if (card && handIndex >= 0) {
                    const animation = createDiscardAnimation(prev, card, 'player', handIndex);
                    queueMicrotask(() => enqueueAnimation(animation));
                }
                // With new system active, skip old animation but still trigger the action
                return {
                    ...prev,
                    animationState: { type: 'discardCard', owner: 'player', cardIds: [cardId], originalAction: prev.actionRequired }
                };
            }

            // OLD ANIMATION SYSTEM (fallback)
            return {
                ...prev,
                animationState: { type: 'discardCard', owner: 'player', cardIds: [cardId], originalAction: prev.actionRequired }
            }
        });
    }, [enqueueAnimation]);

    const compileLane = useCallback((laneIndex: number) => {
        setGameState(prev => {
            if (prev.winner || prev.phase !== 'compile') return prev;
            
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const stateBeforeCompile = resolvers.compileLane(prev, laneIndex);
    
            const stateWithAnimation = { 
                ...stateBeforeCompile, 
                animationState: { type: 'compile' as const, laneIndex },
                compilableLanes: []
            };
    
            setTimeout(() => {
                setGameState(currentState => {
                    const stateAfterCompile = resolvers.performCompile(currentState, laneIndex, onEndGame);
                    if (stateAfterCompile.winner) {
                        return stateAfterCompile;
                    }

                    // REMOVED: Duplicate Control-Mechanic handling that was overwriting the originalAction from performCompile
                    // The Control-Mechanic prompt is now fully handled inside performCompile
                    if (stateAfterCompile.actionRequired?.type === 'prompt_use_control_mechanic') {
                        return { ...stateAfterCompile, animationState: null };
                    }

                    // NEW: Check for compile delete animations
                    const compileAnimations = (stateAfterCompile as any)._compileAnimations as AnimationRequest[] | undefined;
                    if (compileAnimations && compileAnimations.length > 0) {
                        // Play delete animations sequentially before processing queue
                        processAnimationQueue(compileAnimations, () => {
                            setGameState(s => {
                                // Clean up animation marker
                                const cleanState = { ...s };
                                delete (cleanState as any)._compileAnimations;

                                const finalState = turnProgressionCb(cleanState);
                                return { ...finalState, animationState: null };
                            });
                        });
                        // Return state with compile animation still showing while deletes play
                        const stateWithoutMarker = { ...stateAfterCompile };
                        delete (stateWithoutMarker as any)._compileAnimations;
                        return stateWithoutMarker;
                    }

                    const finalState = turnProgressionCb(stateAfterCompile);
                    return { ...finalState, animationState: null };
                });
            }, 1000);
    
            return stateWithAnimation;
        });
    }, [onEndGame, getTurnProgressionCallback]);

    const resolveActionWithCard = (targetCardId: string) => {
        setGameState(prev => {
            const originalTurn = prev.turn;
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(prev, targetCardId);

            if (requiresAnimation) {
                // FIX: Updated the call to `processAnimationQueue` to pass a callback, which aligns with the refactored, more flexible animation handling pattern. This fixes the original property access error.
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        // FIX: If turn changed during animation (due to interrupt restoration),
                        // turnProgressionCb was already called. Pass a no-op to prevent double progression.
                        const endTurnCb = s.turn !== originalTurn
                            ? (state: GameState) => state
                            : turnProgressionCb;

                        return requiresAnimation.onCompleteCallback(s, endTurnCb);
                    });
                });
                return nextState;
            }

            if (nextState.actionRequired) {
                return nextState;
            }

            // If the current action was resolved (actionRequired is null),
            // we must always call the turn progression callback. It will handle
            // processing any queued actions (like Water-0's self-flip) or
            // advancing the game phase.
            return turnProgressionCb(nextState);
        });
    };
    
    const resolveActionWithLane = (targetLaneIndex: number) => {
        // NEW ANIMATION SYSTEM: Create shift animation BEFORE setGameState (like playSelectedCard)
        // This ensures the animation is enqueued synchronously before React updates
        if (USE_NEW_ANIMATION_SYSTEM && enqueueAnimation && gameState.actionRequired?.type === 'select_lane_for_shift') {
            const { cardToShiftId, cardOwner, originalLaneIndex } = gameState.actionRequired;
            // Only animate if shift is valid (not same lane)
            if (originalLaneIndex !== targetLaneIndex) {
                const cardToShift = gameState[cardOwner].lanes.flat().find(c => c.id === cardToShiftId);
                const cardIndex = gameState[cardOwner].lanes[originalLaneIndex].findIndex(c => c.id === cardToShiftId);
                if (cardToShift && cardIndex >= 0) {
                    const animation = createShiftAnimation(
                        gameState,  // Use current gameState, not prev
                        cardToShift,
                        cardOwner,
                        originalLaneIndex,
                        cardIndex,
                        targetLaneIndex
                    );
                    enqueueAnimation(animation);  // Direct call, no queueMicrotask
                }
            }
        }

        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(prev, targetLaneIndex);

            if (requiresAnimation) {
                // FIX: Updated the call to `processAnimationQueue` to use the standardized callback pattern, resolving inconsistencies between card and lane action animations.
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => requiresAnimation.onCompleteCallback(s, turnProgressionCb));
                });
                return nextState;
            }

            if (nextState.actionRequired) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    };

    // Diversity-0: "in this line" play effect - player chooses face-down
    const resolveActionWithLaneFaceDown = (targetLaneIndex: number) => {
        setGameState(prev => {
            // Set isFaceDown: true on the action before resolving
            const stateWithFaceDown = {
                ...prev,
                actionRequired: prev.actionRequired ? {
                    ...prev.actionRequired,
                    isFaceDown: true
                } : null
            };

            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(stateWithFaceDown, targetLaneIndex);

            if (requiresAnimation) {
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => requiresAnimation.onCompleteCallback(s, turnProgressionCb));
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

            // Handle skip for reveal-board-card prompts (Light-2 and custom protocols)
            if (stateWithoutAnimation.actionRequired?.type === 'prompt_shift_or_flip_board_card_custom') {
                stateWithoutAnimation = resolvers.resolveRevealBoardCardPrompt(stateWithoutAnimation, 'skip');
            } else {
                stateWithoutAnimation = resolvers.skipAction(stateWithoutAnimation);
            }

            if (stateWithoutAnimation.actionRequired?.type === 'plague_4_player_flip_optional') {
                return stateWithoutAnimation;
            }

            return turnProgressionCb(stateWithoutAnimation);
        });
    };

    const resolveControlMechanicPrompt = useCallback((choice: 'player' | 'opponent' | 'skip') => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'prompt_use_control_mechanic') return prev;
    
            const { originalAction, actor } = prev.actionRequired;
    
            if (choice === 'skip') {
                let stateAfterSkip = log(prev, actor, "Player skips rearranging protocols.");
                stateAfterSkip.actionRequired = null;
                // Reset indent to 0 before resuming the main action (compile/refresh)
                stateAfterSkip = { ...stateAfterSkip, _logIndentLevel: 0 };

                if (originalAction.type === 'compile') {
                    const stateBeforeCompile = stateAfterSkip;
                    
                    const stateWithAnimation = { 
                        ...stateBeforeCompile, 
                        animationState: { type: 'compile' as const, laneIndex: originalAction.laneIndex },
                        compilableLanes: []
                    };
    
                    setTimeout(() => {
                        setGameState(currentState => {
                            const nextState = resolvers.performCompile(currentState, originalAction.laneIndex, onEndGame);
                            if (nextState.winner) {
                                return nextState;
                            }
                            const turnProgressionCb = getTurnProgressionCallback(nextState.phase);
                            const finalState = turnProgressionCb(nextState);
                            return { ...finalState, animationState: null };
                        });
                    }, 1000);
    
                    return stateWithAnimation;
                } else if (originalAction.type === 'continue_turn') {
                    let stateWithQueuedActions = { ...stateAfterSkip };
                    if (originalAction.queuedSpeed2Actions && originalAction.queuedSpeed2Actions.length > 0) {
                        stateWithQueuedActions.queuedActions = [
                            ...originalAction.queuedSpeed2Actions,
                            ...(stateWithQueuedActions.queuedActions || [])
                        ];
                    }
                    const turnProgressionCb = getTurnProgressionCallback(stateWithQueuedActions.phase);
                    return turnProgressionCb(stateWithQueuedActions);
                } else if (originalAction.type === 'resume_interrupted_turn') {
                    // CRITICAL: Restore the interrupt after control mechanic
                    let stateWithInterruptRestored = { ...stateAfterSkip };
                    stateWithInterruptRestored._interruptedTurn = originalAction.interruptedTurn;
                    stateWithInterruptRestored._interruptedPhase = originalAction.interruptedPhase;

                    if (originalAction.queuedSpeed2Actions && originalAction.queuedSpeed2Actions.length > 0) {
                        stateWithInterruptRestored.queuedActions = [
                            ...originalAction.queuedSpeed2Actions,
                            ...(stateWithInterruptRestored.queuedActions || [])
                        ];
                    }

                    // Use processEndOfAction to properly restore the interrupt
                    return phaseManager.processEndOfAction(stateWithInterruptRestored);
                } else { // fill_hand
                    const stateAfterFill = resolvers.performFillHand(stateAfterSkip, actor);
                    const turnProgressionCb = getTurnProgressionCallback(stateAfterFill.phase);
                    return turnProgressionCb(stateAfterFill);
                }
            } else { // 'player' or 'opponent'
                const target = choice;
                const actorName = actor === 'player' ? 'Player' : 'Opponent';
                const targetName = target === 'player' ? 'their own' : "the opponent's";
                let stateWithChoice = log(prev, actor, `${actorName} chooses to rearrange ${targetName} protocols.`);
                
                stateWithChoice.actionRequired = {
                    type: 'prompt_rearrange_protocols',
                    sourceCardId: 'CONTROL_MECHANIC',
                    target,
                    actor,
                    originalAction,
                };
                return stateWithChoice;
            }
        });
    }, [onEndGame, getTurnProgressionCallback]);

    const resolveOptionalDrawPrompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveOptionalDrawPrompt(prev, accept);
            if (!nextState.actionRequired) {
                return turnProgressionCb(nextState);
            }
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    // REMOVED: resolveDeath1Prompt - Death-1 now uses custom protocol with prompt_optional_draw
    // REMOVED: resolveLove1Prompt - Love-1 now uses custom protocol with prompt_optional_effect

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
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);
    
    // REMOVED: resolveFire3Prompt - Fire-3 now uses custom protocol with prompt_optional_discard_custom

    const resolveOptionalDiscardCustomPrompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveOptionalDiscardCustomPrompt(prev, accept);
            if (!accept) {
                return turnProgressionCb(nextState);
            }
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    const resolveOptionalEffectPrompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);

            const nextState = resolvers.resolveOptionalEffectPrompt(prev, accept);

            // CRITICAL: Call turnProgressionCb if:
            // 1. User declined (!accept), OR
            // 2. User accepted but effect was skipped (no actionRequired)
            // Only skip turnProgressionCb if effect created an actionRequired (waiting for user input)
            if (!nextState.actionRequired) {
                return turnProgressionCb(nextState);
            }
            return nextState;
        });
    }, [getTurnProgressionCallback]);

    // REMOVED: resolveSpeed3Prompt - Speed-3 now uses custom protocol system

    const resolveFire4Discard = useCallback((cardIds: string[]) => {
        setGameState(prev => {
            // Support original Fire-4, custom protocol variable discard, AND batch discard (count > 1)
            const isOriginalFire4 = prev.actionRequired?.type === 'select_cards_from_hand_to_discard_for_fire_4';
            const isVariableCount = prev.actionRequired?.type === 'discard' && (prev.actionRequired as any)?.variableCount;
            const isBatchDiscard = prev.actionRequired?.type === 'discard' && prev.actionRequired.count > 1;

            if (!isOriginalFire4 && !isVariableCount && !isBatchDiscard) return prev;

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

    // REMOVED: resolveLight2Prompt - Light-2 now uses resolveRevealBoardCardPrompt

    const resolveRevealBoardCardPrompt = useCallback((choice: 'shift' | 'flip' | 'skip') => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveRevealBoardCardPrompt(prev, choice);
            if (nextState.actionRequired) {
                return nextState;
            }
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    const resolveRearrangeProtocols = useCallback((newOrder: string[]) => {
        setGameState(prev => {
            // Track rearrange in statistics ONLY if from Control Mechanic (not Psychic-2 etc.)
            if (trackPlayerRearrange && prev.actionRequired?.sourceCardId === 'CONTROL_MECHANIC' && prev.actionRequired?.actor) {
                trackPlayerRearrange(prev.actionRequired.actor);
            }

            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveRearrangeProtocols(prev, newOrder, onEndGame);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback, onEndGame, trackPlayerRearrange]);
    
    // REMOVED: resolvePsychic4Prompt - Psychic-4 now uses custom protocol with prompt_optional_effect
    // REMOVED: resolveSpirit1Prompt - Spirit-1 now uses custom protocol with custom_choice
    // REMOVED: resolveSpirit3Prompt - Spirit-3 now uses custom protocol system with after_draw trigger

    const resolveCustomChoice = useCallback((optionIndex: number) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveCustomChoice(prev, optionIndex);
            if (nextState.actionRequired) {
                return nextState;
            }
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    const resolveSwapProtocols = useCallback((indices: [number, number]) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSwapProtocols(prev, indices, onEndGame);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback, onEndGame]);

    // Clarity-2/3: "Draw 1 card with a value of X revealed this way."
    const resolveSelectRevealedDeckCard = useCallback((cardId: string) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSelectRevealedDeckCard(prev, cardId);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    // Unity-4: "Reveal deck, draw all Unity cards, shuffle"
    const resolveRevealDeckDrawProtocol = useCallback(() => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveRevealDeckDrawProtocol(prev);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    // Luck-0: "State a number"
    const resolveStateNumber = useCallback((number: number) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveStateNumberAction(prev, number);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    // Luck-3: "State a protocol"
    const resolveStateProtocol = useCallback((protocol: string) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveStateProtocolAction(prev, protocol);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    // Luck-0: "Select from drawn cards to reveal"
    const resolveSelectFromDrawnToReveal = useCallback((cardId: string) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSelectFromDrawnToReveal(prev, cardId);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    // Confirm deck discard modal
    const resolveConfirmDeckDiscard = useCallback(() => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveConfirmDeckDiscard(prev);

            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    // Confirm deck play preview modal (Luck-1: show card before lane selection)
    const resolveConfirmDeckPlayPreview = useCallback(() => {
        setGameState(prev => {
            // Don't use turnProgressionCb - this transitions to another action (lane selection)
            const nextState = resolvers.resolveConfirmDeckPlayPreview(prev);
            return nextState;
        });
    }, []);

    // Time-0: Select card from trash to play
    const resolveSelectTrashCardToPlay = useCallback((cardIndex: number) => {
        setGameState(prev => {
            // Don't use turnProgressionCb - this transitions to lane selection
            const nextState = resolvers.resolveSelectTrashCardToPlay(prev, cardIndex);
            return nextState;
        });
    }, []);

    // Time-3: Select card from trash to reveal
    const resolveSelectTrashCardToReveal = useCallback((cardIndex: number) => {
        setGameState(prev => {
            // Don't use turnProgressionCb - this transitions to lane selection or play
            const nextState = resolvers.resolveSelectTrashCardToReveal(prev, cardIndex);
            return nextState;
        });
    }, []);

    const setupTestScenario = useCallback((scenarioOrFunction: string | ((state: GameState) => GameState)) => {
        // CRITICAL: Clear the processing lock when switching scenarios
        // This prevents old setTimeout callbacks from interfering with the new scenario
        isProcessingAIRef.current = false;

        // Increment scenario version to invalidate any pending setTimeout callbacks
        scenarioVersionRef.current++;

        setGameState(currentState => {
            // NEW: If it's a function, call it directly with current state
            if (typeof scenarioOrFunction === 'function') {
                return scenarioOrFunction(currentState);
            }

            // OLD: String-based scenarios (legacy)
            const scenario = scenarioOrFunction;
            if (scenario === 'speed-0-interrupt') {
                const debugPlayerProtocols = ['Speed', 'Life', 'Water'];
                const debugOpponentProtocols = ['Metal', 'Death', 'Hate'];
    
                let playerDeck = shuffleDeck(buildDeck(debugPlayerProtocols));
                let opponentDeck = shuffleDeck(buildDeck(debugOpponentProtocols));
    
                const removeCardFromDeck = (deck: Card[], protocol: string, value: number): Card => {
                    const index = deck.findIndex(c => c.protocol === protocol && c.value === value);
                    if (index > -1) {
                        return deck.splice(index, 1)[0];
                    }
                    return cards.find(c => c.protocol === protocol && c.value === value)!;
                };
    
                const speed0Card = removeCardFromDeck(playerDeck, 'Speed', 0);
                const metal0Card = removeCardFromDeck(opponentDeck, 'Metal', 0);
                const speed1Card = removeCardFromDeck(playerDeck, 'Speed', 1);
                const life1Card = removeCardFromDeck(playerDeck, 'Life', 1);
                const water1Card = removeCardFromDeck(playerDeck, 'Water', 1);
                const speed3Card = removeCardFromDeck(playerDeck, 'Speed', 3);
    
                let newState = stateManager.createInitialState(debugPlayerProtocols, debugOpponentProtocols, useControlMechanic, startingPlayer);
    
                newState.player.lanes = [[], [], []];
                newState.player.lanes[0] = [{ ...speed0Card, id: uuidv4(), isFaceUp: false }]; 
                newState.player.hand = [
                    { ...speed1Card, id: uuidv4(), isFaceUp: true },
                    { ...life1Card, id: uuidv4(), isFaceUp: true },
                    { ...water1Card, id: uuidv4(), isFaceUp: true },
                    { ...speed3Card, id: uuidv4(), isFaceUp: true },
                ];
                newState.player.deck = playerDeck;
                newState.player.discard = [];
    
                newState.opponent.lanes = [[], [], []];
                newState.opponent.hand = [{ ...metal0Card, id: uuidv4(), isFaceUp: true }]; 
                newState.opponent.deck = opponentDeck;
                newState.opponent.discard = [];
    
                newState.turn = 'opponent';
                newState.phase = 'start';
                newState.actionRequired = null;
                newState.queuedActions = [];
                
                newState = stateManager.recalculateAllLaneValues(newState);
                newState = log(newState, 'player', 'DEBUG: Dynamic Speed-0 interrupt scenario set up. AI will play Metal-0.');
                return newState;
            } else if (scenario === 'speed-1-trigger') {
                const debugPlayerProtocols = ['Speed', 'Life', 'Water'];
                const debugOpponentProtocols = ['Metal', 'Death', 'Hate'];

                let playerDeck = shuffleDeck(buildDeck(debugPlayerProtocols));
                const opponentDeck = shuffleDeck(buildDeck(debugOpponentProtocols));

                const removeCardFromDeck = (deck: Card[], protocol: string, value: number): Card => {
                    const index = deck.findIndex(c => c.protocol === protocol && c.value === value);
                    if (index > -1) {
                        return deck.splice(index, 1)[0];
                    }
                    return cards.find(c => c.protocol === protocol && c.value === value)!;
                };

                const speed1Card = removeCardFromDeck(playerDeck, 'Speed', 1);

                let newState = stateManager.createInitialState(debugPlayerProtocols, debugOpponentProtocols, useControlMechanic, startingPlayer);

                newState.player.lanes = [[], [], []];
                newState.player.lanes[0] = [{ ...speed1Card, id: uuidv4(), isFaceUp: true }];

                const { drawnCards, remainingDeck } = drawCardsUtil(playerDeck, [], 6);
                newState.player.hand = drawnCards.map(c => ({...c, id: uuidv4(), isFaceUp: true}));
                newState.player.deck = remainingDeck;
                newState.player.discard = [];

                newState.opponent.lanes = [[], [], []];
                newState.opponent.hand = [];
                newState.opponent.deck = opponentDeck;
                newState.opponent.discard = [];

                newState.turn = 'player';
                newState.phase = 'hand_limit';
                newState.actionRequired = {
                    type: 'discard',
                    actor: 'player',
                    count: 1, 
                };
                newState.queuedActions = [];
                
                newState = stateManager.recalculateAllLaneValues(newState);
                newState = log(newState, 'player', 'DEBUG: Speed-1 discard trigger scenario set up.');
                return newState;
            } else if (scenario === 'fire-oncover-test') {
                // Test scenario for Fire-0 On-Cover bug
                const debugPlayerProtocols = ['Death', 'Hate', 'Water'];
                const debugOpponentProtocols = ['Fire', 'Plague', 'Metal'];

                const playerDeck = shuffleDeck(buildDeck(debugPlayerProtocols));
                let opponentDeck = shuffleDeck(buildDeck(debugOpponentProtocols));

                const removeCardFromDeck = (deck: Card[], protocol: string, value: number): Card => {
                    const index = deck.findIndex(c => c.protocol === protocol && c.value === value);
                    if (index > -1) {
                        return deck.splice(index, 1)[0];
                    }
                    return cards.find(c => c.protocol === protocol && c.value === value)!;
                };

                // Remove specific cards from opponent deck
                const fire0Card = removeCardFromDeck(opponentDeck, 'Fire', 0);
                const fire2Card = removeCardFromDeck(opponentDeck, 'Fire', 2);
                const fire3Card = removeCardFromDeck(opponentDeck, 'Fire', 3);

                // Player cards for each lane
                const death1Card = cards.find(c => c.protocol === 'Death' && c.value === 1)!;
                const hate2Card = cards.find(c => c.protocol === 'Hate' && c.value === 2)!;
                const water3Card = cards.find(c => c.protocol === 'Water' && c.value === 3)!;

                let newState = stateManager.createInitialState(debugPlayerProtocols, debugOpponentProtocols, useControlMechanic, 'opponent');

                // Player has one face-up card in each lane (so AI can flip them)
                newState.player.lanes = [
                    [{ ...death1Card, id: uuidv4(), isFaceUp: true }],
                    [{ ...hate2Card, id: uuidv4(), isFaceUp: true }],
                    [{ ...water3Card, id: uuidv4(), isFaceUp: true }]
                ];
                newState.player.hand = [];
                newState.player.deck = playerDeck;
                newState.player.discard = [];

                // Opponent has Fire-0 already in play, Fire-3 and Fire-2 in hand
                newState.opponent.lanes = [
                    [{ ...fire0Card, id: uuidv4(), isFaceUp: true }],
                    [],
                    []
                ];
                newState.opponent.hand = [
                    { ...fire3Card, id: uuidv4(), isFaceUp: true },
                    { ...fire2Card, id: uuidv4(), isFaceUp: true }
                ];
                newState.opponent.deck = opponentDeck;
                newState.opponent.discard = [];

                newState.turn = 'opponent';
                newState.phase = 'action';
                newState.actionRequired = null;
                newState.queuedActions = [];

                newState = stateManager.recalculateAllLaneValues(newState);
                newState = log(newState, 'opponent', 'DEBUG: Fire On-Cover test scenario. Opponent has Fire-0 in play, Fire-3 and Fire-2 in hand. Ready to play Fire-3.');
                return newState;
            } else if (scenario === 'speed-2-control-test') {
                // Test scenario for Speed-2 + Control Mechanic bug
                const debugPlayerProtocols = ['Speed', 'Light', 'Water'];
                const debugOpponentProtocols = ['Fire', 'Plague', 'Metal'];

                const playerDeck = shuffleDeck(buildDeck(debugPlayerProtocols));
                const opponentDeck = shuffleDeck(buildDeck(debugOpponentProtocols));

                const removeCardFromDeck = (deck: Card[], protocol: string, value: number): Card => {
                    const index = deck.findIndex(c => c.protocol === protocol && c.value === value);
                    if (index > -1) {
                        return deck.splice(index, 1)[0];
                    }
                    return cards.find(c => c.protocol === protocol && c.value === value)!;
                };

                // Get Speed-2 card
                const speed2Card = removeCardFromDeck(playerDeck, 'Speed', 2);

                let newState = stateManager.createInitialState(debugPlayerProtocols, debugOpponentProtocols, true, 'player'); // Control enabled!

                // Player has Speed-2 ready to compile
                newState.player.lanes = [
                    [{ ...speed2Card, id: uuidv4(), isFaceUp: true }],
                    [],
                    []
                ];
                newState.player.protocols[0] = 'Speed';
                newState.player.laneValues[0] = 10; // Ready to compile!
                newState.player.hand = [];
                newState.player.deck = playerDeck;
                newState.player.discard = [];
                newState.controlCardHolder = 'player'; // Player has Control!

                newState.opponent.lanes = [[], [], []];
                newState.opponent.hand = [];
                newState.opponent.deck = opponentDeck;
                newState.opponent.discard = [];

                newState.turn = 'player';
                newState.phase = 'compile';
                newState.compilableLanes = [0]; // Speed lane is compilable
                newState.actionRequired = null;
                newState.queuedActions = [];

                newState = stateManager.recalculateAllLaneValues(newState);
                newState = log(newState, 'player', 'DEBUG: Speed-2 + Control test scenario. Player has Speed-2 (value 10), Control Component active. Ready to compile Protocol Speed!');
                return newState;
            }
            return currentState;
        });
    }, [useControlMechanic]);

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
                    } else if (originalAction.type === 'discard' && (originalAction.count > 1 || (originalAction as any).variableCount)) {
                        // Batch discard or variable count - use resolveFire4Discard for proper followUpEffect handling
                        stateAfterDiscard = resolvers.resolveFire4Discard(s, cardIds);
                    } else {
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

    // NOTE: discard_completed is now handled directly in discardResolver - no hook needed here

    // Hook 1: AI Turn Processing (Normal opponent turns)
    useEffect(() => {
        // CRITICAL FIX: Don't trigger if an interrupt is active (_interruptedTurn is set)
        // Interrupts are handled by Hook 2, not Hook 1
        if (gameState.turn === 'opponent' &&
            !gameState.winner &&
            !gameState.animationState &&
            !gameState._interruptedTurn &&  // NEW: Don't trigger during interrupts
            !isProcessingAIRef.current) {

            isProcessingAIRef.current = true;
            const currentScenarioVersion = scenarioVersionRef.current;

            // CRITICAL: Capture the state NOW, before setTimeout
            const capturedState = gameState;

            const timer = setTimeout(() => {
                // Check if scenario has changed - if so, abort this callback
                if (scenarioVersionRef.current !== currentScenarioVersion) {
                    return;
                }

                aiManager.runOpponentTurn(capturedState, setGameState, difficulty, {
                    compileLane: (s, l) => resolvers.performCompile(s, l, onEndGame),
                    playCard: resolvers.playCard,
                    fillHand: resolvers.performFillHand,
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
                    resolveOptionalDrawPrompt: resolvers.resolveOptionalDrawPrompt,
                    // REMOVED: resolveDeath1Prompt - Death-1 now uses custom protocol
                    // REMOVED: resolveLove1Prompt - Love-1 now uses custom protocol
                    resolvePlague4Flip: (s, a) => resolvers.resolvePlague4Flip(s, a, 'opponent'),
                    resolvePlague2Discard: resolvers.resolvePlague2OpponentDiscard,
                    resolvePlague2OpponentDiscard: resolvers.resolvePlague2OpponentDiscard,
                    // REMOVED: resolveFire3Prompt - Fire-3 now uses custom protocol
                    resolveOptionalDiscardCustomPrompt: resolvers.resolveOptionalDiscardCustomPrompt,
                    resolveOptionalEffectPrompt: resolvers.resolveOptionalEffectPrompt,
                    resolveFire4Discard: resolvers.resolveFire4Discard,
                    resolveHate1Discard: resolvers.resolveHate1Discard,
                    // REMOVED: resolveLight2Prompt - now uses resolveRevealBoardCardPrompt
                    resolveRearrangeProtocols: (s, o) => resolvers.resolveRearrangeProtocols(s, o, onEndGame),
                    resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                    // REMOVED: resolvePsychic4Prompt - Psychic-4 now uses custom protocol
                    // REMOVED: resolveSpirit1Prompt - Spirit-1 now uses custom protocol
                    resolveSwapProtocols: (s, o) => resolvers.resolveSwapProtocols(s, o, onEndGame),
                    revealOpponentHand: resolvers.revealOpponentHand,
                    resolveCustomChoice: resolvers.resolveCustomChoice,
                }, processAnimationQueue, phaseManager, trackPlayerRearrange, enqueueAnimation);
            }, 1500);
            return () => {
                clearTimeout(timer);
                isProcessingAIRef.current = false;
            };
        }
    }, [gameState.turn, gameState.phase, gameState.winner, gameState.animationState, gameState._interruptedTurn, difficulty, onEndGame, processAnimationQueue, gameState.actionRequired]);

    // Hook 2: Opponent Action During Player Turn (Higher priority - shorter timeout)
    useEffect(() => {
        const action = gameState.actionRequired;
        // CRITICAL FIX: Check for opponent actions during player's turn, INCLUDING during interrupts.
        // If an interrupt is active (_interruptedTurn === 'player'), the opponent can have actions even though turn === 'opponent'.
        const isPlayerTurnOrInterrupt = gameState.turn === 'player' || gameState._interruptedTurn === 'player';
        const hasOpponentAction = action && 'actor' in action && action.actor === 'opponent';
        const isOpponentActionDuringPlayerTurn =
            isPlayerTurnOrInterrupt &&
            !gameState.animationState &&
            hasOpponentAction;

        // CRITICAL: Check the lock AND set it in a way that prevents race conditions
        // We check !isProcessingAIRef.current AFTER all other conditions, and set it immediately
        if (isOpponentActionDuringPlayerTurn && !isProcessingAIRef.current) {
            isProcessingAIRef.current = true;

            // CRITICAL: Execute IMMEDIATELY without setTimeout to avoid React Hook race conditions
            // The closure and cleanup functions were causing the wrong state to be used
            aiManager.resolveRequiredOpponentAction(
                gameState,
                setGameState,
                difficulty,
                {
                    playCard: resolvers.playCard,
                    discardCards: resolvers.discardCards,
                    flipCard: resolvers.flipCard,
                    returnCard: resolvers.returnCard,
                    deleteCard: (s, c) => ({
                        newState: s,
                        animationRequests: [{ type: 'delete', cardId: c, owner: 'opponent'}]
                    }),
                    resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                    // REMOVED: resolveLove1Prompt - Love-1 now uses custom protocol
                    resolveHate1Discard: resolvers.resolveHate1Discard,
                    resolvePlague2OpponentDiscard: resolvers.resolvePlague2OpponentDiscard,
                    revealOpponentHand: resolvers.revealOpponentHand,
                    resolveRearrangeProtocols: (s, o) => resolvers.resolveRearrangeProtocols(s, o, onEndGame),
                    // REMOVED: resolveSpirit1Prompt - Spirit-1 now uses custom protocol
                    // REMOVED: resolvePsychic4Prompt - Psychic-4 now uses custom protocol
                },
                phaseManager,
                processAnimationQueue,
                resolvers.resolveActionWithCard,
                resolvers.resolveActionWithLane,
                trackPlayerRearrange
            );

            // CRITICAL FIX: Clear lock immediately instead of after 1 second
            // The 1-second delay was causing softlocks when the interrupt resolved and switched turns,
            // because useEffect #1 (opponent turn) would trigger but find the lock still set
            isProcessingAIRef.current = false;
        }
    }, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue, onEndGame]);

    useEffect(() => {
        setGameState(currentState => {
            // CRITICAL: Recalculate ALL lane values at the start of EVERY turn for BOTH players
            // This ensures passive value modifiers (like Clarity-0's +1 per card in hand) are always current
            let updatedState = stateManager.recalculateAllLaneValues(currentState);

            if (updatedState.turn === 'player' && updatedState.phase === 'start' && !updatedState.actionRequired) {
                return phaseManager.processStartOfTurn(updatedState);
            }
            return updatedState;
        });
    }, [gameState.turn, gameState.phase]);

    return {
        gameState, selectedCard, setSelectedCard, playSelectedCard, fillHand,
        discardCardFromHand, compileLane, resolveActionWithCard, resolveActionWithLane, resolveActionWithLaneFaceDown,
        selectHandCardForAction, skipAction, resolvePlague2Discard, resolveActionWithHandCard,
        resolvePlague4Flip, resolveOptionalDiscardCustomPrompt, resolveOptionalEffectPrompt, resolveFire4Discard, resolveHate1Discard, resolveRevealBoardCardPrompt,
        resolveRearrangeProtocols, resolveOptionalDrawPrompt, resolveSwapProtocols,
        resolveControlMechanicPrompt, resolveCustomChoice, resolveSelectRevealedDeckCard, resolveRevealDeckDrawProtocol,
        resolveStateNumber, resolveStateProtocol, resolveSelectFromDrawnToReveal,
        resolveConfirmDeckDiscard, resolveConfirmDeckPlayPreview,
        resolveSelectTrashCardToPlay, resolveSelectTrashCardToReveal,
        setupTestScenario,
        // REMOVED: resolveFire3Prompt, resolveDeath1Prompt, resolveLove1Prompt, resolvePsychic4Prompt, resolveSpirit1Prompt
    };
};
