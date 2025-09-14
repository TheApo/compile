/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";

/**
 * Speed-3 End Phase: You may shift 1 of your cards. If you do, flip this card.
 */
export const execute = (card: PlayedCard, state: GameState): EffectResult => {
    const player = state.turn;
    const allPlayerCards = state[player].lanes.flat();

    if (allPlayerCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'prompt_shift_for_speed_3',
                    sourceCardId: card.id,
                    optional: true,
                    actor: player,
                }
            }
        };
    }
    
    return { newState: state };
}