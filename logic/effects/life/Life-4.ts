/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Life-4: If this card is covering a card, draw 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const lane = state[actor].lanes[laneIndex];

    // The card has already been added to the lane, so if it's covering something, length > 1
    if (lane.length > 1) {
        let newState = drawForPlayer(state, actor, 1);
        newState = log(newState, actor, "Life-4: Card is covering another, draw 1 card.");
        return { newState };
    }

    return { newState: state };
};