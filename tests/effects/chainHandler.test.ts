/**
 * Chain Handler Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Player, PlayedCard, EffectContext } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import {
    queuePendingEffects,
    getPendingEffects,
    hasPendingEffects,
    processConditional,
    flattenEffectChain,
    hasConditional,
    getConditionalType,
    storeTargetCardId,
    clearTargetCardId
} from '../../logic/effects/utils/chainHandler';

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

// Helper to create a context
function createContext(): EffectContext {
    return {
        cardOwner: 'player',
        actor: 'player',
        currentTurn: 'player',
        opponent: 'opponent',
        triggerType: 'start'
    };
}

describe('Chain Handler', () => {
    let state: GameState;
    let context: EffectContext;

    beforeEach(() => {
        state = createTestState();
        context = createContext();
    });

    describe('queuePendingEffects / getPendingEffects', () => {
        it('queues effects and retrieves them correctly', () => {
            const effects = [
                { id: 'effect1', params: { action: 'draw' } },
                { id: 'effect2', params: { action: 'flip' } }
            ] as any;

            const stateWithPending = queuePendingEffects(state, 'card-1', 0, effects, context);

            expect(hasPendingEffects(stateWithPending)).toBe(true);

            const { pending, newState } = getPendingEffects(stateWithPending);

            expect(pending).not.toBeNull();
            expect(pending?.effects).toHaveLength(2);
            expect(pending?.sourceCardId).toBe('card-1');
            expect(pending?.laneIndex).toBe(0);
            expect(pending?.context.cardOwner).toBe('player');
            expect(hasPendingEffects(newState)).toBe(false);
        });

        it('returns null when no pending effects', () => {
            const { pending, newState } = getPendingEffects(state);

            expect(pending).toBeNull();
            expect(newState).toEqual(state);
        });

        it('does not queue empty effects array', () => {
            const stateWithPending = queuePendingEffects(state, 'card-1', 0, [], context);

            expect(hasPendingEffects(stateWithPending)).toBe(false);
        });
    });

    describe('processConditional', () => {
        it('returns thenEffect for if_executed when effect was executed', () => {
            const thenEffect = { id: 'then', params: { action: 'draw' } };
            const effect = {
                id: 'main',
                params: { action: 'flip' },
                conditional: {
                    type: 'if_executed',
                    thenEffect
                }
            } as any;

            const result = processConditional(effect, true);

            expect(result).toEqual(thenEffect);
        });

        it('returns null for if_executed when effect was NOT executed', () => {
            const thenEffect = { id: 'then', params: { action: 'draw' } };
            const effect = {
                id: 'main',
                params: { action: 'flip' },
                conditional: {
                    type: 'if_executed',
                    thenEffect
                }
            } as any;

            const result = processConditional(effect, false);

            expect(result).toBeNull();
        });

        it('returns thenEffect for "then" regardless of execution', () => {
            const thenEffect = { id: 'then', params: { action: 'delete' } };
            const effect = {
                id: 'main',
                params: { action: 'flip' },
                conditional: {
                    type: 'then',
                    thenEffect
                }
            } as any;

            // Should return thenEffect even if main effect was not executed
            expect(processConditional(effect, false)).toEqual(thenEffect);
            expect(processConditional(effect, true)).toEqual(thenEffect);
        });

        it('returns null when no conditional', () => {
            const effect = {
                id: 'main',
                params: { action: 'flip' }
            } as any;

            const result = processConditional(effect, true);

            expect(result).toBeNull();
        });
    });

    describe('flattenEffectChain', () => {
        it('flattens a chain of effects', () => {
            const effect3 = { id: 'effect3', params: { action: 'draw' } };
            const effect2 = {
                id: 'effect2',
                params: { action: 'flip' },
                conditional: { type: 'then', thenEffect: effect3 }
            };
            const effect1 = {
                id: 'effect1',
                params: { action: 'delete' },
                conditional: { type: 'if_executed', thenEffect: effect2 }
            } as any;

            const flattened = flattenEffectChain(effect1);

            expect(flattened).toHaveLength(3);
            expect(flattened[0].id).toBe('effect1');
            expect(flattened[1].id).toBe('effect2');
            expect(flattened[2].id).toBe('effect3');
        });

        it('returns single effect when no chain', () => {
            const effect = { id: 'single', params: { action: 'draw' } } as any;

            const flattened = flattenEffectChain(effect);

            expect(flattened).toHaveLength(1);
            expect(flattened[0].id).toBe('single');
        });
    });

    describe('hasConditional / getConditionalType', () => {
        it('returns true when effect has conditional with thenEffect', () => {
            const effect = {
                params: { action: 'flip' },
                conditional: {
                    type: 'if_executed',
                    thenEffect: { params: { action: 'draw' } }
                }
            } as any;

            expect(hasConditional(effect)).toBe(true);
            expect(getConditionalType(effect)).toBe('if_executed');
        });

        it('returns false when effect has no conditional', () => {
            const effect = { params: { action: 'flip' } } as any;

            expect(hasConditional(effect)).toBe(false);
            expect(getConditionalType(effect)).toBeNull();
        });

        it('returns false when conditional has no thenEffect', () => {
            const effect = {
                params: { action: 'flip' },
                conditional: { type: 'if_executed' }
            } as any;

            expect(hasConditional(effect)).toBe(false);
        });
    });

    describe('storeTargetCardId / clearTargetCardId', () => {
        it('stores and retrieves target card ID', () => {
            const cardId = 'target-card-123';
            const stateWithTarget = storeTargetCardId(state, cardId);

            expect(stateWithTarget.lastCustomEffectTargetCardId).toBe(cardId);
        });

        it('clears target card ID', () => {
            const cardId = 'target-card-123';
            const stateWithTarget = storeTargetCardId(state, cardId);
            const clearedState = clearTargetCardId(stateWithTarget);

            expect(clearedState.lastCustomEffectTargetCardId).toBeUndefined();
        });
    });
});
