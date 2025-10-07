/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Fire-3 End Phase: You may discard 1 card. If you do, flip 1 card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    if (state[cardOwner].hand.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'prompt_fire_3_discard',
                    sourceCardId: card.id,
                    optional: true,
                    actor: cardOwner,
                }
            }
        };
    }
    return { newState: state };
}