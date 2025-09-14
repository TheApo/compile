/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";

/**
 * Fire-3 End Phase: You may discard 1 card. If you do, flip 1 card.
 */
export const execute = (card: PlayedCard, state: GameState): EffectResult => {
    const player = state.turn;
    if (state[player].hand.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'prompt_fire_3_discard',
                    sourceCardId: card.id,
                    optional: true,
                }
            }
        };
    }
    return { newState: state };
}