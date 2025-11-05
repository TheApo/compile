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

    // CRITICAL FIX: Get all UNCOVERED cards (standard targeting rule) except Anarchy-1 itself
    const uncoveredCards: Array<{ card: PlayedCard, currentLane: number }> = [];
    for (const player of ['player', 'opponent'] as const) {
        for (let i = 0; i < newState[player].lanes.length; i++) {
            const lane = newState[player].lanes[i];
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1];
                if (topCard.id !== card.id) {
                    uncoveredCards.push({ card: topCard, currentLane: i });
                }
            }
        }
    }

    if (uncoveredCards.length === 0) {
        newState = log(newState, cardOwner, "Anarchy-1: No other uncovered cards to shift.");
        return { newState };
    }

    // CRITICAL FIX: Check if ANY card has at least ONE valid destination (lane without matching protocol)
    let hasValidTarget = false;
    for (const { card: cardToCheck, currentLane } of uncoveredCards) {
        const cardProtocol = cardToCheck.protocol;

        // Check all 3 lanes (except current lane)
        for (let targetLane = 0; targetLane < 3; targetLane++) {
            if (targetLane === currentLane) continue; // Can't shift to same lane

            const playerProtocol = newState.player.protocols[targetLane];
            const opponentProtocol = newState.opponent.protocols[targetLane];

            // Valid destination = card's protocol does NOT match either protocol in target lane
            if (cardProtocol !== playerProtocol && cardProtocol !== opponentProtocol) {
                hasValidTarget = true;
                break;
            }
        }

        if (hasValidTarget) break; // At least one card has a valid destination
    }

    if (!hasValidTarget) {
        newState = log(newState, cardOwner, "Anarchy-1: No valid targets (all cards match protocols in all other lanes).");
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
