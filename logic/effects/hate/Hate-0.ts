/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Hate-0: Delete 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allCardsOnBoard = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    const otherCardsOnBoard = allCardsOnBoard.filter(c => c.id !== card.id);

    if (otherCardsOnBoard.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: { 
                    type: 'select_cards_to_delete', 
                    count: 1, 
                    sourceCardId: card.id,
                    disallowedIds: [card.id],
                    actor,
                }
            }
        };
    }
    return { newState: state };
}