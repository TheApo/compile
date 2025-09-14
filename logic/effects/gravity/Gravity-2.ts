/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Gravity-2: Flip 1 card. Shift that card to this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const allCardsOnBoard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()];

    if (allCardsOnBoard.length > 0) {
        newState.actionRequired = {
            type: 'select_card_to_flip_and_shift_for_gravity_2',
            sourceCardId: card.id,
            targetLaneIndex: laneIndex,
        };
    }

    return { newState };
};