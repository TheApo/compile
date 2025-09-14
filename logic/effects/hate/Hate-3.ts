/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Hate-3: After you delete cards: Draw 1 card.
 * This is a triggered effect, not an on-play effect.
 */
export const checkForHate3Trigger = (state: GameState, deletingPlayer: Player): GameState => {
    const playerState = state[deletingPlayer];
    const hasHate3 = playerState.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Hate' && c.value === 3);

    if (hasHate3) {
        let newState = { ...state };
        newState = log(newState, deletingPlayer, "Hate-3 triggers: Draw 1 card.");
        newState = drawForPlayer(newState, deletingPlayer, 1);
        return newState;
    }
    
    return state;
};