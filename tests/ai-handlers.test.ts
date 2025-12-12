/**
 * AI Handler Tests
 *
 * Tests that AI can handle all action types without softlocking.
 * Focuses on the 6 handlers that were changed to generic versions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, PlayedCard, Player, ActionRequired } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { easyAI } from '../logic/ai/easy';
import { normalAI } from '../logic/ai/normal';
import { getAllCustomProtocolCards } from '../logic/customProtocols/cardFactory';
import { recalculateAllLaneValues } from '../logic/game/stateManager';

// Helper to create a card
function createCard(protocol: string, value: number, isFaceUp: boolean = true): PlayedCard {
    const allCards = getAllCustomProtocolCards();
    const cardData = allCards.find(c => c.protocol === protocol && c.value === value);

    return {
        id: uuidv4(),
        protocol: cardData?.protocol || protocol,
        value: cardData?.value ?? value,
        top: cardData?.top || '',
        middle: cardData?.middle || '',
        bottom: cardData?.bottom || '',
        keywords: cardData?.keywords || {},
        isFaceUp,
        isRevealed: false,
        ...(cardData as any)?.customEffects && { customEffects: (cardData as any).customEffects }
    };
}

// Helper to create a minimal game state
function createTestState(): GameState {
    const state: any = {
        player: {
            protocols: ['Fire', 'Water', 'Death'],
            lanes: [[], [], []],
            hand: [createCard('Fire', 2), createCard('Water', 1), createCard('Death', 3)],
            deck: [createCard('Fire', 4), createCard('Water', 5)],
            discard: [],
            stats: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
            laneValues: [0, 0, 0],
            compiled: [false, false, false],
        },
        opponent: {
            protocols: ['Fire', 'Water', 'Hate'],
            lanes: [[], [], []],
            hand: [createCard('Hate', 2), createCard('Fire', 1)],
            deck: [createCard('Hate', 4), createCard('Fire', 5)],
            discard: [],
            stats: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
            laneValues: [0, 0, 0],
            compiled: [false, false, false],
        },
        turn: 'opponent',
        phase: 'play',
        turnNumber: 1,
        laneValues: { player: [0, 0, 0], opponent: [0, 0, 0] },
        winner: null,
        actionRequired: null,
        queuedActions: [],
        stats: {
            player: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
            opponent: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
        },
        log: [],
        animationState: null,
        logIndent: 0,
        logSource: null,
        logPhase: null,
    };
    return state as GameState;
}

describe('AI Handler Tests - Generic Handler Migration', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('select_cards_to_delete (formerly Death-1 specific)', () => {
        it('Easy AI handles select_cards_to_delete', () => {
            // Setup: Place cards on board as targets
            const targetCard = createCard('Fire', 2, true);
            const sourceCard = createCard('Death', 1, true);
            state.player.lanes[0] = [targetCard];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                disallowedIds: [sourceCard.id],
                actor: 'opponent',
            };

            const action = easyAI(state, state.actionRequired);
            expect(action.type).toBe('deleteCard');
            expect(action.cardId).toBeDefined();
        });

        it('Normal AI handles select_cards_to_delete with calculation: highest_value', () => {
            // Setup: Place multiple cards with different values
            const card1 = createCard('Fire', 4, true);
            const card2 = createCard('Water', 2, true);
            const card3 = createCard('Death', 5, true);
            const sourceCard = createCard('Hate', 2, true);

            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];
            state.player.lanes[2] = [card3];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCard.id,
                disallowedIds: [sourceCard.id],
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    calculation: 'highest_value',
                },
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('deleteCard');
            // Should select the highest value card (Death-5)
            expect(action.cardId).toBe(card3.id);
        });
    });

    describe('select_card_to_flip (formerly Fire-3 specific)', () => {
        it('Easy AI handles generic select_card_to_flip', () => {
            const targetCard = createCard('Water', 3, true);
            const sourceCard = createCard('Fire', 3, true);
            state.player.lanes[0] = [targetCard];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    position: 'uncovered',
                    excludeSelf: true,
                },
            } as any;

            const action = easyAI(state, state.actionRequired);
            expect(action.type).toBe('flipCard');
            expect(action.cardId).toBeDefined();
            expect(action.cardId).not.toBe(sourceCard.id); // Should not flip self
        });

        it('Normal AI handles select_card_to_flip with currentLaneIndex (each_lane)', () => {
            const coveredCard = createCard('Fire', 1, false);
            const uncoveredCard = createCard('Fire', 2, true);
            const sourceCard = createCard('Chaos', 0, true);

            state.player.lanes[0] = [coveredCard, uncoveredCard];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_flip',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                currentLaneIndex: 0,
                remainingLanes: [1, 2],
                targetFilter: {
                    position: 'covered',
                },
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('flipCard');
            expect(action.cardId).toBe(coveredCard.id); // Should flip the covered card
        });
    });

    describe('select_lane_for_shift (formerly Light-2 specific)', () => {
        it('Easy AI handles generic select_lane_for_shift', () => {
            const cardToShift = createCard('Light', 2, true);
            const sourceCard = createCard('Light', 2, true);

            state.player.lanes[0] = [cardToShift];
            state.opponent.lanes[1] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_lane_for_shift',
                sourceCardId: sourceCard.id,
                cardToShiftId: cardToShift.id,
                cardOwner: 'player',
                originalLaneIndex: 0,
                actor: 'opponent',
            } as any;

            const action = easyAI(state, state.actionRequired);
            expect(action.type).toBe('selectLane');
            expect(action.laneIndex).toBeDefined();
            expect(action.laneIndex).not.toBe(0); // Should not shift to same lane
        });
    });

    describe('flip_self (formerly Water-0 and Psychic-4 specific)', () => {
        it('Easy AI handles generic flip_self', () => {
            const sourceCard = createCard('Water', 0, true);
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'flip_self',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
            } as any;

            const action = easyAI(state, state.actionRequired);
            expect(action.type).toBe('flipCard');
            expect(action.cardId).toBe(sourceCard.id);
        });

        it('Normal AI handles flip_self_for_water_0 (legacy support)', () => {
            const sourceCard = createCard('Water', 0, true);
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'flip_self_for_water_0',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('flipCard');
            expect(action.cardId).toBe(sourceCard.id);
        });

        it('Normal AI handles flip_self_for_psychic_4 (legacy support)', () => {
            const sourceCard = createCard('Psychic', 4, true);
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'flip_self_for_psychic_4',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('flipCard');
            expect(action.cardId).toBe(sourceCard.id);
        });
    });

    // NOTE: Legacy prompt tests removed - Death-1 and Light-2 now use generic handlers
    // prompt_death_1_effect -> select_cards_to_delete
    // prompt_shift_or_flip_for_light_2 -> prompt_shift_or_flip_board_card_custom
});

describe('AI targetFilter Tests - Full Filter Support', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('valueRange filter (Death-4: only value 0 or 1)', () => {
        it('Normal AI respects valueRange in select_cards_to_delete', () => {
            // Setup: Place cards with different values
            const card0 = createCard('Fire', 0, true);  // Valid target (value 0)
            const card1 = createCard('Water', 1, true); // Valid target (value 1)
            const card5 = createCard('Death', 5, true); // Invalid target (value 5)
            const sourceCard = createCard('Death', 4, true);

            state.player.lanes[0] = [card0];
            state.player.lanes[1] = [card1];
            state.player.lanes[2] = [card5];
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

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('deleteCard');
            // Should NOT select card5 (value 5), only card0 or card1
            expect([card0.id, card1.id]).toContain(action.cardId);
            expect(action.cardId).not.toBe(card5.id);
        });

        it('Easy AI respects valueRange in select_cards_to_delete', () => {
            const card0 = createCard('Fire', 0, true);
            const card5 = createCard('Death', 5, true);
            const sourceCard = createCard('Death', 4, true);

            state.player.lanes[0] = [card0];
            state.player.lanes[1] = [card5];
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

            const action = easyAI(state, state.actionRequired);
            expect(action.type).toBe('deleteCard');
            expect(action.cardId).toBe(card0.id); // Only valid target
        });

        it('Normal AI skips when no valid targets match valueRange', () => {
            const card5 = createCard('Death', 5, true); // Invalid (value 5)
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

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('skip');
        });
    });

    describe('valueEquals filter', () => {
        it('Normal AI respects valueEquals in select_card_to_return', () => {
            const card2 = createCard('Fire', 2, true);  // Valid target
            const card5 = createCard('Water', 5, true); // Invalid target
            const sourceCard = createCard('Water', 4, true);

            state.player.lanes[0] = [card2];
            state.player.lanes[1] = [card5];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_return',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    valueEquals: 2,
                },
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('returnCard');
            expect(action.cardId).toBe(card2.id);
        });
    });

    describe('valueRange in select_card_to_flip', () => {
        it('Normal AI respects valueRange when flipping', () => {
            const card0 = createCard('Fire', 0, true);  // Valid target
            const card5 = createCard('Water', 5, true); // Invalid target
            const sourceCard = createCard('Apathy', 3, true);

            state.player.lanes[0] = [card0];
            state.player.lanes[1] = [card5];
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
                    valueRange: { min: 0, max: 1 },
                },
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('flipCard');
            expect(action.cardId).toBe(card0.id);
        });
    });

    describe('valueRange in select_card_to_shift', () => {
        it('Normal AI respects valueRange when shifting', () => {
            const card1 = createCard('Fire', 1, true);  // Valid target
            const card5 = createCard('Water', 5, true); // Invalid target
            const sourceCard = createCard('Gravity', 1, true);

            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card5];
            state.opponent.lanes[0] = [sourceCard];
            state = recalculateAllLaneValues(state);

            state.actionRequired = {
                type: 'select_card_to_shift',
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                targetFilter: {
                    owner: 'opponent',
                    position: 'uncovered',
                    valueRange: { min: 0, max: 1 },
                },
            } as any;

            const action = normalAI(state, state.actionRequired);
            expect(action.type).toBe('shiftCard');
            expect(action.cardId).toBe(card1.id);
        });
    });
});

describe('AI No-Softlock Tests', () => {
    const actionTypes = [
        'select_cards_to_delete',
        'select_card_to_flip',
        'select_lane_for_shift',
        'flip_self',
        'select_lane_for_return',
        'select_card_to_shift',
    ];

    for (const actionType of actionTypes) {
        it(`Easy AI returns valid action for ${actionType}`, () => {
            const state = createTestState();
            const sourceCard = createCard('Fire', 3, true);
            const targetCard = createCard('Water', 2, true);

            state.opponent.lanes[0] = [sourceCard];
            state.player.lanes[1] = [targetCard];

            state.actionRequired = {
                type: actionType,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                count: 1,
            } as any;

            const action = easyAI(state, state.actionRequired);

            // Should return a valid action type, not crash
            expect(action).toBeDefined();
            expect(action.type).toBeDefined();
            // Should not return an empty or null action
            expect(['skip', 'flipCard', 'deleteCard', 'selectLane', 'shiftCard', 'returnCard']).toContain(action.type);
        });

        it(`Normal AI returns valid action for ${actionType}`, () => {
            const state = createTestState();
            const sourceCard = createCard('Fire', 3, true);
            const targetCard = createCard('Water', 2, true);

            state.opponent.lanes[0] = [sourceCard];
            state.player.lanes[1] = [targetCard];

            state.actionRequired = {
                type: actionType,
                sourceCardId: sourceCard.id,
                actor: 'opponent',
                count: 1,
            } as any;

            const action = normalAI(state, state.actionRequired);

            expect(action).toBeDefined();
            expect(action.type).toBeDefined();
            expect(['skip', 'flipCard', 'deleteCard', 'selectLane', 'shiftCard', 'returnCard']).toContain(action.type);
        });
    }
});
