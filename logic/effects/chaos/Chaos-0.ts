/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";
import { isFrost1Active } from "../common/frost1Check";

/**
 * Chaos-0 Middle Command: "In each line, flip 1 covered card."
 *
 * Covered card = any card that is NOT the uncovered (top) card in a lane.
 * Player chooses 1 covered card per lane (from both sides).
 * Lanes without covered cards are skipped.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const frost1Active = isFrost1Active(state);

    // Helper function to check if a lane has covered cards (considering Frost-1)
    const hasCoveredCards = (laneIdx: number): boolean => {
        const playerLane = state.player.lanes[laneIdx];
        const opponentLane = state.opponent.lanes[laneIdx];

        // Get all covered cards in this lane
        const coveredCards = [
            ...playerLane.filter((c, idx) => idx < playerLane.length - 1),
            ...opponentLane.filter((c, idx) => idx < opponentLane.length - 1)
        ];

        // If Frost-1 is active, only count face-up covered cards
        const validTargets = frost1Active
            ? coveredCards.filter(c => c.isFaceUp)
            : coveredCards;

        return validTargets.length > 0;
    };

    // Find all lanes that have valid covered cards to flip
    const lanesWithCoveredCards = [0, 1, 2].filter(i => hasCoveredCards(i));

    if (lanesWithCoveredCards.length > 0) {
        // Start with the first lane
        const firstLane = lanesWithCoveredCards[0];
        const remainingLanes = lanesWithCoveredCards.slice(1);

        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_covered_card_to_flip_for_chaos_0',
                    sourceCardId: card.id,
                    laneIndex: firstLane,
                    remainingLanes: remainingLanes,
                    actor: cardOwner,
                }
            }
        };
    }

    // No valid covered cards in any lane -> effect ends
    let newState = log(state, cardOwner, frost1Active
        ? "Chaos-0: Cannot flip face-down covered cards (Frost-1 is active)."
        : "Chaos-0: No covered cards to flip.");
    return { newState };
}
