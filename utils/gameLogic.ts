/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, cards as baseCards } from "../data/cards";
import { getAllCustomProtocolCards } from "../logic/customProtocols/cardFactory";
import { isCustomProtocolEnabled } from "./customProtocolSettings";

// Cached merged cards to avoid reloading on every buildDeck call
let cachedMergedCards: Card[] | null = null;

/**
 * Get all available cards (base + custom protocols if enabled)
 */
function getAllCards(): Card[] {
    if (!cachedMergedCards) {
        const customEnabled = isCustomProtocolEnabled();
        const customCards = customEnabled ? getAllCustomProtocolCards() : [];
        cachedMergedCards = [...baseCards, ...customCards];
    }
    return cachedMergedCards;
}

/**
 * Invalidate the card cache (call this when custom protocols change)
 */
export function invalidateCardCache(): void {
    cachedMergedCards = null;
}

/**
 * Builds a deck from a list of protocols.
 * @param protocols - An array of protocol names.
 * @returns An array of cards that belong to the selected protocols.
 */
export function buildDeck(protocols: string[]): Card[] {
    const allCards = getAllCards();
    const deck: Card[] = [];
    for (const protocol of protocols) {
        const protocolCards = allCards.filter(card => card.protocol === protocol);
        deck.push(...protocolCards);
    }
    return deck;
}

/**
 * Shuffles an array of cards in-place using the Fisher-Yates algorithm.
 * @param deck - The array of cards to shuffle.
 * @returns The shuffled array of cards.
 */
// FIX: Made the function generic to accept any array type.
export function shuffleDeck<T>(deck: T[]): T[] {
    const shuffledDeck = [...deck]; // Create a copy to avoid mutating the original
    for (let i = shuffledDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledDeck[i], shuffledDeck[j]] = [shuffledDeck[j], shuffledDeck[i]];
    }
    return shuffledDeck;
}
