/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Speed-4: Shift 1 of your opponent's face-down cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    const opponentFaceDownCards = state[opponent].lanes.flat().filter(c => !c.isFaceUp);
    if (opponentFaceDownCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_opponent_face_down_card_to_shift',
                    sourceCardId: card.id,
                    actor: actor,
                }
            }
        };
    }
    return { newState: state };
}