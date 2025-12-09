/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Trigger Processor
 *
 * Verarbeitet die Ausführung von Effekten basierend auf Triggern.
 * Koordiniert zwischen Trigger-Erkennung und Action-Ausführung.
 */

import { GameState, Player, PlayedCard, EffectContext, EffectResult } from '../../../types';
import { EffectDefinition } from '../../../types/customProtocol';
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from '../../utils/log';
import { recalculateAllLaneValues } from '../../game/stateManager';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import {
    TriggerType,
    TriggerableEffect,
    findCardsWithTrigger,
    getEffectsForTrigger,
    createTriggerContext,
    sortTriggerableEffects,
    isReactiveTrigger
} from './triggerHandler';

/**
 * Optionen für die Trigger-Verarbeitung
 */
export interface ProcessTriggerOptions {
    /** Der Spieler, dessen Karten geprüft werden (default: aktueller Spieler) */
    player?: Player;
    /** Spezifische Karte, deren Effekte ausgeführt werden sollen */
    specificCard?: PlayedCard;
    /** Lane-Index der spezifischen Karte */
    laneIndex?: number;
    /** Zusätzlicher Context für den Effekt */
    additionalContext?: Partial<EffectContext>;
    /** Bereits verarbeitete Karten-IDs (für Start/End) */
    processedIds?: string[];
    /** Soll der Log-Indent erhöht werden? */
    increaseIndent?: boolean;
}

/**
 * Ergebnis der Trigger-Verarbeitung
 */
export interface ProcessTriggerResult extends EffectResult {
    /** IDs der verarbeiteten Karten */
    processedCardIds: string[];
    /** Wurde ein Effekt ausgeführt? */
    effectExecuted: boolean;
}

/**
 * Verarbeitet alle Effekte für einen bestimmten Trigger-Typ
 */
export function processTrigger(
    state: GameState,
    trigger: TriggerType,
    options: ProcessTriggerOptions = {}
): ProcessTriggerResult {
    const player = options.player || state.turn;
    const processedIds = options.processedIds || [];
    const newProcessedIds: string[] = [...processedIds];
    let currentState = { ...state };
    let anyEffectExecuted = false;

    // Finde alle triggerbaren Effekte
    let triggerableEffects: TriggerableEffect[];

    if (options.specificCard && options.laneIndex !== undefined) {
        // Nur Effekte einer spezifischen Karte
        triggerableEffects = findCardsWithTrigger(currentState, trigger, {
            specificCardId: options.specificCard.id
        });
    } else {
        // Alle Karten des Spielers
        triggerableEffects = findCardsWithTrigger(currentState, trigger, {
            player,
            requireUncovered: shouldRequireUncovered(trigger)
        });
    }

    // Filter bereits verarbeitete Karten
    triggerableEffects = triggerableEffects.filter(
        te => !processedIds.includes(te.card.id)
    );

    // Sortiere nach Ausführungsreihenfolge
    triggerableEffects = sortTriggerableEffects(triggerableEffects, state.turn);

    // Verarbeite jeden triggerbaren Effekt
    for (const triggerableEffect of triggerableEffects) {
        // Re-validiere die Karte vor der Ausführung
        if (!validateCardForExecution(currentState, triggerableEffect)) {
            continue;
        }

        // Erstelle Context
        const context = createExecutionContext(
            currentState,
            triggerableEffect,
            trigger,
            options.additionalContext
        );

        // Führe den Effekt aus
        const result = executeTriggeredEffect(
            currentState,
            triggerableEffect,
            context,
            options.increaseIndent
        );

        currentState = result.newState;
        anyEffectExecuted = anyEffectExecuted || result.effectExecuted;

        // Markiere als verarbeitet
        if (!newProcessedIds.includes(triggerableEffect.card.id)) {
            newProcessedIds.push(triggerableEffect.card.id);
        }

        // Wenn eine Aktion erforderlich ist, stoppe und gib zurück
        if (currentState.actionRequired) {
            return {
                newState: currentState,
                processedCardIds: newProcessedIds,
                effectExecuted: anyEffectExecuted
            };
        }
    }

    return {
        newState: recalculateAllLaneValues(currentState),
        processedCardIds: newProcessedIds,
        effectExecuted: anyEffectExecuted
    };
}

/**
 * Verarbeitet Start-Phase Effekte
 */
export function processStartPhaseEffects(state: GameState): ProcessTriggerResult {
    const processedIds = state.processedStartEffectIds || [];

    const result = processTrigger(state, 'start', {
        processedIds,
        increaseIndent: true
    });

    // Speichere verarbeitete IDs im State
    result.newState.processedStartEffectIds = result.processedCardIds;

    return result;
}

/**
 * Verarbeitet End-Phase Effekte
 */
export function processEndPhaseEffects(state: GameState): ProcessTriggerResult {
    const processedIds = state.processedEndEffectIds || [];

    const result = processTrigger(state, 'end', {
        processedIds,
        increaseIndent: true
    });

    // Speichere verarbeitete IDs im State
    result.newState.processedEndEffectIds = result.processedCardIds;

    return result;
}

/**
 * Verarbeitet On-Play Effekte (Middle Box)
 */
export function processOnPlayEffects(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player
): ProcessTriggerResult {
    return processTrigger(state, 'on_play', {
        specificCard: card,
        laneIndex,
        player: cardOwner,
        additionalContext: { triggerType: 'play' },
        increaseIndent: true
    });
}

/**
 * Verarbeitet On-Flip Effekte (Middle Box)
 */
export function processOnFlipEffects(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player
): ProcessTriggerResult {
    return processTrigger(state, 'on_flip', {
        specificCard: card,
        laneIndex,
        player: cardOwner,
        additionalContext: { triggerType: 'flip' },
        increaseIndent: true
    });
}

/**
 * Verarbeitet On-Cover Effekte (Bottom Box)
 */
export function processOnCoverEffects(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player
): ProcessTriggerResult {
    return processTrigger(state, 'on_cover', {
        specificCard: card,
        laneIndex,
        player: cardOwner,
        additionalContext: { triggerType: 'cover' }
    });
}

/**
 * Bestimmt ob für einen Trigger uncovered erforderlich ist
 */
function shouldRequireUncovered(trigger: TriggerType): boolean {
    // Top-Box Effekte sind auch bei covered Karten aktiv
    const topOnlyTriggers: TriggerType[] = [
        'passive',
        'after_draw',
        'after_delete',
        'after_discard',
        'after_flip',
        'after_clear_cache',
        'before_compile_delete',
        'after_opponent_discard'
    ];

    // Diese Trigger erfordern NICHT uncovered (Top-Box)
    if (topOnlyTriggers.includes(trigger)) {
        return false;
    }

    // on_cover ist speziell - die Karte ist GERADE dabei, covered zu werden
    if (trigger === 'on_cover' || trigger === 'on_cover_or_flip') {
        return false;
    }

    // Middle und Bottom Effekte erfordern uncovered
    return true;
}

/**
 * Validiert ob eine Karte noch ausgeführt werden kann
 */
function validateCardForExecution(
    state: GameState,
    triggerableEffect: TriggerableEffect
): boolean {
    const { card, owner, laneIndex, position, isUncovered } = triggerableEffect;

    // Karte muss noch existieren
    const currentLane = state[owner].lanes[laneIndex];
    if (!currentLane) return false;

    const cardInLane = currentLane.find(c => c.id === card.id);
    if (!cardInLane) return false;

    // Karte muss face-up sein
    if (!cardInLane.isFaceUp) return false;

    // Für Middle und Bottom (außer Top): Muss uncovered sein
    if (position !== 'top') {
        const currentIsUncovered = currentLane[currentLane.length - 1].id === card.id;
        if (!currentIsUncovered) return false;
    }

    return true;
}

/**
 * Erstellt den Execution Context
 */
function createExecutionContext(
    state: GameState,
    triggerableEffect: TriggerableEffect,
    trigger: TriggerType,
    additionalContext?: Partial<EffectContext>
): EffectContext {
    const { owner } = triggerableEffect;
    const opponent = owner === 'player' ? 'opponent' : 'player';

    const baseContext: EffectContext = {
        cardOwner: owner,
        actor: owner,
        currentTurn: state.turn,
        opponent,
        triggerType: mapTriggerToContextTriggerType(trigger)
    };

    if (additionalContext) {
        return { ...baseContext, ...additionalContext };
    }

    return baseContext;
}

/**
 * Mappt TriggerType auf Context triggerType
 */
function mapTriggerToContextTriggerType(trigger: TriggerType): EffectContext['triggerType'] {
    switch (trigger) {
        case 'on_play': return 'play';
        case 'on_flip': return 'flip';
        case 'on_cover':
        case 'on_cover_or_flip': return 'cover';
        case 'start': return 'start';
        case 'end': return 'end';
        default: return 'middle';
    }
}

/**
 * Führt einen einzelnen getriggerten Effekt aus
 */
function executeTriggeredEffect(
    state: GameState,
    triggerableEffect: TriggerableEffect,
    context: EffectContext,
    increaseIndent: boolean = false
): { newState: GameState; effectExecuted: boolean } {
    const { card, laneIndex, effect, position } = triggerableEffect;
    let currentState = state;
    let effectExecuted = false;

    // Set logging context
    const cardName = `${card.protocol}-${card.value}`;
    currentState = setLogSource(currentState, cardName);

    // Set phase based on trigger type
    const phaseContext = getPhaseContext(context.triggerType);
    if (phaseContext) {
        currentState = setLogPhase(currentState, phaseContext);
    }

    if (increaseIndent) {
        currentState = increaseLogIndent(currentState);
    }

    // Execute the custom effect
    const result = executeCustomEffect(card, laneIndex, currentState, context, effect);
    currentState = result.newState;
    effectExecuted = true;

    // Clear logging context if no action is pending
    if (!currentState.actionRequired) {
        if (increaseIndent) {
            currentState = decreaseLogIndent(currentState);
        }
        currentState = setLogSource(currentState, undefined);
        currentState = setLogPhase(currentState, undefined);
    }

    return { newState: currentState, effectExecuted };
}

/**
 * Bestimmt den Phase-Context für Logging
 */
function getPhaseContext(triggerType: EffectContext['triggerType']): string | undefined {
    switch (triggerType) {
        case 'start': return 'start';
        case 'end': return 'end';
        case 'play':
        case 'flip': return 'middle';
        default: return undefined;
    }
}
