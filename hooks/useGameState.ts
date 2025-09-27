/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
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
import { handleUncoverEffect } from '../logic/game/helpers/actionUtils';
import { drawCards as drawCardsUtil } from '../utils/gameStateModifiers';

export const useGameState = (
    playerProtocols: string[], 
    opponentProtocols: string[],
    onEndGame: (winner: Player, finalState: GameState) => void,
    difficulty: Difficulty,
    useControlMechanic: boolean
) => {
    const [gameState, setGameState] = useState<GameState>(() => {
        const initialState = stateManager.createInitialState(playerProtocols, opponentProtocols, useControlMechanic);
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
                // Find context from state 's' right before deletion.
                const laneIndex = s[nextRequest.owner].lanes.findIndex(l => l.some(c => c.id === nextRequest.cardId));
                const wasTopCard = laneIndex !== -1 && 
                                   s[nextRequest.owner].lanes[laneIndex].length > 0 && 
                                   s[nextRequest.owner].lanes[laneIndex][s[nextRequest.owner].lanes[laneIndex].length - 1].id === nextRequest.cardId;
    
                let stateAfterDelete = deleteCardFromBoard(s, nextRequest.cardId);
                let stateWithNewValues = stateManager.recalculateAllLaneValues(stateAfterDelete);
                
                let finalState = { ...stateWithNewValues, animationState: null };
    
                if (wasTopCard) {
                    const uncoverResult = handleUncoverEffect(finalState, nextRequest.owner, laneIndex);
                    // Important: Ignore any animation requests from the uncover effect to prevent nesting.
                    // We take the resulting state, which may have a new actionRequired.
                    finalState = uncoverResult.newState;
                }
                
                return finalState;
            });
    
            if (rest.length > 0) {
                processAnimationQueue(rest, onComplete);
            } else {
                onComplete();
            }
        }, 500);
    }, []);

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
            // If fillHand triggers the Control mechanic, an action will be set. Don't progress turn yet.
            if (newState.actionRequired) {
                return newState;
            }
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
    
                    const compiler = currentState.turn;
                    if (currentState.useControlMechanic && currentState.controlCardHolder === compiler) {
                        let stateWithPrompt = log(stateAfterCompile, compiler, `${compiler === 'player' ? 'Player' : 'Opponent'} has Control and may rearrange protocols after compiling.`);
                        
                        const speed2Actions = stateAfterCompile.queuedActions;
                        stateWithPrompt.queuedActions = [];
                        
                        stateWithPrompt.actionRequired = {
                            type: 'prompt_use_control_mechanic',
                            sourceCardId: 'CONTROL_MECHANIC',
                            actor: compiler,
                            originalAction: { type: 'continue_turn', queuedSpeed2Actions: speed2Actions },
                        };
                        stateWithPrompt.controlCardHolder = null;
                        return { ...stateWithPrompt, animationState: null };
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
                        const finalState = requiresAnimation.onCompleteCallback(s, turnProgressionCb);
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

    const resolveControlMechanicPrompt = useCallback((choice: 'player' | 'opponent' | 'skip') => {
        setGameState(prev => {
            if (prev.actionRequired?.type !== 'prompt_use_control_mechanic') return prev;
    
            const { originalAction, actor } = prev.actionRequired;
    
            if (choice === 'skip') {
                let stateAfterSkip = log(prev, actor, "Player skips rearranging protocols.");
                stateAfterSkip.actionRequired = null;
                
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

    const resolveDeath1Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveDeath1Prompt(prev, accept);
            if (!nextState.actionRequired) {
                return turnProgressionCb(nextState);
            }
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
            const nextState = resolvers.resolveRearrangeProtocols(prev, newOrder, onEndGame);
            
            if (nextState.winner) {
                return nextState;
            }

            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback, onEndGame]);
    
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
                return nextState;
            }
            return turnProgressionCb(nextState);
        });
    }, [getTurnProgressionCallback]);

    const resolveSpirit3Prompt = useCallback((accept: boolean) => {
        setGameState(prev => {
            const turnProgressionCb = getTurnProgressionCallback(prev.phase);
            const nextState = resolvers.resolveSpirit3Prompt(prev, accept);
            if (nextState.actionRequired) { // new shift action
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

    const setupTestScenario = useCallback((scenario: string) => {
        setGameState(currentState => {
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
                    // Fallback to global list if not found (shouldn't happen with correct setup)
                    return cards.find(c => c.protocol === protocol && c.value === value)!;
                };
    
                // Define and remove cards from decks
                const speed0Card = removeCardFromDeck(playerDeck, 'Speed', 0);
                const metal0Card = removeCardFromDeck(opponentDeck, 'Metal', 0);
                // Player hand cards matching protocols
                const speed1Card = removeCardFromDeck(playerDeck, 'Speed', 1);
                const life1Card = removeCardFromDeck(playerDeck, 'Life', 1);
                const water1Card = removeCardFromDeck(playerDeck, 'Water', 1);
                const speed3Card = removeCardFromDeck(playerDeck, 'Speed', 3);
    
                let newState = stateManager.createInitialState(debugPlayerProtocols, debugOpponentProtocols, useControlMechanic);
    
                // Player setup
                newState.player.lanes = [[], [], []];
                newState.player.lanes[0] = [{ ...speed0Card, id: uuidv4(), isFaceUp: false }]; // Face-down Speed-0
                newState.player.hand = [
                    { ...speed1Card, id: uuidv4(), isFaceUp: true },
                    { ...life1Card, id: uuidv4(), isFaceUp: true },
                    { ...water1Card, id: uuidv4(), isFaceUp: true },
                    { ...speed3Card, id: uuidv4(), isFaceUp: true },
                ];
                newState.player.deck = playerDeck;
                newState.player.discard = [];
    
                // Opponent setup
                newState.opponent.lanes = [[], [], []];
                newState.opponent.hand = [{ ...metal0Card, id: uuidv4(), isFaceUp: true }]; // Only has Metal-0
                newState.opponent.deck = opponentDeck;
                newState.opponent.discard = [];
    
                // Game state setup
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

                let newState = stateManager.createInitialState(debugPlayerProtocols, debugOpponentProtocols, useControlMechanic);

                // Player setup
                newState.player.lanes = [[], [], []];
                newState.player.lanes[0] = [{ ...speed1Card, id: uuidv4(), isFaceUp: true }];

                const { drawnCards, remainingDeck } = drawCardsUtil(playerDeck, [], 6);
                newState.player.hand = drawnCards.map(c => ({...c, id: uuidv4(), isFaceUp: true}));
                newState.player.deck = remainingDeck;
                newState.player.discard = [];

                // Opponent setup
                newState.opponent.lanes = [[], [], []];
                newState.opponent.hand = [];
                newState.opponent.deck = opponentDeck;
                newState.opponent.discard = [];

                // Game state setup
                newState.turn = 'player';
                newState.phase = 'hand_limit';
                newState.actionRequired = {
                    type: 'discard',
                    actor: 'player',
                    count: 1, // 6 cards in hand - 5 limit = 1
                };
                newState.queuedActions = [];
                
                newState = stateManager.recalculateAllLaneValues(newState);
                newState = log(newState, 'player', 'DEBUG: Speed-1 discard trigger scenario set up.');
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


    useEffect(() => {
        if (gameState.turn === 'opponent' && !gameState.winner && !gameState.animationState) {
            const timer = setTimeout(() => {
                aiManager.runOpponentTurn(gameState, setGameState, difficulty, {
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
                    resolveDeath1Prompt: resolvers.resolveDeath1Prompt,
                    resolveLove1Prompt: resolvers.resolveLove1Prompt,
                    resolvePlague4Flip: (s, a) => resolvers.resolvePlague4Flip(s, a, 'opponent'),
                    resolvePlague2Discard: resolvers.resolvePlague2OpponentDiscard,
                    resolveFire3Prompt: resolvers.resolveFire3Prompt,
                    resolveSpeed3Prompt: resolvers.resolveSpeed3Prompt,
                    resolveFire4Discard: resolvers.resolveFire4Discard,
                    resolveHate1Discard: resolvers.resolveHate1Discard,
                    resolveLight2Prompt: resolvers.resolveLight2Prompt,
                    resolveRearrangeProtocols: (s, o) => resolvers.resolveRearrangeProtocols(s, o, onEndGame),
                    resolveActionWithHandCard: resolvers.resolveActionWithHandCard,
                    resolvePsychic4Prompt: resolvers.resolvePsychic4Prompt,
                    resolveSpirit1Prompt: resolvers.resolveSpirit1Prompt,
                    resolveSpirit3Prompt: resolvers.resolveSpirit3Prompt,
                    resolveSwapProtocols: (s, o) => resolvers.resolveSwapProtocols(s, o, onEndGame),
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
            action && 'actor' in action && action.actor === 'opponent';

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
                        resolveRearrangeProtocols: (s, o) => resolvers.resolveRearrangeProtocols(s, o, onEndGame),
                    }, 
                    phaseManager, 
                    processAnimationQueue,
                    resolvers.resolveActionWithCard,
                    resolvers.resolveActionWithLane
                );
            }, 1500); // AI "thinking" time
            return () => clearTimeout(timer);
        }
    }, [gameState.actionRequired, gameState.turn, gameState.animationState, difficulty, processAnimationQueue, onEndGame]);

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
        resolveControlMechanicPrompt,
        setupTestScenario,
    };
};