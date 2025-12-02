/**
 * Effect Chain Tests
 *
 * Tests complete effect chains including:
 * - Multi-step prompts (reveal → decide → execute)
 * - Conditional effects (if_executed, if_you_do)
 * - Chained effects (delete → uncover → trigger)
 * - AI decisions at each step
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, PlayedCard, Player } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { easyAI } from '../logic/ai/easy';
import { normalAI } from '../logic/ai/normal';
import { recalculateAllLaneValues } from '../logic/game/stateManager';
import { playCard } from '../logic/game/resolvers/playResolver';
import { resolveOptionalEffectPrompt } from '../logic/game/resolvers/promptResolver';
import * as laneResolver from '../logic/game/resolvers/laneResolver';

// Helper to create a minimal card without needing localStorage
function createCard(protocol: string, value: number, isFaceUp: boolean = true): PlayedCard {
    return {
        id: uuidv4(),
        protocol,
        value,
        top: '',
        middle: '',
        bottom: '',
        keywords: {},
        isFaceUp,
        isRevealed: false,
    };
}

// Helper to create a card with custom effects
function createCustomCard(
    protocol: string,
    value: number,
    isFaceUp: boolean,
    customEffects: any
): PlayedCard {
    return {
        ...createCard(protocol, value, isFaceUp),
        customEffects,
    } as PlayedCard;
}

// Helper to create a minimal game state
function createTestState(): GameState {
    const state: any = {
        player: {
            protocols: ['Fire', 'Water', 'Death'],
            lanes: [[], [], []],
            hand: [],
            deck: Array(10).fill(null).map(() => createCard('Fire', 2)),
            discard: [],
            compiled: [false, false, false],
            stats: { cardsPlayed: 0, cardsDeleted: 0, cardsDrawn: 0 },
            laneValues: [0, 0, 0],
        },
        opponent: {
            protocols: ['Hate', 'Apathy', 'Metal'],
            lanes: [[], [], []],
            hand: [createCard('Hate', 2), createCard('Metal', 3)],
            deck: Array(10).fill(null).map(() => createCard('Hate', 1)),
            discard: [],
            compiled: [false, false, false],
            stats: { cardsPlayed: 0, cardsDeleted: 0, cardsDrawn: 0 },
            laneValues: [0, 0, 0],
        },
        turn: 'opponent' as Player,
        phase: 'action',
        turnNumber: 1,
        laneValues: { player: [0, 0, 0], opponent: [0, 0, 0] },
        winner: null,
        actionRequired: null,
        queuedActions: [],
        queuedEffect: null,
        stats: {
            player: { cardsPlayed: 0, cardsDeleted: 0, cardsDrawn: 0 },
            opponent: { cardsPlayed: 0, cardsDeleted: 0, cardsDrawn: 0 },
        },
        log: [],
        animationState: null,
        _logIndentLevel: 0,
        _currentLogSource: null,
        _currentPhaseContext: null,
    };
    return state as GameState;
}

// Helper to simulate AI responding to an action until no more actions required
function runAIUntilComplete(
    state: GameState,
    ai: typeof normalAI,
    maxIterations: number = 10
): { finalState: GameState; decisions: any[] } {
    let currentState = state;
    const decisions: any[] = [];
    let iterations = 0;

    while (currentState.actionRequired && iterations < maxIterations) {
        const action = currentState.actionRequired;
        const decision = ai(currentState, action);
        decisions.push({ action: action.type, decision });

        // Apply the decision based on type
        currentState = applyAIDecision(currentState, decision);
        iterations++;
    }

    return { finalState: currentState, decisions };
}

// Helper to apply AI decision to state
function applyAIDecision(state: GameState, decision: any): GameState {
    let newState = { ...state };

    switch (decision.type) {
        case 'skip':
            newState.actionRequired = null;
            break;

        case 'deleteCard':
            // Simplified - just remove the card
            const cardId = decision.cardId;
            for (const playerKey of ['player', 'opponent'] as const) {
                for (let i = 0; i < newState[playerKey].lanes.length; i++) {
                    const lane = newState[playerKey].lanes[i];
                    const cardIndex = lane.findIndex(c => c.id === cardId);
                    if (cardIndex !== -1) {
                        const newLanes = [...newState[playerKey].lanes];
                        newLanes[i] = lane.filter(c => c.id !== cardId);
                        newState = {
                            ...newState,
                            [playerKey]: { ...newState[playerKey], lanes: newLanes }
                        };
                        break;
                    }
                }
            }
            newState.actionRequired = null;
            break;

        case 'flipCard':
            const flipId = decision.cardId;
            for (const playerKey of ['player', 'opponent'] as const) {
                for (let i = 0; i < newState[playerKey].lanes.length; i++) {
                    const lane = newState[playerKey].lanes[i];
                    const cardIndex = lane.findIndex(c => c.id === flipId);
                    if (cardIndex !== -1) {
                        const newLanes = [...newState[playerKey].lanes];
                        const card = { ...lane[cardIndex], isFaceUp: !lane[cardIndex].isFaceUp };
                        newLanes[i] = [...lane.slice(0, cardIndex), card, ...lane.slice(cardIndex + 1)];
                        newState = {
                            ...newState,
                            [playerKey]: { ...newState[playerKey], lanes: newLanes }
                        };
                        break;
                    }
                }
            }
            newState.actionRequired = null;
            break;

        case 'selectLane':
            // For shift - simplified
            newState.actionRequired = null;
            break;

        case 'returnCard':
            // Remove card and add to hand
            const returnId = decision.cardId;
            for (const playerKey of ['player', 'opponent'] as const) {
                for (let i = 0; i < newState[playerKey].lanes.length; i++) {
                    const lane = newState[playerKey].lanes[i];
                    const cardIndex = lane.findIndex(c => c.id === returnId);
                    if (cardIndex !== -1) {
                        const card = lane[cardIndex];
                        const newLanes = [...newState[playerKey].lanes];
                        newLanes[i] = lane.filter(c => c.id !== returnId);
                        const newHand = [...newState[playerKey].hand, { ...card, isFaceUp: true }];
                        newState = {
                            ...newState,
                            [playerKey]: {
                                ...newState[playerKey],
                                lanes: newLanes,
                                hand: newHand
                            }
                        };
                        break;
                    }
                }
            }
            newState.actionRequired = null;
            break;

        case 'resolveOptionalEffectPrompt':
            newState = resolveOptionalEffectPrompt(newState, decision.accept);
            break;

        default:
            // Unknown decision type, clear action
            newState.actionRequired = null;
    }

    return recalculateAllLaneValues(newState);
}

describe('Effect Chain Tests', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('Multi-step Decision Prompts', () => {
        it('AI handles reveal → flip/shift/skip decision chain', () => {
            // Setup: Light-2 style effect - reveal a card, then decide
            const revealedCard = createCard('Fire', 3, false);
            const sourceCard = createCard('Light', 2, true);

            state.player.lanes[0] = [revealedCard];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            // Set up the prompt for shift/flip/skip
            state.actionRequired = {
                type: 'prompt_shift_or_flip_board_card_custom',
                sourceCardId: sourceCard.id,
                revealedCardId: revealedCard.id,
                actor: 'opponent',
            } as any;

            const decision = normalAI(state, state.actionRequired);

            // AI should make a valid choice
            expect(decision.type).toBe('resolveRevealBoardCardPrompt');
            expect(['shift', 'flip', 'skip']).toContain(decision.choice);
        });

        it('AI handles optional effect prompt with followUpEffect', () => {
            // Setup: Death-1 style - draw 1, if you do delete 1 other card
            const targetCard = createCard('Fire', 3, true);
            const sourceCard = createCard('Death', 1, true);

            state.player.lanes[0] = [targetCard];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            // First prompt: optional draw
            state.actionRequired = {
                type: 'prompt_optional_draw',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                count: 1,
                optional: true,
                followUpEffect: {
                    id: 'death_1_delete',
                    params: { action: 'delete', count: 1 },
                },
                conditionalType: 'if_executed',
            } as any;

            const decision = normalAI(state, state.actionRequired);

            // AI should decide to accept or skip (generic handler)
            expect(decision.type).toBe('resolveOptionalEffectPrompt');
            expect(typeof decision.accept).toBe('boolean');
        });
    });

    describe('Target Filter Validation in Chains', () => {
        it('AI respects valueRange when choosing delete target in chain', () => {
            // Setup: After some effect, AI needs to delete a low-value card
            const card0 = createCard('Fire', 0, true);
            const card5 = createCard('Water', 5, true);
            const sourceCard = createCard('Death', 4, true);

            state.player.lanes[0] = [card0];
            state.player.lanes[1] = [card5];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            // Simulate being in a chain where we need to select delete target
            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    position: 'uncovered',
                    faceState: 'face_up',
                    valueRange: { min: 0, max: 1 },
                },
            } as any;

            const { finalState, decisions } = runAIUntilComplete(state, normalAI);

            // Should have made exactly one decision
            expect(decisions.length).toBe(1);
            // Should have selected the valid target (card0)
            expect(decisions[0].decision.cardId).toBe(card0.id);
        });

        it('AI skips when no valid targets exist in chain', () => {
            // No valid targets for valueRange filter
            const card5 = createCard('Water', 5, true);
            const sourceCard = createCard('Death', 4, true);

            state.player.lanes[0] = [card5];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    position: 'uncovered',
                    faceState: 'face_up',
                    valueRange: { min: 0, max: 1 },
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('skip');
        });
    });

    describe('Queued Actions Processing', () => {
        it('AI processes multiple queued actions in sequence', () => {
            // Setup: Multiple cards need to be processed
            const card1 = createCard('Fire', 1, true);
            const card2 = createCard('Water', 2, true);
            const sourceCard = createCard('Chaos', 0, true);

            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            // First action in queue
            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                currentLaneIndex: 0,
                targetFilter: {
                    position: 'uncovered',
                },
            } as any;

            // Simulate queued actions
            state.queuedActions = [
                {
                    type: 'select_card_to_flip',
                    sourceCardId: sourceCard.id,
                    actor: 'opponent',
                    currentLaneIndex: 1,
                    targetFilter: {
                        position: 'uncovered',
                    },
                } as any,
            ];

            // Process first action
            let decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('flipCard');

            // Apply and get next action
            let newState = applyAIDecision(state, decision);

            // Pop queued action
            if (state.queuedActions.length > 0) {
                newState.actionRequired = state.queuedActions[0];
                newState.queuedActions = state.queuedActions.slice(1);
            }

            // Process second action
            if (newState.actionRequired) {
                decision = normalAI(newState, newState.actionRequired);
                expect(decision.type).toBe('flipCard');
            }
        });
    });

    describe('Owner Filter Edge Cases', () => {
        it('AI correctly interprets "own" vs "opponent" relative to actor', () => {
            // When AI (opponent) plays a card that targets "own" cards
            // Setup: AI has two cards - one that is NOT the source
            const aiCard1 = createCard('Metal', 3, true);
            const aiCard2 = createCard('Apathy', 4, true);  // This is NOT the source card
            const playerCard = createCard('Fire', 2, true);
            const sourceCard = createCard('Hate', 2, true);

            // Put aiCard1 in lane 0, sourceCard in lane 1, aiCard2 in lane 2
            state.opponent.lanes[0] = [aiCard1];
            state.opponent.lanes[1] = [sourceCard];
            state.opponent.lanes[2] = [aiCard2];
            state.player.lanes[0] = [playerCard];
            state = recalculateAllLaneValues(state);

            // Effect targets "own" cards (AI's cards)
            // WITHOUT excludeSelf - so sourceCard is also valid target
            // AI should pick lowest value to minimize loss: sourceCard (2) < aiCard1 (3) < aiCard2 (4)
            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'own',  // AI's own cards
                    position: 'uncovered',
                    // NO excludeSelf - all own cards are valid targets
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('deleteCard');
            // AI picks lowest value: sourceCard (value 2)
            // This is correct behavior - if you don't exclude self, self is valid!
            expect(decision.cardId).toBe(sourceCard.id);
        });

        it('AI excludes source card when excludeSelf is true', () => {
            // Same setup but WITH excludeSelf
            const aiCard1 = createCard('Metal', 3, true);
            const aiCard2 = createCard('Apathy', 4, true);
            const playerCard = createCard('Fire', 2, true);
            const sourceCard = createCard('Hate', 2, true);

            state.opponent.lanes[0] = [aiCard1];
            state.opponent.lanes[1] = [sourceCard];
            state.opponent.lanes[2] = [aiCard2];
            state.player.lanes[0] = [playerCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'own',
                    position: 'uncovered',
                    excludeSelf: true,  // Now source is excluded
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('deleteCard');
            // AI picks lowest of remaining: aiCard1 (value 3)
            expect(decision.cardId).toBe(aiCard1.id);
        });

        it('AI correctly targets opponent cards when filter says "opponent"', () => {
            const aiCard = createCard('Metal', 3, true);
            const playerCard = createCard('Fire', 2, true);
            const sourceCard = createCard('Death', 3, true);

            state.opponent.lanes[0] = [aiCard];
            state.player.lanes[0] = [playerCard];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            // Effect targets "opponent" cards (player's cards from AI perspective)
            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',  // Player's cards
                    position: 'uncovered',
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('deleteCard');
            // Should select player's card
            expect(decision.cardId).toBe(playerCard.id);
        });
    });

    describe('Face State Filter', () => {
        it('AI only targets face-up cards when filter requires it', () => {
            const faceUpCard = createCard('Fire', 2, true);
            const faceDownCard = createCard('Water', 5, false);
            const sourceCard = createCard('Apathy', 3, true);

            state.player.lanes[0] = [faceUpCard];
            state.player.lanes[1] = [faceDownCard];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    position: 'uncovered',
                    faceState: 'face_up',
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('flipCard');
            expect(decision.cardId).toBe(faceUpCard.id);
        });

        it('AI only targets face-down cards when filter requires it', () => {
            const faceUpCard = createCard('Fire', 2, true);
            const faceDownCard = createCard('Water', 5, false);
            const sourceCard = createCard('Light', 2, true);

            state.player.lanes[0] = [faceUpCard];
            state.player.lanes[1] = [faceDownCard];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    position: 'uncovered',
                    faceState: 'face_down',
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('flipCard');
            expect(decision.cardId).toBe(faceDownCard.id);
        });
    });

    describe('Position Filter', () => {
        it('AI only targets uncovered cards when position filter is uncovered', () => {
            const coveredCard = createCard('Fire', 5, true);
            const uncoveredCard = createCard('Water', 1, true);
            const sourceCard = createCard('Death', 3, true);

            // Stack cards - coveredCard is under uncoveredCard
            state.player.lanes[0] = [coveredCard, uncoveredCard];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    position: 'uncovered',
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('deleteCard');
            // Should only be able to target the uncovered card
            expect(decision.cardId).toBe(uncoveredCard.id);
        });

        it('AI targets covered cards when position filter is covered', () => {
            const coveredCard = createCard('Fire', 5, true);
            const uncoveredCard = createCard('Water', 1, true);
            const sourceCard = createCard('Darkness', 2, true);

            state.player.lanes[0] = [coveredCard, uncoveredCard];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                currentLaneIndex: 0,
                targetFilter: {
                    owner: 'opponent',
                    position: 'covered',
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('flipCard');
            expect(decision.cardId).toBe(coveredCard.id);
        });
    });

    describe('ExcludeSelf Filter', () => {
        it('AI does not target source card when excludeSelf is true', () => {
            const sourceCard = createCard('Fire', 3, true);
            const otherCard = createCard('Water', 2, true);

            state.opponent.lanes[0] = [sourceCard];
            state.opponent.lanes[1] = [otherCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'own',
                    position: 'uncovered',
                    excludeSelf: true,
                },
            } as any;

            const decision = normalAI(state, state.actionRequired);
            expect(decision.type).toBe('flipCard');
            // Should NOT target the source card
            expect(decision.cardId).not.toBe(sourceCard.id);
            expect(decision.cardId).toBe(otherCard.id);
        });
    });
});

describe('AI Consistency Tests - Easy vs Normal', () => {
    it('Both AIs handle the same action without crashing', () => {
        const state = createTestState();
        const targetCard = createCard('Fire', 2, true);
        const sourceCard = createCard('Death', 3, true);

        state.player.lanes[0] = [targetCard];
        state.opponent.lanes[0] = [sourceCard];

        state.actionRequired = {
            type: 'select_cards_to_delete',
            count: 1,
            sourceCardId: sourceCard.id,
            actor: 'opponent',
            targetFilter: {
                owner: 'opponent',
                position: 'uncovered',
            },
        } as any;

        const easyDecision = easyAI(recalculateAllLaneValues(state), state.actionRequired);
        const normalDecision = normalAI(recalculateAllLaneValues(state), state.actionRequired);

        // Both should produce valid decisions
        expect(easyDecision.type).toBe('deleteCard');
        expect(normalDecision.type).toBe('deleteCard');
        expect(easyDecision.cardId).toBe(targetCard.id);
        expect(normalDecision.cardId).toBe(targetCard.id);
    });
});
