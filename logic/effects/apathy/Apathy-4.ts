/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Apathy-4: You may flip 1 of your face-up covered cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const ownFaceUpCoveredCards = newState[actor].lanes.flatMap(lane => 
        lane.filter((c, index) => c.isFaceUp && index < lane.length - 1)
    );
    if (ownFaceUpCoveredCards.length > 0) {
        newState.actionRequired = { type: 'select_own_face_up_covered_card_to_flip', count: 1, optional: true, sourceCardId: card.id, actor };
    }
    return { newState };
}