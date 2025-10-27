/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Spirit-2: You may flip 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Check if Frost-1 is active (blocks all face-down→face-up flips)
    const frost1IsActive = [state.player, state.opponent].some(playerState =>
        playerState.lanes.some(lane => {
            const topCard = lane[lane.length - 1];
            return topCard && topCard.isFaceUp && topCard.protocol === 'Frost' && topCard.value === 1;
        })
    );

    const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];

    // If Frost-1 is active, only face-up cards can be flipped (to face-down)
    const validFlipTargets = frost1IsActive
        ? allCards.filter(c => c.isFaceUp)
        : allCards;

    if (validFlipTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_any_card_to_flip_optional',
                    sourceCardId: card.id,
                    optional: true,
                    actor: cardOwner,
                }
            }
        };
    }

    // No valid targets - skip the effect
    return { newState: state };
}