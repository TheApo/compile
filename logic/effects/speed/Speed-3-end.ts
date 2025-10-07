/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Speed-3 End Phase: You may shift 1 of your cards. If you do, flip this card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Check for valid targets: any of the player's uncovered cards.
    const validTargets: PlayedCard[] = [];
    for (const lane of state[cardOwner].lanes) {
        if (lane.length > 0) {
            const topCard = lane[lane.length - 1]; // This is the uncovered card.
            validTargets.push(topCard);
        }
    }

    if (validTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'prompt_shift_for_speed_3',
                    sourceCardId: card.id,
                    optional: true,
                    actor: cardOwner,
                }
            }
        };
    }

    return { newState: state };
};