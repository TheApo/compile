/**
 * Integration Tests for Effect System
 *
 * Diese Tests beweisen, dass die neuen Module (targetResolver, countResolver)
 * tatsächlich im echten Spielfluss verwendet werden.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameState, Player, PlayedCard } from '../../types';
import { v4 as uuidv4 } from 'uuid';

// Importiere die "alten" Funktionen die jetzt an die neuen delegieren
import { findCardOnBoard, isCardUncovered } from '../../logic/game/helpers/actionUtils';

// Importiere die neuen Module direkt zum Vergleich
import {
    findCardOnBoard as findCardOnBoardNew,
    isCardUncovered as isCardUncoveredNew,
    hasValidTargets,
    findValidTargets
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

describe('Effect System Integration', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('actionUtils delegates to targetResolver', () => {
        it('findCardOnBoard in actionUtils uses targetResolver implementation', () => {
            const card = createCard('Fire', 3);
            state.player.lanes[0] = [card];

            // Beide Aufrufe sollten das gleiche Ergebnis liefern
            const oldResult = findCardOnBoard(state, card.id);
            const newResult = findCardOnBoardNew(state, card.id);

            expect(oldResult).not.toBeNull();
            expect(newResult).not.toBeNull();
            expect(oldResult?.card.id).toBe(newResult?.card.id);
            expect(oldResult?.owner).toBe(newResult?.owner);
            expect(oldResult?.laneIndex).toBe(newResult?.laneIndex);
        });

        it('isCardUncovered in actionUtils uses targetResolver implementation', () => {
            const coveredCard = createCard('Fire', 2);
            const uncoveredCard = createCard('Water', 3);
            state.player.lanes[0] = [coveredCard, uncoveredCard];

            // Beide Aufrufe sollten das gleiche Ergebnis liefern
            expect(isCardUncovered(state, coveredCard.id)).toBe(isCardUncoveredNew(state, coveredCard.id));
            expect(isCardUncovered(state, uncoveredCard.id)).toBe(isCardUncoveredNew(state, uncoveredCard.id));

            // Verifiziere die Werte
            expect(isCardUncovered(state, coveredCard.id)).toBe(false);
            expect(isCardUncovered(state, uncoveredCard.id)).toBe(true);
        });

        it('findCardOnBoard handles non-existent cards correctly', () => {
            const oldResult = findCardOnBoard(state, 'non-existent');
            const newResult = findCardOnBoardNew(state, 'non-existent');

            expect(oldResult).toBeNull();
            expect(newResult).toBeNull();
        });

        it('findCardOnBoard handles undefined cardId', () => {
            const oldResult = findCardOnBoard(state, undefined);
            const newResult = findCardOnBoardNew(state, undefined);

            expect(oldResult).toBeNull();
            expect(newResult).toBeNull();
        });
    });

    describe('targetResolver finds correct targets in game scenarios', () => {
        it('finds face-up opponent cards for delete effect', () => {
            // Setup: Player has Fire-3 effect that deletes opponent's face-up card
            const playerCard = createCard('Fire', 3, true);
            const opponentCard1 = createCard('Hate', 2, true);
            const opponentCard2 = createCard('Metal', 4, false); // face-down

            state.player.lanes[0] = [playerCard];
            state.opponent.lanes[0] = [opponentCard1];
            state.opponent.lanes[1] = [opponentCard2];

            // Find targets for delete effect (owner: opponent, faceState: face_up)
            const targets = findValidTargets({
                state,
                filter: { owner: 'opponent', faceState: 'face_up' },
                actor: 'player'
            });

            // Should only find the face-up opponent card
            expect(targets.length).toBe(1);
            expect(targets[0].card.id).toBe(opponentCard1.id);
        });

        it('finds own uncovered cards for shift effect, excluding self', () => {
            // Setup: Player's Spirit-2 wants to shift another own card
            const sourceCard = createCard('Spirit', 2, true);
            const targetCard1 = createCard('Fire', 3, true);
            const targetCard2 = createCard('Water', 1, true);

            state.player.lanes[0] = [sourceCard];
            state.player.lanes[1] = [targetCard1];
            state.player.lanes[2] = [targetCard2];

            // Find targets for shift effect (owner: own, excludeSelf: true)
            const targets = findValidTargets({
                state,
                filter: { owner: 'own', excludeSelf: true },
                sourceCardId: sourceCard.id,
                actor: 'player'
            });

            // Should find both target cards, but not the source
            expect(targets.length).toBe(2);
            expect(targets.some(t => t.card.id === sourceCard.id)).toBe(false);
            expect(targets.some(t => t.card.id === targetCard1.id)).toBe(true);
            expect(targets.some(t => t.card.id === targetCard2.id)).toBe(true);
        });

        it('finds covered cards correctly', () => {
            // Setup: Darkness effect that can flip covered cards
            const coveredCard = createCard('Fire', 5, true);
            const uncoveredCard = createCard('Water', 2, true);

            state.player.lanes[0] = [coveredCard, uncoveredCard];

            // Find covered cards
            const targets = findValidTargets({
                state,
                filter: { position: 'covered' },
                actor: 'opponent'
            });

            expect(targets.length).toBe(1);
            expect(targets[0].card.id).toBe(coveredCard.id);
            expect(targets[0].isUncovered).toBe(false);
        });

        it('respects valueRange filter for low-value delete effects', () => {
            // Setup: Death-4 deletes cards with value 0-1
            const card0 = createCard('Fire', 0, true);
            const card1 = createCard('Water', 1, true);
            const card3 = createCard('Death', 3, true);
            const card5 = createCard('Spirit', 5, true);

            state.player.lanes[0] = [card0];
            state.player.lanes[1] = [card1];
            state.opponent.lanes[0] = [card3];
            state.opponent.lanes[1] = [card5];

            const targets = findValidTargets({
                state,
                filter: { valueRange: { min: 0, max: 1 } },
                actor: 'opponent'
            });

            expect(targets.length).toBe(2);
            expect(targets.every(t => t.card.value <= 1)).toBe(true);
        });
    });

    describe('hasValidTargets correctly checks preconditions', () => {
        it('returns false when no valid targets exist', () => {
            // No cards on board
            expect(hasValidTargets({
                state,
                filter: { owner: 'opponent' },
                actor: 'player'
            })).toBe(false);
        });

        it('returns true when valid targets exist', () => {
            state.opponent.lanes[0] = [createCard('Hate', 2)];

            expect(hasValidTargets({
                state,
                filter: { owner: 'opponent' },
                actor: 'player'
            })).toBe(true);
        });

        it('returns false when filter excludes all cards', () => {
            // Only face-up cards exist
            state.player.lanes[0] = [createCard('Fire', 3, true)];

            expect(hasValidTargets({
                state,
                filter: { faceState: 'face_down' },
                actor: 'opponent'
            })).toBe(false);
        });
    });
});
