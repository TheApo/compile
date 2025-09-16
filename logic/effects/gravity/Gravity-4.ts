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
    
    // Check player's lanes for valid targets
    newState.player.lanes.forEach((lane, i) => {
        if (i !== laneIndex) { // Card must be from another line
            lane.forEach(c => {
                if (!c.isFaceUp) {
                    validTargets.push(c);
                }
            });
        }
    });

    // Check opponent's lanes for valid targets
    newState.opponent.lanes.forEach((lane, i) => {
        if (i !== laneIndex) { // Card must be from another line
            lane.forEach(c => {
                if (!c.isFaceUp) {
                    validTargets.push(c);
                }
            });
        }
    });

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