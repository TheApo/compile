/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../../logic/utils/log";

/**
 * Light-4: Your opponent reveals their hand.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponentId = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    const opponent = { ...newState[opponentId] };

    if (opponent.hand.length > 0) {
        // This is now an action that must be resolved, to allow the AI to "act"
        // and for the game state to correctly pause and show the hand.
        newState.actionRequired = {
            type: 'reveal_opponent_hand',
            sourceCardId: card.id,
            actor,
        };
    }

    return { newState };
};