/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Darkness-1: Flip 1 of your opponent's cards. You may shift that card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    const opponentCards = newState[opponent].lanes.flat();
    if (opponentCards.length > 0) {
        newState.actionRequired = {
            type: 'select_opponent_card_to_flip',
            sourceCardId: card.id,
        };
    }

    return { newState };
}