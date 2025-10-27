/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Frost-2: Play a card face-down.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    if (newState[cardOwner].hand.length > 0) {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_play',
            sourceCardId: card.id,
            isFaceDown: true,
            actor: cardOwner,
        };
    }

    return { newState };
}
