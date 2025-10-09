/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Common Effect: You discard 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };
    const currentPlayerState = newState[cardOwner];
    console.log(`[discard-one] Card: ${card.protocol}-${card.value}, Owner: ${cardOwner}, Hand length: ${currentPlayerState.hand.length}`);
    if (currentPlayerState.hand.length > 0) {
        newState.actionRequired = { type: 'discard', actor: cardOwner, count: 1, sourceCardId: card.id };
        console.log(`[discard-one] Created discard action`);
    } else {
        console.log(`[discard-one] No cards in hand, skipping discard action`);
    }
    return { newState };
}