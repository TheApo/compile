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

    // Check if Frost-1 is active (blocks all face-down→face-up flips)
    const frost1IsActive = [newState.player, newState.opponent].some(playerState =>
        playerState.lanes.some(lane => {
            const topCard = lane[lane.length - 1];
            return topCard && topCard.isFaceUp && topCard.protocol === 'Frost' && topCard.value === 1;
        })
    );

    // A card is covered if it's not the last one in the stack.
    const ownCovered = newState[cardOwner].lanes[laneIndex].filter((c, index, arr) => index < arr.length - 1);
    const opponentCovered = newState[opponent].lanes[laneIndex].filter((c, index, arr) => index < arr.length - 1);
    const allCoveredInLine = [...ownCovered, ...opponentCovered];

    // If Frost-1 is active, only face-up covered cards can be flipped
    const validFlipTargets = frost1IsActive
        ? allCoveredInLine.filter(c => c.isFaceUp)
        : allCoveredInLine;

    if (validFlipTargets.length > 0) {
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
