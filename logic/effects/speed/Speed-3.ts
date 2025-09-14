/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Speed-3: Shift 1 of your other cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const otherCards = state[actor].lanes.flat().filter(c => c.id !== card.id);
    if (otherCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_own_other_card_to_shift',
                    sourceCardId: card.id,
                }
            }
        };
    }
    return { newState: state };
}
