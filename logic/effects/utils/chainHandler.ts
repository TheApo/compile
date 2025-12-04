/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Effect Chain Handler
 *
 * Manages effect chains and conditionals:
 * - if_executed: Execute follow-up only if previous effect was successful
 * - then: Always execute follow-up after previous effect
 * - Pending effects queue management
 */

import { GameState, Player, PlayedCard, EffectContext, EffectResult } from '../../../types';
import { EffectDefinition } from '../../../types/customProtocol';

/**
 * Pending effects structure stored in state
 */
export interface PendingEffects {
    /** Source card that started the chain */
    sourceCardId: string;
    /** Lane where source card is located */
    laneIndex: number;
    /** Remaining effects to execute */
    effects: EffectDefinition[];
    /** Context for effect execution */
    context: EffectContext;
}

/**
 * Queue remaining effects from a chain for later execution
 */
export function queuePendingEffects(
    state: GameState,
    sourceCardId: string,
    laneIndex: number,
    effects: EffectDefinition[],
    context: EffectContext
): GameState {
    if (effects.length === 0) {
        return state;
    }

    const pending: PendingEffects = {
        sourceCardId,
        laneIndex,
        effects,
        context
    };

    return {
        ...state,
        _pendingCustomEffects: pending
    } as any;
}

/**
 * Get and clear pending effects from state
 */
export function getPendingEffects(state: GameState): {
    pending: PendingEffects | null;
    newState: GameState;
} {
    const pending = (state as any)._pendingCustomEffects as PendingEffects | undefined;

    if (!pending) {
        return { pending: null, newState: state };
    }

    // Clear from state
    const newState = { ...state };
    delete (newState as any)._pendingCustomEffects;

    return { pending, newState };
}

/**
 * Check if there are pending effects
 */
export function hasPendingEffects(state: GameState): boolean {
    const pending = (state as any)._pendingCustomEffects as PendingEffects | undefined;
    return pending !== undefined && pending.effects.length > 0;
}

/**
 * Process conditional chain from effect definition
 *
 * Returns the follow-up effect if conditions are met
 */
export function processConditional(
    effect: EffectDefinition,
    effectWasExecuted: boolean
): EffectDefinition | null {
    const conditional = effect.conditional;

    if (!conditional) {
        return null;
    }

    const thenEffect = conditional.thenEffect;
    if (!thenEffect) {
        return null;
    }

    switch (conditional.type) {
        case 'if_executed':
            // Only execute follow-up if the effect was successfully executed
            if (effectWasExecuted) {
                return thenEffect;
            }
            return null;

        case 'then':
            // Always execute follow-up
            return thenEffect;

        default:
            console.warn(`[Chain Handler] Unknown conditional type: ${conditional.type}`);
            return null;
    }
}

/**
 * Build a flattened list of effects from a chain
 *
 * Useful for understanding the full chain before execution
 */
export function flattenEffectChain(effect: EffectDefinition): EffectDefinition[] {
    const effects: EffectDefinition[] = [effect];

    let current = effect;
    while (current.conditional?.thenEffect) {
        effects.push(current.conditional.thenEffect);
        current = current.conditional.thenEffect;
    }

    return effects;
}

/**
 * Check if an effect has a conditional follow-up
 */
export function hasConditional(effect: EffectDefinition): boolean {
    return effect.conditional !== undefined && effect.conditional.thenEffect !== undefined;
}

/**
 * Get the conditional type of an effect
 */
export function getConditionalType(effect: EffectDefinition): 'if_executed' | 'then' | null {
    if (!effect.conditional) {
        return null;
    }
    return effect.conditional.type || null;
}

/**
 * Create an action to execute remaining effects after a user interaction
 */
export function createExecuteRemainingEffectsAction(
    pending: PendingEffects,
    selectedCardFromPreviousEffect?: string
): any {
    return {
        type: 'execute_remaining_custom_effects',
        sourceCardId: pending.sourceCardId,
        laneIndex: pending.laneIndex,
        effects: pending.effects,
        context: pending.context,
        actor: pending.context.cardOwner,
        selectedCardFromPreviousEffect
    };
}

/**
 * Handle the useCardFromPreviousEffect flag
 *
 * This is used for effects like "Flip 1 card. Draw cards equal to THAT card's value"
 * where the flipped card's value determines the draw count
 */
export function resolveUseCardFromPreviousEffect(
    state: GameState,
    effect: EffectDefinition,
    context: EffectContext
): EffectContext {
    if (!effect.params?.useCardFromPreviousEffect) {
        return context;
    }

    // Get the card ID from state
    const targetCardId = state.lastCustomEffectTargetCardId;
    if (!targetCardId) {
        console.warn('[Chain Handler] useCardFromPreviousEffect set but no target card ID in state');
        return context;
    }

    // The actual card value will be resolved by the effect executor
    // We just need to ensure the context knows to look for it
    return {
        ...context,
        referencedCard: { id: targetCardId } as PlayedCard
    } as EffectContext;
}

/**
 * Store the target card ID for chain reference
 */
export function storeTargetCardId(state: GameState, cardId: string): GameState {
    return {
        ...state,
        lastCustomEffectTargetCardId: cardId
    };
}

/**
 * Clear the stored target card ID
 */
export function clearTargetCardId(state: GameState): GameState {
    const newState = { ...state };
    delete newState.lastCustomEffectTargetCardId;
    return newState;
}

/**
 * Check if the effect chain was interrupted (e.g., by a reactive effect)
 */
export function wasChainInterrupted(state: GameState): boolean {
    return state.actionRequired !== null || state._interruptedTurn !== undefined;
}

/**
 * Prepare state for continuing a chain after an interruption
 */
export function prepareChainContinuation(
    state: GameState,
    remainingEffects: EffectDefinition[],
    context: EffectContext,
    sourceCardId: string,
    laneIndex: number
): GameState {
    if (remainingEffects.length === 0) {
        return state;
    }

    // Queue the remaining effects
    return queuePendingEffects(state, sourceCardId, laneIndex, remainingEffects, context);
}
