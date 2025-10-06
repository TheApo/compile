/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Gravity-1: Draw 2 cards. Shift 1 card either to or from this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawForPlayer(state, cardOwner, 2);
    newState = log(newState, cardOwner, "Gravity-1: Draw 2 cards.");

    const allCardsOnBoard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()];

    if (allCardsOnBoard.length > 0) {
        newState.actionRequired = {
            type: 'select_card_to_shift_for_gravity_1',
            sourceCardId: card.id,
            sourceLaneIndex: laneIndex,
            actor: cardOwner,
        };
    }

    return { newState };
};