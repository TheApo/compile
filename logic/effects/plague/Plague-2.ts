/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Plague-2: Dicard 1 or more cards. Your opponent discards the amount of cards discarded plus 1.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };

    if (newState[actor].hand.length > 0) {
        if (actor === 'player') {
            newState.actionRequired = { 
                type: 'plague_2_player_discard', 
                sourceCardId: card.id 
            };
        } else { // Opponent's turn
            newState.actionRequired = { 
                type: 'plague_2_opponent_discard', 
                sourceCardId: card.id 
            };
        }
    }
    return { newState };
}