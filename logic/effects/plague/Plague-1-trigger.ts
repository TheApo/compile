/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Plague-1 Trigger: After your opponent discards cards: Draw 1 card.
 * This checks if the opponent of the discarding player has a face-up Plague-1.
 * @param state The current game state.
 * @param discardingPlayer The player who just discarded cards.
 * @returns The new game state, potentially with a card drawn.
 */
export const checkForPlague1Trigger = (state: GameState, discardingPlayer: Player): GameState => {
    const opponentOfDiscarder = discardingPlayer === 'player' ? 'opponent' : 'player';
    const opponentState = state[opponentOfDiscarder];

    // The trigger is active for any face-up Plague-1 card owned by the opponent of the discarder.
    // Based on convention from Hate-3, it does not need to be uncovered.
    const hasPlague1 = opponentState.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Plague' && c.value === 1);
    
    if (hasPlague1) {
        let newState = { ...state };
        newState = log(newState, opponentOfDiscarder, "Plague-1 triggers after opponent discards: Draw 1 card.");
        newState = drawForPlayer(newState, opponentOfDiscarder, 1);
        return newState;
    }
    
    return state;
};