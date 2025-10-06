/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Speed-4: Shift 1 of your opponent's face-down cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;

    // According to default targeting rules, we can only target uncovered cards.
    const validTargets: PlayedCard[] = [];
    for (const lane of state[opponent].lanes) {
        if (lane.length > 0) {
            const topCard = lane[lane.length - 1];
            if (!topCard.isFaceUp) {
                validTargets.push(topCard);
            }
        }
    }

    if (validTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_opponent_face_down_card_to_shift',
                    sourceCardId: card.id,
                    actor: cardOwner,
                }
            }
        };
    }

    const newState = log(state, cardOwner, "Speed-4: Opponent has no valid (uncovered) face-down cards to shift.");
    return { newState };
}
