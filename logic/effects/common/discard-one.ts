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
    if (currentPlayerState.hand.length > 0) {
        newState.actionRequired = { type: 'discard', actor: cardOwner, count: 1, sourceCardId: card.id };
    }
    return { newState };
}