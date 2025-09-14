/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Death-4: Delete a card with a value of 0 or 1.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const lowValueCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
        .filter(c => c.value === 0 || c.value === 1);
        
    if (lowValueCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: { type: 'select_low_value_card_to_delete', sourceCardId: card.id }
            }
        };
    }
    return { newState: state };
}