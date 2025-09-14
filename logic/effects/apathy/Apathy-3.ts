/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Apathy-3: Flip 1 of your opponent's face-up cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    const opponentFaceUpCards = newState[opponent].lanes.flat().filter(c => c.isFaceUp);
    if (opponentFaceUpCards.length > 0) {
        newState.actionRequired = { type: 'select_opponent_face_up_card_to_flip', count: 1, sourceCardId: card.id, actor };
    }
    return { newState };
}