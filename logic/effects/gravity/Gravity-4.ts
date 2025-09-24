/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Gravity-4: Shift 1 face-down card to this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };

    const validTargets: PlayedCard[] = [];
    
    // According to default targeting rules, only "uncovered" cards can be targeted unless specified otherwise.
    // Therefore, we only check the top card of each other lane.
    const players: Player[] = ['player', 'opponent'];
    for (const p of players) {
        newState[p].lanes.forEach((lane, i) => {
            if (i !== laneIndex) { // Card must be from another line.
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        validTargets.push(topCard);
                    }
                }
            }
        });
    }

    if (validTargets.length > 0) {
        newState.actionRequired = {
            type: 'select_face_down_card_to_shift_for_gravity_4',
            sourceCardId: card.id,
            targetLaneIndex: laneIndex,
            actor,
        };
    } else {
        newState = log(newState, actor, "Gravity-4: No valid face-down cards in other lines to shift.");
    }
    
    return { newState };
};
