/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Darkness-2: You may flip 1 covered card in this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = { ...state };

    // A card is covered if it's not the last one in the stack.
    const ownCovered = newState[cardOwner].lanes[laneIndex].filter((c, index, arr) => index < arr.length - 1);
    const opponentCovered = newState[opponent].lanes[laneIndex].filter((c, index, arr) => index < arr.length - 1);
    const allCoveredInLine = [...ownCovered, ...opponentCovered];

    if (allCoveredInLine.length > 0) {
        newState.actionRequired = {
            type: 'select_covered_card_in_line_to_flip_optional',
            laneIndex,
            sourceCardId: card.id,
            optional: true,
            actor: cardOwner,
        };
    }

    return { newState };
}
