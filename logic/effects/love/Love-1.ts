/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawFromOpponentDeck } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Love-1: Draw the top card of your opponent's deck.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawFromOpponentDeck(state, cardOwner, 1);

    const actorName = cardOwner === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, cardOwner, `Love-1: ${actorName} draws the top card of the opponent's deck.`);

    return { newState };
}