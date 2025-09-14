/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../../logic/utils/log";

/**
 * Speed-0: Play 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };

    if (newState[actor].hand.length > 0) {
        newState = log(newState, actor, "Speed-0: Play another card.");
        newState.actionRequired = {
            type: 'select_card_from_hand_to_play',
            disallowedLaneIndex: -1, // No disallowed lane
            sourceCardId: card.id,
            // isFaceDown is omitted, to be determined by game rules in the resolver
        };
    }

    return { newState };
}