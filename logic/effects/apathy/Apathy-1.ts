/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Apathy-1: Flip all other face-up cards in this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;

    const playerLane = state[cardOwner].lanes[laneIndex];
    const opponentLane = state[opponent].lanes[laneIndex];
    
    const cardsToFlip = new Set<string>();

    // Collect player's cards to flip
    playerLane
        .filter(c => c.id !== card.id && c.isFaceUp)
        .forEach(c => cardsToFlip.add(c.id));

    // Collect opponent's cards to flip
    opponentLane
        .filter(c => c.isFaceUp)
        .forEach(c => cardsToFlip.add(c.id));

    if (cardsToFlip.size > 0) {
        let newState = { ...state };
        newState = log(newState, cardOwner, `Apathy-1: Flip ${cardsToFlip.size} card(s) face-down in the line.`);
        return { newState: findAndFlipCards(cardsToFlip, newState) };
    }
    
    return { newState: state };
}