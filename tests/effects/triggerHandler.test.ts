/**
 * Trigger Handler Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Player, PlayedCard } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import {
    TriggerType,
    EffectPosition,
    TriggerableEffect,
    getEffectsForTrigger,
    findCardsWithTrigger,
    cardHasTrigger,
    isReactiveTrigger,
    isPassiveTrigger,
    createTriggerContext,
    sortTriggerableEffects
} from '../../logic/effects/triggers/triggerHandler';

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

// Helper to create a card with custom effects
function createCardWithEffects(
    protocol: string,
    value: number,
    effects: {
        topEffects?: any[];
        middleEffects?: any[];
        bottomEffects?: any[];
    },
    isFaceUp: boolean = true
): PlayedCard {
    const card = createCard(protocol, value, isFaceUp);
    (card as any).customEffects = effects;
    return card;
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

describe('Trigger Handler', () => {
    let state: GameState;

    beforeEach(() => {
        state = createTestState();
    });

    describe('getEffectsForTrigger', () => {
        it('returns empty array for card without custom effects', () => {
            const card = createCard('Fire', 1);
            const effects = getEffectsForTrigger(card, 'on_play');
            expect(effects).toEqual([]);
        });

        it('returns matching effects from all positions', () => {
            const card = createCardWithEffects('Fire', 1, {
                topEffects: [{ trigger: 'passive', params: { action: 'value_modifier' } }],
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }],
                bottomEffects: [{ trigger: 'start', params: { action: 'draw' } }]
            });

            const onPlayEffects = getEffectsForTrigger(card, 'on_play');
            expect(onPlayEffects).toHaveLength(1);
            expect(onPlayEffects[0].params.action).toBe('flip');

            const startEffects = getEffectsForTrigger(card, 'start');
            expect(startEffects).toHaveLength(1);
            expect(startEffects[0].params.action).toBe('draw');

            const passiveEffects = getEffectsForTrigger(card, 'passive');
            expect(passiveEffects).toHaveLength(1);
            expect(passiveEffects[0].params.action).toBe('value_modifier');
        });

        it('filters by position when specified', () => {
            const card = createCardWithEffects('Fire', 1, {
                topEffects: [{ trigger: 'on_play', params: { action: 'draw' } }],
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }],
                bottomEffects: [{ trigger: 'on_play', params: { action: 'delete' } }]
            });

            const middleOnly = getEffectsForTrigger(card, 'on_play', 'middle');
            expect(middleOnly).toHaveLength(1);
            expect(middleOnly[0].params.action).toBe('flip');
        });

        it('defaults to on_play when trigger is undefined', () => {
            const card = createCardWithEffects('Fire', 1, {
                middleEffects: [{ params: { action: 'flip' } }] // no trigger specified
            });

            const effects = getEffectsForTrigger(card, 'on_play');
            expect(effects).toHaveLength(1);
        });

        it('matches on_cover_or_flip for both on_cover and on_flip', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{ trigger: 'on_cover_or_flip', params: { action: 'draw' } }]
            });

            const onCoverEffects = getEffectsForTrigger(card, 'on_cover');
            expect(onCoverEffects).toHaveLength(1);

            const onFlipEffects = getEffectsForTrigger(card, 'on_flip');
            expect(onFlipEffects).toHaveLength(1);
        });
    });

    describe('findCardsWithTrigger', () => {
        it('finds all cards with matching trigger across all lanes', () => {
            const card1 = createCardWithEffects('Fire', 1, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }]
            });
            const card2 = createCardWithEffects('Water', 2, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'draw' } }]
            });

            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            const triggers = findCardsWithTrigger(state, 'on_play');
            expect(triggers).toHaveLength(2);
        });

        it('filters by player when specified', () => {
            const playerCard = createCardWithEffects('Fire', 1, {
                bottomEffects: [{ trigger: 'start', params: { action: 'draw' } }]
            });
            const opponentCard = createCardWithEffects('Hate', 1, {
                bottomEffects: [{ trigger: 'start', params: { action: 'flip' } }]
            });

            state.player.lanes[0] = [playerCard];
            state.opponent.lanes[0] = [opponentCard];

            const playerOnly = findCardsWithTrigger(state, 'start', { player: 'player' });
            expect(playerOnly).toHaveLength(1);
            expect(playerOnly[0].owner).toBe('player');
        });

        it('filters by specific card ID', () => {
            const card1 = createCardWithEffects('Fire', 1, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }]
            });
            const card2 = createCardWithEffects('Water', 2, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'draw' } }]
            });

            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            const specific = findCardsWithTrigger(state, 'on_play', { specificCardId: card1.id });
            expect(specific).toHaveLength(1);
            expect(specific[0].card.id).toBe(card1.id);
        });

        it('filters by uncovered when required', () => {
            const topCard = createCardWithEffects('Fire', 1, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }]
            });
            const coveredCard = createCardWithEffects('Water', 2, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'draw' } }]
            });

            state.player.lanes[0] = [coveredCard, topCard]; // coveredCard is covered

            const uncoveredOnly = findCardsWithTrigger(state, 'on_play', { requireUncovered: true });
            expect(uncoveredOnly).toHaveLength(1);
            expect(uncoveredOnly[0].card.id).toBe(topCard.id);
        });

        it('excludes face-down cards by default', () => {
            const faceUpCard = createCardWithEffects('Fire', 1, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }]
            }, true);
            const faceDownCard = createCardWithEffects('Water', 2, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'draw' } }]
            }, false);

            state.player.lanes[0] = [faceUpCard];
            state.player.lanes[1] = [faceDownCard];

            const faceUpOnly = findCardsWithTrigger(state, 'on_play');
            expect(faceUpOnly).toHaveLength(1);
            expect(faceUpOnly[0].card.isFaceUp).toBe(true);
        });

        it('includes face-down cards when requireFaceUp is false', () => {
            const faceDownCard = createCardWithEffects('Water', 2, {
                topEffects: [{ trigger: 'passive', params: { action: 'value_modifier' } }]
            }, false);

            state.player.lanes[0] = [faceDownCard];

            const withFaceDown = findCardsWithTrigger(state, 'passive', { requireFaceUp: false });
            expect(withFaceDown).toHaveLength(1);
        });

        it('correctly identifies effect positions', () => {
            const card = createCardWithEffects('Fire', 1, {
                topEffects: [{ trigger: 'after_draw', params: { action: 'flip' } }],
                middleEffects: [{ trigger: 'on_play', params: { action: 'delete' } }],
                bottomEffects: [{ trigger: 'start', params: { action: 'draw' } }]
            });

            state.player.lanes[0] = [card];

            const topEffects = findCardsWithTrigger(state, 'after_draw');
            expect(topEffects[0].position).toBe('top');

            const middleEffects = findCardsWithTrigger(state, 'on_play');
            expect(middleEffects[0].position).toBe('middle');

            const bottomEffects = findCardsWithTrigger(state, 'start');
            expect(bottomEffects[0].position).toBe('bottom');
        });
    });

    describe('cardHasTrigger', () => {
        it('returns true when card has matching trigger', () => {
            const card = createCardWithEffects('Fire', 1, {
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }]
            });

            expect(cardHasTrigger(card, 'on_play')).toBe(true);
            expect(cardHasTrigger(card, 'start')).toBe(false);
        });

        it('filters by position when specified', () => {
            const card = createCardWithEffects('Fire', 1, {
                topEffects: [{ trigger: 'on_play', params: { action: 'draw' } }],
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }]
            });

            expect(cardHasTrigger(card, 'on_play', { position: 'top' })).toBe(true);
            expect(cardHasTrigger(card, 'on_play', { position: 'bottom' })).toBe(false);
        });
    });

    describe('isReactiveTrigger', () => {
        it('returns true for reactive triggers', () => {
            expect(isReactiveTrigger('after_draw')).toBe(true);
            expect(isReactiveTrigger('after_delete')).toBe(true);
            expect(isReactiveTrigger('after_flip')).toBe(true);
            expect(isReactiveTrigger('after_clear_cache')).toBe(true);
            expect(isReactiveTrigger('before_compile_delete')).toBe(true);
            expect(isReactiveTrigger('after_opponent_discard')).toBe(true);
        });

        it('returns false for non-reactive triggers', () => {
            expect(isReactiveTrigger('on_play')).toBe(false);
            expect(isReactiveTrigger('start')).toBe(false);
            expect(isReactiveTrigger('end')).toBe(false);
            expect(isReactiveTrigger('passive')).toBe(false);
        });
    });

    describe('isPassiveTrigger', () => {
        it('returns true only for passive trigger', () => {
            expect(isPassiveTrigger('passive')).toBe(true);
            expect(isPassiveTrigger('on_play')).toBe(false);
            expect(isPassiveTrigger('start')).toBe(false);
        });
    });

    describe('createTriggerContext', () => {
        it('creates correct context for player', () => {
            const context = createTriggerContext(state, 'player', 'on_play');

            expect(context.cardOwner).toBe('player');
            expect(context.actor).toBe('player');
            expect(context.opponent).toBe('opponent');
            expect(context.currentTurn).toBe('player');
            expect(context.triggerType).toBe('play');
        });

        it('creates correct context for opponent', () => {
            const context = createTriggerContext(state, 'opponent', 'start');

            expect(context.cardOwner).toBe('opponent');
            expect(context.actor).toBe('opponent');
            expect(context.opponent).toBe('player');
            expect(context.triggerType).toBe('start');
        });

        it('maps trigger types correctly', () => {
            expect(createTriggerContext(state, 'player', 'on_play').triggerType).toBe('play');
            expect(createTriggerContext(state, 'player', 'on_flip').triggerType).toBe('flip');
            expect(createTriggerContext(state, 'player', 'on_cover').triggerType).toBe('cover');
            expect(createTriggerContext(state, 'player', 'start').triggerType).toBe('start');
            expect(createTriggerContext(state, 'player', 'end').triggerType).toBe('end');
            expect(createTriggerContext(state, 'player', 'after_draw').triggerType).toBe('middle');
        });
    });

    describe('sortTriggerableEffects', () => {
        it('sorts own effects before opponent effects', () => {
            const ownCard = createCardWithEffects('Fire', 1, {
                bottomEffects: [{ trigger: 'start', params: { action: 'draw' } }]
            });
            const opponentCard = createCardWithEffects('Hate', 1, {
                bottomEffects: [{ trigger: 'start', params: { action: 'flip' } }]
            });

            state.player.lanes[0] = [ownCard];
            state.opponent.lanes[0] = [opponentCard];

            const effects = findCardsWithTrigger(state, 'start');
            const sorted = sortTriggerableEffects(effects, 'player');

            expect(sorted[0].owner).toBe('player');
            expect(sorted[1].owner).toBe('opponent');
        });

        it('sorts by lane index within same owner', () => {
            const card0 = createCardWithEffects('Fire', 1, {
                bottomEffects: [{ trigger: 'start', params: { action: 'draw' } }]
            });
            const card2 = createCardWithEffects('Water', 2, {
                bottomEffects: [{ trigger: 'start', params: { action: 'flip' } }]
            });

            state.player.lanes[0] = [card0];
            state.player.lanes[2] = [card2];

            const effects = findCardsWithTrigger(state, 'start');
            const sorted = sortTriggerableEffects(effects, 'player');

            expect(sorted[0].laneIndex).toBe(0);
            expect(sorted[1].laneIndex).toBe(2);
        });

        it('sorts by position within same lane (top before middle before bottom)', () => {
            const card = createCardWithEffects('Fire', 1, {
                topEffects: [{ trigger: 'on_play', params: { action: 'value_modifier' } }],
                middleEffects: [{ trigger: 'on_play', params: { action: 'flip' } }],
                bottomEffects: [{ trigger: 'on_play', params: { action: 'draw' } }]
            });

            state.player.lanes[0] = [card];

            const effects = findCardsWithTrigger(state, 'on_play');
            const sorted = sortTriggerableEffects(effects, 'player');

            expect(sorted[0].position).toBe('top');
            expect(sorted[1].position).toBe('middle');
            expect(sorted[2].position).toBe('bottom');
        });
    });
});
