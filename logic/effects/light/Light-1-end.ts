/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Light-1 End Phase Effect: Draw 1 card.
 */
export const execute = (card: PlayedCard, state: GameState): EffectResult => {
    let newState = drawForPlayer(state, state.turn, 1);
    newState = log(newState, state.turn, "Light-1 End Phase: Draw 1 card.");
    return { newState };
}