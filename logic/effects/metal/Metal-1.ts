/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Metal-1: Draw 2 cards. Your opponent cannot compile next turn.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = { ...state };

    newState = drawForPlayer(newState, cardOwner, 2);
    newState = log(newState, cardOwner, "Metal-1: Draw 2 cards.");

    // Immutable update for the opponent's state
    const opponentState = { ...newState[opponent], cannotCompile: true };
    newState = { ...newState, [opponent]: opponentState };

    newState = log(newState, cardOwner, "Metal-1: Opponent cannot compile next turn.");

    return { newState };
};