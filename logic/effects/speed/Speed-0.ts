/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Speed-0: Play 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    if (newState[cardOwner].hand.length > 0) {
        newState = log(newState, cardOwner, "Speed-0: Play another card.");
        newState.actionRequired = {
            type: 'select_card_from_hand_to_play',
            disallowedLaneIndex: -1, // No disallowed lane
            sourceCardId: card.id,
            actor: cardOwner,
            // isFaceDown is omitted, to be determined by game rules in the resolver
        };
    }

    return { newState };
}