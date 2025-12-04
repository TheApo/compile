/**
 * Trigger Processor Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameState, Player, PlayedCard } from '../../types';
import { v4 as uuidv4 } from 'uuid';

// Mock the effectInterpreter module
vi.mock('../../logic/customProtocols/effectInterpreter', () => ({
    executeCustomEffect: vi.fn((card, laneIndex, state, context, effect) => {
        // Default mock implementation - returns state unchanged with effect result
        return {
            newState: state,
            message: 'Effect executed'
        };
    })
}));

import {
    processTrigger,
    processStartPhaseEffects,
    processEndPhaseEffects,
    processOnPlayEffects,
    processOnFlipEffects,
    processOnCoverEffects
} from '../../logic/effects/triggers/triggerProcessor';
import { executeCustomEffect } from '../../logic/customProtocols/effectInterpreter';

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
            hand: [createCard('Fire', 1), createCard('Water', 2)],
            deck: [createCard('Death', 3), createCard('Fire', 4)],
            discard: [],
            compiled: [false, false, false],
            laneValues: [0, 0, 0],
        },
        opponent: {
            protocols: ['Hate', 'Apathy', 'Metal'],
            lanes: [[], [], []],
            hand: [],
            deck: [createCard('Hate', 1)],
            discard: [],
            compiled: [false, false, false],
            laneValues: [0, 0, 0],
        },
        turn: 'player' as Player,
        phase: 'action',
        gameLog: [],
        logIndent: 0,
    };
    return state as GameState;
}

describe('Trigger Processor', () => {
    let state: GameState;
    const mockedExecuteCustomEffect = vi.mocked(executeCustomEffect);

    beforeEach(() => {
        state = createTestState();
        vi.clearAllMocks();
        // Reset mock to default implementation
        mockedExecuteCustomEffect.mockImplementation((card, laneIndex, state, context, effect) => ({
            newState: state,
            message: 'Effect executed'
        }));
    });

    describe('processTrigger', () => {
        it('returns unchanged state when no triggerable effects exist', () => {
            const card = createCard('Fire', 1);
            state.player.lanes[0] = [card];

            const result = processTrigger(state, 'start');

            expect(result.effectExecuted).toBe(false);
            expect(result.processedCardIds).toEqual([]);
            expect(mockedExecuteCustomEffect).not.toHaveBeenCalled();
        });

        it('processes effects for cards with matching trigger', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processTrigger(state, 'start');

            expect(result.effectExecuted).toBe(true);
            expect(result.processedCardIds).toContain(card.id);
            expect(mockedExecuteCustomEffect).toHaveBeenCalledTimes(1);
        });

        it('skips already processed cards', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            // First process
            const result1 = processTrigger(state, 'start');
            expect(result1.processedCardIds).toContain(card.id);
            expect(mockedExecuteCustomEffect).toHaveBeenCalledTimes(1);

            // Second process with same processed IDs - should skip
            vi.clearAllMocks();
            const result2 = processTrigger(result1.newState, 'start', {
                processedIds: result1.processedCardIds
            });
            expect(result2.effectExecuted).toBe(false);
            expect(mockedExecuteCustomEffect).not.toHaveBeenCalled();
        });

        it('processes specific card when specified', () => {
            const card1 = createCardWithEffects('Fire', 1, {
                middleEffects: [{
                    trigger: 'on_play',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            const card2 = createCardWithEffects('Water', 2, {
                middleEffects: [{
                    trigger: 'on_play',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            const result = processTrigger(state, 'on_play', {
                specificCard: card1,
                laneIndex: 0
            });

            expect(result.processedCardIds).toContain(card1.id);
            expect(result.processedCardIds).not.toContain(card2.id);
            expect(mockedExecuteCustomEffect).toHaveBeenCalledTimes(1);
        });

        it('skips face-down cards', () => {
            const faceDownCard = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            }, false);
            state.player.lanes[0] = [faceDownCard];

            const result = processTrigger(state, 'start');

            expect(result.effectExecuted).toBe(false);
            expect(mockedExecuteCustomEffect).not.toHaveBeenCalled();
        });

        it('skips covered cards for middle effects', () => {
            const coveredCard = createCardWithEffects('Fire', 1, {
                middleEffects: [{
                    trigger: 'on_play',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            const topCard = createCard('Water', 2);
            state.player.lanes[0] = [coveredCard, topCard]; // coveredCard is covered

            const result = processTrigger(state, 'on_play');

            // Middle effects require uncovered
            expect(result.processedCardIds).not.toContain(coveredCard.id);
            expect(mockedExecuteCustomEffect).not.toHaveBeenCalled();
        });

        it('processes covered cards for top (passive/reactive) effects', () => {
            const coveredCard = createCardWithEffects('Fire', 1, {
                topEffects: [{
                    trigger: 'after_draw',
                    params: { action: 'flip', flipSelf: true }
                }]
            });
            const topCard = createCard('Water', 2);
            state.player.lanes[0] = [coveredCard, topCard];

            const result = processTrigger(state, 'after_draw');

            // Top effects work even when covered
            expect(result.processedCardIds).toContain(coveredCard.id);
            expect(mockedExecuteCustomEffect).toHaveBeenCalledTimes(1);
        });

        it('stops processing when actionRequired is set', () => {
            const card1 = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'flip' }
                }]
            });
            const card2 = createCardWithEffects('Water', 2, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'draw' }
                }]
            });
            state.player.lanes[0] = [card1];
            state.player.lanes[1] = [card2];

            // Mock to set actionRequired after first effect
            mockedExecuteCustomEffect.mockImplementationOnce((card, laneIndex, state, context, effect) => ({
                newState: { ...state, actionRequired: { type: 'flip', message: 'Choose card' } },
                message: 'Effect executed'
            }));

            const result = processTrigger(state, 'start');

            // Should stop after first card
            expect(mockedExecuteCustomEffect).toHaveBeenCalledTimes(1);
            expect(result.newState.actionRequired).toBeDefined();
        });
    });

    describe('processStartPhaseEffects', () => {
        it('processes start triggers and stores processed IDs', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processStartPhaseEffects(state);

            expect(result.effectExecuted).toBe(true);
            expect(result.newState.processedStartEffectIds).toContain(card.id);
        });

        it('respects previously processed start effect IDs', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'start',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];
            state.processedStartEffectIds = [card.id];

            const result = processStartPhaseEffects(state);

            expect(result.effectExecuted).toBe(false);
            expect(mockedExecuteCustomEffect).not.toHaveBeenCalled();
        });
    });

    describe('processEndPhaseEffects', () => {
        it('processes end triggers and stores processed IDs', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'end',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processEndPhaseEffects(state);

            expect(result.effectExecuted).toBe(true);
            expect(result.newState.processedEndEffectIds).toContain(card.id);
        });

        it('respects previously processed end effect IDs', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'end',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];
            state.processedEndEffectIds = [card.id];

            const result = processEndPhaseEffects(state);

            expect(result.effectExecuted).toBe(false);
        });
    });

    describe('processOnPlayEffects', () => {
        it('processes on_play trigger for specific card', () => {
            const card = createCardWithEffects('Fire', 1, {
                middleEffects: [{
                    trigger: 'on_play',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processOnPlayEffects(state, card, 0, 'player');

            expect(result.effectExecuted).toBe(true);
            expect(result.processedCardIds).toContain(card.id);
        });

        it('sets correct context for card owner', () => {
            const card = createCardWithEffects('Fire', 1, {
                middleEffects: [{
                    trigger: 'on_play',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.opponent.lanes[0] = [card];

            const result = processOnPlayEffects(state, card, 0, 'opponent');

            expect(result.effectExecuted).toBe(true);
            // Check that the context was passed correctly
            expect(mockedExecuteCustomEffect).toHaveBeenCalled();
            const callArgs = mockedExecuteCustomEffect.mock.calls[0];
            expect(callArgs[3].cardOwner).toBe('opponent');
        });
    });

    describe('processOnFlipEffects', () => {
        it('processes on_flip trigger for specific card', () => {
            const card = createCardWithEffects('Fire', 1, {
                middleEffects: [{
                    trigger: 'on_flip',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processOnFlipEffects(state, card, 0, 'player');

            expect(result.effectExecuted).toBe(true);
        });

        it('processes on_cover_or_flip as on_flip', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'on_cover_or_flip',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processOnFlipEffects(state, card, 0, 'player');

            expect(result.effectExecuted).toBe(true);
        });
    });

    describe('processOnCoverEffects', () => {
        it('processes on_cover trigger for card being covered', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'on_cover',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processOnCoverEffects(state, card, 0, 'player');

            expect(result.effectExecuted).toBe(true);
        });

        it('processes on_cover_or_flip as on_cover', () => {
            const card = createCardWithEffects('Fire', 1, {
                bottomEffects: [{
                    trigger: 'on_cover_or_flip',
                    params: { action: 'draw', count: 1, targetPlayer: 'self' }
                }]
            });
            state.player.lanes[0] = [card];

            const result = processOnCoverEffects(state, card, 0, 'player');

            expect(result.effectExecuted).toBe(true);
        });
    });
});
