/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Card Memory - Tracks known values of face-down cards
 *
 * The AI can remember card values when:
 * 1. AI plays its own card face-down (AI knows what's in its hand)
 * 2. A face-up card is flipped to face-down (the value was visible)
 * 3. A card is revealed (Psychic effects, etc.)
 *
 * This allows the AI to make smarter decisions about flipping cards.
 */

import { GameState, PlayedCard, Player } from '../../types';

/**
 * Remember a card's value in AI memory
 */
export function rememberCard(state: GameState, cardId: string, value: number): GameState {
    const memory = state.aiCardMemory || {};
    return {
        ...state,
        aiCardMemory: {
            ...memory,
            [cardId]: value,
        },
    };
}

/**
 * Forget a card (when it's deleted or returned to hand)
 */
export function forgetCard(state: GameState, cardId: string): GameState {
    if (!state.aiCardMemory || !(cardId in state.aiCardMemory)) {
        return state;
    }

    const { [cardId]: _, ...rest } = state.aiCardMemory;
    return {
        ...state,
        aiCardMemory: rest,
    };
}

/**
 * Get the known value of a face-down card, or null if unknown
 */
export function getKnownValue(state: GameState, cardId: string): number | null {
    if (!state.aiCardMemory) return null;
    return state.aiCardMemory[cardId] ?? null;
}

/**
 * Check if AI knows the value of a card
 */
export function aiKnowsCard(state: GameState, cardId: string): boolean {
    return state.aiCardMemory !== undefined && cardId in state.aiCardMemory;
}

/**
 * Get effective value of a card for AI decision making
 * - If face-up: return actual value
 * - If face-down and known: return known value
 * - If face-down and unknown: return 2 (default face-down value)
 */
export function getEffectiveValueForAI(state: GameState, card: PlayedCard): number {
    if (card.isFaceUp) {
        return card.value;
    }

    const knownValue = getKnownValue(state, card.id);
    if (knownValue !== null) {
        return knownValue;
    }

    // Unknown face-down card - assume default value of 2
    return 2;
}

/**
 * Update memory when a card is played face-down by AI
 * AI always knows its own cards
 */
export function rememberAIPlayedCard(state: GameState, card: PlayedCard): GameState {
    // AI (opponent) always knows its own face-down cards
    return rememberCard(state, card.id, card.value);
}

/**
 * Update memory when a card is flipped from face-up to face-down
 * Both players can see face-up cards, so AI remembers the value
 */
export function rememberFlippedCard(state: GameState, card: PlayedCard): GameState {
    // Only remember if flipping FROM face-up TO face-down
    if (card.isFaceUp) {
        return rememberCard(state, card.id, card.value);
    }
    return state;
}

/**
 * Update memory when a card is revealed
 */
export function rememberRevealedCard(state: GameState, cardId: string, value: number): GameState {
    return rememberCard(state, cardId, value);
}

/**
 * Clear memory for cards that no longer exist on the board
 * (deleted or returned to hand)
 */
export function cleanupMemory(state: GameState): GameState {
    if (!state.aiCardMemory) return state;

    const existingCardIds = new Set<string>();

    // Collect all card IDs on the board
    for (const player of ['player', 'opponent'] as const) {
        for (const lane of state[player].lanes) {
            for (const card of lane) {
                existingCardIds.add(card.id);
            }
        }
    }

    // Remove memory entries for cards that no longer exist
    const cleanedMemory: Record<string, number> = {};
    for (const [cardId, value] of Object.entries(state.aiCardMemory)) {
        if (existingCardIds.has(cardId)) {
            cleanedMemory[cardId] = value;
        }
    }

    return {
        ...state,
        aiCardMemory: cleanedMemory,
    };
}

/**
 * Get all known card values for debugging
 */
export function getMemoryDebugInfo(state: GameState): string {
    if (!state.aiCardMemory || Object.keys(state.aiCardMemory).length === 0) {
        return 'AI Memory: Empty';
    }

    const entries = Object.entries(state.aiCardMemory)
        .map(([id, value]) => `${id.substring(0, 8)}...=${value}`)
        .join(', ');

    return `AI Memory: ${entries}`;
}
