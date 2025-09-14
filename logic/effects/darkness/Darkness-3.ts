/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Darkness-3: Play 1 card face-down in another line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    
    if (newState[actor].hand.length > 0) {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_play',
            disallowedLaneIndex: laneIndex,
            sourceCardId: card.id,
            isFaceDown: true,
        };
    }

    return { newState };
}