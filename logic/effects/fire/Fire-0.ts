/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Fire-0: Flip 1 other card. Draw 2 cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allOtherCards = [
        ...state.player.lanes.flat(), 
        ...state.opponent.lanes.flat()
    ].filter(c => c.id !== card.id);

    if (allOtherCards.length > 0) {
        return { 
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_any_other_card_to_flip',
                    sourceCardId: card.id,
                    draws: 2,
                    actor,
                }
            }
        };
    } else {
        // If no other cards, just draw
        let newState = log(state, actor, "Fire-0: No other cards to flip, drawing 2 cards.");
        newState = drawForPlayer(newState, actor, 2);
        return { newState };
    }
}