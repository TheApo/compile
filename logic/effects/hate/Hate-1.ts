/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Hate-1: Discard 3 cards. Delete 1 card. Delete 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const currentPlayerState = newState[actor];
    
    const maxDiscard = Math.min(3, currentPlayerState.hand.length);

    if (maxDiscard > 0) {
        newState.actionRequired = { 
            type: 'select_cards_from_hand_to_discard_for_hate_1', 
            count: maxDiscard, 
            sourceCardId: card.id,
        };
    } else {
        // No cards to discard, proceed directly to deleting.
        newState.actionRequired = {
            type: 'select_cards_to_delete',
            count: 2,
            sourceCardId: card.id,
            disallowedIds: [card.id]
        };
    }
    return { newState };
}