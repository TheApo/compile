/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Plague-1: Your opponent discards 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { opponent } = context;
    let newState = { ...state };
    if (newState[opponent].hand.length > 0) {
        newState.actionRequired = { type: 'discard', actor: opponent, count: 1, sourceCardId: card.id };
    }
    return { newState };
}