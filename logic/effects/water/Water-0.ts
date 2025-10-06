/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, ActionRequired } from "../../../types";

/**
 * Water-0: Flip 1 other card. Flip this card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].filter(c => c.id !== card.id);

    if (allOtherCards.length > 0) {
        const selectTargetAction: ActionRequired = {
            type: 'select_any_other_card_to_flip_for_water_0',
            sourceCardId: card.id,
            actor: cardOwner,
        };

        return {
            newState: {
                ...state,
                actionRequired: selectTargetAction,
            }
        };
    }

    // If there are no other cards, the effect does nothing.
    return { newState: state };
}