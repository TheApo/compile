/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Speed-3: Shift 1 of your other cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    // A valid target is an uncovered card that is not the source card.
    const validTargets: PlayedCard[] = [];
    for (const lane of state[actor].lanes) {
        if (lane.length > 0) {
            const topCard = lane[lane.length - 1]; // This is the uncovered card.
            if (topCard.id !== card.id) {
                validTargets.push(topCard);
            }
        }
    }

    if (validTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_own_other_card_to_shift',
                    sourceCardId: card.id,
                    actor,
                }
            }
        };
    }
    return { newState: state };
};