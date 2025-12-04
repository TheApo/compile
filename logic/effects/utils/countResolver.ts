/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Count Resolver
 *
 * Zentrale Logik zum Auflösen von dynamischen Count-Werten.
 * Ersetzt die verstreute countType-Logik in effectInterpreter.ts
 */

import { GameState, Player, PlayedCard } from '../../../types';
import { CountDefinition, CountResolutionContext } from '../types';
import { findCardOnBoard } from './targetResolver';
// WICHTIG: Nutze die existierende Funktion die alle Modifikatoren berücksichtigt!
import { getEffectiveCardValue } from '../../game/stateManager';

/**
 * Löst einen dynamischen Count-Wert auf
 *
 * Unterstützte Typen:
 * - fixed: Fester Wert (Standard)
 * - equal_to_card_value: Wert einer referenzierten Karte (Light-0)
 * - equal_to_discarded: Anzahl abgeworfener Karten (Fire-4)
 * - hand_size / previous_hand_size: Handgröße (Chaos-4)
 * - count_face_down: Anzahl face-down Karten (Frost-0)
 */
export function resolveCount(
    countDef: number | CountDefinition | undefined,
    context: CountResolutionContext
): number {
    // Wenn countDef eine Zahl ist, direkt zurückgeben
    if (typeof countDef === 'number') {
        return countDef;
    }

    // Wenn countDef undefined ist, default 1
    if (!countDef) {
        return 1;
    }

    // Wenn es ein fester Wert ist
    if (countDef.fixed !== undefined) {
        return countDef.fixed;
    }

    const { state, actor, referencedCardValue, discardedCount, previousHandSize } = context;

    switch (countDef.type) {
        case 'equal_to_card_value':
            return resolveCardValueCount(countDef, context);

        case 'equal_to_discarded':
            return discardedCount || 0;

        case 'hand_size':
            return state[actor].hand.length;

        case 'previous_hand_size':
            return previousHandSize || 0;

        case 'count_face_down':
            return countFaceDownCards(state, countDef.laneIndex);

        default:
            return 1;
    }
}

/**
 * Löst count basierend auf dem Wert einer referenzierten Karte auf
 * Verwendet für Light-0: "Flip 1 card. Draw cards equal to that card's value"
 */
function resolveCardValueCount(
    countDef: CountDefinition,
    context: CountResolutionContext
): number {
    const { state, referencedCardValue } = context;

    // Erst prüfen ob ein direkter Wert im Context ist
    if (referencedCardValue !== undefined) {
        return referencedCardValue;
    }

    // Fallback: lastCustomEffectTargetCardId aus State
    const targetCardId = (state as any).lastCustomEffectTargetCardId;
    if (targetCardId) {
        const cardLocation = findCardOnBoard(state, targetCardId);
        if (cardLocation) {
            const lane = state[cardLocation.owner].lanes[cardLocation.laneIndex];
            // Nutze getEffectiveCardValue die alle Modifikatoren berücksichtigt (Darkness-2, etc.)
            return getEffectiveCardValue(cardLocation.card, lane, state, cardLocation.laneIndex, cardLocation.owner);
        }
    }

    // Keine Referenz gefunden
    return 0;
}

/**
 * Zählt face-down Karten
 * Optional auf eine Lane beschränkt
 */
function countFaceDownCards(state: GameState, laneIndex?: number): number {
    let count = 0;

    for (const player of ['player', 'opponent'] as Player[]) {
        for (let i = 0; i < state[player].lanes.length; i++) {
            // Wenn laneIndex angegeben, nur diese Lane zählen
            if (laneIndex !== undefined && i !== laneIndex) {
                continue;
            }

            for (const card of state[player].lanes[i]) {
                if (!card.isFaceUp) {
                    count++;
                }
            }
        }
    }

    return count;
}

/**
 * Zählt face-up Karten
 */
export function countFaceUpCards(state: GameState, laneIndex?: number): number {
    let count = 0;

    for (const player of ['player', 'opponent'] as Player[]) {
        for (let i = 0; i < state[player].lanes.length; i++) {
            if (laneIndex !== undefined && i !== laneIndex) {
                continue;
            }

            for (const card of state[player].lanes[i]) {
                if (card.isFaceUp) {
                    count++;
                }
            }
        }
    }

    return count;
}

/**
 * Zählt Karten eines bestimmten Owners
 */
export function countCardsForOwner(
    state: GameState,
    owner: Player,
    options?: {
        laneIndex?: number;
        faceState?: 'face_up' | 'face_down' | 'any';
        position?: 'covered' | 'uncovered' | 'any';
    }
): number {
    let count = 0;
    const { laneIndex, faceState, position } = options || {};

    for (let i = 0; i < state[owner].lanes.length; i++) {
        if (laneIndex !== undefined && i !== laneIndex) {
            continue;
        }

        const lane = state[owner].lanes[i];
        for (let j = 0; j < lane.length; j++) {
            const card = lane[j];
            const isUncovered = j === lane.length - 1;

            // Face state filter
            if (faceState === 'face_up' && !card.isFaceUp) continue;
            if (faceState === 'face_down' && card.isFaceUp) continue;

            // Position filter
            if (position === 'uncovered' && !isUncovered) continue;
            if (position === 'covered' && isUncovered) continue;

            count++;
        }
    }

    return count;
}

/**
 * Berechnet den Gesamtwert aller Karten eines Owners in einer Lane
 * HINWEIS: Für den echten Lane-Wert nutze besser state[owner].laneValues[laneIndex]
 * da dieser bereits alle Modifikatoren berücksichtigt!
 */
export function calculateLaneValue(
    state: GameState,
    owner: Player,
    laneIndex: number
): number {
    const lane = state[owner].lanes[laneIndex];
    let total = 0;

    for (const card of lane) {
        // Nutze getEffectiveCardValue für korrekte Werte (inkl. Darkness-2, etc.)
        total += getEffectiveCardValue(card, lane, state, laneIndex, owner);
    }

    return total;
}

/**
 * Validiert dass ein Count-Wert positiv ist
 * Gibt 0 zurück wenn der Wert negativ oder undefined ist
 */
export function validateCount(count: number | undefined): number {
    if (count === undefined || count < 0) {
        return 0;
    }
    return count;
}
