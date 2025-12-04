/**
 * Precondition Checker Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Player, PlayedCard } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import {
    checkEffectPrecondition,
    shouldSkipOptionalEffect
} from '../../logic/effects/utils/preconditionChecker';

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
            deck: [createCard('Death', 3)],
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

describe('Precondition Checker', () => {
    let state: GameState;
    let sourceCard: PlayedCard;

    beforeEach(() => {
        state = createTestState();
        sourceCard = createCard('Fire', 3);
        state.player.lanes[0] = [sourceCard];
    });

    describe('checkEffectPrecondition', () => {
        describe('flip effects', () => {
            it('returns canExecute true when valid flip targets exist', () => {
                const targetCard = createCard('Water', 2, false); // face-down
                state.opponent.lanes[0] = [targetCard];

                const effect = {
                    params: {
                        action: 'flip',
                        targetFilter: { faceState: 'face_down' }
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
                expect(result.validTargetCount).toBe(1);
            });

            it('returns canExecute false when no valid flip targets', () => {
                // All cards are face-up
                state.opponent.lanes[0] = [createCard('Hate', 2, true)];

                const effect = {
                    params: {
                        action: 'flip',
                        targetFilter: { faceState: 'face_down' }
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(false);
                expect(result.skipReason).toContain('flip');
            });

            it('flipSelf always returns canExecute true', () => {
                const effect = {
                    params: {
                        action: 'flip',
                        flipSelf: true
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });
        });

        describe('delete effects', () => {
            it('returns canExecute true when valid delete targets exist', () => {
                state.opponent.lanes[0] = [createCard('Hate', 2)];

                const effect = {
                    params: {
                        action: 'delete',
                        targetFilter: { owner: 'opponent' }
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });

            it('returns canExecute false when no delete targets in other lanes (each_other_line)', () => {
                // No cards in lanes 1 and 2
                const effect = {
                    params: {
                        action: 'delete',
                        scope: 'each_other_line',
                        targetFilter: {}
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(false);
            });

            it('deleteSelf always returns canExecute true', () => {
                const effect = {
                    params: {
                        action: 'delete',
                        deleteSelf: true
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });
        });

        describe('shift effects', () => {
            it('returns canExecute true when valid shift targets exist', () => {
                state.player.lanes[1] = [createCard('Water', 2)];

                const effect = {
                    params: {
                        action: 'shift',
                        targetFilter: { owner: 'own' }
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });

            it('returns canExecute false when no shift targets', () => {
                const effect = {
                    params: {
                        action: 'shift',
                        targetFilter: { owner: 'opponent' }
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(false);
            });
        });

        describe('draw effects', () => {
            it('returns canExecute true when deck has cards', () => {
                const effect = {
                    params: {
                        action: 'draw',
                        count: 1
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });

            it('returns canExecute false when deck and discard empty', () => {
                state.player.deck = [];
                state.player.discard = [];

                const effect = {
                    params: {
                        action: 'draw',
                        count: 1
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(false);
            });
        });

        describe('discard effects', () => {
            it('returns canExecute true when hand has cards', () => {
                const effect = {
                    params: {
                        action: 'discard',
                        count: 1
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });

            it('returns canExecute false when hand is empty', () => {
                state.player.hand = [];

                const effect = {
                    params: {
                        action: 'discard',
                        count: 1
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(false);
            });
        });

        describe('take effects', () => {
            it('returns canExecute true when opponent has cards in hand', () => {
                state.opponent.hand = [createCard('Hate', 1)];

                const effect = {
                    params: {
                        action: 'take'
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(true);
            });

            it('returns canExecute false when opponent hand is empty', () => {
                state.opponent.hand = [];

                const effect = {
                    params: {
                        action: 'take'
                    }
                } as any;

                const result = checkEffectPrecondition(state, sourceCard, 0, 'player', effect);

                expect(result.canExecute).toBe(false);
            });
        });
    });

    describe('shouldSkipOptionalEffect', () => {
        it('returns false for non-optional effects', () => {
            const effect = {
                params: {
                    action: 'flip',
                    optional: false,
                    targetFilter: { faceState: 'face_down' }
                }
            } as any;

            const result = shouldSkipOptionalEffect(state, sourceCard, 0, 'player', effect);

            expect(result).toBe(false);
        });

        it('returns true for optional effects with no valid targets', () => {
            // No face-down cards
            const effect = {
                params: {
                    action: 'flip',
                    optional: true,
                    targetFilter: { faceState: 'face_down' }
                }
            } as any;

            const result = shouldSkipOptionalEffect(state, sourceCard, 0, 'player', effect);

            expect(result).toBe(true);
        });

        it('returns false for optional effects with valid targets', () => {
            state.opponent.lanes[0] = [createCard('Hate', 2, false)];

            const effect = {
                params: {
                    action: 'flip',
                    optional: true,
                    targetFilter: { faceState: 'face_down' }
                }
            } as any;

            const result = shouldSkipOptionalEffect(state, sourceCard, 0, 'player', effect);

            expect(result).toBe(false);
        });
    });
});
