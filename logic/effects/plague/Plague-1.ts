/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Plague-1: Your opponent discards 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    if (newState[opponent].hand.length > 0) {
        newState.actionRequired = { type: 'discard', player: opponent, count: 1, sourceCardId: card.id };
    }
    return { newState };
}