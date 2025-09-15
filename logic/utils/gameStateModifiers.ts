/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { Card } from "../data/cards";
import { GameState, PlayedCard, Player, PlayerState } from "../types";
import { shuffleDeck } from './gameLogic';
import { log } from '../utils/log';
import { recalculateAllLaneValues } from '../game/stateManager';

/**
 * Draws a specified number of cards from a deck, handling reshuffling the discard pile if necessary.
 * @param deck - The current deck.
 * @param discard - The current discard pile.
 * @param count - The number of cards to draw.
 * @returns An object with the new hand additions, the updated deck, and the updated discard pile.
 */
export function drawCards(deck: Card[], discard: Card[], count: number): { drawnCards: Card[], remainingDeck: Card[], newDiscard: Card[], reshuffled: boolean } {
    let currentDeck = [...deck];
    let currentDiscard = [...discard];
    let drawn: Card[] = [];
    let reshuffled = false;

    for (let i = 0; i < count; i++) {
        if (currentDeck.length === 0) {
            if (currentDiscard.length === 0) {
                // No more cards to draw anywhere
                break;
            }
            // Reshuffle discard into deck
            currentDeck = shuffleDeck(currentDiscard);
            currentDiscard = [];
            reshuffled = true;
        }
        drawn.push(currentDeck.shift()!);
    }
    
    return { drawnCards: drawn, remainingDeck: currentDeck, newDiscard: currentDiscard, reshuffled };
}

/**
 * Checks for the Spirit-3 trigger after a player draws cards.
 * @param state - The current GameState.
 * @param player - The player who drew cards.
 * @returns The new GameState with a queued action if Spirit-3 is present.
 */
export function checkForSpirit3Trigger(state: GameState, player: Player): GameState {
    const playerState = state[player];
    let newState = state;

    const allSpirit3Cards = playerState.lanes.flat().filter(c => c.protocol === 'Spirit' && c.value === 3 && c.isFaceUp);
    if (allSpirit3Cards.length > 0) {
        for (const spirit3 of allSpirit3Cards) {
             newState = log(newState, player, "Spirit-3 triggers after drawing: You may shift this card.");
             newState.queuedActions = [
                ...(newState.queuedActions || []),
                {
                    type: 'prompt_shift_for_spirit_3',
                    sourceCardId: spirit3.id,
                    optional: true,
                    actor: player,
                }
             ];
        }
    }
    return newState;
}

/**
 * A helper function to apply the draw logic to a player's state.
 * @param state - The current GameState.
 * @param player - The player who is drawing.
 * @param count - The number of cards to draw.
 * @returns The new GameState.
 */
export function drawForPlayer(state: GameState, player: Player, count: number): GameState {
    const playerState = state[player];
    const { drawnCards, remainingDeck, newDiscard, reshuffled } = drawCards(playerState.deck, playerState.discard, count);
    
    if (drawnCards.length === 0) return state;

    const newHandCards = drawnCards.map(c => ({...c, id: uuidv4(), isFaceUp: true}));
    const drawnCardIds = newHandCards.map(c => c.id);
    
    const newPlayerState: PlayerState = {
        ...playerState,
        deck: remainingDeck,
        discard: newDiscard,
        hand: [...playerState.hand, ...newHandCards],
        stats: {
            ...playerState.stats,
            cardsDrawn: playerState.stats.cardsDrawn + drawnCards.length,
        }
    };

    let newState: GameState = { ...state, [player]: newPlayerState };
    // Also update the top-level stats object for the results screen
    newState.stats[player].cardsDrawn = newPlayerState.stats.cardsDrawn;


    if (drawnCardIds.length > 0) {
        newState.animationState = { type: 'drawCard', owner: player, cardIds: drawnCardIds };
    }

    if (reshuffled) {
        const playerName = player === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, player, `${playerName}'s deck is empty. Discard pile has been reshuffled into the deck.`);
    }

    // After drawing, check for the trigger
    if (drawnCards.length > 0) {
        newState = checkForSpirit3Trigger(newState, player);
    }
    
    return newState;
}

/**
 * A helper for the 'Refresh' keyword - draws until the player has 5 cards.
 */
export function refreshHandForPlayer(state: GameState, player: Player): GameState {
    const playerState = state[player];
    const cardsToDraw = 5 - playerState.hand.length;
    if (cardsToDraw <= 0) return state;

    const playerName = player === 'player' ? 'Player' : 'Opponent';
    let newState = drawForPlayer(state, player, cardsToDraw);
    return log(newState, player, `${playerName} refreshes their hand, drawing ${cardsToDraw} card(s).`);
}


/**
 * Finds specific cards anywhere on the board and flips their `isFaceUp` status.
 * @param cardIds - An array of IDs of the cards to flip.
 * @param state - The current GameState.
 * @returns The new GameState with the cards flipped.
 */
export function findAndFlipCards(cardIds: Set<string>, state: GameState): GameState {
    const newState = { ...state };

    const flipInLanes = (lanes: PlayedCard[][]): PlayedCard[][] => {
        return lanes.map(lane =>
            lane.map(card =>
                cardIds.has(card.id) ? { ...card, isFaceUp: !card.isFaceUp } : card
            )
        );
    };

    newState.player.lanes = flipInLanes(newState.player.lanes);
    newState.opponent.lanes = flipInLanes(newState.opponent.lanes);

    return recalculateAllLaneValues(newState);
}

/**
 * Discards random cards from a player's hand.
 * @param state - The current GameState.
 * @param player - The player who is discarding.
 * @param count - The number of cards to discard.
 * @returns The new GameState.
 */
export function discardRandomCardsFromHand(state: GameState, player: Player, count: number): GameState {
    const playerState = state[player];
    if (playerState.hand.length === 0) return state;

    const handCopy = [...playerState.hand];
    const cardsToDiscard: PlayedCard[] = [];

    for (let i = 0; i < count && handCopy.length > 0; i++) {
        const randomIndex = Math.floor(Math.random() * handCopy.length);
        cardsToDiscard.push(handCopy.splice(randomIndex, 1)[0]);
    }

    const cardsToDiscardIds = new Set(cardsToDiscard.map(c => c.id));
    const newHand = playerState.hand.filter(c => !cardsToDiscardIds.has(c.id));
    const newDiscardPile = [...playerState.discard, ...cardsToDiscard.map(({ id, isFaceUp, ...cardData }) => cardData)];

    const newPlayerState: PlayerState = {
        ...playerState,
        hand: newHand,
        discard: newDiscardPile,
    };
    
    return { ...state, [player]: newPlayerState };
}