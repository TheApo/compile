/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log, setLogSource, setLogPhase } from "../../utils/log";

/**
 * Hate-3: After you delete cards: Draw 1 card.
 * This is a triggered effect, not an on-play effect.
 */
export const checkForHate3Trigger = (state: GameState, deletingPlayer: Player): GameState => {
    const playerState = state[deletingPlayer];
    const hasHate3 = playerState.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Hate' && c.value === 3);

    if (hasHate3) {
        let newState = { ...state };

        // Set context for Hate-3 trigger (no phase marker - it's a triggered effect)
        newState = setLogSource(newState, "Hate-3");
        newState = setLogPhase(newState, undefined);

        newState = log(newState, deletingPlayer, "Triggers after deleting cards: Draw 1 card.");
        newState = drawForPlayer(newState, deletingPlayer, 1);

        // Clear context after trigger
        newState = setLogSource(newState, undefined);

        return newState;
    }

    return state;
};