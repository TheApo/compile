/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Trigger Handler
 *
 * Zentrale Logik für die Verarbeitung von Effekt-Triggern.
 * Bestimmt WANN Effekte ausgelöst werden basierend auf:
 * - Position (top, middle, bottom)
 * - Trigger-Typ (on_play, start, end, on_cover, after_draw, etc.)
 * - Karten-Status (face-up, uncovered, etc.)
 */

import { GameState, Player, PlayedCard, EffectContext, EffectResult } from '../../../types';
import { EffectDefinition, EffectTrigger } from '../../../types/customProtocol';

/**
 * Alle unterstützten Trigger-Typen
 */
export type TriggerType =
    // Middle Box Triggers
    | 'on_play'      // Wenn Karte gespielt wird
    | 'on_flip'      // Wenn Karte umgedreht wird (face-up)

    // Bottom Box Triggers
    | 'start'        // Am Zuganfang
    | 'end'          // Am Zugende
    | 'on_cover'     // Wenn Karte überdeckt wird
    | 'on_cover_or_flip'  // Bei Cover ODER Flip

    // Top Box (Reactive) Triggers
    | 'passive'      // Immer aktiv (z.B. value_modifier)
    | 'after_draw'   // Nach dem Ziehen
    | 'after_delete' // Nach dem Löschen
    | 'after_flip'   // Nach dem Flippen
    | 'after_clear_cache'  // Nach Cache-Phase
    | 'before_compile_delete'  // Vor Compile-Löschung
    | 'after_opponent_discard';  // Nach Gegner-Abwurf

/**
 * Position eines Effekts auf der Karte
 */
export type EffectPosition = 'top' | 'middle' | 'bottom';

/**
 * Information über einen triggerbaren Effekt
 */
export interface TriggerableEffect {
    card: PlayedCard;
    owner: Player;
    laneIndex: number;
    position: EffectPosition;
    effect: EffectDefinition;
    isUncovered: boolean;
}

/**
 * Findet alle Effekte einer Karte für einen bestimmten Trigger
 */
export function getEffectsForTrigger(
    card: PlayedCard,
    trigger: TriggerType,
    position?: EffectPosition
): EffectDefinition[] {
    const customCard = card as any;
    if (!customCard.customEffects) {
        return [];
    }

    const results: EffectDefinition[] = [];

    // Top Effects
    if (!position || position === 'top') {
        const topEffects = customCard.customEffects.topEffects || [];
        for (const effect of topEffects) {
            if (matchesTrigger(effect.trigger, trigger)) {
                results.push(effect);
            }
        }
    }

    // Middle Effects
    if (!position || position === 'middle') {
        const middleEffects = customCard.customEffects.middleEffects || [];
        for (const effect of middleEffects) {
            if (matchesTrigger(effect.trigger, trigger)) {
                results.push(effect);
            }
        }
    }

    // Bottom Effects
    if (!position || position === 'bottom') {
        const bottomEffects = customCard.customEffects.bottomEffects || [];
        for (const effect of bottomEffects) {
            if (matchesTrigger(effect.trigger, trigger)) {
                results.push(effect);
            }
        }
    }

    return results;
}

/**
 * Prüft ob ein Effekt-Trigger mit dem gesuchten Trigger übereinstimmt
 */
function matchesTrigger(effectTrigger: string | undefined, searchTrigger: TriggerType): boolean {
    if (!effectTrigger) {
        // Default trigger basierend auf Position
        return searchTrigger === 'on_play';
    }

    // Exakte Übereinstimmung
    if (effectTrigger === searchTrigger) {
        return true;
    }

    // on_cover_or_flip matcht sowohl on_cover als auch on_flip
    if (effectTrigger === 'on_cover_or_flip') {
        return searchTrigger === 'on_cover' || searchTrigger === 'on_flip';
    }

    return false;
}

/**
 * Findet alle Karten mit triggerbaren Effekten für einen bestimmten Trigger
 */
export function findCardsWithTrigger(
    state: GameState,
    trigger: TriggerType,
    options?: {
        player?: Player;           // Nur Karten dieses Spielers
        specificCardId?: string;   // Nur diese spezifische Karte
        requireUncovered?: boolean; // Nur unbedeckte Karten
        requireFaceUp?: boolean;    // Nur face-up Karten (default: true)
    }
): TriggerableEffect[] {
    const results: TriggerableEffect[] = [];
    const players = options?.player ? [options.player] : ['player', 'opponent'] as Player[];
    const requireFaceUp = options?.requireFaceUp !== false;

    for (const player of players) {
        for (let laneIndex = 0; laneIndex < state[player].lanes.length; laneIndex++) {
            const lane = state[player].lanes[laneIndex];

            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                const card = lane[cardIndex];
                const isUncovered = cardIndex === lane.length - 1;

                // Filter: Spezifische Karte
                if (options?.specificCardId && card.id !== options.specificCardId) {
                    continue;
                }

                // Filter: Face-up
                if (requireFaceUp && !card.isFaceUp) {
                    continue;
                }

                // Filter: Uncovered
                if (options?.requireUncovered && !isUncovered) {
                    continue;
                }

                // Finde passende Effekte
                const triggerableEffects = findTriggerableEffectsForCard(
                    card,
                    trigger,
                    isUncovered
                );

                for (const { position, effect } of triggerableEffects) {
                    results.push({
                        card,
                        owner: player,
                        laneIndex,
                        position,
                        effect,
                        isUncovered
                    });
                }
            }
        }
    }

    return results;
}

/**
 * Findet alle triggerbaren Effekte für eine einzelne Karte
 */
function findTriggerableEffectsForCard(
    card: PlayedCard,
    trigger: TriggerType,
    isUncovered: boolean
): Array<{ position: EffectPosition; effect: EffectDefinition }> {
    const results: Array<{ position: EffectPosition; effect: EffectDefinition }> = [];
    const customCard = card as any;

    if (!customCard.customEffects) {
        return results;
    }

    // Top Effects - Aktiv wenn face-up (auch wenn covered)
    const topEffects = customCard.customEffects.topEffects || [];
    for (const effect of topEffects) {
        if (matchesTrigger(effect.trigger, trigger)) {
            results.push({ position: 'top', effect });
        }
    }

    // Middle Effects - Nur wenn uncovered
    if (isUncovered) {
        const middleEffects = customCard.customEffects.middleEffects || [];
        for (const effect of middleEffects) {
            if (matchesTrigger(effect.trigger, trigger)) {
                results.push({ position: 'middle', effect });
            }
        }
    }

    // Bottom Effects - Nur wenn uncovered (außer on_cover, das triggert beim Covered-werden)
    // on_cover ist speziell: Es triggert wenn die Karte GERADE überdeckt wird
    if (isUncovered || trigger === 'on_cover') {
        const bottomEffects = customCard.customEffects.bottomEffects || [];
        for (const effect of bottomEffects) {
            if (matchesTrigger(effect.trigger, trigger)) {
                results.push({ position: 'bottom', effect });
            }
        }
    }

    return results;
}

/**
 * Prüft ob eine Karte einen bestimmten Trigger hat
 */
export function cardHasTrigger(
    card: PlayedCard,
    trigger: TriggerType,
    options?: {
        position?: EffectPosition;
        isUncovered?: boolean;
    }
): boolean {
    const isUncovered = options?.isUncovered !== false;
    const effects = findTriggerableEffectsForCard(card, trigger, isUncovered);

    if (options?.position) {
        return effects.some(e => e.position === options.position);
    }

    return effects.length > 0;
}

/**
 * Bestimmt ob ein Trigger reaktiv ist (kann andere Effekte unterbrechen)
 */
export function isReactiveTrigger(trigger: TriggerType): boolean {
    const reactiveTriggers: TriggerType[] = [
        'after_draw',
        'after_delete',
        'after_flip',
        'after_clear_cache',
        'before_compile_delete',
        'after_opponent_discard'
    ];

    return reactiveTriggers.includes(trigger);
}

/**
 * Bestimmt ob ein Trigger passiv ist (keine Aktion, nur Modifikation)
 */
export function isPassiveTrigger(trigger: TriggerType): boolean {
    return trigger === 'passive';
}

/**
 * Erstellt den Effekt-Context für einen Trigger
 */
export function createTriggerContext(
    state: GameState,
    cardOwner: Player,
    trigger: TriggerType
): EffectContext {
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';

    return {
        cardOwner,
        actor: cardOwner,
        currentTurn: state.turn,
        opponent,
        triggerType: mapTriggerToContextType(trigger)
    };
}

/**
 * Mappt TriggerType auf EffectContext.triggerType
 */
function mapTriggerToContextType(trigger: TriggerType): EffectContext['triggerType'] {
    switch (trigger) {
        case 'on_play':
            return 'play';
        case 'on_flip':
            return 'flip';
        case 'on_cover':
        case 'on_cover_or_flip':
            return 'cover';
        case 'start':
            return 'start';
        case 'end':
            return 'end';
        default:
            return 'middle';
    }
}

/**
 * Sortiert Effekte nach Ausführungsreihenfolge
 * (z.B. eigene Effekte vor Gegner-Effekten)
 */
export function sortTriggerableEffects(
    effects: TriggerableEffect[],
    currentTurn: Player
): TriggerableEffect[] {
    return [...effects].sort((a, b) => {
        // Eigene Effekte zuerst
        if (a.owner === currentTurn && b.owner !== currentTurn) return -1;
        if (a.owner !== currentTurn && b.owner === currentTurn) return 1;

        // Dann nach Lane-Index
        if (a.laneIndex !== b.laneIndex) return a.laneIndex - b.laneIndex;

        // Dann nach Position (top vor middle vor bottom)
        const positionOrder = { top: 0, middle: 1, bottom: 2 };
        return positionOrder[a.position] - positionOrder[b.position];
    });
}
