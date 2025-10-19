/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";

/**
 * Chaos-0 Middle Command: "In each line, flip 1 covered card."
 *
 * Covered card = any card that is NOT the uncovered (top) card in a lane.
 * Player chooses 1 covered card per lane (from both sides).
 * Lanes without covered cards are skipped.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Helper function to check if a lane has covered cards
    const hasCoveredCards = (laneIdx: number): boolean => {
        const playerLane = state.player.lanes[laneIdx];
        const opponentLane = state.opponent.lanes[laneIdx];

        // A lane has covered cards if any lane has more than 1 card
        return (playerLane.length > 1) || (opponentLane.length > 1);
    };

    // Find all lanes that have covered cards
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

    // No covered cards in any lane -> effect ends
    return { newState: state };
}
