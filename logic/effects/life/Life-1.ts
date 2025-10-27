/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../../logic/utils/log";
import { isFrost1Active } from "../common/frost1Check";

/**
 * Life-1: Flip 1 card. Flip 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const frost1Active = isFrost1Active(state);

    const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];

    // If Frost-1 is active, only face-up cards can be flipped (to face-down)
    const validFlipTargets = frost1Active
        ? allCards.filter(c => c.isFaceUp)
        : allCards;

    if (validFlipTargets.length > 0) {
        let newState = { ...state };
        newState = log(newState, cardOwner, "Life-1: Prompts to flip 2 cards.");
        newState.actionRequired = {
            type: 'select_any_card_to_flip',
            count: 2,
            sourceCardId: card.id,
            actor: cardOwner,
        };
        return { newState };
    }

    // No valid targets
    let newState = log(state, cardOwner, frost1Active
        ? "Life-1: Cannot flip face-down cards (Frost-1 is active)."
        : "Life-1: No cards to flip.");
    return { newState };
};