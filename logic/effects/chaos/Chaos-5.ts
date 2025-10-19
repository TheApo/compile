/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Chaos-5 Middle Command: "Discard 1 card."
 *
 * Mandatory discard of 1 card from hand.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Check if player has cards to discard
    if (state[cardOwner].hand.length === 0) {
        let newState = log(state, cardOwner, `Chaos-5: No cards to discard.`);
        return { newState };
    }

    // Trigger mandatory discard action
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'discard',
                actor: cardOwner,
                count: 1,
                sourceCardId: card.id,
            }
        }
    };
};
