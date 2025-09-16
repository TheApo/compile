/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Metal-3: Draw 1 card. Delete all cards in 1 other line with 8 or more cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = drawForPlayer(state, actor, 1);
    newState = log(newState, actor, "Metal-3: Draw 1 card.");

    const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
    let canTargetLanes = false;
    for (const i of otherLaneIndices) {
        const totalCards = newState.player.lanes[i].length + newState.opponent.lanes[i].length;
        if (totalCards >= 8) {
            canTargetLanes = true;
            break;
        }
    }

    if (canTargetLanes) {
        newState.actionRequired = {
            type: 'select_lane_for_metal_3_delete',
            sourceCardId: card.id,
            disallowedLaneIndex: laneIndex,
            actor,
        };
    }

    return { newState };
};