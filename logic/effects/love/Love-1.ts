/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawFromOpponentDeck } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Love-1: Draw the top card of your opponent's deck.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = drawFromOpponentDeck(state, actor, 1);
    
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, actor, `Love-1: ${actorName} draws the top card of the opponent's deck.`);
    
    return { newState };
}