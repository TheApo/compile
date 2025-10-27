/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { isFrost1Active } from "../common/frost1Check";

/**
 * Fire-0: Flip 1 other card. Draw 2 cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const frost1Active = isFrost1Active(state);

    const allOtherCards = [
        ...state.player.lanes.flat(),
        ...state.opponent.lanes.flat()
    ].filter(c => c.id !== card.id);

    // If Frost-1 is active, only face-up cards can be flipped (to face-down)
    const validFlipTargets = frost1Active
        ? allOtherCards.filter(c => c.isFaceUp)
        : allOtherCards;

    if (validFlipTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_any_other_card_to_flip',
                    sourceCardId: card.id,
                    draws: 2,
                    actor: cardOwner,
                }
            }
        };
    } else {
        // If no valid cards to flip, just draw
        let newState = frost1Active
            ? log(state, cardOwner, "Fire-0: Cannot flip face-down cards (Frost-1 is active). Drawing 2 cards.")
            : log(state, cardOwner, "Fire-0: No other cards to flip, drawing 2 cards.");
        newState = drawForPlayer(newState, cardOwner, 2);
        return { newState };
    }
}