/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { v4 as uuidv4 } from 'uuid';

/**
 * Gravity-0: For every 2 cards in this line, play the top card of your deck face-down under this card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;

    const cardsInPlayerLane = state[cardOwner].lanes[laneIndex].length;
    const cardsInOpponentLane = state[opponent].lanes[laneIndex].length;
    
    // The just-played Gravity-0 card is already in the player's lane count.
    const totalCardsInLine = cardsInPlayerLane + cardsInOpponentLane;
    
    const cardsToPlayCount = Math.floor(totalCardsInLine / 2);

    if (cardsToPlayCount === 0) {
        return { newState: state };
    }

    let newState = { ...state };
    const playerState = { ...newState[cardOwner] };

    const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, cardsToPlayCount);

    if (drawnCards.length === 0) {
        return { newState };
    }

    const newPlayedCards = drawnCards.map(c => ({ ...c, id: uuidv4(), isFaceUp: false }));

    const targetLane = [...playerState.lanes[laneIndex]];
    // The Gravity-0 card is the last card in the array. Insert the new cards before it.
    targetLane.splice(targetLane.length - 1, 0, ...newPlayedCards);

    const newPlayerLanes = [...playerState.lanes];
    newPlayerLanes[laneIndex] = targetLane;

    newState[cardOwner] = {
        ...playerState,
        lanes: newPlayerLanes,
        deck: remainingDeck,
        discard: newDiscard,
    };

    newState = log(newState, cardOwner, `Gravity-0: Plays ${drawnCards.length} card(s) face-down under itself.`);

    return { newState };
};