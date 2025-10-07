/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Psychic-4 End Phase: You may return 1 of your opponent's cards. If you do, flip this card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    const opponentHasCards = state[opponent].lanes.flat().length > 0;

    if (opponentHasCards) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'prompt_return_for_psychic_4',
                    sourceCardId: card.id,
                    optional: true,
                    actor: cardOwner,
                }
            }
        };
    }

    return { newState: state };
};