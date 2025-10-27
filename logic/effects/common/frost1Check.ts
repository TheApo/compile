/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState } from "../../../types";

/**
 * Checks if Frost-1 is active on the board.
 * Frost-1 Top Effect: "Cards cannot be flipped face-up."
 *
 * @returns true if any uncovered face-up Frost-1 exists on the board
 */
export const isFrost1Active = (state: GameState): boolean => {
    return [state.player, state.opponent].some(playerState =>
        playerState.lanes.some(lane => {
            const topCard = lane[lane.length - 1];
            return topCard && topCard.isFaceUp && topCard.protocol === 'Frost' && topCard.value === 1;
        })
    );
};
