/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Death-4: Delete a card with a value of 0 or 1.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const validTargets: PlayedCard[] = [];
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1]; // Only check uncovered card
                if (topCard.isFaceUp && (topCard.value === 0 || topCard.value === 1)) {
                    validTargets.push(topCard);
                }
            }
        }
    }
        
    if (validTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: { type: 'select_low_value_card_to_delete', sourceCardId: card.id, actor }
            }
        };
    }
    
    const newState = log(state, actor, "Death-4: No valid targets (face-up, uncovered card with value 0 or 1) found.");
    return { newState };
};
