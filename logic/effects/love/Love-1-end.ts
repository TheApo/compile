/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";

/**
 * Love-1 End Phase: You may give 1 card from your hand to your opponent. If you do, draw 2 cards.
 */
export const execute = (card: PlayedCard, state: GameState): EffectResult => {
    const player = state.turn;
    // Effect can only be used if the player has a card to give.
    if (state[player].hand.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'prompt_give_card_for_love_1',
                    sourceCardId: card.id,
                    optional: true,
                }
            }
        };
    }
    return { newState: state };
}