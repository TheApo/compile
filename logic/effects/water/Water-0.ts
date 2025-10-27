/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, ActionRequired } from "../../../types";
import { log } from "../../utils/log";
import { isFrost1Active } from "../common/frost1Check";

/**
 * Water-0: Flip 1 other card. Flip this card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const frost1Active = isFrost1Active(state);

    const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].filter(c => c.id !== card.id);

    // If Frost-1 is active, only face-up cards can be flipped (to face-down)
    const validFlipTargets = frost1Active
        ? allOtherCards.filter(c => c.isFaceUp)
        : allOtherCards;

    if (validFlipTargets.length > 0) {
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

    // No valid targets
    let newState = log(state, cardOwner, frost1Active
        ? "Water-0: Cannot flip face-down cards (Frost-1 is active)."
        : "Water-0: No other cards to flip.");
    return { newState };
}