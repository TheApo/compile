/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Light-2: Draw 2 cards. Reveal 1 face-down card. You may shift or flip that card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = drawForPlayer(state, actor, 2);
    newState = log(newState, actor, "Light-2: Draw 2 cards.");

    const allFaceDownCards = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()].filter(c => !c.isFaceUp);
    
    if (allFaceDownCards.length > 0) {
        newState.actionRequired = {
            type: 'select_face_down_card_to_reveal_for_light_2',
            sourceCardId: card.id,
            actor,
        };
    }

    return { newState };
};