/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Death-2: Delete all cards in 1 line with values of 1 or 2.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'select_lane_for_death_2',
                sourceCardId: card.id,
                actor: cardOwner,
            }
        }
    };
}