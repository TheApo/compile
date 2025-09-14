/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Gravity-4: Shift 1 face-down card to this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const allFaceDownCards = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()].filter(c => !c.isFaceUp);

    if (allFaceDownCards.length > 0) {
        newState.actionRequired = {
            type: 'select_face_down_card_to_shift_for_gravity_4',
            sourceCardId: card.id,
            targetLaneIndex: laneIndex,
        };
    }
    
    return { newState };
};