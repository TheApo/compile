/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Light-2: Draw 2 cards. Reveal 1 face-down card. You may shift or flip that card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawForPlayer(state, cardOwner, 2);
    newState = log(newState, cardOwner, "Light-2: Draw 2 cards.");

    const uncoveredFaceDownCards: PlayedCard[] = [];
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of newState[p].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1];
                if (!topCard.isFaceUp) {
                    uncoveredFaceDownCards.push(topCard);
                }
            }
        }
    }

    if (uncoveredFaceDownCards.length > 0) {
        newState.actionRequired = {
            type: 'select_face_down_card_to_reveal_for_light_2',
            sourceCardId: card.id,
            actor: cardOwner,
        };
    } else {
        newState = log(newState, cardOwner, "Light-2: No valid face-down cards to reveal.");
    }

    return { newState };
}