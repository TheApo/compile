/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Death-2: Delete all cards in 1 line with values of 1 or 2.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    return {
        newState: {
            ...state,
            actionRequired: { 
                type: 'select_lane_for_death_2', 
                sourceCardId: card.id,
            }
        }
    };
}