/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, Player, PlayerState, PlayedCard } from '../../types';
import { buildDeck, shuffleDeck } from '../../utils/gameLogic';
import { drawCards as drawCardsUtil } from '../../utils/gameStateModifiers';
import { log } from '../utils/log';

export const createInitialPlayerState = (protocols: string[]): PlayerState => {
    const deck = shuffleDeck(buildDeck(protocols));
    const { drawnCards, remainingDeck } = drawCardsUtil(deck, [], 5);

    const initialStats = {
        cardsPlayed: 0,
        cardsDiscarded: 0,
        cardsDeleted: 0,
        cardsFlipped: 0,
        cardsShifted: 0,
        cardsDrawn: drawnCards.length, // Initial draw
        handsRefreshed: 0,
    };

    const hand = drawnCards.map(c => ({ ...c, id: uuidv4(), isFaceUp: true }));

    return {
        protocols,
        deck: remainingDeck,
        hand,
        lanes: [[], [], []],
        discard: [],
        compiled: [false, false, false],
        laneValues: [0, 0, 0],
        cannotCompile: false,
        stats: initialStats,
    };
};

export const createInitialState = (playerProtocols: string[], opponentProtocols: string[], useControlMechanic: boolean, startingPlayer: Player = 'player'): GameState => {
    const playerState = createInitialPlayerState(playerProtocols);
    const opponentState = createInitialPlayerState(opponentProtocols);
    const initialState: GameState = {
        player: playerState,
        opponent: opponentState,
        turn: startingPlayer,
        phase: 'start',
        controlCardHolder: null,
        useControlMechanic,
        winner: null,
        log: [],
        actionRequired: null,
        queuedActions: [],
        animationState: null,
        compilableLanes: [],
        processedStartEffectIds: [],
        processedEndEffectIds: [],
        lastPlayedCardId: undefined,
        stats: {
            player: playerState.stats,
            opponent: opponentState.stats,
        }
    };

    // Log game start and protocols
    const starterName = startingPlayer === 'player' ? 'Player' : 'Opponent';
    const playerProtocolsList = playerProtocols.join(', ');
    const opponentProtocolsList = opponentProtocols.join(', ');

    let stateWithLogs = log(initialState, 'player', `Game Started.`);
    stateWithLogs = log(stateWithLogs, 'player', `Player protocols: ${playerProtocolsList}`);
    stateWithLogs = log(stateWithLogs, 'opponent', `Opponent protocols: ${opponentProtocolsList}`);
    stateWithLogs = log(stateWithLogs, 'player', `${starterName} goes first.`);

    return stateWithLogs;
}

export const getEffectiveCardValue = (card: PlayedCard, lane: PlayedCard[], state?: GameState, laneIndex?: number, cardOwner?: Player): number => {
    if (card.isFaceUp) {
        return card.value;
    }

    // Check if Darkness-2 (hardcoded) is active in the lane
    const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
    if (hasDarkness2) {
        return 4;
    }

    // Check for custom cards with set_to_fixed value modifiers
    if (state && laneIndex !== undefined && cardOwner !== undefined) {
        const modifiers = getActiveValueModifiers(state);
        for (const modifier of modifiers) {
            if (modifier.type === 'set_to_fixed') {
                const appliesToLane = modifier.scope === 'global' || (modifier.scope === 'this_lane' && modifier.laneIndex === laneIndex);
                if (!appliesToLane) continue;

                // CRITICAL: Check if modifier applies to this card's owner
                const modifierOwner = modifier.cardOwner;
                if (modifier.target === 'own_cards' && modifierOwner !== cardOwner) continue;
                if (modifier.target === 'opponent_cards' && modifierOwner === cardOwner) continue;

                // Check if modifier filter matches this card
                const filter = modifier.filter;
                if (filter) {
                    const faceStateMatches = !filter.faceState || filter.faceState === 'any' ||
                                           (filter.faceState === 'face_down' && !card.isFaceUp) ||
                                           (filter.faceState === 'face_up' && card.isFaceUp);

                    if (faceStateMatches) {
                        return modifier.value;
                    }
                }
            }
        }
    }

    return 2; // Default face-down value
};

const calculateBaseLaneValue = (lane: PlayedCard[], state?: GameState, laneIndex?: number, cardOwner?: Player): number => {
    let value = 0;
    for (const card of lane) {
        if (card.isFaceUp) {
            value += card.value;
        } else {
            // Check for value modifiers (Darkness-2, custom protocols)
            value += getEffectiveCardValue(card, lane, state, laneIndex, cardOwner);
        }
    }
    return Math.max(0, value);
};

/**
 * Get active value modifiers from custom protocol cards
 */
interface ValueModifier {
    type: 'add_per_condition' | 'set_to_fixed' | 'add_to_total';
    value: number;
    condition?: 'per_face_down_card' | 'per_face_up_card' | 'per_card' | 'per_card_in_hand';
    target: 'own_cards' | 'opponent_cards' | 'all_cards' | 'own_total' | 'opponent_total';
    scope: 'this_lane' | 'global';
    filter?: {
        faceState?: 'face_up' | 'face_down' | 'any';
        position?: 'covered' | 'uncovered' | 'any';
    };
    cardOwner: Player;
    laneIndex: number;
}

function getActiveValueModifiers(state: GameState): ValueModifier[] {
    const modifiers: ValueModifier[] = [];

    for (const player of ['player', 'opponent'] as Player[]) {
        state[player].lanes.forEach((lane, laneIndex) => {
            lane.forEach(card => {
                if (card.isFaceUp) {
                    const customCard = card as any;
                    if (customCard.customEffects) {
                        // Check all three boxes for value modifiers
                        const allEffects = [
                            ...(customCard.customEffects.topEffects || []),
                            ...(customCard.customEffects.middleEffects || []),
                            ...(customCard.customEffects.bottomEffects || [])
                        ];

                        allEffects.forEach((effect: any) => {
                            if (effect.params.action === 'value_modifier' && effect.trigger === 'passive') {
                                modifiers.push({
                                    ...effect.params.modifier,
                                    cardOwner: player,
                                    laneIndex
                                });
                            }
                        });
                    }
                }
            });
        });
    }

    return modifiers;
}

/**
 * Apply custom protocol value modifiers
 */
function applyCustomValueModifiers(
    state: GameState,
    playerValues: number[],
    opponentValues: number[]
): { finalPlayerValues: number[]; finalOpponentValues: number[] } {
    const modifiers = getActiveValueModifiers(state);
    const finalPlayerValues = [...playerValues];
    const finalOpponentValues = [...opponentValues];

    for (const modifier of modifiers) {
        const { type, value, condition, target, scope, filter, cardOwner, laneIndex } = modifier;

        // Determine which lanes to affect
        const lanes: number[] = scope === 'global' ? [0, 1, 2] : [laneIndex];

        for (const lane of lanes) {
            switch (type) {
                case 'add_per_condition': {
                    if (!condition) continue;

                    let count = 0;
                    const playerLane = state.player.lanes[lane];
                    const opponentLane = state.opponent.lanes[lane];

                    // Count based on condition
                    if (condition === 'per_face_down_card') {
                        count = playerLane.filter(c => !c.isFaceUp).length +
                                opponentLane.filter(c => !c.isFaceUp).length;
                    } else if (condition === 'per_face_up_card') {
                        count = playerLane.filter(c => c.isFaceUp).length +
                                opponentLane.filter(c => c.isFaceUp).length;
                    } else if (condition === 'per_card') {
                        count = playerLane.length + opponentLane.length;
                    } else if (condition === 'per_card_in_hand') {
                        // Clarity-0: Count cards in the card owner's hand
                        count = state[cardOwner].hand.length;
                    }

                    // Apply to target
                    if (target === 'own_total' && cardOwner === 'player') {
                        finalPlayerValues[lane] += value * count;
                    } else if (target === 'own_total' && cardOwner === 'opponent') {
                        finalOpponentValues[lane] += value * count;
                    } else if (target === 'opponent_total' && cardOwner === 'player') {
                        finalOpponentValues[lane] += value * count;
                    } else if (target === 'opponent_total' && cardOwner === 'opponent') {
                        finalPlayerValues[lane] += value * count;
                    }
                    break;
                }

                case 'set_to_fixed': {
                    // This affects individual cards, handled in getEffectiveCardValue
                    break;
                }

                case 'add_to_total': {
                    if (target === 'own_total' && cardOwner === 'player') {
                        finalPlayerValues[lane] += value;
                    } else if (target === 'own_total' && cardOwner === 'opponent') {
                        finalOpponentValues[lane] += value;
                    } else if (target === 'opponent_total' && cardOwner === 'player') {
                        finalOpponentValues[lane] += value;
                    } else if (target === 'opponent_total' && cardOwner === 'opponent') {
                        finalPlayerValues[lane] += value;
                    }
                    break;
                }
            }
        }
    }

    return {
        finalPlayerValues: finalPlayerValues.map(v => Math.max(0, v)),
        finalOpponentValues: finalOpponentValues.map(v => Math.max(0, v))
    };
}

function applyStaticValueModifiers(state: GameState, playerBase: number[], opponentBase: number[]): { finalPlayerValues: number[], finalOpponentValues: number[] } {
    let finalPlayerValues = [...playerBase];
    let finalOpponentValues = [...opponentBase];

    // NOTE: Metal-0 hardcoded logic removed - now uses custom protocol value_modifier
    // Cross-lane effects are now handled via applyCustomValueModifiers

    // NOTE: Apathy-0 hardcoded logic removed - now uses custom protocol value_modifier
    // NOTE: Darkness-2 is handled in getEffectiveCardValue, not here (to avoid double-counting)

    return { finalPlayerValues, finalOpponentValues };
}


export const recalculateAllLaneValues = (state: GameState): GameState => {
    const playerBaseValues = state.player.lanes.map((lane, idx) => calculateBaseLaneValue(lane, state, idx, 'player'));
    const opponentBaseValues = state.opponent.lanes.map((lane, idx) => calculateBaseLaneValue(lane, state, idx, 'opponent'));

    // Apply hardcoded modifiers (Darkness-2 only - others moved to custom protocols)
    const staticResult = applyStaticValueModifiers(state, playerBaseValues, opponentBaseValues);

    // Apply custom protocol value modifiers
    const { finalPlayerValues, finalOpponentValues } = applyCustomValueModifiers(
        state,
        staticResult.finalPlayerValues,
        staticResult.finalOpponentValues
    );

    return {
        ...state,
        player: { ...state.player, laneValues: finalPlayerValues },
        opponent: { ...state.opponent, laneValues: finalOpponentValues },
    };
};

export const calculateCompilableLanes = (state: GameState, player: Player): number[] => {
    const compilableLanes = [];
    const playerState = state[player];
    const opponentState = state[player === 'player' ? 'opponent' : 'player'];
    if (!playerState.cannotCompile) {
        for(let i = 0; i < 3; i++) {
            const playerValue = playerState.laneValues[i];
            const opponentValue = opponentState.laneValues[i];
            if(playerValue >= 10 && playerValue > opponentValue) {
                compilableLanes.push(i);
            }
        }
    }
    return compilableLanes;
};

/**
 * Calculate total lane value for a specific player (uses cached laneValues)
 * This is more efficient than recalculating from scratch
 */
export const getPlayerLaneValue = (state: GameState, player: Player, laneIndex: number): number => {
    return state[player].laneValues[laneIndex];
};

/**
 * Find lanes where opponent has higher total value than the card owner (Courage-1)
 */
export const getLanesWhereOpponentHasHigherValue = (state: GameState, cardOwner: Player): number[] => {
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';
    const validLanes: number[] = [];

    for (let i = 0; i < 3; i++) {
        const ownValue = state[cardOwner].laneValues[i];
        const oppValue = state[opponent].laneValues[i];
        if (oppValue > ownValue) {
            validLanes.push(i);
        }
    }
    return validLanes;
};

/**
 * Find lane(s) with opponent's highest total value (Courage-3)
 * Returns array in case of ties
 */
export const getOpponentHighestValueLanes = (state: GameState, cardOwner: Player): number[] => {
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';
    let maxValue = -1;
    let maxLanes: number[] = [];

    for (let i = 0; i < 3; i++) {
        const oppValue = state[opponent].laneValues[i];
        if (oppValue > maxValue) {
            maxValue = oppValue;
            maxLanes = [i];
        } else if (oppValue === maxValue) {
            maxLanes.push(i);
        }
    }
    return maxLanes;
};