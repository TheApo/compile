/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../../logic/utils/log";

/**
 * Light-4: Your opponent reveals their hand.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponentId = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    const opponent = { ...newState[opponentId] };

    if (opponent.hand.length > 0) {
        opponent.hand = opponent.hand.map(c => ({ ...c, isRevealed: true }));
        newState[opponentId] = opponent;
        newState = log(newState, actor, "Light-4: Opponent reveals their hand.");
    }

    return { newState };
};