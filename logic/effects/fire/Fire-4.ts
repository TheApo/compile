/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Fire-4: Discard 1 or more cards. Draw the amount discarded plus 1.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    if (state[actor].hand.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_cards_from_hand_to_discard_for_fire_4',
                    sourceCardId: card.id,
                    actor,
                }
            }
        };
    }
    return { newState: state };
}