/**
 * Count Resolver Tests
 *
 * Tests für die dynamische Count-Auflösungslogik
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Player, PlayedCard } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import {
    resolveCount,
    countFaceUpCards,
    countCardsForOwner,
    calculateLaneValue,
    validateCount
} from '../../logic/effects/utils/countResolver';

// Helper to create a minimal card
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

// Helper to create a minimal game state
function createTestState(): GameState {
    const state: any = {
        player: {
            protocols: ['Fire', 'Water', 'Death'],
            lanes: [[], [], []],
            hand: [createCard('Fire', 1), createCard('Water', 2)],
            deck: [],
            discard: [],
            compiled: [false, false, false],
            laneValues: [0, 0, 0],
        },
        opponent: {
            protocols: ['Hate', 'Apathy', 'Metal'],
            lanes: [[], [], []],
            hand: [],
            deck: [],
            discard: [],
            compiled: [false, false, false],
            laneValues: [0, 0, 0],
        },
        turn: 'player' as Player,
        phase: 'action',
    };
    return state as GameState;
}

describe('Count Resolver', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('resolveCount', () => {
        it('returns number directly when countDef is a number', () => {
            const result = resolveCount(3, { state, actor: 'player' });
            expect(result).toBe(3);
        });

        it('returns 1 when countDef is undefined', () => {
            const result = resolveCount(undefined, { state, actor: 'player' });
            expect(result).toBe(1);
        });

        it('returns fixed value from CountDefinition', () => {
            const result = resolveCount({ fixed: 5 }, { state, actor: 'player' });
            expect(result).toBe(5);
        });

        it('resolves equal_to_discarded type', () => {
            const result = resolveCount(
                { type: 'equal_to_discarded' },
                { state, actor: 'player', discardedCount: 3 }
            );
            expect(result).toBe(3);
        });

        it('resolves hand_size type', () => {
            const result = resolveCount(
                { type: 'hand_size' },
                { state, actor: 'player' }
            );
            expect(result).toBe(2); // 2 cards in player hand
        });

        it('resolves previous_hand_size type', () => {
            const result = resolveCount(
                { type: 'previous_hand_size' },
                { state, actor: 'player', previousHandSize: 5 }
            );
            expect(result).toBe(5);
        });

        it('resolves count_face_down type', () => {
            state.player.lanes[0] = [createCard('Fire', 2, false)];
            state.player.lanes[1] = [createCard('Water', 3, false)];
            state.opponent.lanes[0] = [createCard('Hate', 1, false)];

            const result = resolveCount(
                { type: 'count_face_down' },
                { state, actor: 'player' }
            );
            expect(result).toBe(3);
        });

        it('resolves equal_to_card_value with referencedCardValue', () => {
            const result = resolveCount(
                { type: 'equal_to_card_value' },
                { state, actor: 'player', referencedCardValue: 4 }
            );
            expect(result).toBe(4);
        });
    });

    describe('countFaceUpCards', () => {
        it('counts all face-up cards', () => {
            state.player.lanes[0] = [createCard('Fire', 2, true)];
            state.player.lanes[1] = [createCard('Water', 3, false)];
            state.opponent.lanes[0] = [createCard('Hate', 1, true)];

            expect(countFaceUpCards(state)).toBe(2);
        });

        it('counts face-up cards in specific lane', () => {
            state.player.lanes[0] = [createCard('Fire', 2, true)];
            state.player.lanes[1] = [createCard('Water', 3, true)];

            expect(countFaceUpCards(state, 0)).toBe(1);
        });
    });

    describe('countCardsForOwner', () => {
        it('counts all cards for owner', () => {
            state.player.lanes[0] = [createCard('Fire', 2)];
            state.player.lanes[1] = [createCard('Water', 3)];
            state.opponent.lanes[0] = [createCard('Hate', 1)];

            expect(countCardsForOwner(state, 'player')).toBe(2);
        });

        it('counts face-up cards for owner', () => {
            state.player.lanes[0] = [createCard('Fire', 2, true)];
            state.player.lanes[1] = [createCard('Water', 3, false)];

            expect(countCardsForOwner(state, 'player', { faceState: 'face_up' })).toBe(1);
        });

        it('counts uncovered cards for owner', () => {
            const covered = createCard('Fire', 2);
            const uncovered = createCard('Water', 3);
            state.player.lanes[0] = [covered, uncovered];

            expect(countCardsForOwner(state, 'player', { position: 'uncovered' })).toBe(1);
        });

        it('counts covered cards for owner', () => {
            const covered = createCard('Fire', 2);
            const uncovered = createCard('Water', 3);
            state.player.lanes[0] = [covered, uncovered];

            expect(countCardsForOwner(state, 'player', { position: 'covered' })).toBe(1);
        });
    });

    describe('calculateLaneValue', () => {
        it('calculates total value of face-up cards', () => {
            state.player.lanes[0] = [
                createCard('Fire', 3, true),
                createCard('Water', 2, true)
            ];

            expect(calculateLaneValue(state, 'player', 0)).toBe(5);
        });

        it('uses value 2 for face-down cards', () => {
            state.player.lanes[0] = [
                createCard('Fire', 5, false),
                createCard('Water', 3, true)
            ];

            expect(calculateLaneValue(state, 'player', 0)).toBe(5); // 2 + 3
        });

        it('returns 0 for empty lane', () => {
            expect(calculateLaneValue(state, 'player', 0)).toBe(0);
        });
    });

    describe('validateCount', () => {
        it('returns the count when positive', () => {
            expect(validateCount(5)).toBe(5);
        });

        it('returns 0 for undefined', () => {
            expect(validateCount(undefined)).toBe(0);
        });

        it('returns 0 for negative values', () => {
            expect(validateCount(-3)).toBe(0);
        });

        it('returns 0 for zero', () => {
            expect(validateCount(0)).toBe(0);
        });
    });
});
