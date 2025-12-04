/**
 * Target Resolver Tests
 *
 * Tests für die zentrale Target-Auflösungslogik
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Player, PlayedCard } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import {
    findCardOnBoard,
    isCardUncovered,
    findValidTargets,
    hasValidTargets,
    findTargetByCalculation,
    countValidTargets,
    groupTargetsByLane,
    groupTargetsByOwner
} from '../../logic/effects/utils/targetResolver';

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
            hand: [],
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

describe('Target Resolver', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('findCardOnBoard', () => {
        it('finds a card in player lane', () => {
            const card = createCard('Fire', 3);
            state.player.lanes[0] = [card];

            const result = findCardOnBoard(state, card.id);

            expect(result).not.toBeNull();
            expect(result?.card.id).toBe(card.id);
            expect(result?.owner).toBe('player');
            expect(result?.laneIndex).toBe(0);
            expect(result?.isUncovered).toBe(true);
        });

        it('finds a card in opponent lane', () => {
            const card = createCard('Hate', 2);
            state.opponent.lanes[1] = [card];

            const result = findCardOnBoard(state, card.id);

            expect(result).not.toBeNull();
            expect(result?.owner).toBe('opponent');
            expect(result?.laneIndex).toBe(1);
        });

        it('returns null for non-existent card', () => {
            const result = findCardOnBoard(state, 'non-existent-id');
            expect(result).toBeNull();
        });

        it('identifies covered cards correctly', () => {
            const coveredCard = createCard('Fire', 2);
            const uncoveredCard = createCard('Water', 3);
            state.player.lanes[0] = [coveredCard, uncoveredCard];

            const coveredResult = findCardOnBoard(state, coveredCard.id);
            const uncoveredResult = findCardOnBoard(state, uncoveredCard.id);

            expect(coveredResult?.isUncovered).toBe(false);
            expect(uncoveredResult?.isUncovered).toBe(true);
        });
    });

    describe('isCardUncovered', () => {
        it('returns true for uncovered card', () => {
            const card = createCard('Fire', 3);
            state.player.lanes[0] = [card];

            expect(isCardUncovered(state, card.id)).toBe(true);
        });

        it('returns false for covered card', () => {
            const coveredCard = createCard('Fire', 2);
            const topCard = createCard('Water', 3);
            state.player.lanes[0] = [coveredCard, topCard];

            expect(isCardUncovered(state, coveredCard.id)).toBe(false);
        });

        it('returns false for non-existent card', () => {
            expect(isCardUncovered(state, 'non-existent')).toBe(false);
        });
    });

    describe('findValidTargets', () => {
        it('finds all uncovered cards by default', () => {
            const card1 = createCard('Fire', 3);
            const card2 = createCard('Water', 2);
            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            const targets = findValidTargets({
                state,
                filter: {},
                actor: 'opponent'
            });

            expect(targets.length).toBe(2);
        });

        it('filters by owner=own correctly', () => {
            const ownCard = createCard('Fire', 3);
            const opponentCard = createCard('Hate', 2);
            state.player.lanes[0] = [ownCard];
            state.opponent.lanes[0] = [opponentCard];

            const targets = findValidTargets({
                state,
                filter: { owner: 'own' },
                actor: 'player'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.id).toBe(ownCard.id);
        });

        it('filters by owner=opponent correctly', () => {
            const ownCard = createCard('Fire', 3);
            const opponentCard = createCard('Hate', 2);
            state.player.lanes[0] = [ownCard];
            state.opponent.lanes[0] = [opponentCard];

            const targets = findValidTargets({
                state,
                filter: { owner: 'opponent' },
                actor: 'player'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.id).toBe(opponentCard.id);
        });

        it('filters by faceState=face_up correctly', () => {
            const faceUpCard = createCard('Fire', 3, true);
            const faceDownCard = createCard('Water', 2, false);
            state.player.lanes[0] = [faceUpCard];
            state.player.lanes[1] = [faceDownCard];

            const targets = findValidTargets({
                state,
                filter: { faceState: 'face_up' },
                actor: 'opponent'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.isFaceUp).toBe(true);
        });

        it('filters by faceState=face_down correctly', () => {
            const faceUpCard = createCard('Fire', 3, true);
            const faceDownCard = createCard('Water', 2, false);
            state.player.lanes[0] = [faceUpCard];
            state.player.lanes[1] = [faceDownCard];

            const targets = findValidTargets({
                state,
                filter: { faceState: 'face_down' },
                actor: 'opponent'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.isFaceUp).toBe(false);
        });

        it('filters by position=covered correctly', () => {
            const coveredCard = createCard('Fire', 2);
            const uncoveredCard = createCard('Water', 3);
            state.player.lanes[0] = [coveredCard, uncoveredCard];

            const targets = findValidTargets({
                state,
                filter: { position: 'covered' },
                actor: 'opponent'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.id).toBe(coveredCard.id);
        });

        it('excludes self when excludeSelf=true', () => {
            const sourceCard = createCard('Fire', 3);
            const otherCard = createCard('Water', 2);
            state.player.lanes[0] = [sourceCard];
            state.player.lanes[1] = [otherCard];

            const targets = findValidTargets({
                state,
                filter: { excludeSelf: true },
                sourceCardId: sourceCard.id,
                actor: 'opponent'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.id).toBe(otherCard.id);
        });

        it('filters by valueRange correctly', () => {
            const lowCard = createCard('Fire', 1);
            const midCard = createCard('Water', 3);
            const highCard = createCard('Death', 5);
            state.player.lanes[0] = [lowCard];
            state.player.lanes[1] = [midCard];
            state.player.lanes[2] = [highCard];

            const targets = findValidTargets({
                state,
                filter: { valueRange: { min: 2, max: 4 } },
                actor: 'opponent'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.value).toBe(3);
        });

        it('respects scope restriction', () => {
            const card1 = createCard('Fire', 3);
            const card2 = createCard('Water', 2);
            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            const targets = findValidTargets({
                state,
                filter: {},
                actor: 'opponent',
                scopeLaneIndex: 0
            });

            expect(targets.length).toBe(1);
            expect(targets[0].laneIndex).toBe(0);
        });
    });

    describe('hasValidTargets', () => {
        it('returns true when targets exist', () => {
            state.player.lanes[0] = [createCard('Fire', 3)];

            expect(hasValidTargets({
                state,
                filter: {},
                actor: 'opponent'
            })).toBe(true);
        });

        it('returns false when no targets exist', () => {
            expect(hasValidTargets({
                state,
                filter: {},
                actor: 'opponent'
            })).toBe(false);
        });

        it('returns false when filter excludes all cards', () => {
            state.player.lanes[0] = [createCard('Fire', 3, true)];

            expect(hasValidTargets({
                state,
                filter: { faceState: 'face_down' },
                actor: 'opponent'
            })).toBe(false);
        });
    });

    describe('findTargetByCalculation', () => {
        it('finds highest value target', () => {
            const lowCard = createCard('Fire', 1);
            const highCard = createCard('Water', 5);
            state.player.lanes[0] = [lowCard];
            state.player.lanes[1] = [highCard];

            const result = findTargetByCalculation(
                { state, filter: {}, actor: 'opponent' },
                'highest_value'
            );

            expect(result?.card.value).toBe(5);
        });

        it('finds lowest value target', () => {
            const lowCard = createCard('Fire', 1);
            const highCard = createCard('Water', 5);
            state.player.lanes[0] = [lowCard];
            state.player.lanes[1] = [highCard];

            const result = findTargetByCalculation(
                { state, filter: {}, actor: 'opponent' },
                'lowest_value'
            );

            expect(result?.card.value).toBe(1);
        });

        it('returns null when no targets exist', () => {
            const result = findTargetByCalculation(
                { state, filter: {}, actor: 'opponent' },
                'highest_value'
            );

            expect(result).toBeNull();
        });
    });

    describe('countValidTargets', () => {
        it('counts all valid targets', () => {
            state.player.lanes[0] = [createCard('Fire', 3)];
            state.player.lanes[1] = [createCard('Water', 2)];
            state.opponent.lanes[0] = [createCard('Hate', 1)];

            const count = countValidTargets({
                state,
                filter: {},
                actor: 'player'
            });

            expect(count).toBe(3);
        });
    });

    describe('groupTargetsByLane', () => {
        it('groups targets by lane index', () => {
            const card1 = createCard('Fire', 3);
            const card2 = createCard('Water', 2);
            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            const targets = findValidTargets({
                state,
                filter: {},
                actor: 'opponent'
            });

            const grouped = groupTargetsByLane(targets);

            expect(grouped.get(0)?.length).toBe(1);
            expect(grouped.get(1)?.length).toBe(1);
        });
    });

    describe('groupTargetsByOwner', () => {
        it('groups targets by owner', () => {
            state.player.lanes[0] = [createCard('Fire', 3)];
            state.opponent.lanes[0] = [createCard('Hate', 2)];

            const targets = findValidTargets({
                state,
                filter: {},
                actor: 'player'
            });

            const grouped = groupTargetsByOwner(targets);

            expect(grouped.get('player')?.length).toBe(1);
            expect(grouped.get('opponent')?.length).toBe(1);
        });
    });
});
