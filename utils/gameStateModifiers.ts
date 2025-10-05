/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { Card } from "../data/cards";
import { GameState, PlayedCard, Player, PlayerState, ActionRequired } from "../types";
import { shuffleDeck } from './gameLogic';
import { log } from '../logic/utils/log';
import { recalculateAllLaneValues } from '../logic/game/stateManager';

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
             const action: ActionRequired = {
                type: 'prompt_shift_for_spirit_3',
                sourceCardId: spirit3.id,
                optional: true,
                actor: player,
             };
             newState.queuedActions = [
                ...(newState.queuedActions || []),
                action
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
    
    const newStats = {
        ...playerState.stats,
        cardsDrawn: playerState.stats.cardsDrawn + drawnCards.length,
    };

    const newPlayerState: PlayerState = {
        ...playerState,
        deck: remainingDeck,
        discard: newDiscard,
        hand: [...playerState.hand, ...newHandCards],
        stats: newStats,
    };

    let newState: GameState = { 
        ...state, 
        [player]: newPlayerState,
        stats: {
            ...state.stats,
            [player]: newStats,
        }
    };

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

// FIX: Add missing 'drawFromOpponentDeck' function to resolve import errors.
/**
 * A helper function to apply draw logic from an opponent's deck.
 * @param state - The current GameState.
 * @param drawingPlayer - The player who is drawing.
 * @param count - The number of cards to draw.
 * @returns The new GameState.
 */
export function drawFromOpponentDeck(state: GameState, drawingPlayer: Player, count: number): GameState {
    const opponentPlayer = drawingPlayer === 'player' ? 'opponent' : 'player';
    
    let newState = { ...state };
    const opponentState = { ...newState[opponentPlayer] };
    const drawingPlayerState = { ...newState[drawingPlayer] };

    const { drawnCards, remainingDeck, newDiscard, reshuffled } = drawCards(opponentState.deck, opponentState.discard, count);
    
    if (drawnCards.length > 0) {
        const newCardsForHand = drawnCards.map(c => ({ ...c, id: uuidv4(), isFaceUp: true }));
        const drawnCardIds = newCardsForHand.map(c => c.id);
        
        drawingPlayerState.hand = [...drawingPlayerState.hand, ...newCardsForHand];
        
        const newDrawingPlayerStats = {
            ...drawingPlayerState.stats,
            cardsDrawn: drawingPlayerState.stats.cardsDrawn + drawnCards.length,
        };
        drawingPlayerState.stats = newDrawingPlayerStats;

        opponentState.deck = remainingDeck;
        opponentState.discard = newDiscard;
        
        newState = {
            ...newState,
            [drawingPlayer]: drawingPlayerState,
            [opponentPlayer]: opponentState,
            stats: {
                ...newState.stats,
                [drawingPlayer]: newDrawingPlayerStats,
            },
        };

        if (drawnCardIds.length > 0) {
            newState.animationState = { type: 'drawCard', owner: drawingPlayer, cardIds: drawnCardIds };
        }

        if (reshuffled) {
            const opponentName = opponentPlayer === 'player' ? 'Player' : 'Opponent';
            newState = log(newState, drawingPlayer, `${opponentName}'s deck is empty. Discard pile has been reshuffled into the deck.`);
        }

        // After drawing, check for the trigger for the player who just drew.
        newState = checkForSpirit3Trigger(newState, drawingPlayer);
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

    // Track refresh in stats
    const newPlayerState = {
        ...newState[player],
        stats: {
            ...newState[player].stats,
            handsRefreshed: newState[player].stats.handsRefreshed + 1,
        }
    };

    newState = {
        ...newState,
        [player]: newPlayerState,
        stats: {
            ...newState.stats,
            [player]: newPlayerState.stats,
        }
    };

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