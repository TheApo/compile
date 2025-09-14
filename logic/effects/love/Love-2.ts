/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer, refreshHandForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Love-2: Your opponent draws 1 card. Refresh.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    newState = log(newState, actor, "Love-2: Opponent draws 1 card.");
    newState = drawForPlayer(newState, opponent, 1);
    newState = refreshHandForPlayer(newState, actor);

    return { newState };
}