/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Plague-2: Discard 1 or more cards. Your opponent discards the amount of cards discarded plus 1.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    let newState = { ...state };
    const { cardOwner, opponent } = context;

    // Card text: "Discard 1 or more cards" → cardOwner (you) discards
    if (newState[cardOwner].hand.length > 0) {
        if (cardOwner === 'player') {
            newState.actionRequired = {
                type: 'plague_2_player_discard',
                sourceCardId: card.id,
                actor: cardOwner,  // Wer die Aktion ausführt = card owner
            };
        } else { // Opponent owns Plague-2
            newState.actionRequired = {
                type: 'plague_2_opponent_discard',
                sourceCardId: card.id,
                actor: cardOwner,  // Wer die Aktion ausführt = card owner
            };
        }
    }
    return { newState };
}