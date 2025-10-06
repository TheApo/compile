/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer, refreshHandForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Spirit-0: Refresh. Draw 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    newState = refreshHandForPlayer(newState, cardOwner);
    newState = drawForPlayer(newState, cardOwner, 1);
    newState = log(newState, cardOwner, "Spirit-0: Draw 1 card.");

    return { newState };
}