/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Light-3: Shift all face-down cards in this line to another line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    
    const faceDownInLine = [
        ...newState.player.lanes[laneIndex], 
        ...newState.opponent.lanes[laneIndex]
    ].filter(c => !c.isFaceUp);
    
    if (faceDownInLine.length > 0) {
        newState.actionRequired = {
            type: 'select_lane_to_shift_cards_for_light_3',
            sourceCardId: card.id,
            sourceLaneIndex: laneIndex,
        };
    }

    return { newState };
};