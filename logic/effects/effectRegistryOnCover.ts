/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult } from "../../types";
import { findAndFlipCards } from "../../utils/gameStateModifiers";
import { executeOnCover as hate4 } from './hate/Hate-4';
import { execute as fire0OnCover } from './fire/Fire-0-oncover';
import { execute as life3OnCover } from './life/Life-3-oncover';
import { log } from "../utils/log";

type OnCoverEffectExecutor = (coveredCard: PlayedCard, laneIndex: number, state: GameState) => EffectResult;

const apathy2: OnCoverEffectExecutor = (coveredCard, laneIndex, state) => {
    // When this card would be covered: First, flip this card.
    const actor = state.turn;
    const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
    let newState = log(state, actor, `${cardName} effect triggers: flipping itself face-down.`);
    newState = findAndFlipCards(new Set([coveredCard.id]), newState);
    return { newState };
};

const life0: OnCoverEffectExecutor = (coveredCard, laneIndex, state) => {
    const players: Player[] = ['player', 'opponent'];
    let owner: Player | null = null;
    for (const p of players) {
        if (state[p].lanes[laneIndex].some(c => c.id === coveredCard.id)) {
            owner = p;
            break;
        }
    }
    if (!owner) return { newState: state };

    const actor = state.turn;
    const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
    let newState = log(state, actor, `${cardName} effect triggers: deleting itself.`);
    return { 
        newState,
        animationRequests: [{ type: 'delete', cardId: coveredCard.id, owner }] 
    };
};

const metal6: OnCoverEffectExecutor = (coveredCard, laneIndex, state) => {
    const players: Player[] = ['player', 'opponent'];
    let owner: Player | null = null;
    for (const p of players) {
        if (state[p].lanes[laneIndex].some(c => c.id === coveredCard.id)) {
            owner = p;
            break;
        }
    }
    if (!owner) return { newState: state };

    const actor = state.turn;
    const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
    let newState = log(state, actor, `${cardName} effect triggers on cover: deleting itself.`);
    return {
        newState,
        animationRequests: [{ type: 'delete', cardId: coveredCard.id, owner }]
    };
};

export const effectRegistryOnCover: Record<string, OnCoverEffectExecutor> = {
    'Apathy-2': apathy2,
    'Hate-4': hate4,
    'Fire-0': fire0OnCover,
    'Life-0': life0,
    'Life-3': life3OnCover,
    'Metal-6': metal6,
};