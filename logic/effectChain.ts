/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EffectChain - Clean, object-oriented effect management system
 *
 * This replaces the scattered followUpEffect, outerSourceCardId, conditionalType, etc.
 * with a single, well-structured object that tracks the entire effect execution context.
 */

import { Player } from '../types';
import { EffectDefinition } from '../types/customProtocol';

/**
 * Represents a single effect in the chain with all its context
 */
export interface EffectChainEntry {
    /** Unique identifier for this entry */
    id: string;

    /** The effect definition to execute */
    effectDef: EffectDefinition;

    /** ID of the card that owns this effect */
    sourceCardId: string;

    /** Lane index where the source card is located */
    laneIndex: number;

    /** Owner of the source card */
    owner: Player;

    /** Type of conditional (if any) - 'then' always executes, 'if_executed' only if previous succeeded */
    conditionalType?: 'then' | 'if_executed';

    /** Whether this effect was triggered by an interrupt (reactive effect) */
    isInterrupt?: boolean;

    /** Context data passed from previous effect (e.g., discardedCount for "Discard X. Draw X") */
    contextData?: Record<string, any>;
}

/**
 * The effect chain tracks pending effects and their execution order.
 * When an effect is interrupted (e.g., by Spirit-3's after_draw),
 * the remaining effects are preserved and executed after the interrupt resolves.
 */
export interface EffectChain {
    /** Effects waiting to be executed, in order */
    pendingEffects: EffectChainEntry[];

    /** The effect currently being executed (for tracking purposes) */
    currentEffect?: EffectChainEntry;

    /** Stack of interrupted effect chains (for nested interrupts) */
    interruptStack: EffectChainEntry[][];
}

/**
 * Creates a new empty effect chain
 */
export function createEffectChain(): EffectChain {
    return {
        pendingEffects: [],
        currentEffect: undefined,
        interruptStack: []
    };
}

/**
 * Creates an effect chain entry from the given parameters
 */
export function createEffectEntry(
    effectDef: EffectDefinition,
    sourceCardId: string,
    laneIndex: number,
    owner: Player,
    options?: {
        conditionalType?: 'then' | 'if_executed';
        isInterrupt?: boolean;
        contextData?: Record<string, any>;
    }
): EffectChainEntry {
    return {
        id: `${sourceCardId}-${effectDef.id}-${Date.now()}`,
        effectDef,
        sourceCardId,
        laneIndex,
        owner,
        conditionalType: options?.conditionalType,
        isInterrupt: options?.isInterrupt,
        contextData: options?.contextData
    };
}

/**
 * Adds an effect to the end of the chain (normal sequencing)
 */
export function appendEffect(chain: EffectChain, entry: EffectChainEntry): EffectChain {
    return {
        ...chain,
        pendingEffects: [...chain.pendingEffects, entry]
    };
}

/**
 * Adds an effect to the front of the chain (for interrupts that should execute first)
 */
export function prependEffect(chain: EffectChain, entry: EffectChainEntry): EffectChain {
    return {
        ...chain,
        pendingEffects: [entry, ...chain.pendingEffects]
    };
}

/**
 * Adds multiple effects to the chain
 */
export function appendEffects(chain: EffectChain, entries: EffectChainEntry[]): EffectChain {
    return {
        ...chain,
        pendingEffects: [...chain.pendingEffects, ...entries]
    };
}

/**
 * Pops the next effect from the chain and sets it as current
 */
export function popNextEffect(chain: EffectChain): { chain: EffectChain; effect: EffectChainEntry | undefined } {
    if (chain.pendingEffects.length === 0) {
        return { chain: { ...chain, currentEffect: undefined }, effect: undefined };
    }

    const [nextEffect, ...remainingEffects] = chain.pendingEffects;
    return {
        chain: {
            ...chain,
            pendingEffects: remainingEffects,
            currentEffect: nextEffect
        },
        effect: nextEffect
    };
}

/**
 * Pushes the current pending effects onto the interrupt stack and starts a new chain.
 * Used when a reactive effect (like Spirit-3's after_draw) interrupts the current chain.
 */
export function pushInterrupt(chain: EffectChain): EffectChain {
    if (chain.pendingEffects.length === 0 && !chain.currentEffect) {
        // Nothing to push
        return chain;
    }

    const effectsToPush = chain.currentEffect
        ? [chain.currentEffect, ...chain.pendingEffects]
        : chain.pendingEffects;

    return {
        pendingEffects: [],
        currentEffect: undefined,
        interruptStack: [effectsToPush, ...chain.interruptStack]
    };
}

/**
 * Pops effects from the interrupt stack back to the pending effects.
 * Used when an interrupt completes and we need to resume the original chain.
 */
export function popInterrupt(chain: EffectChain): EffectChain {
    if (chain.interruptStack.length === 0) {
        return chain;
    }

    const [restoredEffects, ...remainingStack] = chain.interruptStack;
    return {
        pendingEffects: [...chain.pendingEffects, ...restoredEffects],
        currentEffect: chain.currentEffect,
        interruptStack: remainingStack
    };
}

/**
 * Clears the entire effect chain
 */
export function clearEffectChain(): EffectChain {
    return createEffectChain();
}

/**
 * Checks if the chain has any pending effects
 */
export function hasPendingEffects(chain: EffectChain): boolean {
    return chain.pendingEffects.length > 0 || chain.interruptStack.length > 0;
}

/**
 * Gets the total count of pending effects (including interrupt stack)
 */
export function getPendingEffectCount(chain: EffectChain): number {
    const stackCount = chain.interruptStack.reduce((sum, stack) => sum + stack.length, 0);
    return chain.pendingEffects.length + stackCount;
}

/**
 * Serializes the effect chain for storage in GameState
 */
export function serializeEffectChain(chain: EffectChain): any {
    return {
        pendingEffects: chain.pendingEffects,
        currentEffect: chain.currentEffect,
        interruptStack: chain.interruptStack
    };
}

/**
 * Deserializes an effect chain from GameState
 */
export function deserializeEffectChain(data: any): EffectChain {
    if (!data) {
        return createEffectChain();
    }
    return {
        pendingEffects: data.pendingEffects || [],
        currentEffect: data.currentEffect,
        interruptStack: data.interruptStack || []
    };
}
