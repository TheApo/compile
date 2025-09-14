/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Water-3: Return all cards with a value of 2 in 1 line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'select_lane_for_water_3',
                sourceCardId: card.id,
            }
        }
    };
};