/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Fire-1: Discard 1 card. If you do, delete 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    if (newState[actor].hand.length > 0) {
        newState.actionRequired = {
            type: 'discard',
            player: actor,
            count: 1,
            sourceCardId: card.id,
            sourceEffect: 'fire_1',
        };
    }
    return { newState };
}