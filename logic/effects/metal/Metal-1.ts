/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Metal-1: Draw 2 cards. Your opponent cannot compile next turn.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    newState = drawForPlayer(newState, actor, 2);
    newState = log(newState, actor, "Metal-1: Draw 2 cards.");
    newState[opponent].cannotCompile = true;
    newState = log(newState, actor, "Metal-1: Opponent cannot compile next turn.");

    return { newState };
};