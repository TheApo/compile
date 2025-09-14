/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Death-3: Delete 1 face-down card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const faceDownCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].filter(c => !c.isFaceUp);
    if (faceDownCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: { type: 'select_face_down_card_to_delete', sourceCardId: card.id }
            }
        };
    }
    return { newState: state };
}