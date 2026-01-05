/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Central helper for handling followUpEffect synchronously.
 *
 * CRITICAL: This solves the async timing bug where followUpEffect was processed
 * in onCompleteCallback (async), but AI runs synchronously and never waits for callbacks.
 * This caused "If you do" effects (like "Shift 1. If you do, flip this card") to be skipped.
 *
 * Usage: Call this function BEFORE setting up any requiresAnimation block.
 */

import { GameState, Player, ActionRequired } from '../../../types';
import { findCardOnBoard } from '../helpers/actionUtils';

/**
 * Synchronously queues a followUpEffect to prevent async timing issues.
 *
 * @param state - Current game state
 * @param prevActionRequired - The actionRequired from BEFORE the action was executed
 * @param actor - The player performing the action
 * @param wasActionExecuted - Did the action (shift/delete/flip/return) actually happen?
 * @returns Updated game state with followUpEffect queued (or unchanged if no followUp)
 */
export function queueFollowUpEffectSync(
    state: GameState,
    prevActionRequired: ActionRequired | null,
    actor: Player,
    wasActionExecuted: boolean = true
): GameState {
    if (!prevActionRequired) {
        return state;
    }

    const followUpEffect = (prevActionRequired as any)?.followUpEffect;
    const conditionalType = (prevActionRequired as any)?.conditionalType;
    const sourceCardId = prevActionRequired.sourceCardId;

    if (!followUpEffect || !sourceCardId) {
        return state;  // Nothing to queue
    }

    // if_executed: Only execute if the action was actually performed
    const shouldExecute = conditionalType !== 'if_executed' || wasActionExecuted;
    if (!shouldExecute) {
        console.log('[followUpHelper] Skipping followUpEffect (action was not executed)');
        return state;
    }

    const sourceCardForLog = findCardOnBoard(state, sourceCardId);
    const phaseContext = (state as any)._currentPhaseContext || (state.phase === 'start' ? 'start' : 'end');

    const queuedFollowUp = {
        type: 'execute_follow_up_effect' as const,
        sourceCardId: sourceCardId,
        followUpEffect: followUpEffect,
        actor: actor,
        logContext: {
            indentLevel: 1,
            sourceCardName: sourceCardForLog
                ? `${sourceCardForLog.card.protocol}-${sourceCardForLog.card.value}`
                : undefined,
            phase: phaseContext,
        },
    };

    // Check if already queued to prevent double execution
    const alreadyQueued = (state.queuedActions || []).some(
        (a: any) => a.type === 'execute_follow_up_effect' && a.sourceCardId === sourceCardId
    );
    if (alreadyQueued) {
        console.log('[followUpHelper] followUpEffect already queued, skipping');
        return state;
    }

    console.log('[followUpHelper] Queuing followUpEffect synchronously for', sourceCardForLog?.card.protocol, sourceCardForLog?.card.value);

    return {
        ...state,
        queuedActions: [...(state.queuedActions || []), queuedFollowUp as any]
    };
}

/**
 * Checks if a followUpEffect has already been queued for a given source card.
 * Use this in onCompleteCallback to prevent double execution.
 */
export function isFollowUpAlreadyQueued(state: GameState, sourceCardId: string): boolean {
    return (state.queuedActions || []).some(
        (a: any) => a.type === 'execute_follow_up_effect' && a.sourceCardId === sourceCardId
    );
}
