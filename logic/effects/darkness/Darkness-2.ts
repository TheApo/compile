/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Darkness-2: You may flip 1 covered card in this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    
    const coveredCardsInLane = newState[actor].lanes[laneIndex].filter((c, index, arr) => index < arr.length - 1);

    if (coveredCardsInLane.length > 0) {
        newState.actionRequired = {
            type: 'select_own_covered_card_in_lane_to_flip',
            laneIndex,
            sourceCardId: card.id,
            optional: true,
            actor,
        };
    }

    return { newState };
}