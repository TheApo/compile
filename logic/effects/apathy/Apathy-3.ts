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
    // Rule: Must be an opponent's uncovered, face-up card.
    const opponentUncoveredFaceUpCards = newState[opponent].lanes
        .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
        .filter((c): c is PlayedCard => c !== null && c.isFaceUp);

    if (opponentUncoveredFaceUpCards.length > 0) {
        newState.actionRequired = { type: 'select_opponent_face_up_card_to_flip', count: 1, sourceCardId: card.id, actor };
    }
    return { newState };
}