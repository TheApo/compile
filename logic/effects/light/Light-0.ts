/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";
import { isFrost1Active } from "../common/frost1Check";

/**
 * Light-0: Flip 1 card. Draw cards equal to that card's value.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const frost1Active = isFrost1Active(state);

    const allCardsOnBoard = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];

    // If Frost-1 is active, only face-up cards can be flipped (to face-down)
    const validFlipTargets = frost1Active
        ? allCardsOnBoard.filter(c => c.isFaceUp)
        : allCardsOnBoard;

    if (validFlipTargets.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_card_to_flip_for_light_0',
                    sourceCardId: card.id,
                    actor: cardOwner,
                }
            }
        };
    }

    // No valid targets
    let newState = log(state, cardOwner, frost1Active
        ? "Light-0: Cannot flip face-down cards (Frost-1 is active)."
        : "Light-0: No cards to flip.");
    return { newState };
};