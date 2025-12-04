/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EffectQueue - Zentrale Queue-Verwaltung für Effect-Management
 *
 * Diese Datei bietet GameState-basierte Wrapper-Funktionen für das EffectChain-System.
 * Sie vereinfacht die Verwendung und stellt Stack-Semantik für Interrupts bereit.
 */

import { GameState, Player } from '../types';
import { EffectDefinition } from '../types/customProtocol';
import {
    EffectChain,
    EffectChainEntry,
    createEffectChain,
    createEffectEntry,
    appendEffect,
    prependEffect,
    popNextEffect,
    pushInterrupt,
    popInterrupt,
    hasPendingEffects
} from './effectChain';

/**
 * Stellt sicher dass GameState eine initialisierte EffectChain hat
 */
export function ensureEffectChain(state: GameState): GameState {
    if (!state.effectChain) {
        return {
            ...state,
            effectChain: createEffectChain()
        };
    }
    return state;
}

/**
 * Fügt einen Effect am Ende der Queue hinzu (normale Sequenzierung)
 */
export function queueEffect(
    state: GameState,
    effectDef: EffectDefinition,
    sourceCardId: string,
    laneIndex: number,
    owner: Player,
    options?: {
        conditionalType?: 'then' | 'if_executed';
        isInterrupt?: boolean;
        contextData?: Record<string, any>;
    }
): GameState {
    const stateWithChain = ensureEffectChain(state);
    const entry = createEffectEntry(effectDef, sourceCardId, laneIndex, owner, options);

    return {
        ...stateWithChain,
        effectChain: appendEffect(stateWithChain.effectChain, entry)
    };
}

/**
 * Fügt einen vorbereiteten EffectChainEntry zur Queue hinzu
 */
export function queueEffectEntry(state: GameState, entry: EffectChainEntry): GameState {
    const stateWithChain = ensureEffectChain(state);
    return {
        ...stateWithChain,
        effectChain: appendEffect(stateWithChain.effectChain, entry)
    };
}

/**
 * Fügt mehrere Effects zur Queue hinzu
 */
export function queueEffects(state: GameState, entries: EffectChainEntry[]): GameState {
    const stateWithChain = ensureEffectChain(state);
    let chain = stateWithChain.effectChain;

    for (const entry of entries) {
        chain = appendEffect(chain, entry);
    }

    return { ...stateWithChain, effectChain: chain };
}

/**
 * Fügt einen Effect am Anfang der Queue ein (für sofortige Ausführung)
 */
export function prependEffectToQueue(state: GameState, entry: EffectChainEntry): GameState {
    const stateWithChain = ensureEffectChain(state);
    return {
        ...stateWithChain,
        effectChain: prependEffect(stateWithChain.effectChain, entry)
    };
}

/**
 * INTERRUPT: Suspendiert die aktuelle Queue und startet eine neue.
 * Verwendet Stack-Semantik (LIFO) - der Interrupt wird zuerst ausgeführt,
 * dann wird die ursprüngliche Queue wiederhergestellt.
 *
 * Beispiel: Anarchy-0 shift -> Water-3 uncovered -> Water-3 return ZUERST
 */
export function suspendQueueForInterrupt(state: GameState): GameState {
    const stateWithChain = ensureEffectChain(state);

    // Auch queuedActions auf den Stack schieben wenn vorhanden
    // (für Kompatibilität mit dem alten System)
    const hasOldQueuedActions = state.queuedActions && state.queuedActions.length > 0;

    const chainWithInterrupt = pushInterrupt(stateWithChain.effectChain);

    return {
        ...stateWithChain,
        effectChain: chainWithInterrupt,
        // Speichere alte queuedActions wenn vorhanden
        _suspendedQueuedActions: hasOldQueuedActions
            ? [...(state._suspendedQueuedActions || []), state.queuedActions]
            : state._suspendedQueuedActions,
        queuedActions: hasOldQueuedActions ? [] : state.queuedActions
    };
}

/**
 * Stellt die suspendierte Queue nach Interrupt-Completion wieder her.
 * Wird aufgerufen wenn die aktuelle Queue leer ist.
 */
export function restoreFromInterruptStack(state: GameState): GameState {
    // Prüfe ob _suspendedQueuedActions vorhanden (das alte System)
    const suspendedActions = state._suspendedQueuedActions;

    if (suspendedActions && suspendedActions.length > 0) {
        // Pop the last suspended queue (LIFO)
        const lastSuspended = suspendedActions[suspendedActions.length - 1];
        const remainingSuspended = suspendedActions.slice(0, -1);

        // Merge with any current queuedActions (current should be empty, but just in case)
        const restoredQueuedActions = [...(state.queuedActions || []), ...lastSuspended];

        return {
            ...state,
            queuedActions: restoredQueuedActions,
            _suspendedQueuedActions: remainingSuspended.length > 0
                ? remainingSuspended
                : undefined
        };
    }

    // Fallback: Prüfe ob EffectChain Interrupt-Stack hat (neues System)
    if (state.effectChain && state.effectChain.interruptStack.length > 0) {
        const restoredChain = popInterrupt(state.effectChain);
        return {
            ...state,
            effectChain: restoredChain
        };
    }

    return state;
}

/**
 * Holt den nächsten Effect aus der Queue
 */
export function dequeueEffect(state: GameState): { state: GameState; effect?: EffectChainEntry } {
    const stateWithChain = ensureEffectChain(state);
    const { chain, effect } = popNextEffect(stateWithChain.effectChain);

    return {
        state: { ...stateWithChain, effectChain: chain },
        effect
    };
}

/**
 * Prüft ob die Queue Effects hat (inkl. Interrupt-Stack)
 */
export function hasQueuedEffects(state: GameState): boolean {
    if (!state.effectChain) {
        return false;
    }
    return hasPendingEffects(state.effectChain);
}

/**
 * Prüft ob ein Interrupt-Stack existiert
 */
export function hasInterruptStack(state: GameState): boolean {
    if (!state.effectChain) {
        return false;
    }
    return state.effectChain.interruptStack.length > 0;
}

/**
 * Leert die gesamte Effect Queue (inkl. Interrupt-Stack)
 */
export function clearEffectQueue(state: GameState): GameState {
    return {
        ...state,
        effectChain: createEffectChain(),
        _suspendedQueuedActions: undefined
    };
}

/**
 * Setzt Context-Daten für den aktuellen Effect
 * (z.B. targetCardId nach einer Flip-Auswahl)
 */
export function setCurrentEffectContext(
    state: GameState,
    contextData: Record<string, any>
): GameState {
    if (!state.effectChain?.currentEffect) {
        return state;
    }

    return {
        ...state,
        effectChain: {
            ...state.effectChain,
            currentEffect: {
                ...state.effectChain.currentEffect,
                contextData: {
                    ...state.effectChain.currentEffect.contextData,
                    ...contextData
                }
            }
        }
    };
}

/**
 * Holt Context-Daten vom aktuellen Effect
 */
export function getCurrentEffectContext(state: GameState): Record<string, any> | undefined {
    return state.effectChain?.currentEffect?.contextData;
}

/**
 * Debug: Gibt den aktuellen Queue-Status aus
 */
export function debugQueueStatus(state: GameState): string {
    if (!state.effectChain) {
        return 'No EffectChain initialized';
    }

    const chain = state.effectChain;
    const lines: string[] = [];

    lines.push(`Pending Effects: ${chain.pendingEffects.length}`);
    chain.pendingEffects.forEach((e, i) => {
        lines.push(`  [${i}] ${e.effectDef?.id || 'unknown'} from ${e.sourceCardId}`);
    });

    if (chain.currentEffect) {
        lines.push(`Current: ${chain.currentEffect.effectDef?.id || 'unknown'}`);
    }

    lines.push(`Interrupt Stack Depth: ${chain.interruptStack.length}`);
    chain.interruptStack.forEach((stack, i) => {
        lines.push(`  Stack[${i}]: ${stack.length} effects`);
    });

    return lines.join('\n');
}
