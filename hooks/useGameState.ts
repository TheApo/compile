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
    createSequentialDrawAnimations,
    createSequentialDiscardAnimations,
    createShiftAnimation,
    createReturnAnimation,
    createRevealAnimation,
    findCardInLanes,
    createPhaseTransitionAnimation,
    enqueueAnimationsFromRequests,
} from '../logic/animation/animationHelpers';
import { createAndEnqueueShiftAnimation, createAndEnqueueLaneDeleteAnimations, processCompileAnimations } from '../logic/animation/aiAnimationCreators';
import { ANIMATION_DURATIONS } from '../constants/animationTiming';
import {
    playCardMessage,
    shiftCardMessage,
    shiftAllCardsMessage,
    deleteCardMessage,
    returnAllCardsMessage,
    drawCardsMessage,
    discardCardMessage,
    refreshHandMessage,
} from '../logic/utils/logMessages';
// NOTE: Hate-3 trigger is now handled via custom protocol reactive effects

// NOTE: processCompileAnimations moved to aiAnimationCreators.ts (DRY - central animation helpers)

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
    enqueueAnimations?: (items: Omit<AnimationQueueItem, 'id'>[]) => void,
    // NEW: Animation queue state for blocking AI until animations complete
    isAnimating?: boolean
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

    // Track previous hand state for detecting effect-triggered draws
    const prevPlayerHandRef = useRef<Set<string>>(new Set(gameState.player.hand.map(c => c.id)));
    const prevOpponentHandRef = useRef<Set<string>>(new Set(gameState.opponent.hand.map(c => c.id)));
    const prevPlayerHandLengthRef = useRef<number>(gameState.player.hand.length);
    const prevOpponentHandLengthRef = useRef<number>(gameState.opponent.hand.length);

    // Track previous turn and phase for phase transition animations
    const prevTurnRef = useRef<Player>(startingPlayer);
    const prevPhaseRef = useRef<GamePhase>(gameState.phase as GamePhase);

    // Synchronous ref for animation-blocking
    // Prevents race condition between Phase-Animation Effect and Hook 1
    // Set BEFORE async enqueue, checked by Hook 1, reset when isAnimating becomes false
    const isAnimationPendingRef = useRef<boolean>(false);



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
            if (nextRequest.type === 'flip') {
                // Flip animation was already created in handleFlipCard via enqueueAnimation
                // Just wait for the animation to complete, then process next/callback
                setTimeout(() => {
                    if (rest.length > 0) {
                        processNext(rest);
                    } else {
                        onComplete();
                    }
                }, ANIMATION_DURATIONS.flip);
            } else if (nextRequest.type === 'delete') {
                // Delete animation was already created BEFORE setGameState in resolveActionWithCard
                // Just wait for the animation to complete, then process next/callback
                setTimeout(() => {
                    if (rest.length > 0) {
                        processNext(rest);
                    } else {
                        onComplete();
                    }
                }, ANIMATION_DURATIONS.delete);
            } else if (nextRequest.type === 'return') {
                // Return animation was already created BEFORE setGameState in resolveActionWithLane
                // State was already changed in the resolver via internalReturnCard
                // Just wait for the animation to complete, then process next/callback
                setTimeout(() => {
                    if (rest.length > 0) {
                        processNext(rest);
                    } else {
                        onComplete();
                    }
                }, ANIMATION_DURATIONS.return);
            } else if (nextRequest.type === 'play') {
                // Create play animation for deck-to-lane plays
                if (enqueueAnimation && nextRequest.fromDeck && nextRequest.toLane !== undefined) {
                    setGameState(currentState => {
                        const owner = nextRequest.owner;
                        const toLane = nextRequest.toLane!;
                        const playedCard = currentState[owner].lanes[toLane]?.find(c => c.id === nextRequest.cardId);

                        if (playedCard) {
                            // CRITICAL FIX: For sequential play animations (like Life-0),
                            // we need to hide ALL cards that haven't been animated yet, not just this one.
                            // Find all play requests that are still pending (this + rest)
                            const allPendingPlayRequests = [nextRequest, ...rest.filter(r => r.type === 'play' && r.fromDeck)];
                            const pendingCardIds = new Set(allPendingPlayRequests.map(r => r.cardId));

                            // Create a snapshot without ALL pending cards
                            let snapshotState = currentState;
                            for (const player of ['player', 'opponent'] as const) {
                                snapshotState = {
                                    ...snapshotState,
                                    [player]: {
                                        ...snapshotState[player],
                                        lanes: snapshotState[player].lanes.map(lane =>
                                            lane.filter(c => !pendingCardIds.has(c.id))
                                        )
                                    }
                                };
                            }

                            const animation = createPlayAnimation(
                                snapshotState,  // Use state WITHOUT pending cards
                                playedCard,
                                owner,
                                toLane,
                                false,  // fromHand = false (from deck)
                                undefined,  // no handIndex
                                nextRequest.isFaceUp ?? false,
                                owner === 'opponent'  // isOpponentAction
                            );
                            enqueueAnimation(animation);
                        }

                        return { ...currentState, animationState: null };
                    });

                    // Wait for animation to complete
                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, ANIMATION_DURATIONS.play);
                    return; // Exit early - new system handled everything
                }

            } else if (nextRequest.type === 'draw') {
                // Create sequential draw animations
                if (enqueueAnimations) {
                    // Use drawnCardIds if provided (preferred - avoids state timing issues)
                    // Otherwise fall back to finding cards by count in current state
                    const drawnCardIds = (nextRequest as any).drawnCardIds as string[] | undefined;

                    setGameState(currentState => {
                        const player = nextRequest.player;
                        const count = nextRequest.count;
                        const hand = currentState[player].hand;

                        // Find the drawn cards either by ID or by position
                        let newCards: PlayedCard[];
                        let startIndex: number;

                        if (drawnCardIds && drawnCardIds.length > 0) {
                            // Use provided card IDs - more reliable
                            newCards = hand.filter(c => drawnCardIds.includes(c.id));
                            // Find the first drawn card's index as startIndex
                            const firstDrawnIndex = hand.findIndex(c => drawnCardIds.includes(c.id));
                            startIndex = firstDrawnIndex >= 0 ? firstDrawnIndex : hand.length - count;
                        } else {
                            // Fallback: assume last 'count' cards are newly drawn
                            newCards = hand.slice(-count);
                            startIndex = Math.max(0, hand.length - count);
                        }

                        if (newCards.length > 0) {
                            // Create snapshot BEFORE the draw for animation
                            // Remove the drawn cards from hand to reconstruct pre-draw state
                            const drawnIds = new Set(newCards.map(c => c.id));
                            const preDrawHand = hand.filter(c => !drawnIds.has(c.id));
                            const stateBeforeDraw = {
                                ...currentState,
                                [player]: {
                                    ...currentState[player],
                                    hand: preDrawHand,
                                },
                            };

                            const animations = createSequentialDrawAnimations(
                                stateBeforeDraw,
                                newCards,
                                player,
                                startIndex
                            );
                            // Add logMessage to first animation
                            if (animations.length > 0) {
                                const logMsg = drawCardsMessage(player, newCards.length);
                                animations[0] = { ...animations[0], logMessage: { message: logMsg, player } };
                            }
                            enqueueAnimations(animations);
                        }

                        // Clear animationState to prevent double-animation
                        return { ...currentState, animationState: null };
                    });

                    // Wait for animations to complete before processing next
                    const totalDuration = ANIMATION_DURATIONS.draw;
                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, totalDuration);
                    return; // Exit early - new system handled everything
                }

            } else if (nextRequest.type === 'shift') {
                // Handle shift animation for reactive effects that DON'T go through resolveActionWithLane
                // NOTE: For select_lane_for_shift, shift_flipped_card_optional, and playSelectedCard,
                // animations are created BEFORE setGameState. This handler is for other cases.
                if (enqueueAnimation && !(nextRequest as any)._animationAlreadyCreated) {
                    setGameState(currentState => {
                        // Card has already been shifted, so it's now in toLane
                        const card = currentState[nextRequest.owner].lanes[nextRequest.toLane]?.find(c => c.id === nextRequest.cardId);

                        if (card) {
                            const animation = createShiftAnimation(
                                currentState,
                                card,
                                nextRequest.owner,
                                nextRequest.fromLane,
                                0,  // Original index unknown, use 0
                                nextRequest.toLane
                            );
                            enqueueAnimation(animation);
                        }
                        return currentState;
                    });
                }

                // Shift animations wait for animation to complete, then continue
                setTimeout(() => {
                    setTimeout(() => {
                        if (rest.length > 0) {
                            processNext(rest);
                        } else {
                            onComplete();
                        }
                    }, 10);
                }, 1000); // 1s for animation
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

        // Use the animation queue system if available
        if (enqueueAnimation) {
            // Get the card and its position in hand BEFORE state update
            const card = gameState.player.hand.find(c => c.id === cardId);
            const handIndex = gameState.player.hand.findIndex(c => c.id === cardId);

            if (card) {
                const protocolName = targetOwner === 'player'
                    ? gameState.player.protocols[laneIndex]
                    : gameState.opponent.protocols[laneIndex];
                const logMsg = playCardMessage('player', card, protocolName, isFaceUp, targetOwner);

                const animation = createPlayAnimation(
                    gameState,
                    card,
                    'player',
                    laneIndex,
                    true, // fromHand
                    handIndex,
                    isFaceUp
                );
                enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: 'player' } });
            }

            // Update state immediately to final state (no setTimeout, no animationState)
            setGameState(prev => {
                const turnProgressionCb = getTurnProgressionCallback(prev.phase);
                const { newState, animationRequests } = resolvers.playCard(prev, cardId, laneIndex, isFaceUp, 'player', targetOwner);

                // Handle animationRequests from effects
                if (animationRequests && animationRequests.length > 0) {
                    // Create animations for new system
                    // CRITICAL: Use 'prev' state for shift/delete - card is still at original position
                    // Use 'newState' for play - card is now at destination
                    for (const request of animationRequests) {
                        if (request.type === 'shift') {
                            const shiftCard = prev[request.owner].lanes[request.fromLane]?.find(c => c.id === request.cardId);
                            const fromCardIndex = prev[request.owner].lanes[request.fromLane]?.findIndex(c => c.id === request.cardId) ?? -1;
                            if (shiftCard && fromCardIndex >= 0) {
                                const animation = createShiftAnimation(
                                    prev,
                                    shiftCard,
                                    request.owner,
                                    request.fromLane,
                                    fromCardIndex,
                                    request.toLane
                                );
                                enqueueAnimation(animation);
                                // Mark as already created so processAnimationQueue doesn't create duplicate
                                (request as any)._animationAlreadyCreated = true;
                            }
                        } else if (request.type === 'flip') {
                            // Flip animations handled elsewhere
                        } else if (request.type === 'delete') {
                            // For on_cover deletes: Use the snapshot state that includes the new card
                            // This ensures the delete animation shows the covering card already in place
                            const stateForSnapshot = (request as any)._snapshotState || prev;

                            const deleteCard = stateForSnapshot[request.owner].lanes.flat().find(c => c.id === request.cardId);
                            const cardPosition = findCardInLanes(stateForSnapshot, request.cardId, request.owner);
                            if (deleteCard && cardPosition) {
                                const animation = createDeleteAnimation(
                                    stateForSnapshot,
                                    deleteCard,
                                    request.owner,
                                    cardPosition.laneIndex,
                                    cardPosition.cardIndex
                                );
                                enqueueAnimation(animation);
                            }
                        }
                        // Play-from-deck animations are handled below with proper sequencing
                    }

                    // Handle play-from-deck animations with proper sequencing:
                    // For sequential animations, each snapshot should NOT show cards that haven't been animated yet
                    const playFromDeckRequests = animationRequests.filter(
                        r => r.type === 'play' && (r as any).fromDeck && (r as any).toLane !== undefined
                    );

                    if (playFromDeckRequests.length > 0) {
                        // Collect all card IDs that will be animated
                        const allNewCardIds = playFromDeckRequests.map(r => (r as any).cardId);

                        playFromDeckRequests.forEach((request, animIndex) => {
                            const req = request as any;
                            const playCard = newState[req.owner].lanes[req.toLane]?.find(c => c.id === req.cardId);
                            if (playCard) {
                                // For this animation's snapshot:
                                // - Cards that were animated BEFORE this one should be visible (already "landed")
                                // - This card and cards AFTER should be hidden (not yet animated)
                                const cardsToHide = allNewCardIds.slice(animIndex); // This card + all after it

                                // Create snapshot with the correct cards hidden
                                let snapshotState = { ...newState };
                                for (const hideCardId of cardsToHide) {
                                    // Find which lane this card is in
                                    for (const owner of ['player', 'opponent'] as const) {
                                        for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                                            if (snapshotState[owner].lanes[laneIdx].some(c => c.id === hideCardId)) {
                                                snapshotState = {
                                                    ...snapshotState,
                                                    [owner]: {
                                                        ...snapshotState[owner],
                                                        lanes: snapshotState[owner].lanes.map((lane, idx) =>
                                                            idx === laneIdx ? lane.filter(c => c.id !== hideCardId) : lane
                                                        )
                                                    }
                                                };
                                            }
                                        }
                                    }
                                }

                                const animation = createPlayAnimation(
                                    snapshotState,  // Snapshot with correct cards hidden
                                    playCard,
                                    req.owner,
                                    req.toLane,
                                    false,  // fromHand = false (from deck)
                                    undefined,  // no handIndex
                                    req.isFaceUp ?? false,  // isFaceUp
                                    req.owner === 'opponent'  // isOpponentAction
                                );
                                enqueueAnimation(animation);
                            }
                        });
                        // NOTE: 'draw' requests are handled via animationState.type === 'drawCard'
                        // in the useEffect hook. Don't create duplicate animations here.
                    }

                    // CRITICAL: Must use processAnimationQueue for proper game state timing!
                    // The callback ensures turnProgressionCb is called AFTER animations complete
                    const stateToProcess = { ...newState, animationState: null };

                    // Filter out play-from-deck requests since we already created animations for them above
                    const filteredForQueue = animationRequests.filter(r =>
                        !(r.type === 'play' && (r as any).fromDeck)
                    );

                    if (filteredForQueue.length > 0) {
                        processAnimationQueue(filteredForQueue, () => {
                            setGameState(s_after_anim => turnProgressionCb(s_after_anim));
                        });
                    } else {
                        // All animations were handled, just wait for them to complete
                        setTimeout(() => {
                            setGameState(s_after_anim => turnProgressionCb(s_after_anim));
                        }, 1000);
                    }
                    return stateToProcess;
                }

                if (newState.actionRequired) {
                    return newState;
                }

                return turnProgressionCb(newState);
            });
        }
    };

    const fillHand = () => {
        if (gameState.turn !== 'player' || gameState.phase !== 'action' || gameState.actionRequired) return;
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const prevHandIds = new Set(prev.player.hand.map(c => c.id));
            let newState = resolvers.fillHand(prev, 'player');

            // Create SEQUENTIAL draw animations
            // Each card gets its own animation with proper snapshot showing cards that already landed
            if (enqueueAnimations) {
                const newCards = newState.player.hand.filter(c => !prevHandIds.has(c.id));
                if (newCards.length > 0) {
                    // Create sequential animations - each shows previously landed cards
                    const animations = createSequentialDrawAnimations(
                        prev,  // Use prev state for initial snapshot (before cards were added)
                        newCards,
                        'player',
                        prev.player.hand.length  // Starting index in hand
                    );
                    // Add logMessage to first animation (refresh hand)
                    if (animations.length > 0) {
                        const logMsg = refreshHandMessage('player', newCards.length);
                        animations[0] = { ...animations[0], logMessage: { message: logMsg, player: 'player' } };
                    }
                    enqueueAnimations(animations);

                    // CRITICAL: Clear animationState to prevent double-animation from useEffect
                    // (drawForPlayer sets animationState, but we already created the animation here)
                    newState = { ...newState, animationState: null };

                    // Update refs so the useEffect doesn't try to create animation
                    prevPlayerHandRef.current = new Set(newState.player.hand.map(c => c.id));
                    prevPlayerHandLengthRef.current = newState.player.hand.length;
                }
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

            // Set animationState - the useEffect will handle creating the animation
            // (Works for both new and old animation systems)
            return {
                ...prev,
                animationState: { type: 'discardCard', owner: 'player', cardIds: [cardId], originalAction: prev.actionRequired }
            };
        });
    }, []);

    const compileLane = useCallback((laneIndex: number) => {
        setGameState(prev => {
            if (prev.winner || prev.phase !== 'compile') return prev;

            const turnProgressionCb = getTurnProgressionCallback(prev.phase);

            // CRITICAL FIX: Check for Control-Mechanic FIRST (before any animation)
            // If player has Control, show prompt immediately without animation
            const hasControl = prev.useControlMechanic && prev.controlCardHolder === prev.turn;

            if (hasControl) {
                // Call performCompile which will return the control mechanic prompt
                const stateWithPrompt = resolvers.performCompile(prev, laneIndex, onEndGame);
                // No animation yet - will be handled after control mechanic is resolved
                return { ...stateWithPrompt, compilableLanes: [] };
            }

            // No Control-Mechanic: proceed with animation flow
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

                    // DRY: Process compile animations (handles _compileAnimations and cleanup)
                    const stateWithoutMarker = processCompileAnimations(stateAfterCompile, currentState, laneIndex, 'player', enqueueAnimation);

                    const finalState = turnProgressionCb(stateWithoutMarker);
                    return { ...finalState, animationState: null };
                });
            }, 1000);

            return stateWithAnimation;
        });
    }, [onEndGame, getTurnProgressionCallback]);

    const resolveActionWithCard = (targetCardId: string) => {
        // Create return animation BEFORE setGameState
        // This ensures the animation is enqueued synchronously before React updates
        const actionType = gameState.actionRequired?.type;
        if (enqueueAnimation &&
            (actionType === 'select_card_to_return' || actionType === 'select_opponent_card_to_return')) {
            // CRITICAL FIX: Only create animation if the card is actually allowed to be returned
            // Check allowedIds from actionRequired (set by the effect executor based on filters like valueEquals)
            const allowedIds = (gameState.actionRequired as any)?.allowedIds;
            const isCardAllowed = !allowedIds || allowedIds.includes(targetCardId);

            if (isCardAllowed) {
                // Search both sides for the card (the card could be on either player's board)
                for (const owner of ['player', 'opponent'] as Player[]) {
                    let found = false;
                    for (const [laneIdx, lane] of gameState[owner].lanes.entries()) {
                        const cardIndex = lane.findIndex(c => c.id === targetCardId);
                        if (cardIndex >= 0) {
                            const card = lane[cardIndex];
                            const animation = createReturnAnimation(
                                gameState,
                                card,
                                owner,
                                laneIdx,
                                cardIndex,
                                true  // setFaceDown
                            );
                            enqueueAnimation(animation);
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }
        }

        // NEW: Create delete animation BEFORE setGameState (card is still in gameState)
        const isDeleteAction = actionType === 'select_cards_to_delete' ||
                               actionType === 'select_face_down_card_to_delete' ||
                               actionType === 'select_low_value_card_to_delete' ||
                               actionType === 'select_card_from_other_lanes_to_delete';

        if (enqueueAnimation && isDeleteAction) {
            // Find the card to delete in current gameState (before it's removed)
            for (const owner of ['player', 'opponent'] as Player[]) {
                let found = false;
                for (const [laneIdx, lane] of gameState[owner].lanes.entries()) {
                    const cardIndex = lane.findIndex(c => c.id === targetCardId);
                    if (cardIndex >= 0) {
                        const card = lane[cardIndex];
                        const logMsg = deleteCardMessage(card);

                        const animation = createDeleteAnimation(
                            gameState,
                            card,
                            owner,
                            laneIdx,
                            cardIndex
                        );
                        enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: owner } });
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }

        setGameState(prev => {
            const originalTurn = prev.turn;
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation, requiresTurnEnd } = resolvers.resolveActionWithCard(prev, targetCardId, enqueueAnimation);

            if (requiresAnimation) {
                processAnimationQueue(requiresAnimation.animationRequests, () => {
                    setGameState(s => {
                        // FIX: If turn changed during animation (due to interrupt restoration),
                        // turnProgressionCb was already called. Pass a no-op to prevent double progression.
                        const endTurnCb = s.turn !== originalTurn
                            ? (state: GameState) => state
                            : turnProgressionCb;

                        const result = requiresAnimation.onCompleteCallback(s, endTurnCb);

                        return result;
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
        // CRITICAL FIX: Create shift animation BEFORE setGameState using DRY helper
        // This ensures the animation captures the "from" state correctly
        const actionType = gameState.actionRequired?.type;
        const isMultiShiftAction = actionType === 'select_lane_for_shift_all';

        // DRY: Use centralized helper for single-card shifts (handles all shift action types)
        if (enqueueAnimation && gameState.actionRequired) {
            // isOpponentAction = false because this is player's action in useGameState
            createAndEnqueueShiftAnimation(
                gameState,
                gameState.actionRequired,
                targetLaneIndex,
                enqueueAnimation,
                false // Player action, not opponent
            );
        }

        // Handle multi-card shift (select_lane_for_shift_all)
        if (enqueueAnimations && isMultiShiftAction) {
            const req = gameState.actionRequired as any;
            const sourceLaneIndex = req.sourceLaneIndex;
            const cardsToShift = req.cardsToShift as { cardId: string; owner: Player }[] | undefined;

            if (cardsToShift && sourceLaneIndex !== targetLaneIndex) {
                const animations: Omit<AnimationQueueItem, 'id'>[] = [];
                let isFirstCard = true;
                for (const { cardId, owner } of cardsToShift) {
                    const cardIndex = gameState[owner].lanes[sourceLaneIndex]?.findIndex(c => c.id === cardId) ?? -1;
                    const card = gameState[owner].lanes[sourceLaneIndex]?.[cardIndex];
                    if (card && cardIndex >= 0) {
                        const animation = createShiftAnimation(
                            gameState,
                            card,
                            owner,
                            sourceLaneIndex,
                            cardIndex,
                            targetLaneIndex
                        );
                        // Add logMessage only to first card (represents the shift-all action)
                        if (isFirstCard) {
                            const fromProtocol = gameState[owner].protocols[sourceLaneIndex];
                            const toProtocol = gameState[owner].protocols[targetLaneIndex];
                            const logMsg = shiftAllCardsMessage(fromProtocol, toProtocol);
                            animations.push({ ...animation, logMessage: { message: logMsg, player: owner } });
                            isFirstCard = false;
                        } else {
                            animations.push(animation);
                        }
                    }
                }
                if (animations.length > 0) {
                    enqueueAnimations(animations);
                }
            }
        }

        // NEW ANIMATION SYSTEM: Create play animation BEFORE setGameState (like shift)
        // This ensures the animation captures the "from" state correctly
        // Check if cardInHandId is set (indicates play from hand, not from deck)
        const isPlayFromHandAction = actionType === 'select_lane_for_play' &&
                                     (gameState.actionRequired as any)?.cardInHandId;

        if (enqueueAnimation && isPlayFromHandAction) {
            const req = gameState.actionRequired as any;
            const cardInHandId = req.cardInHandId;
            const actor = req.actor || 'player';

            // Find the card in hand and its index
            const handIndex = gameState[actor].hand.findIndex(c => c.id === cardInHandId);
            const cardToPlay = gameState[actor].hand[handIndex];

            if (cardToPlay && handIndex >= 0) {
                // Determine if the card will be played face-up
                const isFaceDown = req.isFaceDown;
                let canPlayFaceUp: boolean;
                if (typeof isFaceDown === 'boolean') {
                    canPlayFaceUp = !isFaceDown;
                } else {
                    // Use same logic as laneResolver for protocol matching
                    const opponentId = actor === 'player' ? 'opponent' : 'player';
                    canPlayFaceUp = cardToPlay.protocol === gameState[actor].protocols[targetLaneIndex] ||
                                   cardToPlay.protocol === gameState[opponentId].protocols[targetLaneIndex];
                }

                const protocolName = gameState[actor].protocols[targetLaneIndex];
                const logMsg = playCardMessage(actor, cardToPlay, protocolName, canPlayFaceUp);

                const animation = createPlayAnimation(
                    gameState,  // Use current gameState (before update)
                    cardToPlay,
                    actor,
                    targetLaneIndex,
                    true,  // fromHand
                    handIndex,
                    canPlayFaceUp,
                    actor === 'opponent'
                );
                enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: actor } });
            }
        }

        // Create return animations for matching cards in lane (respecting targetFilter)
        if (enqueueAnimations && gameState.actionRequired?.type === 'select_lane_for_return') {
            const req = gameState.actionRequired as any;
            const actor = req.cardOwner || req.actor || 'player';
            const targetFilter = req.targetFilter || {};
            const protocolName = gameState.player.protocols[targetLaneIndex];

            // Collect matching cards from BOTH players' lanes (like laneResolver does)
            const matchingCards: { card: PlayedCard; owner: Player; cardIndex: number }[] = [];

            for (const owner of ['player', 'opponent'] as Player[]) {
                const lane = gameState[owner].lanes[targetLaneIndex];
                const faceDownValueInLane = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2) ? 4 : 2;

                lane.forEach((card, cardIndex) => {
                    const value = card.isFaceUp ? card.value : faceDownValueInLane;

                    // Apply the same filters as laneResolver.ts
                    if (targetFilter.valueEquals !== undefined && value !== targetFilter.valueEquals) return;
                    if (targetFilter.faceState === 'face_up' && !card.isFaceUp) return;
                    if (targetFilter.faceState === 'face_down' && card.isFaceUp) return;
                    if (targetFilter.owner === 'own' && owner !== actor) return;
                    if (targetFilter.owner === 'opponent' && owner === actor) return;

                    matchingCards.push({ card, owner, cardIndex });
                });
            }

            // Create return animations only for matching cards
            // CRITICAL: Each animation must exclude previously animated cards from its snapshot
            const animations: Omit<AnimationQueueItem, 'id'>[] = [];
            const hiddenCardIds = new Set<string>();

            matchingCards.forEach(({ card, owner, cardIndex }, idx) => {
                const animation = createReturnAnimation(
                    gameState,
                    card,
                    owner,
                    targetLaneIndex,
                    cardIndex,
                    true,  // setFaceDown
                    false, // isOpponentAction
                    hiddenCardIds  // Pass hidden cards for sequential animation
                );

                // Add this card to hidden set for the NEXT animation
                hiddenCardIds.add(card.id);

                // Add logMessage to first card only
                if (idx === 0) {
                    const logMsg = returnAllCardsMessage(owner, protocolName);
                    animations.push({ ...animation, logMessage: { message: logMsg, player: owner } });
                } else {
                    animations.push(animation);
                }
            });

            if (animations.length > 0) {
                enqueueAnimations(animations);
            }
        }

        // Create delete animations for select_lane_for_delete (Death-2, etc.)
        // DRY: Use centralized helper from aiAnimationCreators.ts
        if (enqueueAnimations && gameState.actionRequired) {
            createAndEnqueueLaneDeleteAnimations(
                gameState,
                gameState.actionRequired,
                targetLaneIndex,
                enqueueAnimations,
                false // isOpponentAction = false (player action)
            );
        }

        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(prev, targetLaneIndex);

            if (requiresAnimation) {
                // FIX: For shift/play/return/delete actions, the animation was already created BEFORE setGameState
                // Filter out those requests to prevent double animation
                const actionType = prev.actionRequired?.type || '';
                // Check if action type contains 'shift' (covers all shift variants)
                const isShiftAction = actionType.toLowerCase().includes('shift');
                const isPlayFromHandAction = actionType === 'select_lane_for_play' &&
                                             (prev.actionRequired as any)?.cardInHandId;
                const isReturnAction = actionType === 'select_lane_for_return';
                const isDeleteAction = actionType === 'select_lane_for_delete';

                let filteredRequests = requiresAnimation.animationRequests;
                if (isShiftAction) {
                    filteredRequests = filteredRequests.filter(r => r.type !== 'shift');
                }
                if (isPlayFromHandAction) {
                    filteredRequests = filteredRequests.filter(r => r.type !== 'play');
                }
                if (isReturnAction) {
                    filteredRequests = filteredRequests.filter(r => r.type !== 'return');
                }
                if (isDeleteAction) {
                    filteredRequests = filteredRequests.filter(r => r.type !== 'delete');
                }

                // Only call processAnimationQueue if there are remaining requests
                if (filteredRequests.length > 0) {
                    processAnimationQueue(filteredRequests, () => {
                        setGameState(s => requiresAnimation.onCompleteCallback(s, turnProgressionCb));
                    });
                } else {
                    // No animation requests left, just call the callback
                    setTimeout(() => {
                        setGameState(s => requiresAnimation.onCompleteCallback(s, turnProgressionCb));
                    }, 1000);
                }
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
        // Create reveal animation BEFORE setGameState
        const actionType = gameState.actionRequired?.type;
        if (enqueueAnimation &&
            actionType === 'select_card_from_hand_to_reveal') {
            const card = gameState.player.hand.find(c => c.id === cardId);
            const handIndex = gameState.player.hand.findIndex(c => c.id === cardId);

            if (card && handIndex >= 0) {
                const animation = createRevealAnimation(
                    gameState,
                    card,
                    'player',
                    'hand',
                    handIndex
                );
                enqueueAnimation(animation);
            }
        }

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

                            // DRY: Process compile animations (same helper as compileLane)
                            const stateWithoutMarker = processCompileAnimations(nextState, currentState, originalAction.laneIndex, 'player', enqueueAnimation);

                            const turnProgressionCb = getTurnProgressionCallback(stateWithoutMarker.phase);
                            const finalState = turnProgressionCb(stateWithoutMarker);
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
    // REMOVED: resolvePlague2Discard - Plague-2 now uses generic 'discard' with variableCount + followUpEffect
    // REMOVED: resolvePlague4Flip - Plague-4 now uses custom protocol with flip + flipSelf + optional
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
    // REMOVED: resolveHate1Discard - Hate-1 now uses generic 'discard' with followUpEffect for delete

    /**
     * Resolve variable count or batch discard (used by custom protocols)
     * Handles discards where count > 1 or variableCount is true
     */
    const resolveVariableDiscard = useCallback((cardIds: string[]) => {
        setGameState(prev => {
            const isVariableCount = prev.actionRequired?.type === 'discard' && (prev.actionRequired as any)?.variableCount;
            const isBatchDiscard = prev.actionRequired?.type === 'discard' && prev.actionRequired.count > 1;

            if (!isVariableCount && !isBatchDiscard) return prev;

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

            // Save originalAction to check if this was a compile action (for animations)
            const originalAction = (prev.actionRequired as any)?.originalAction;

            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveRearrangeProtocols(prev, newOrder, onEndGame);

            if (nextState.winner) {
                return nextState;
            }

            // Handle compile animations if this rearrange was followed by a compile
            // (originalAction.type === 'compile' means Control-Mechanic before compile)
            if (originalAction?.type === 'compile' && (nextState as any)._compileAnimations) {
                const laneIndex = originalAction.laneIndex;
                const stateWithoutMarker = processCompileAnimations(nextState, prev, laneIndex, 'player', enqueueAnimation);
                return turnProgressionCb(stateWithoutMarker);
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

    // Update previous hand refs when hand changes
    // CRITICAL: Don't update refs when animationState.type === 'drawCard' because
    // the draw animation effect needs the OLD refs to determine which cards are new.
    // The draw animation effect will update refs after creating animations.
    useEffect(() => {
        if (gameState.animationState?.type === 'drawCard') {
            return; // Skip ref update - draw animation effect will handle it
        }
        prevPlayerHandRef.current = new Set(gameState.player.hand.map(c => c.id));
        prevOpponentHandRef.current = new Set(gameState.opponent.hand.map(c => c.id));
        prevPlayerHandLengthRef.current = gameState.player.hand.length;
        prevOpponentHandLengthRef.current = gameState.opponent.hand.length;
    }, [gameState.player.hand, gameState.opponent.hand, gameState.animationState]);

    useEffect(() => {
        const animState = gameState.animationState;
        if (animState?.type === 'discardCard' && animState.owner === 'player') {
            // Create sequential discard animations
            if (enqueueAnimations) {
                const { cardIds, originalAction } = animState;
                if (!originalAction) return;

                // Get actual card objects from hand
                const cardsToDiscard = cardIds
                    .map(id => gameState.player.hand.find(c => c.id === id))
                    .filter((c): c is PlayedCard => c !== undefined);

                if (cardsToDiscard.length > 0) {
                    // Create sequential animations using current state (before discard)
                    const animations = createSequentialDiscardAnimations(
                        gameState,
                        cardsToDiscard,
                        'player'
                    );
                    // Add logMessage to first animation
                    if (animations.length > 0 && cardsToDiscard[0]) {
                        const logMsg = discardCardMessage('player', cardsToDiscard[0]);
                        animations[0] = { ...animations[0], logMessage: { message: logMsg, player: 'player' } };
                    }

                    // Apply the discard immediately
                    setGameState(s => {
                        const currentAnim = s.animationState;
                        if (currentAnim?.type !== 'discardCard' || !currentAnim.originalAction) return s;

                        const turnProgressionCb = getTurnProgressionCallback(s.phase);

                        let stateAfterDiscard;
                        if (originalAction.type === 'discard' && (originalAction.count > 1 || (originalAction as any).variableCount)) {
                            // Variable count or batch discard - use resolveVariableDiscard for proper followUpEffect handling
                            stateAfterDiscard = resolvers.resolveVariableDiscard(s, cardIds);
                        } else {
                            stateAfterDiscard = resolvers.discardCards(s, cardIds, 'player');
                        }

                        // CRITICAL FIX: Only clear discard animation, preserve draw animation from followUpEffect!
                        // If animationState is 'drawCard' (from "then draw" effect), keep it so the draw animation plays.
                        if (stateAfterDiscard.animationState?.type === 'discardCard') {
                            stateAfterDiscard.animationState = null;
                        }

                        if (stateAfterDiscard.actionRequired) {
                            return stateAfterDiscard;
                        }

                        return turnProgressionCb(stateAfterDiscard);
                    });

                    // Enqueue animations after state update
                    enqueueAnimations(animations);
                }
                return;
            }

        }
    }, [gameState.animationState, getTurnProgressionCallback, enqueueAnimations, gameState]);

    // NOTE: discard_completed is now handled directly in discardResolver - no hook needed here

    // NEW: useEffect to convert animationState.type === 'drawCard' to queue animations
    // This handles draws from: Control mechanic (fill_hand after skip/rearrange), effect draws, etc.
    useEffect(() => {
        const animState = gameState.animationState;
        if (animState?.type !== 'drawCard') return;
        if (!enqueueAnimations) return;

        const { owner } = animState;
        let { cardIds } = animState;

        // CRITICAL FIX: If cardIds is empty, calculate from hand comparison
        // This handles cases like "Discard 1+, then draw 1 more" where discardResolver
        // sets cardIds: [] and expects us to determine new cards from prevHand vs currentHand
        const prevHandIds = owner === 'player' ? prevPlayerHandRef.current : prevOpponentHandRef.current;
        if (!cardIds || cardIds.length === 0) {
            // Find new cards in hand that weren't there before
            const newCardIds = gameState[owner].hand
                .filter(c => !prevHandIds.has(c.id))
                .map(c => c.id);
            if (newCardIds.length === 0) {
                // No new cards - just clear animationState
                setGameState(s => {
                    if (s.animationState?.type !== 'drawCard') return s;
                    return { ...s, animationState: null };
                });
                return;
            }
            cardIds = newCardIds;
        }

        // CRITICAL: Check if animations were already created for these cards.
        // Other code paths (like fillHand at line 711) may have already created animations
        // and updated the refs. If all cardIds are already in the refs, skip animation creation.
        const allCardsAlreadyTracked = cardIds.every(id => prevHandIds.has(id));
        if (allCardsAlreadyTracked) {
            // Animations already created elsewhere - just clear animationState
            setGameState(s => {
                if (s.animationState?.type !== 'drawCard') return s;
                return { ...s, animationState: null };
            });
            return;
        }

        // Get the drawn cards from hand
        const drawnCards = gameState[owner].hand.filter(c => cardIds.includes(c.id));
        if (drawnCards.length === 0) return;

        // Create pre-draw state for snapshot
        const drawnIdSet = new Set(cardIds);
        const preDrawHand = gameState[owner].hand.filter(c => !drawnIdSet.has(c.id));
        const stateBeforeDraw = {
            ...gameState,
            [owner]: {
                ...gameState[owner],
                hand: preDrawHand,
            }
        };

        // Find starting index
        const firstDrawnIndex = gameState[owner].hand.findIndex(c => cardIds.includes(c.id));
        const startIndex = firstDrawnIndex >= 0 ? firstDrawnIndex : preDrawHand.length;

        // Create and enqueue animations
        const animations = createSequentialDrawAnimations(
            stateBeforeDraw,
            drawnCards,
            owner,
            startIndex
        );
        // Add logMessage to first animation
        if (animations.length > 0) {
            const logMsg = drawCardsMessage(owner, drawnCards.length);
            animations[0] = { ...animations[0], logMessage: { message: logMsg, player: owner } };
        }
        enqueueAnimations(animations);

        // Clear animationState to prevent double-animation
        setGameState(s => {
            if (s.animationState?.type !== 'drawCard') return s;
            return { ...s, animationState: null };
        });

        // Update refs to prevent old useEffect interference
        if (owner === 'player') {
            prevPlayerHandRef.current = new Set(gameState.player.hand.map(c => c.id));
            prevPlayerHandLengthRef.current = gameState.player.hand.length;
        } else {
            prevOpponentHandRef.current = new Set(gameState.opponent.hand.map(c => c.id));
            prevOpponentHandLengthRef.current = gameState.opponent.hand.length;
        }
    }, [gameState.animationState, enqueueAnimations]);

    // NEW: Process _pendingAnimationRequests for player actions
    // This handles draw animations from optional draws (Death-1), reactive effects, etc.
    // AI actions process this in aiManager.ts, but player actions need it here
    useEffect(() => {
        const pending = (gameState as any)._pendingAnimationRequests as AnimationRequest[] | undefined;
        if (!pending || pending.length === 0) return;
        if (!enqueueAnimation) return;

        // Create animations from pending requests using current state
        enqueueAnimationsFromRequests(gameState, pending, enqueueAnimation);

        // Clear pending from state
        setGameState(s => {
            if (!(s as any)._pendingAnimationRequests) return s;
            const newState = { ...s };
            delete (newState as any)._pendingAnimationRequests;
            return newState;
        });
    }, [(gameState as any)._pendingAnimationRequests, enqueueAnimation]);

    // Phase Transition Animation: Enqueue animation when turn OR phase changes
    // NOTE: This animation is purely visual - the AI waits via !isAnimating check in Hook 1
    // CRITICAL: We set isAnimationPendingRef SYNCHRONOUSLY to block Hook 1 immediately
    useEffect(() => {
        const currentPhase = gameState.phase as GamePhase;
        const turnChanged = prevTurnRef.current !== gameState.turn;

        // Only animate on TURN changes (not every phase change)
        // Phase changes during opponent turn are handled internally - no separate animation needed
        if (turnChanged && enqueueAnimation && !gameState.winner) {
            // SYNCHRONOUSLY set ref BEFORE async enqueue - this blocks Hook 1 immediately
            isAnimationPendingRef.current = true;

            const fromTurn = prevTurnRef.current;
            const toTurn = gameState.turn;
            const fromPhase = prevPhaseRef.current;

            // For opponent turn: animate all the way to 'action' (where they'll play)
            // For player turn: animate to 'start' (they control from there)
            const targetPhase = toTurn === 'opponent' ? 'action' : 'start';

            // Create and enqueue phase transition animation
            // IMPORTANT: Use CURRENT gameState for snapshot!
            const phaseAnimation = createPhaseTransitionAnimation(
                gameState,  // Current state - board is correct!
                fromPhase,
                fromTurn,
                toTurn,
                targetPhase  // Full sequence for opponent, start for player
            );

            // Only enqueue if there are phases to animate
            if (phaseAnimation.phaseTransitionData?.phaseSequence?.length > 0) {
                enqueueAnimation(phaseAnimation);
            } else {
                // No animation needed - immediately release the ref
                isAnimationPendingRef.current = false;
            }
        }
        // Update refs for next change detection
        prevTurnRef.current = gameState.turn;
        prevPhaseRef.current = currentPhase;
    }, [gameState.turn, gameState.phase, gameState.winner, enqueueAnimation]);

    // Reset isAnimationPendingRef when all animations complete
    // This allows Hook 1 to proceed after phase transition animation finishes
    useEffect(() => {
        if (!isAnimating) {
            isAnimationPendingRef.current = false;
        }
    }, [isAnimating]);

    // Hook 1: AI Turn Processing (Normal opponent turns)
    // NEW: Uses synchronous AI system - no setTimeout, no callbacks
    useEffect(() => {
        // CRITICAL FIX: Don't trigger if an interrupt is active (_interruptedTurn is set)
        // Interrupts are handled by Hook 2, not Hook 1
        // CRITICAL FIX #2: Don't trigger if there's an actionRequired for the PLAYER
        // (e.g., "Your opponent discards 1 card" - player needs to act, not AI)
        const hasPlayerAction = gameState.actionRequired &&
            'actor' in gameState.actionRequired &&
            gameState.actionRequired.actor === 'player';

        // CRITICAL FIX #3: Also block if ANY actionRequired exists that's not for opponent
        // This handles cases like Spirit-3's after_draw during refresh, where the turn might
        // have already switched to opponent but player still needs to respond to a prompt
        const hasAnyBlockingAction = gameState.actionRequired &&
            (!('actor' in gameState.actionRequired) || gameState.actionRequired.actor !== 'opponent');

        if (gameState.turn === 'opponent' &&
            !gameState.winner &&
            !gameState.animationState &&
            !isAnimating &&  // Wait for all animations (incl. phase transition) to complete
            !isAnimationPendingRef.current &&  // Synchronous check - blocks until phase animation is enqueued
            !gameState._interruptedTurn &&  // Don't trigger during interrupts
            !hasPlayerAction &&  // Don't trigger if player needs to act
            !hasAnyBlockingAction &&  // Don't trigger if there's ANY action not for opponent
            !isProcessingAIRef.current) {

            isProcessingAIRef.current = true;
            const currentScenarioVersion = scenarioVersionRef.current;

            // Execute immediately - delay animation is handled inside runOpponentTurnSync
            // Using queueMicrotask to avoid React state update issues
            queueMicrotask(() => {
                // Check if scenario has changed - if so, abort this callback
                if (scenarioVersionRef.current !== currentScenarioVersion) {
                    isProcessingAIRef.current = false;
                    return;
                }

                // NEW: Use synchronous AI turn processing
                // The entire AI turn runs synchronously - all animations are enqueued
                // The delay animation is created at the start of runOpponentTurnSync
                const finalState = aiManager.runOpponentTurnSync(
                    gameState,
                    difficulty,
                    {
                        compileLane: (s, l) => resolvers.performCompile(s, l, onEndGame),
                        playCard: resolvers.playCard,
                        fillHand: resolvers.performFillHand,
                        discardCards: resolvers.discardCards,
                        flipCard: resolvers.flipCard,
                        deleteCard: (s, c) => ({
                            newState: s,
                            animationRequests: [{ type: 'delete', cardId: c, owner: 'opponent' as Player }]
                        }),
                        returnCard: resolvers.returnCard,
                        skipAction: resolvers.skipAction,
                        resolveOptionalDrawPrompt: resolvers.resolveOptionalDrawPrompt,
                        resolveOptionalDiscardCustomPrompt: resolvers.resolveOptionalDiscardCustomPrompt,
                        resolveOptionalEffectPrompt: resolvers.resolveOptionalEffectPrompt,
                        resolveVariableDiscard: resolvers.resolveVariableDiscard,
                        resolveRearrangeProtocols: (s, o) => resolvers.resolveRearrangeProtocols(s, o, onEndGame),
                        resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                        resolveSwapProtocols: (s, o) => resolvers.resolveSwapProtocols(s, o, onEndGame),
                        revealOpponentHand: resolvers.revealOpponentHand,
                        resolveCustomChoice: resolvers.resolveCustomChoice,
                    },
                    phaseManager,
                    enqueueAnimation,
                    (s, l) => resolvers.performCompile(s, l, onEndGame)
                );

                // Set the final state directly
                setGameState(finalState);
                isProcessingAIRef.current = false;
            });
        }
    }, [gameState.turn, gameState.phase, gameState.winner, gameState.animationState, isAnimating, gameState._interruptedTurn, difficulty, onEndGame, enqueueAnimation, gameState.actionRequired]);

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
                        animationRequests: [{ type: 'delete', cardId: c, owner: 'opponent' as Player }]
                    }),
                    resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                    revealOpponentHand: resolvers.revealOpponentHand,
                    resolveRearrangeProtocols: (s, o) => resolvers.resolveRearrangeProtocols(s, o, onEndGame),
                },
                phaseManager,
                processAnimationQueue,
                resolvers.resolveActionWithCard,
                resolvers.resolveActionWithLane,
                trackPlayerRearrange,
                enqueueAnimation
            );

            // CRITICAL FIX: Clear lock immediately instead of after 1 second
            // The 1-second delay was causing softlocks when the interrupt resolved and switched turns,
            // because useEffect #1 (opponent turn) would trigger but find the lock still set
            isProcessingAIRef.current = false;
        }
    }, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue, onEndGame]);

    useEffect(() => {
        setGameState(currentState => {
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
        selectHandCardForAction, skipAction, resolveActionWithHandCard,
        resolveOptionalDiscardCustomPrompt, resolveOptionalEffectPrompt, resolveVariableDiscard, resolveRevealBoardCardPrompt,
        resolveRearrangeProtocols, resolveOptionalDrawPrompt, resolveSwapProtocols,
        resolveControlMechanicPrompt, resolveCustomChoice, resolveSelectRevealedDeckCard, resolveRevealDeckDrawProtocol,
        resolveStateNumber, resolveStateProtocol, resolveSelectFromDrawnToReveal,
        resolveConfirmDeckDiscard, resolveConfirmDeckPlayPreview,
        resolveSelectTrashCardToPlay, resolveSelectTrashCardToReveal,
        setupTestScenario,
        // REMOVED: Legacy card-specific functions (resolvePlague2Discard, resolvePlague4Flip, resolveFire4Discard, resolveHate1Discard, etc.)
    };
};
