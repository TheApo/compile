/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Anarchy-1: Shift 1 other card to a line without a matching protocol.
 *
 * Effect breakdown:
 * 1. Player must shift 1 OTHER card (not Anarchy-1 itself)
 * 2. The shift destination MUST be a lane where the card's protocol does NOT match either protocol in that lane
 *
 * Example: Fire-3 can be shifted to Death/Water lane (Fire doesn't match Death or Water)
 * Example: Fire-3 CANNOT be shifted to Fire/Psychic lane (Fire matches)
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // Get all OTHER cards on board (not Anarchy-1 itself)
    const allOtherCards = [
        ...newState.player.lanes.flat(),
        ...newState.opponent.lanes.flat()
    ].filter(c => c.id !== card.id);

    if (allOtherCards.length === 0) {
        newState = log(newState, cardOwner, "Anarchy-1: No other cards to shift.");
        return { newState };
    }

    // Request player to select a card to shift (must be shifted to non-matching lane)
    newState.actionRequired = {
        type: 'select_card_to_shift_for_anarchy_1',
        sourceCardId: card.id,
        actor: cardOwner,
    };

    return { newState };
};
