/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Death-0: Delete 1 card from each other line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
    
    const lanesWithCards = otherLaneIndices.filter(i => 
        state.player.lanes[i].length > 0 || state.opponent.lanes[i].length > 0
    );

    const countToDelete = lanesWithCards.length;

    if (countToDelete > 0) {
        return {
            newState: {
                ...state,
                actionRequired: { 
                    type: 'select_card_from_other_lanes_to_delete', 
                    sourceCardId: card.id,
                    disallowedLaneIndex: laneIndex,
                    lanesSelected: [],
                    count: countToDelete,
                    actor,
                }
            }
        };
    }
    return { newState: state };
}