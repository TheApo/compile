/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Life-2: Draw 1 card. You may flip 1 face-down card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawForPlayer(state, cardOwner, 1);
    newState = log(newState, cardOwner, "Life-2: Draw 1 card.");

    const allFaceDownCards = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()].filter(c => !c.isFaceUp);

    if (allFaceDownCards.length > 0) {
        newState.actionRequired = {
            type: 'select_any_face_down_card_to_flip_optional',
            sourceCardId: card.id,
            optional: true,
            actor: cardOwner,
        };
    }

    return { newState };
}