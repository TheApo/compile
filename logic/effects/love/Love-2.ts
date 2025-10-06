/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer, refreshHandForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Love-2: Your opponent draws 1 card. Refresh.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = { ...state };

    newState = log(newState, cardOwner, "Love-2: Opponent draws 1 card.");
    newState = drawForPlayer(newState, opponent, 1);
    newState = refreshHandForPlayer(newState, cardOwner);

    return { newState };
}