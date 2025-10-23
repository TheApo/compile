/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Anarchy-2: Delete a covered or uncovered card in a line with a matching protocol.
 *
 * Effect breakdown:
 * 1. Player can delete 1 card (covered OR uncovered - ANY card in a lane)
 * 2. RESTRICTION: The card's protocol MUST match at least one of the two protocols in that lane
 * 3. This is the OPPOSITE of Anarchy-1's shift logic (Anarchy-1 = non-matching, Anarchy-2 = matching)
 *
 * Example: Fire-3 in Fire/Water lane CAN be deleted (Fire matches)
 * Example: Fire-3 in Death/Psychic lane CANNOT be deleted (no match)
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // Get all cards on board (covered and uncovered)
    const allCardsOnBoard = [
        ...newState.player.lanes.flat(),
        ...newState.opponent.lanes.flat()
    ];

    if (allCardsOnBoard.length === 0) {
        newState = log(newState, cardOwner, "Anarchy-2: No cards to delete.");
        return { newState };
    }

    // Request player to select a card to delete (must be in lane with matching protocol)
    newState.actionRequired = {
        type: 'select_card_to_delete_for_anarchy_2',
        sourceCardId: card.id,
        actor: cardOwner,
    };

    return { newState };
};
