/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Love-4: Reveal 1 card from your hand. Flip 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    
    if (newState[actor].hand.length > 0) {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_reveal',
            sourceCardId: card.id,
        };
    }
    
    return { newState };
}