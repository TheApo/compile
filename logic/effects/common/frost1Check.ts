/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState } from "../../../types";

/**
 * Checks if Frost-1's TOP effect is active on the board.
 * Frost-1 Top Effect: "Cards cannot be flipped face-up."
 *
 * Top-Box effects are ALWAYS active when card is face-up, even if covered!
 *
 * @returns true if any face-up Frost-1 exists on the board (covered OR uncovered)
 */
export const isFrost1Active = (state: GameState): boolean => {
    // Check ALL face-up Frost-1 cards in ALL lanes (covered OR uncovered)
    // Top effects are ALWAYS active when card is face-up, even if covered!
    return [state.player, state.opponent].some(playerState =>
        playerState.lanes.some(lane =>
            lane.some(card =>
                card.isFaceUp && card.protocol === 'Frost' && card.value === 1
            )
        )
    );
};

/**
 * Checks if Frost-1's BOTTOM effect is active on the board.
 * Frost-1 Bottom Effect: "Protocols cannot be rearranged."
 *
 * Bottom-Box effects ONLY work when card is uncovered (top card) AND face-up!
 *
 * @returns true if any uncovered face-up Frost-1 exists on the board
 */
export const isFrost1BottomActive = (state: GameState): boolean => {
    // Check ONLY uncovered (top card) face-up Frost-1 in ALL lanes
    // Bottom effects only work when uncovered!
    return [state.player, state.opponent].some(playerState =>
        playerState.lanes.some(lane => {
            const topCard = lane[lane.length - 1];
            return topCard && topCard.isFaceUp && topCard.protocol === 'Frost' && topCard.value === 1;
        })
    );
};
