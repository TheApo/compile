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
    };

    return {
        protocols,
        deck: remainingDeck,
        hand: drawnCards.map(c => ({ ...c, id: uuidv4(), isFaceUp: true })),
        lanes: [[], [], []],
        discard: [],
        compiled: [false, false, false],
        laneValues: [0, 0, 0],
        cannotCompile: false,
        stats: initialStats,
    };
};

export const createInitialState = (playerProtocols: string[], opponentProtocols: string[], useControlMechanic: boolean): GameState => {
    const playerState = createInitialPlayerState(playerProtocols);
    const opponentState = createInitialPlayerState(opponentProtocols);
    const initialState: GameState = {
        player: playerState,
        opponent: opponentState,
        turn: 'player',
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
     return log(initialState, 'player', 'Game Started.');
}

export const getEffectiveCardValue = (card: PlayedCard, lane: PlayedCard[]): number => {
    if (card.isFaceUp) {
        return card.value;
    }
    // Check if Darkness-2 is active in the lane
    const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
    return hasDarkness2 ? 4 : 2;
};

const calculateBaseLaneValue = (lane: PlayedCard[]): number => {
    let value = 0;
    for (const card of lane) {
        if (card.isFaceUp) {
            value += card.value;
        } else {
            value += 2;
        }
    }
    return Math.max(0, value);
};

function applyStaticValueModifiers(state: GameState, playerBase: number[], opponentBase: number[]): { finalPlayerValues: number[], finalOpponentValues: number[] } {
    let finalPlayerValues = [...playerBase];
    let finalOpponentValues = [...opponentBase];

    // Cross-lane effects (e.g., Metal 0)
    for (let i = 0; i < 3; i++) {
        if (state.opponent.lanes[i].some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 0)) {
            finalPlayerValues[i] = Math.max(0, finalPlayerValues[i] - 2);
        }
        if (state.player.lanes[i].some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 0)) {
            finalOpponentValues[i] = Math.max(0, finalOpponentValues[i] - 2);
        }
    }

    // Lane-specific effects
    for (let i = 0; i < 3; i++) {
        // Player lane modifiers
        for (const card of state.player.lanes[i]) {
            if (card.isFaceUp) {
                switch (`${card.protocol}-${card.value}`) {
                    case 'Apathy-0': { // Your total value in this line is increased by 1 for each face-down card in this line.
                        const playerFaceDownCount = state.player.lanes[i].filter(c => !c.isFaceUp).length;
                        const opponentFaceDownCount = state.opponent.lanes[i].filter(c => !c.isFaceUp).length;
                        finalPlayerValues[i] += (playerFaceDownCount + opponentFaceDownCount);
                        break;
                    }
                     case 'Darkness-2': { // All face-down cards in this stack have a value of 4.
                        const faceDownCount = state.player.lanes[i].filter(c => !c.isFaceUp).length;
                        finalPlayerValues[i] += faceDownCount * 2; // Add 2 for each, since base is 2.
                        break;
                    }
                }
            }
        }
         // Opponent lane modifiers
        for (const card of state.opponent.lanes[i]) {
            if (card.isFaceUp) {
                 switch (`${card.protocol}-${card.value}`) {
                    case 'Apathy-0': {
                        const playerFaceDownCount = state.player.lanes[i].filter(c => !c.isFaceUp).length;
                        const opponentFaceDownCount = state.opponent.lanes[i].filter(c => !c.isFaceUp).length;
                        finalOpponentValues[i] += (playerFaceDownCount + opponentFaceDownCount);
                        break;
                    }
                     case 'Darkness-2': {
                        const faceDownCount = state.opponent.lanes[i].filter(c => !c.isFaceUp).length;
                        finalOpponentValues[i] += faceDownCount * 2;
                        break;
                    }
                }
            }
        }
    }

    return { finalPlayerValues, finalOpponentValues };
}


export const recalculateAllLaneValues = (state: GameState): GameState => {
    const playerBaseValues = state.player.lanes.map(calculateBaseLaneValue);
    const opponentBaseValues = state.opponent.lanes.map(calculateBaseLaneValue);

    const { finalPlayerValues, finalOpponentValues } = applyStaticValueModifiers(state, playerBaseValues, opponentBaseValues);

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