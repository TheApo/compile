/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Hate-0: Delete 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    // According to default targeting rules, "delete" can only target uncovered cards.
    // Let's find all uncovered cards that are not the source card itself.
    const targetableCards: PlayedCard[] = [];
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1]; // This is the uncovered card
                if (topCard.id !== card.id) {
                    targetableCards.push(topCard);
                }
            }
        }
    }

    if (targetableCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_cards_to_delete',
                    count: 1,
                    sourceCardId: card.id,
                    disallowedIds: [card.id],
                    actor: cardOwner,
                }
            }
        };
    }

    const newState = log(state, cardOwner, "Hate-0: No valid (uncovered) cards to delete.");
    return { newState };
}