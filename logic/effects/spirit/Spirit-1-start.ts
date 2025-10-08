/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Spirit-1 Start: Either discard 1 card or flip this card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'prompt_spirit_1_start',
                sourceCardId: card.id,
                actor: cardOwner,
            }
        }
    };
};