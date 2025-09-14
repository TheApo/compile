/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer, refreshHandForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Spirit-0: Refresh. Draw 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    
    newState = refreshHandForPlayer(newState, actor);
    newState = drawForPlayer(newState, actor, 1);
    newState = log(newState, actor, "Spirit-0: Draw 1 card.");

    return { newState };
}