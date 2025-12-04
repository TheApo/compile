/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Target Resolver
 *
 * Zentrale Logik zum Finden von gültigen Targets für Effekte.
 * Ersetzt die verstreute hasValidBoardTargets-Logik in effectInterpreter.ts
 */

import { GameState, Player, PlayedCard, TargetFilter } from '../../../types';
import { CardLocation, FindTargetsOptions, TargetValidationFn, PreconditionResult } from '../types';

/**
 * Findet eine Karte auf dem Board anhand ihrer ID
 */
export function findCardOnBoard(
    state: GameState,
    cardId: string | undefined
): CardLocation | null {
    if (!cardId) return null;

    for (const owner of ['player', 'opponent'] as Player[]) {
        for (let laneIndex = 0; laneIndex < state[owner].lanes.length; laneIndex++) {
            const lane = state[owner].lanes[laneIndex];
            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                const card = lane[cardIndex];
                if (card.id === cardId) {
                    return {
                        card,
                        owner,
                        laneIndex,
                        cardIndex,
                        isUncovered: cardIndex === lane.length - 1
                    };
                }
            }
        }
    }
    return null;
}

/**
 * Prüft ob eine Karte uncovered (nicht bedeckt) ist
 */
export function isCardUncovered(state: GameState, cardId: string | undefined): boolean {
    if (!cardId) return false;

    for (const owner of ['player', 'opponent'] as Player[]) {
        for (const lane of state[owner].lanes) {
            if (lane.length > 0 && lane[lane.length - 1].id === cardId) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Erstellt eine Validierungsfunktion basierend auf TargetFilter
 */
export function createTargetValidator(
    filter: TargetFilter,
    actor: Player,
    sourceCardId?: string
): TargetValidationFn {
    return (card: PlayedCard, owner: Player, laneIndex: number, cardIndex: number): boolean => {
        const state = null as any; // Wird nicht benötigt für diese Checks
        const lane = null as any; // Muss extern berechnet werden

        // Check excludeSelf
        if (filter.excludeSelf && card.id === sourceCardId) {
            return false;
        }

        // Check owner filter
        if (filter.owner === 'own' && owner !== actor) {
            return false;
        }
        if (filter.owner === 'opponent' && owner === actor) {
            return false;
        }

        // Check faceState filter
        if (filter.faceState === 'face_up' && !card.isFaceUp) {
            return false;
        }
        if (filter.faceState === 'face_down' && card.isFaceUp) {
            return false;
        }

        // Check valueRange filter
        if (filter.valueRange) {
            const value = card.isFaceUp ? card.value : 2; // Face-down = 2
            if (value < filter.valueRange.min || value > filter.valueRange.max) {
                return false;
            }
        }

        // Check valueEquals filter
        if (filter.valueEquals !== undefined) {
            const value = card.isFaceUp ? card.value : 2;
            if (value !== filter.valueEquals) {
                return false;
            }
        }

        return true;
    };
}

/**
 * Findet alle gültigen Targets basierend auf den Optionen
 */
export function findValidTargets(options: FindTargetsOptions): CardLocation[] {
    const { state, filter, sourceCardId, actor, scopeLaneIndex, customValidation } = options;
    const targets: CardLocation[] = [];

    // Determine which player is "own" and which is "opponent"
    const effectActor = actor || state.turn;

    for (const owner of ['player', 'opponent'] as Player[]) {
        for (let laneIndex = 0; laneIndex < state[owner].lanes.length; laneIndex++) {
            // Check scope restriction
            if (scopeLaneIndex !== undefined && laneIndex !== scopeLaneIndex) {
                continue;
            }

            const lane = state[owner].lanes[laneIndex];
            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                const card = lane[cardIndex];
                const isUncovered = cardIndex === lane.length - 1;

                // Check excludeSelf
                if (filter.excludeSelf && card.id === sourceCardId) {
                    continue;
                }

                // Check owner filter
                if (filter.owner === 'own' && owner !== effectActor) {
                    continue;
                }
                if (filter.owner === 'opponent' && owner === effectActor) {
                    continue;
                }

                // Check position filter (default: uncovered)
                const posFilter = filter.position || 'uncovered';
                if (posFilter === 'uncovered' && !isUncovered) {
                    continue;
                }
                if (posFilter === 'covered' && isUncovered) {
                    continue;
                }
                // position === 'any' allows both

                // Check faceState filter
                if (filter.faceState === 'face_up' && !card.isFaceUp) {
                    continue;
                }
                if (filter.faceState === 'face_down' && card.isFaceUp) {
                    continue;
                }

                // Check valueRange filter
                if (filter.valueRange) {
                    const value = card.isFaceUp ? card.value : 2;
                    if (value < filter.valueRange.min || value > filter.valueRange.max) {
                        continue;
                    }
                }

                // Check valueEquals filter
                if (filter.valueEquals !== undefined) {
                    const value = card.isFaceUp ? card.value : 2;
                    if (value !== filter.valueEquals) {
                        continue;
                    }
                }

                // Custom validation
                if (customValidation && !customValidation(card, owner, laneIndex, cardIndex)) {
                    continue;
                }

                targets.push({
                    card,
                    owner,
                    laneIndex,
                    cardIndex,
                    isUncovered
                });
            }
        }
    }

    return targets;
}

/**
 * Prüft ob es gültige Targets gibt (schneller als findValidTargets wenn nur Check benötigt)
 */
export function hasValidTargets(options: FindTargetsOptions): boolean {
    const { state, filter, sourceCardId, actor, scopeLaneIndex, customValidation } = options;
    const effectActor = actor || state.turn;

    for (const owner of ['player', 'opponent'] as Player[]) {
        for (let laneIndex = 0; laneIndex < state[owner].lanes.length; laneIndex++) {
            if (scopeLaneIndex !== undefined && laneIndex !== scopeLaneIndex) {
                continue;
            }

            const lane = state[owner].lanes[laneIndex];
            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                const card = lane[cardIndex];
                const isUncovered = cardIndex === lane.length - 1;

                // Quick checks - same as findValidTargets
                if (filter.excludeSelf && card.id === sourceCardId) continue;
                if (filter.owner === 'own' && owner !== effectActor) continue;
                if (filter.owner === 'opponent' && owner === effectActor) continue;

                const posFilter = filter.position || 'uncovered';
                if (posFilter === 'uncovered' && !isUncovered) continue;
                if (posFilter === 'covered' && isUncovered) continue;

                if (filter.faceState === 'face_up' && !card.isFaceUp) continue;
                if (filter.faceState === 'face_down' && card.isFaceUp) continue;

                if (filter.valueRange) {
                    const value = card.isFaceUp ? card.value : 2;
                    if (value < filter.valueRange.min || value > filter.valueRange.max) continue;
                }

                if (filter.valueEquals !== undefined) {
                    const value = card.isFaceUp ? card.value : 2;
                    if (value !== filter.valueEquals) continue;
                }

                if (customValidation && !customValidation(card, owner, laneIndex, cardIndex)) continue;

                // Found at least one valid target
                return true;
            }
        }
    }

    return false;
}

/**
 * Findet das Target mit dem höchsten/niedrigsten Wert
 */
export function findTargetByCalculation(
    options: FindTargetsOptions,
    calculation: 'highest_value' | 'lowest_value'
): CardLocation | null {
    const targets = findValidTargets(options);

    if (targets.length === 0) return null;

    return targets.reduce((best, current) => {
        const currentValue = current.card.isFaceUp ? current.card.value : 2;
        const bestValue = best.card.isFaceUp ? best.card.value : 2;

        if (calculation === 'highest_value') {
            return currentValue > bestValue ? current : best;
        } else {
            return currentValue < bestValue ? current : best;
        }
    });
}

/**
 * Zählt die Anzahl gültiger Targets
 */
export function countValidTargets(options: FindTargetsOptions): number {
    return findValidTargets(options).length;
}

/**
 * Gruppiert Targets nach Lane
 */
export function groupTargetsByLane(targets: CardLocation[]): Map<number, CardLocation[]> {
    const grouped = new Map<number, CardLocation[]>();

    for (const target of targets) {
        const laneTargets = grouped.get(target.laneIndex) || [];
        laneTargets.push(target);
        grouped.set(target.laneIndex, laneTargets);
    }

    return grouped;
}

/**
 * Gruppiert Targets nach Owner
 */
export function groupTargetsByOwner(targets: CardLocation[]): Map<Player, CardLocation[]> {
    const grouped = new Map<Player, CardLocation[]>();

    for (const target of targets) {
        const ownerTargets = grouped.get(target.owner) || [];
        ownerTargets.push(target);
        grouped.set(target.owner, ownerTargets);
    }

    return grouped;
}
