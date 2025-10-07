/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Death-1 Start: You may draw 1 card. If you do, delete 1 other card, then delete this card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'prompt_death_1_effect',
                sourceCardId: card.id,
                optional: true,
                actor: cardOwner,
            }
        }
    };
};