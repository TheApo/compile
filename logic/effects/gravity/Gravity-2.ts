/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";
import { isFrost1Active } from "../common/frost1Check";

/**
 * Gravity-2: Flip 1 card. Shift that card to this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const frost1Active = isFrost1Active(state);

    let newState = { ...state };
    const allCardsOnBoard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()];

    // If Frost-1 is active, only face-up cards can be flipped (to face-down)
    const validFlipTargets = frost1Active
        ? allCardsOnBoard.filter(c => c.isFaceUp)
        : allCardsOnBoard;

    if (validFlipTargets.length > 0) {
        newState.actionRequired = {
            type: 'select_card_to_flip_and_shift_for_gravity_2',
            sourceCardId: card.id,
            targetLaneIndex: laneIndex,
            actor: cardOwner,
        };
        return { newState };
    }

    // No valid targets
    newState = log(newState, cardOwner, frost1Active
        ? "Gravity-2: Cannot flip face-down cards (Frost-1 is active)."
        : "Gravity-2: No cards to flip.");
    return { newState };
};