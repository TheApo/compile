/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Frost-4: You may flip 1 card of your face-up covered cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };
    const ownFaceUpCoveredCards = newState[cardOwner].lanes.flatMap(lane =>
        lane.filter((c, index) => c.isFaceUp && index < lane.length - 1)
    );
    if (ownFaceUpCoveredCards.length > 0) {
        newState.actionRequired = { type: 'select_own_face_up_covered_card_to_flip', count: 1, optional: true, sourceCardId: card.id, actor: cardOwner };
    }
    return { newState };
}
