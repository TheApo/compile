/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Gravity-1: Draw 2 cards. Shift 1 card either to or from this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = drawForPlayer(state, actor, 2);
    newState = log(newState, actor, "Gravity-1: Draw 2 cards.");

    const allCardsOnBoard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()];

    if (allCardsOnBoard.length > 0) {
        newState.actionRequired = {
            type: 'select_card_to_shift_for_gravity_1',
            sourceCardId: card.id,
            sourceLaneIndex: laneIndex,
        };
    }
    
    return { newState };
};