/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Water-4: Return 1 of your cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'select_own_card_to_return_for_water_4',
                sourceCardId: card.id,
            }
        }
    };
};