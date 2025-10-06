/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Death-3: Delete 1 face-down card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const validTargets: PlayedCard[] = [];
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1]; // Only check uncovered card
                if (!topCard.isFaceUp) {
                    validTargets.push(topCard);
                }
            }
        }
    }

    if (validTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: { type: 'select_face_down_card_to_delete', sourceCardId: card.id, actor: cardOwner }
            }
        };
    }

    const newState = log(state, cardOwner, "Death-3: No valid targets (uncovered face-down cards) found.");
    return { newState };
};
