/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Chaos-2: "Shift 1 of your covered cards."
 *
 * Prompts the cardOwner to select one of their own covered cards to shift.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Check if cardOwner has any covered cards
    const hasCoveredCards = state[cardOwner].lanes.some(lane => lane.length > 1);

    if (!hasCoveredCards) {
        // No covered cards to shift
        return { newState: state };
    }

    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'select_own_covered_card_to_shift',
                sourceCardId: card.id,
                actor: cardOwner,
            }
        }
    };
};
