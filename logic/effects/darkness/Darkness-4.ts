/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Darkness-4: Shift 1 face-down card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // According to default targeting rules, "shift" can only target uncovered cards.
    const uncoveredFaceDownCards: PlayedCard[] = [];
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1];
                if (!topCard.isFaceUp) {
                    uncoveredFaceDownCards.push(topCard);
                }
            }
        }
    }

    if (uncoveredFaceDownCards.length > 0) {
        newState = log(newState, cardOwner, "Darkness-4: Prompts to shift 1 face-down card.");
        newState.actionRequired = {
            type: 'select_face_down_card_to_shift_for_darkness_4',
            sourceCardId: card.id,
            actor: cardOwner,
        };
    } else {
        newState = log(newState, cardOwner, "Darkness-4: No valid face-down card to shift.");
    }

    return { newState };
}