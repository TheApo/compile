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

    // CRITICAL FIX: Find all valid targets - cards in lanes where their protocol matches at least one lane protocol
    const validTargets: PlayedCard[] = [];
    for (let i = 0; i < newState.player.lanes.length; i++) {
        const playerProtocol = newState.player.protocols[i];
        const opponentProtocol = newState.opponent.protocols[i];

        // Check player's cards in this lane
        for (const cardInLane of newState.player.lanes[i]) {
            if (cardInLane.protocol === playerProtocol || cardInLane.protocol === opponentProtocol) {
                validTargets.push(cardInLane);
            }
        }

        // Check opponent's cards in this lane
        for (const cardInLane of newState.opponent.lanes[i]) {
            if (cardInLane.protocol === playerProtocol || cardInLane.protocol === opponentProtocol) {
                validTargets.push(cardInLane);
            }
        }
    }

    if (validTargets.length === 0) {
        newState = log(newState, cardOwner, "Anarchy-2: No valid targets (no cards in lanes with matching protocols).");
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
