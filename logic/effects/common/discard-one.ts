/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Common Effect: You discard 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const currentPlayerState = newState[actor];
    if (currentPlayerState.hand.length > 0) {
        newState.actionRequired = { type: 'discard', actor: actor, count: 1, sourceCardId: card.id };
    }
    return { newState };
}