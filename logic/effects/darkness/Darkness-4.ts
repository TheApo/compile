/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Darkness-4: Shift 1 face-down card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    
    const allFaceDownCards = [
        ...newState.player.lanes.flat(), 
        ...newState.opponent.lanes.flat()
    ].filter(c => !c.isFaceUp);
    
    if (allFaceDownCards.length > 0) {
        newState = log(newState, actor, "Darkness-4: Prompts to shift 1 face-down card.");
        newState.actionRequired = {
            type: 'select_face_down_card_to_shift_for_darkness_4',
            sourceCardId: card.id,
            actor,
        };
    }

    return { newState };
}