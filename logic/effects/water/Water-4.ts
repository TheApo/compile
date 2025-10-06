/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Water-4: Return 1 of your cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'select_own_card_to_return_for_water_4',
                sourceCardId: card.id,
                actor: cardOwner,
            }
        }
    };
}