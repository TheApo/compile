/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";

/**
 * Life-3: When this card would be covered: First, play the top card of your deck face-down in another line.
 */
export const execute = (coveredCard: PlayedCard, laneIndex: number, state: GameState): EffectResult => {
    const player = state.turn;
    // Check if player has cards in deck or discard to play
    if (state[player].deck.length > 0 || state[player].discard.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_lane_for_life_3_play',
                    sourceCardId: coveredCard.id,
                    disallowedLaneIndex: laneIndex,
                }
            }
        };
    }
    return { newState: state };
};
