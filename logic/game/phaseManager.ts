/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, GamePhase, PlayedCard, ActionRequired, EffectContext } from '../../types';
import { executeStartPhaseEffects, executeEndPhaseEffects, executeOnPlayEffect } from '../effectExecutor';
import { calculateCompilableLanes, recalculateAllLaneValues } from './stateManager';
import { findCardOnBoard, isCardUncovered, isCardPhysicallyUncovered, internalShiftCard, handleUncoverEffect } from './helpers/actionUtils';
import { drawForPlayer, findAndFlipCards } from '../../utils/gameStateModifiers';
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from '../utils/log';
// NOTE: handleAnarchyConditionalDraw removed - old Anarchy-0 code is no longer used, custom protocol handles this
import { getActivePassiveRules } from './passiveRuleChecker';
import { executeCustomEffect } from '../customProtocols/effectInterpreter';

const checkControlPhase = (state: GameState): GameState => {
    if (!state.useControlMechanic) {
        return state;
    }

    const player = state.turn;
    const opponent = player === 'player' ? 'opponent' : 'player';

    const playerState = state[player];
    const opponentState = state[opponent];

    let playerWins = 0;

    const playerValue0 = playerState.laneValues[0];
    const playerValue1 = playerState.laneValues[1];
    const playerValue2 = playerState.laneValues[2];

    // A "line" is a direct vertical comparison of protocols and their lanes.
    const opponentValue0 = opponentState.laneValues[0];
    const opponentValue1 = opponentState.laneValues[1];
    const opponentValue2 = opponentState.laneValues[2];

    if (playerValue0 > opponentValue0) playerWins++;
    if (playerValue1 > opponentValue1) playerWins++;
    if (playerValue2 > opponentValue2) playerWins++;

    if (playerWins >= 2) {
        if (state.controlCardHolder !== player) {
            // IMPORTANT: Clear effect context before logging control phase changes
            let newState = setLogSource(state, undefined);
            newState = setLogPhase(newState, undefined);
            newState = { ...newState, _logIndentLevel: 0 };

            const playerName = player === 'player' ? 'Player' : 'Opponent';
            newState = log(newState, player, `${playerName} gains the Control Component.`);
            return { ...newState, controlCardHolder: player };
        }
    }

    return state;
}

export const advancePhase = (state: GameState): GameState => {
    if (state.winner) return state;

    const turnPlayer = state.turn;
    let nextState = { ...state };

    // CRITICAL: Clear ALL effect context (indent, source, phase) at EVERY phase boundary
    // This ensures that phase-level logs are never indented or prefixed with card names
    nextState = setLogSource(nextState, undefined);
    nextState = setLogPhase(nextState, undefined);
    nextState = { ...nextState, _logIndentLevel: 0 };

    switch (state.phase) {
        case 'start':
            nextState = executeStartPhaseEffects(nextState).newState;
            // If the start phase required an action, it will be set. Don't advance phase.
            if (nextState.actionRequired) return nextState;

            // Clear context again before transitioning to control phase
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };
            // Clear start phase snapshot when leaving start phase
            nextState._startPhaseEffectSnapshot = undefined;
            return { ...nextState, phase: 'control' };

        case 'control': {
            const stateAfterControl = checkControlPhase(nextState);

            // Clear context again before transitioning to compile phase
            let cleanState = setLogSource(stateAfterControl, undefined);
            cleanState = setLogPhase(cleanState, undefined);
            cleanState = { ...cleanState, _logIndentLevel: 0 };
            return { ...cleanState, phase: 'compile' };
        }

        case 'compile': {
            const compilableLanes = calculateCompilableLanes(nextState, turnPlayer);
            if (compilableLanes.length > 0) {
                return { ...nextState, compilableLanes }; // Stay in compile phase, wait for input
            }

            // Clear context again before transitioning to action phase
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };
            return { ...nextState, phase: 'action', compilableLanes: [] }; // Move to action phase
        }

        case 'action':
             // This transition is triggered manually by other functions after an action is completed.
             // Clear context again before transitioning to hand_limit phase
             nextState = setLogSource(nextState, undefined);
             nextState = setLogPhase(nextState, undefined);
             nextState = { ...nextState, _logIndentLevel: 0 };
             return { ...nextState, phase: 'hand_limit' };

        case 'hand_limit': {
            const playerState = nextState[turnPlayer];

            // Check for Spirit-0 (hardcoded - must be face-up and uncovered)
            const hasSpirit0 = playerState.lanes.some(lane =>
                lane.length > 0 &&
                lane[lane.length - 1].isFaceUp &&
                lane[lane.length - 1].protocol === 'Spirit' &&
                lane[lane.length - 1].value === 0
            );

            // Check for custom cards with skip_check_cache_phase passive rule
            const passiveRules = getActivePassiveRules(nextState);
            const hasSkipCacheRule = passiveRules.some(({ rule, cardOwner }) =>
                rule.type === 'skip_check_cache_phase' &&
                (rule.target === 'self' && cardOwner === turnPlayer || rule.target === 'all') &&
                cardOwner === turnPlayer
            );

            if (hasSpirit0 || hasSkipCacheRule) {
                let stateWithLog = log(nextState, turnPlayer, "Skipping Check Cache phase.");

                // Clear context again before transitioning to end phase
                stateWithLog = setLogSource(stateWithLog, undefined);
                stateWithLog = setLogPhase(stateWithLog, undefined);
                stateWithLog = { ...stateWithLog, _logIndentLevel: 0 };
                return { ...stateWithLog, phase: 'end' };
            }

            if (playerState.hand.length > 5) {
                const cardsToDiscard = playerState.hand.length - 5;
                const playerName = turnPlayer === 'player' ? 'Player' : 'Opponent';
                let stateWithLog = log(nextState, turnPlayer, `Check Cache: ${playerName} has ${playerState.hand.length} cards, must discard ${cardsToDiscard}.`);
                // Increase indent for the discard actions that follow
                stateWithLog = increaseLogIndent(stateWithLog);
                return {
                    ...stateWithLog,
                    actionRequired: { type: 'discard', actor: turnPlayer, count: cardsToDiscard }
                };
            }

            // Hand limit is fine, move to end phase.
            // Clear context again before transitioning to end phase
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };
            return { ...nextState, phase: 'end' };
        }

        case 'end': {

            // Clear end phase snapshot at the beginning of end phase processing
            // (it will be recreated if needed by executeEndPhaseEffects)
            const stateBeforeEffects = { ...nextState };
            nextState = executeEndPhaseEffects(nextState).newState;

            const actionBefore = stateBeforeEffects.actionRequired;
            const actionAfter = nextState.actionRequired;

            // If the end phase effects created a NEW action, we should pause and wait for it.
            if (actionAfter && actionAfter !== actionBefore) {
                 return nextState;
            }

            // FIX: Check if there are queued actions before ending the turn.
            // Process the queue to pop the next action.
            if (nextState.queuedActions && nextState.queuedActions.length > 0) {
                nextState = processEndOfAction(nextState);
                // If processEndOfAction created an action, return it
                if (nextState.actionRequired) {
                    return nextState;
                }
                // Otherwise, the queue was cleared, continue to end the turn
            }

            // If no new action was generated, the turn is over.
            const nextTurn: Player = turnPlayer === 'player' ? 'opponent' : 'player';
            // The `cannotCompile` flag applies for one turn. Now that this player's turn is over,
            // we can reset their flag so they are able to compile on their *next* turn.
            const endingPlayerState = {...nextState[turnPlayer], cannotCompile: false};

            // CRITICAL: Clear ALL context before transitioning to the next turn
            nextState = setLogSource(nextState, undefined);
            nextState = setLogPhase(nextState, undefined);
            nextState = { ...nextState, _logIndentLevel: 0 };

            // CRITICAL: Recalculate ALL lane values at the start of a new turn
            // This ensures values are correct after effects like flipSelf that may not trigger recalculation
            nextState = recalculateAllLaneValues(nextState);

            return {
                ...nextState,
                [turnPlayer]: endingPlayerState, // Apply the reset to the player whose turn just ended
                turn: nextTurn,
                phase: 'start',
                processedStartEffectIds: [],
                processedEndEffectIds: [],
                processedSpeed1TriggerThisTurn: false,
                processedUncoverEventIds: [],
                // CRITICAL: Clear phase effect snapshots when starting a new turn
                _startPhaseEffectSnapshot: undefined,
                _endPhaseEffectSnapshot: undefined,
                // CRITICAL: Clear interrupt state when starting a new turn
                _interruptedTurn: undefined,
                _interruptedPhase: undefined,
            };
        }
    }
    return state; // Should not be reached
};

/**
 * CENTRAL QUEUE HELPER: Automatically queue pending custom effects
 * This ensures that multi-effect cards (like Chaos-1) always work correctly
 * regardless of which resolver was used.
 */
export function queuePendingCustomEffects(state: GameState): GameState {
    const pendingEffects = (state as any)._pendingCustomEffects;

    if (!pendingEffects || pendingEffects.effects.length === 0) {
        return state; // No pending effects, nothing to do
    }
    console.log('[queuePendingCustomEffects] Queueing effects for sourceCardId:', pendingEffects.sourceCardId, 'effects:', pendingEffects.effects?.map((e: any) => ({ id: e.id, action: e.params?.action, hasConditional: !!e.conditional })));

    // CRITICAL FIX: Check if these exact effects are already queued (by sourceCardId AND effect IDs)
    // This prevents double-queueing when card deletion triggers uncover + callback restoration
    const pendingEffectIds = pendingEffects.effects.map((e: any) => e.id).join(',');
    const alreadyQueued = state.queuedActions?.some((action: any) =>
        action.type === 'execute_remaining_custom_effects' &&
        action.sourceCardId === pendingEffects.sourceCardId &&
        action.effects?.map((e: any) => e.id).join(',') === pendingEffectIds
    );

    if (alreadyQueued) {
        // Effects already in queue - just clear _pendingCustomEffects without re-adding
        const newState = { ...state };
        delete (newState as any)._pendingCustomEffects;
        return newState;
    }

    // CRITICAL FIX: Capture lastCustomEffectTargetCardId for "Flip X. Shift THAT card" effects
    // The target card ID is set when the user selects a card, and must be preserved
    // for the remaining effects that use useCardFromPreviousEffect
    const targetCardId = pendingEffects.selectedCardFromPreviousEffect || state.lastCustomEffectTargetCardId;

    const pendingAction: any = {
        type: 'execute_remaining_custom_effects',
        sourceCardId: pendingEffects.sourceCardId,
        laneIndex: pendingEffects.laneIndex,
        effects: pendingEffects.effects,
        context: pendingEffects.context,
        actor: pendingEffects.context.cardOwner,
        selectedCardFromPreviousEffect: targetCardId,
        // Log-Kontext weitergeben für korrekte Einrückung/Quellkarte nach Interrupts
        logSource: pendingEffects.logSource,
        logPhase: pendingEffects.logPhase,
        logIndentLevel: pendingEffects.logIndentLevel
    };

    // Queue the pending effects
    // CRITICAL FIX: Add at BEGINNING for LIFO order - child effects must complete before parent effects
    const newState = {
        ...state,
        queuedActions: [
            pendingAction,
            ...(state.queuedActions || [])
        ]
    };

    // Clear from state after queueing
    delete (newState as any)._pendingCustomEffects;

    return newState;
}

/**
 * Process only the queued actions without advancing phases.
 * Use this when you want to resolve queued effects but stay in the current phase.
 */
export const processQueuedActions = (state: GameState): GameState => {
    // CRITICAL: Check for pending custom effects FIRST before processing queue
    let mutableState = queuePendingCustomEffects(state);

    // CRITICAL: Handle _pendingFollowUpEffect (queued from discardResolver when reactive effects interrupted)
    // This is the SINGLE POINT OF TRUTH for executing followUpEffect after discard
    const pendingFollowUp = (mutableState as any)._pendingFollowUpEffect;
    if (pendingFollowUp && !mutableState.actionRequired) {
        const { followUpEffect, conditionalType, previousHandSize, sourceCardId, actor, savedIndentLevel } = pendingFollowUp;
        delete (mutableState as any)._pendingFollowUpEffect;

        // Find source card and execute followUpEffect
        const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
        if (sourceCardInfo) {
            const actorPlayer = actor as 'player' | 'opponent';
            const currentHandSize = mutableState[actorPlayer].hand.length;
            const discardedCount = Math.max(0, (previousHandSize || 0) - currentHandSize);
            const shouldExecute = conditionalType === 'then' || (conditionalType === 'if_executed' && discardedCount > 0);

            if (shouldExecute) {
                // Set log context
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = setLogSource(mutableState, cardName);
                mutableState = setLogPhase(mutableState, 'middle');
                if (savedIndentLevel !== undefined) {
                    mutableState = { ...mutableState, _logIndentLevel: savedIndentLevel };
                }

                // Find lane index
                let laneIndex = -1;
                for (let i = 0; i < mutableState[sourceCardInfo.owner].lanes.length; i++) {
                    if (mutableState[sourceCardInfo.owner].lanes[i].some(c => c.id === sourceCardId)) {
                        laneIndex = i;
                        break;
                    }
                }

                if (laneIndex !== -1) {
                    const context: EffectContext = {
                        cardOwner: sourceCardInfo.owner,
                        opponent: sourceCardInfo.owner === 'player' ? 'opponent' as Player : 'player' as Player,
                        currentTurn: mutableState.turn,
                        actor: actorPlayer,
                        discardedCount: discardedCount,
                    };

                    const result = executeCustomEffect(sourceCardInfo.card, laneIndex, mutableState, context, followUpEffect);
                    mutableState = result.newState;

                    // If effect created actionRequired, return it
                    if (mutableState.actionRequired) {
                        return mutableState;
                    }
                }
            }
        }
    }

    // Check for a queued ACTION first.
    if (!mutableState.queuedActions || mutableState.queuedActions.length === 0) {
        // CRITICAL FIX: If queue is empty but there ARE deferred parent effects on the stack,
        // we need to pop the top parent effect and process it.
        // This handles 3+ level nesting where a grandchild (Light-5) finishes with actionRequired
        // but has no remaining effects, so there's no execute_remaining_custom_effects queued.
        // Example: Smoke-1 → Test-1 → Light-5 (discard) - after Light-5 finishes, Test-1 must continue!
        const deferredStack = (mutableState as any)._deferredParentEffects;
        if (deferredStack && deferredStack.length > 0 && !mutableState.actionRequired) {
            // Pop the last (most recent) parent from the stack (LIFO order)
            const parentEffect = deferredStack[deferredStack.length - 1];
            const remainingStack = deferredStack.slice(0, -1);

            // Create a queued action for the parent's remaining effects
            const parentAction: any = {
                type: 'execute_remaining_custom_effects',
                sourceCardId: parentEffect.sourceCardId,
                laneIndex: parentEffect.laneIndex,
                effects: parentEffect.effects,
                context: parentEffect.context,
                actor: parentEffect.actor || parentEffect.context?.cardOwner,
                selectedCardFromPreviousEffect: parentEffect.selectedCardFromPreviousEffect,
                savedLastCustomEffectTargetCardId: parentEffect.savedLastCustomEffectTargetCardId,
                logSource: parentEffect.logSource,
                logPhase: parentEffect.logPhase,
                logIndentLevel: parentEffect.logIndentLevel
            };

            // Recursively process the parent's remaining effects
            return processQueuedActions({
                ...mutableState,
                _deferredParentEffects: remainingStack.length > 0 ? remainingStack : undefined,
                lastCustomEffectTargetCardId: parentEffect.savedLastCustomEffectTargetCardId || parentEffect.selectedCardFromPreviousEffect,
                queuedActions: [parentAction]
            });
        }
        return mutableState;
    }

    let queuedActions = [...mutableState.queuedActions];

    while (queuedActions.length > 0) {
        const nextAction = queuedActions.shift()!;

        // Rule: An effect is cancelled if its source card is no longer on the board or face-up.
        // EXCEPTION: flip_self has its own specific checks
        if (nextAction.sourceCardId && nextAction.type !== 'flip_self') {
            const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                // CRITICAL: Temporarily set log source to the cancelled card, not the current context
                const previousLogSource = (mutableState as any)._logSource;
                mutableState = setLogSource(mutableState, cardName);
                mutableState = log(mutableState, nextAction.actor, `Queued effect was cancelled because the source is no longer active.`);
                mutableState = setLogSource(mutableState, previousLogSource);
                continue; // Skip this action
            }
        }

        // --- Auto-resolving actions ---
        // NOTE: "discard all" is now auto-executed in effectInterpreter.ts

        // GENERIC: Auto-resolve flip_self actions (Water-0, Psychic-4, custom protocols)
        if (nextAction.type === 'flip_self') {
            const { sourceCardId, actor } = nextAction as { type: string, sourceCardId: string, actor: Player };
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

            // CRITICAL: Only execute if source card is still on the board, face-up AND uncovered
            // Commands are only active when uncovered, so the self-flip must be cancelled if source is covered
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                const reason = !sourceCardInfo ? 'deleted' :
                              !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                              'now covered';
                mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        // GENERIC: Auto-resolve execute_follow_up_effect actions (Speed-3 "If you do, flip this card")
        // This handles conditional effects that were queued because an interrupt (uncover) occurred
        if (nextAction.type === 'execute_follow_up_effect') {
            const { sourceCardId, followUpEffect, actor, logContext } = nextAction as any;
            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
            const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

            // CRITICAL: Only execute if source card is still on the board, face-up AND uncovered
            if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                const lane = mutableState[sourceCardInfo.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                const laneIdx = mutableState[sourceCardInfo.owner].lanes.indexOf(lane!);
                const context = {
                    cardOwner: sourceCardInfo.owner,
                    actor: actor,
                    currentTurn: mutableState.turn,
                    opponent: (sourceCardInfo.owner === 'player' ? 'opponent' : 'player') as Player,
                };

                // CRITICAL: Restore log context so followUp appears indented under original effect
                // Use sourceCardName from logContext, with fallback to sourceCardInfo
                const cardName = (logContext?.sourceCardName) || `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                // Determine phase context - use logContext.phase, fallback to current game phase
                const phaseContext = logContext?.phase || (mutableState.phase === 'start' ? 'start' : 'end');
                mutableState = {
                    ...mutableState,
                    _logIndentLevel: logContext?.indentLevel || 1,
                    _currentEffectSource: cardName,
                    _currentPhaseContext: phaseContext as 'start' | 'end',
                };

                const result = executeCustomEffect(sourceCardInfo.card, laneIdx, mutableState, context, followUpEffect);
                mutableState = result.newState;

                // If the followUpEffect created a new actionRequired, we need to pause
                if (mutableState.actionRequired) {
                    mutableState = { ...mutableState, queuedActions };
                    return mutableState;
                }
            } else {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                const reason = !sourceCardInfo ? 'deleted' :
                              !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                              'now covered';
                mutableState = log(mutableState, actor, `The follow-up effect from ${cardName} was cancelled because it is ${reason}.`);
            }
            continue; // Action resolved (or cancelled), move to next in queue
        }

        // GENERIC: Auto-resolve execute_conditional_followup actions
        // This handles conditional.thenEffect that was queued because a reactive effect (like after_draw)
        // interrupted the original effect with a DIFFERENT card's actionRequired.
        // Example: Death-1's "draw, if you do delete other then delete self" gets interrupted by Spirit-3's after_draw
        if (nextAction.type === 'execute_conditional_followup') {
            const { sourceCardId, laneIndex, followUpEffect, context, actor } = nextAction as any;

            // Find the source card
            const sourceCard = [...mutableState.player.lanes.flat(), ...mutableState.opponent.lanes.flat()]
                .find(c => c.id === sourceCardId);

            if (!sourceCard) {
                // Card no longer exists (was deleted) - skip the followUp
                mutableState = log(mutableState, actor, `Conditional follow-up effect skipped: source card no longer exists.`);
                continue;
            }

            // CRITICAL: Check if the source card is still face-up
            // If it was flipped face-down, the conditional effect should be cancelled
            if (!sourceCard.isFaceUp) {
                const cardName = `${sourceCard.protocol}-${sourceCard.value}`;
                mutableState = log(mutableState, actor, `Conditional follow-up effect from ${cardName} cancelled: card was flipped face-down.`);
                continue;
            }

            // Execute the followUp effect
            const result = executeCustomEffect(sourceCard, laneIndex, mutableState, context, followUpEffect);
            mutableState = recalculateAllLaneValues(result.newState);

            // If followUp created actionRequired, return it
            if (mutableState.actionRequired) {
                // If followUp has its own nested conditional, attach it
                if (followUpEffect.conditional && followUpEffect.conditional.thenEffect) {
                    mutableState.actionRequired = {
                        ...mutableState.actionRequired,
                        followUpEffect: followUpEffect.conditional.thenEffect,
                        conditionalType: followUpEffect.conditional.type,
                    } as any;
                }
                mutableState = { ...mutableState, queuedActions };
                return mutableState;
            }

            // If followUp has its own conditional.thenEffect and completed immediately, execute it recursively
            if (followUpEffect.conditional && followUpEffect.conditional.thenEffect) {
                const nestedResult = executeCustomEffect(sourceCard, laneIndex, mutableState, context, followUpEffect.conditional.thenEffect);
                mutableState = recalculateAllLaneValues(nestedResult.newState);
                if (mutableState.actionRequired) {
                    mutableState = { ...mutableState, queuedActions };
                    return mutableState;
                }
            }

            continue; // Action resolved, move to next in queue
        }

        // NOTE: discard_completed is now handled directly in discardResolver via executeFollowUpAfterDiscard
        // and _pendingFollowUpEffect at the top of processQueuedActions

        // Internal queue action type for executing remaining custom effects
        if ((nextAction as any).type === 'execute_remaining_custom_effects') {
            const {
                sourceCardId,
                laneIndex,
                effects,
                context,
                selectedCardFromPreviousEffect,
                // Log-Kontext aus Action extrahieren
                logSource,
                logPhase,
                logIndentLevel
            } = nextAction as any;
            console.log('[phaseManager] execute_remaining_custom_effects for sourceCardId:', sourceCardId, 'effects:', effects?.map((e: any) => ({ id: e.id, action: e.params?.action, hasConditional: !!e.conditional })));

            // Log-Kontext wiederherstellen VOR der Effekt-Ausführung
            if (logSource !== undefined) {
                mutableState = { ...mutableState, _currentEffectSource: logSource };
            }
            if (logPhase !== undefined) {
                mutableState = { ...mutableState, _currentPhaseContext: logPhase };
            }
            if (logIndentLevel !== undefined) {
                mutableState = { ...mutableState, _logIndentLevel: logIndentLevel };
            }

            const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);

            // CRITICAL: Check if source card still exists and is active
            if (!sourceCardInfo) {
                mutableState = log(mutableState, context.cardOwner, `Remaining effects cancelled because the source card was deleted or returned.`);
                continue;
            }

            if (!sourceCardInfo.card.isFaceUp) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, context.cardOwner, `Remaining effects from ${cardName} cancelled because it was flipped face-down.`);
                continue;
            }

            // Check if source card is still PHYSICALLY uncovered
            // CRITICAL FIX: Top effects (start/end triggers) work even when covered, per rules!
            // Only bottom effects require the card to be uncovered.
            // Per rules: "Top box effects are active if the card is face-up, even if covered"
            // But for middle/bottom effects: "The remainder of darkness 0 effect... does NOT trigger as its middle text is now covered"
            const isTopEffect = context.triggerType === 'start' || context.triggerType === 'end';
            const sourceIsUncovered = isCardPhysicallyUncovered(mutableState, sourceCardId);

            if (!sourceIsUncovered && !isTopEffect) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                mutableState = log(mutableState, context.cardOwner, `Remaining effects from ${cardName} cancelled because it is now covered.`);
                continue;
            }

            // CRITICAL FIX: Restore lastCustomEffectTargetCardId from savedLastCustomEffectTargetCardId
            // This is needed for 3+ level nesting where grandchild effects overwrite the target ID
            const savedTargetId = (nextAction as any).savedLastCustomEffectTargetCardId;
            if (savedTargetId) {
                mutableState.lastCustomEffectTargetCardId = savedTargetId;
            }

            // If we have a selected card from previous effect (e.g., "Flip 1 card. Shift THAT card"), store it
            if (selectedCardFromPreviousEffect) {
                (mutableState as any)._selectedCardFromPreviousEffect = selectedCardFromPreviousEffect;
                // CRITICAL: Also set lastCustomEffectTargetCardId so that useCardFromPreviousEffect works
                // This is needed because the shift effect checks lastCustomEffectTargetCardId first
                // Only set if not already set by savedLastCustomEffectTargetCardId above
                if (!savedTargetId) {
                    mutableState.lastCustomEffectTargetCardId = selectedCardFromPreviousEffect;
                }
            }

            // Execute remaining effects sequentially
            for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
                const effectDef = effects[effectIndex];
                const result = executeCustomEffect(sourceCardInfo.card, laneIndex, mutableState, context, effectDef);
                mutableState = result.newState;

                // CRITICAL: If this effect has animations AND no actionRequired, show them
                // But if actionRequired is set, prioritize it over animations
                if (result.animationRequests && result.animationRequests.length > 0 && !mutableState.actionRequired) {

                    const remainingEffects = effects.slice(effectIndex + 1);

                    // If there are more effects after this one, queue them to execute AFTER animations
                    if (remainingEffects.length > 0) {
                        const nextAction: any = {
                            type: 'execute_remaining_custom_effects',
                            sourceCardId,
                            laneIndex,
                            effects: remainingEffects,
                            context,
                            actor: context.cardOwner,
                            // Log-Kontext mitspeichern für korrekte Einrückung/Quellkarte
                            logSource: mutableState._currentEffectSource,
                            logPhase: mutableState._currentPhaseContext,
                            logIndentLevel: mutableState._logIndentLevel || 0
                        };
                        mutableState.queuedActions = [nextAction, ...(queuedActions || [])];
                    } else {
                        // No more effects - restore original queue
                        mutableState.queuedActions = queuedActions;
                    }

                    // Set animation state so it displays
                    // Take the FIRST animation request (show one at a time)
                    const firstAnimation = result.animationRequests[0];
                    if (firstAnimation.type === 'draw') {
                        mutableState.animationState = {
                            type: 'drawCard',
                            owner: firstAnimation.player as Player,
                            cardIds: [] // Draw animations are handled separately
                        };
                    } else if (firstAnimation.type === 'play') {
                        mutableState.animationState = {
                            type: 'playCard',
                            cardId: firstAnimation.cardId,
                            owner: firstAnimation.owner
                        };
                    } else if (firstAnimation.type === 'delete') {
                        mutableState.animationState = {
                            type: 'deleteCard',
                            cardId: firstAnimation.cardId,
                            owner: firstAnimation.owner
                        };
                    }

                    // Return to trigger animation display - queue will continue after animation
                    return mutableState;
                }

                // If an action is required, stop and save remaining effects
                if (mutableState.actionRequired) {
                    const remainingEffects = effects.slice(effectIndex + 1);

                    // CRITICAL: Save remaining effects to be executed after this action completes
                    if (remainingEffects.length > 0) {
                        (mutableState as any)._pendingCustomEffects = {
                            sourceCardId,
                            laneIndex,
                            context,
                            effects: remainingEffects,
                            // Log-Kontext mitspeichern für korrekte Einrückung/Quellkarte
                            logSource: mutableState._currentEffectSource,
                            logPhase: mutableState._currentPhaseContext,
                            logIndentLevel: mutableState._logIndentLevel || 0
                        };
                    }

                    // CRITICAL: If there's an interrupted turn, restore it before returning
                    // This ensures the turn is correct when the action is displayed to the user
                    if (mutableState._interruptedTurn) {
                        const originalTurnPlayer = mutableState._interruptedTurn;
                        const originalPhase = mutableState._interruptedPhase || mutableState.phase;
                        delete mutableState._interruptedTurn;
                        delete mutableState._interruptedPhase;
                        mutableState.turn = originalTurnPlayer;
                        mutableState.phase = originalPhase;
                    }

                    mutableState.queuedActions = queuedActions; // Save remaining queue
                    return mutableState;
                }
            }

            // CRITICAL FIX: After ALL effects of this card (child) are done via execute_remaining_custom_effects,
            // pop parent effects from the deferred stack and QUEUE them to execute next.
            // This ensures correct effect chain order: Child completes ALL effects → Parent resumes
            const deferredStack = (mutableState as any)._deferredParentEffects;
            if (deferredStack && deferredStack.length > 0) {
                // Pop the last (most recent) parent from the stack (LIFO order)
                const parentEffect = deferredStack[deferredStack.length - 1];
                const remainingStack = deferredStack.slice(0, -1);

                // CRITICAL: Create a queued action for the parent's remaining effects
                // and add it to the FRONT of the queue so it executes next
                const parentAction: any = {
                    type: 'execute_remaining_custom_effects',
                    sourceCardId: parentEffect.sourceCardId,
                    laneIndex: parentEffect.laneIndex,
                    effects: parentEffect.effects,
                    context: parentEffect.context,
                    actor: parentEffect.actor || parentEffect.context?.cardOwner,
                    selectedCardFromPreviousEffect: parentEffect.selectedCardFromPreviousEffect,
                    // CRITICAL FIX: Pass through savedLastCustomEffectTargetCardId for 3+ level nesting
                    savedLastCustomEffectTargetCardId: parentEffect.savedLastCustomEffectTargetCardId,
                    logSource: parentEffect.logSource,
                    logPhase: parentEffect.logPhase,
                    logIndentLevel: parentEffect.logIndentLevel
                };

                // Add parent action to the FRONT of remaining queue so it executes next
                queuedActions = [parentAction, ...(queuedActions || [])];

                mutableState = {
                    ...mutableState,
                    _deferredParentEffects: remainingStack.length > 0 ? remainingStack : undefined,
                    // CRITICAL FIX: Restore lastCustomEffectTargetCardId so "shift THAT card" works correctly
                    lastCustomEffectTargetCardId: parentEffect.savedLastCustomEffectTargetCardId || parentEffect.selectedCardFromPreviousEffect
                };
            }

            continue; // Action resolved, move to next in queue
        }

        // NOTE: speed_3_self_flip_after_shift now handled via generic flip_self action type

        if (nextAction.type === 'reveal_opponent_hand') {
            const opponentId = mutableState.turn === 'player' ? 'opponent' : 'player';
            const opponentState = { ...mutableState[opponentId] };

            if (opponentState.hand.length > 0) {
                opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
                mutableState[opponentId] = opponentState;
                const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent reveals their hand.`);
            } else {
                const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent has no cards to reveal.`);
            }
            continue; // Action resolved, move to next in queue
        }

        // GENERIC: Auto-resolve pending_uncover_effect actions (bulk delete uncovered multiple cards)
        if (nextAction.type === 'pending_uncover_effect') {
            const { owner, laneIndex } = nextAction as any;

            const uncoverResult = handleUncoverEffect(mutableState, owner, laneIndex);
            mutableState = uncoverResult.newState;

            // If uncover created an actionRequired, pause and save remaining queue
            if (mutableState.actionRequired) {
                mutableState.queuedActions = queuedActions;
                return mutableState;
            }
            continue; // Action resolved, move to next in queue
        }

        // NOTE: Legacy gravity_2_shift_after_flip, select_any_opponent_card_to_shift, shift_flipped_card_optional
        // now use generic select_card_to_shift with followUpEffect parameters

        // CRITICAL FIX: When dequeuing a discard action, re-check hand size.
        // The hand size may have changed since the action was queued (e.g., War-3 reactive played a card).
        // This prevents softlocks where player is asked to discard with 0 cards.
        if (nextAction.type === 'discard' && nextAction.actor) {
            const discardActor = nextAction.actor as 'player' | 'opponent';
            const currentHandSize = mutableState[discardActor].hand.length;
            const requiredCount = (nextAction as any).count || 1;

            if (currentHandSize === 0) {
                // Actor has no cards - skip this discard action entirely
                const actorName = discardActor === 'player' ? 'Player' : 'Opponent';

                // Set context from source card if available for proper log formatting
                if (nextAction.sourceCardId) {
                    const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                    if (sourceCard) {
                        const cardName = `${sourceCard.card.protocol}-${sourceCard.card.value}`;
                        mutableState = setLogSource(mutableState, cardName);
                        mutableState = setLogPhase(mutableState, 'middle');
                        // Restore saved indent level for correct nesting
                        const savedIndent = (nextAction as any)._savedIndentLevel;
                        if (savedIndent !== undefined) {
                            mutableState = { ...mutableState, _logIndentLevel: savedIndent };
                        }
                    }
                }

                mutableState = log(mutableState, discardActor, `${actorName} has no cards to discard - effect skipped.`);

                // Clear context after logging
                mutableState = setLogSource(mutableState, undefined);
                mutableState = setLogPhase(mutableState, undefined);
                mutableState = { ...mutableState, _logIndentLevel: 0 };

                continue; // Skip to next queued action
            } else if (typeof requiredCount === 'number' && currentHandSize < requiredCount) {
                // Actor has fewer cards than required - adjust count
                (nextAction as any).count = currentHandSize;
            }
        }

        // --- If we reach here, the action is not auto-resolving and is possible ---
        mutableState.actionRequired = nextAction;
        mutableState.queuedActions = queuedActions; // Update the state with the rest of the queue
        return mutableState; // Break loop and return to wait for user/AI input
    }

    // All queued actions were auto-resolved or impossible.
    return { ...mutableState, queuedActions: [], actionRequired: null };
};

export const processEndOfAction = (state: GameState): GameState => {
    if (state.winner) return state;

    // Internal execute_remaining_custom_effects is handled via queuedActions

    // This is the crucial check. If an action is required, the turn cannot end.
    // This handles both actions for the current turn player (which the AI manager will loop on)
    // and interrupt actions for the other player (which the useGameState hook will trigger the AI for).
    if (state.actionRequired) {
        return state;
    }

    // CRITICAL FIX: Process queued actions BEFORE checking for interrupts.
    // This ensures actions like gravity_2_shift_after_flip are processed even when
    // there's no interrupt (e.g., opponent flips their own card, triggering their own discard).
    // CRITICAL FIX #2: Also check for _deferredParentEffects stack - this handles cases where:
    // - Water-0 flips Water-4 → Water-4's return completes with NO queuedActions
    // - But _deferredParentEffects still has Water-0's flip_self waiting!
    // Without this check, parent effects in the deferred stack would never execute.
    const hasDeferredParentEffects = (state as any)._deferredParentEffects && (state as any)._deferredParentEffects.length > 0;
    if ((state.queuedActions && state.queuedActions.length > 0) || hasDeferredParentEffects) {
        const stateAfterQueue = processQueuedActions(state);
        // If queued actions created a new actionRequired, return immediately
        if (stateAfterQueue.actionRequired) {
            return stateAfterQueue;
        }
        // Continue with the processed state
        state = stateAfterQueue;
    }

    // Check for a completed interrupt first.
    if (state._interruptedTurn) {
        const originalTurnPlayer = state._interruptedTurn;
        const originalPhase = state._interruptedPhase || state.phase;
        let restoredState = { ...state };
        delete restoredState._interruptedTurn;
        delete restoredState._interruptedPhase;
        restoredState.turn = originalTurnPlayer;
        restoredState.phase = originalPhase;

        // CRITICAL FIX: If interrupt happened during start/end phase, process queued actions first,
        // then return to let the normal phase progression continue (via runOpponentTurn).
        // Otherwise the while-loop below will advance phases without giving the AI a chance to act.
        if (originalPhase === 'start' || originalPhase === 'end') {
            // FIX: Process queued actions (like flip_self_for_psychic_4) before returning
            if (restoredState.queuedActions && restoredState.queuedActions.length > 0) {
                restoredState = processQueuedActions(restoredState);
            }
            // If queued actions were processed and no new actionRequired was created,
            // AND we're in end phase, check for remaining end effects FIRST before ending the turn.
            if (!restoredState.actionRequired && originalPhase === 'end') {
                // CRITICAL FIX: Re-check for remaining END phase effects before ending turn
                const stateAfterEndRecheck = executeEndPhaseEffects(restoredState).newState;
                if (stateAfterEndRecheck.actionRequired) {
                    return stateAfterEndRecheck;
                }

                // No more end effects - NOW end the turn
                const nextTurn: Player = stateAfterEndRecheck.turn === 'player' ? 'opponent' : 'player';
                const endingPlayerState = {...stateAfterEndRecheck[stateAfterEndRecheck.turn], cannotCompile: false};

                // CRITICAL: Clear ALL context before transitioning to the next turn
                let finalState = setLogSource(stateAfterEndRecheck, undefined);
                finalState = setLogPhase(finalState, undefined);
                finalState = { ...finalState, _logIndentLevel: 0 };

                // CRITICAL: Recalculate ALL lane values at the start of a new turn
                finalState = recalculateAllLaneValues(finalState);

                return {
                    ...finalState,
                    [stateAfterEndRecheck.turn]: endingPlayerState,
                    turn: nextTurn,
                    phase: 'start',
                    processedStartEffectIds: [],
                    processedEndEffectIds: [],
                    processedSpeed1TriggerThisTurn: false,
                    processedUncoverEventIds: [],
                    // CRITICAL: Clear phase effect snapshots when starting a new turn
                    _startPhaseEffectSnapshot: undefined,
                    _endPhaseEffectSnapshot: undefined,
                    // CRITICAL: Clear interrupt state when starting a new turn
                    _interruptedTurn: undefined,
                    _interruptedPhase: undefined,
                };
            }

            // CRITICAL FIX: For START phase interrupts, continue the original player's turn properly.
            // When an interrupt happens during Start phase (e.g., opponent's Death-1 deletes a card,
            // uncovering player's Speed-3 which triggers its middle effect), after the interrupt
            // completes, we must continue OPPONENT's turn through their remaining phases.
            if (originalPhase === 'start' && !restoredState.actionRequired) {
                // Re-check for remaining start effects for the restored player
                const stateAfterStartRecheck = executeStartPhaseEffects(restoredState).newState;
                if (stateAfterStartRecheck.actionRequired) {
                    return stateAfterStartRecheck;
                }
                // No more start effects - continue through remaining phases (control → compile → action → ...)
                let nextState = { ...stateAfterStartRecheck, phase: 'control' as GamePhase };
                return continueTurnProgression(nextState);
            }

            return restoredState;
        }

        // The interrupt is over. The original turn player's action that was
        // interrupted is now considered complete. Continue processing the rest
        // of their turn from this restored state, without returning early.
        // This will fall through to phase advancement (hand_limit → end → turn switch)
        state = restoredState;
    }

    // If the original action that caused the control prompt is stored, execute it now.
    if (state.actionRequired?.type === 'prompt_rearrange_protocols' && state.actionRequired.originalAction) {
        const originalAction = state.actionRequired.originalAction;
        let stateAfterRearrange = { ...state, actionRequired: null, controlCardHolder: null }; // Reset control

        if (originalAction.type === 'compile') {
            // Re-trigger the compile logic
            // Note: This part might need the compile function from useGameState, which isn't available here.
            // A potential refactor would be to handle this in useGameState. For now, we assume it continues the turn.
            return continueTurnProgression(stateAfterRearrange); // Simplified for now
        } else if (originalAction.type === 'fill_hand') {
            // Re-trigger the fill hand logic
            // FIX: Access hand.length to get the number of cards, not length on the PlayerState object.
            const stateAfterFill = drawForPlayer(stateAfterRearrange, stateAfterRearrange.turn, 5 - stateAfterRearrange[stateAfterRearrange.turn].hand.length);
            return continueTurnProgression(stateAfterFill);
        }
    }

    // Check for a queued effect before advancing phase.
    // This is where the "committed" card officially "lands" on the board.
    if (state.queuedEffect) {
        const { card, laneIndex } = state.queuedEffect;
        // CRITICAL: Clear _committedCardId - the card is now officially "landed"
        // This allows the card to be selectable for effects triggered by its own on_play
        const stateWithoutQueue = { ...state, queuedEffect: undefined, _committedCardId: undefined };
        const cardLocation = findCardOnBoard(stateWithoutQueue, card.id);

        if (cardLocation) {
            const { card: cardOnBoard, owner: cardOwner } = cardLocation;
            // CRITICAL: Reset indent level before executing queued effect
            // The queued effect (middle command of played card) should be at indent 1
            // (directly under "plays card" log, not nested under any interrupt chain)
            let stateForQueuedEffect = { ...stateWithoutQueue, _logIndentLevel: 0 };
            const queuedEffectContext: EffectContext = {
                cardOwner: cardOwner,
                actor: cardOwner,
                currentTurn: stateForQueuedEffect.turn,
                opponent: cardOwner === 'player' ? 'opponent' : 'player',
                triggerType: 'play'
            };
            const { newState } = executeOnPlayEffect(cardOnBoard, laneIndex, stateForQueuedEffect, queuedEffectContext);
            if (newState.actionRequired) {
                // The queued effect produced an action. Return this new state and wait.
                return newState;
            }
            // If no action, continue with the rest of the turn logic from this new state.
            state = newState;
        } else {
            // Card was removed from board before its on-play effect could trigger.
            // This is valid (e.g. on-cover effect returns the card). Just log and continue.
            console.warn(`Skipping queued effect for ${card.protocol}-${card.value} as it is no longer on the board.`);
            state = log(state, state.turn, `Skipping queued effect for ${card.protocol}-${card.value} as it is no longer on the board.`);
            // The state to continue from is the one without the queued effect.
            state = stateWithoutQueue;
        }
    }


    // Check for a queued ACTION first.
    if (state.queuedActions && state.queuedActions.length > 0) {
        let mutableState = { ...state };
        let queuedActions = [...mutableState.queuedActions];

        while (queuedActions.length > 0) {
            const nextAction = queuedActions.shift()!;

            // Rule: An effect is cancelled if its source card is no longer on the board or face-up.
            // EXCEPTION: flip_self_for_water_0 and flip_self_for_psychic_4 have their own specific checks
            // CRITICAL: Skip source validation for flip_self actions (they have their own validation logic)
            const isFlipSelfAction = nextAction.type === 'flip_self';
            if (nextAction.sourceCardId && !isFlipSelfAction) {
                const sourceCardInfo = findCardOnBoard(mutableState, nextAction.sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                    // CRITICAL: Temporarily set log source to the cancelled card, not the current context
                    const previousLogSource = (mutableState as any)._logSource;
                    mutableState = setLogSource(mutableState, cardName);
                    mutableState = log(mutableState, nextAction.actor, `Queued effect was cancelled because the source is no longer active.`);
                    mutableState = setLogSource(mutableState, previousLogSource);
                    continue; // Skip this action
                }
            }

            // --- Auto-resolving actions ---
            // GENERIC: Auto-resolve flip_self actions (Water-0, Psychic-4, Speed-3, custom protocols)
            if (isFlipSelfAction) {
                const { sourceCardId, actor } = nextAction as { type: string, sourceCardId: string, actor: Player };
                const sourceCardInfo = findCardOnBoard(mutableState, sourceCardId);
                const sourceIsUncovered = isCardUncovered(mutableState, sourceCardId);

                // CRITICAL: Only execute if source card is still on the board, face-up AND uncovered
                // Commands are only active when uncovered, so the self-flip must be cancelled if source is covered
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    mutableState = log(mutableState, actor, `${cardName}: Flips itself.`);
                    mutableState = findAndFlipCards(new Set([sourceCardId]), mutableState);
                    mutableState.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                    const reason = !sourceCardInfo ? 'deleted' :
                                  !sourceCardInfo.card.isFaceUp ? 'flipped face-down' :
                                  'now covered';
                    mutableState = log(mutableState, actor, `The self-flip effect from ${cardName} was cancelled because it is ${reason}.`);
                }
                continue; // Action resolved (or cancelled), move to next in queue
            }

            // NOTE: Legacy anarchy_0_conditional_draw and speed_3_self_flip_after_shift removed
            // Now handled via generic flip_self action type

            if (nextAction.type === 'reveal_opponent_hand') {
                const opponentId = mutableState.turn === 'player' ? 'opponent' : 'player';
                const opponentState = { ...mutableState[opponentId] };

                if (opponentState.hand.length > 0) {
                    opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
                    mutableState[opponentId] = opponentState;
                    const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                    const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                    mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent reveals their hand.`);
                } else {
                    const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                    const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
                    mutableState = log(mutableState, mutableState.turn, `${sourceName}: Opponent has no cards to reveal.`);
                }
                continue; // Action resolved, move to next in queue
            }

            // NOTE: Legacy select_any_opponent_card_to_shift and shift_flipped_card_optional removed
            // Now use generic select_card_to_shift with targetFilter parameters

            // NOTE: discard_completed is now handled directly in discardResolver via executeFollowUpAfterDiscard
            // and _pendingFollowUpEffect at the top of processQueuedActions

            // CRITICAL FIX: When dequeuing a discard action, re-check hand size.
            // The hand size may have changed since the action was queued (e.g., War-3 reactive played a card).
            // This prevents softlocks where player is asked to discard with 0 cards.
            if (nextAction.type === 'discard' && nextAction.actor) {
                const discardActor = nextAction.actor as 'player' | 'opponent';
                const currentHandSize = mutableState[discardActor].hand.length;
                const requiredCount = (nextAction as any).count || 1;

                if (currentHandSize === 0) {
                    // Actor has no cards - skip this discard action entirely
                    const actorName = discardActor === 'player' ? 'Player' : 'Opponent';

                    // Set context from source card if available for proper log formatting
                    if (nextAction.sourceCardId) {
                        const sourceCard = findCardOnBoard(mutableState, nextAction.sourceCardId);
                        if (sourceCard) {
                            const cardName = `${sourceCard.card.protocol}-${sourceCard.card.value}`;
                            mutableState = setLogSource(mutableState, cardName);
                            mutableState = setLogPhase(mutableState, 'middle');
                            // Restore saved indent level for correct nesting
                            const savedIndent = (nextAction as any)._savedIndentLevel;
                            if (savedIndent !== undefined) {
                                mutableState = { ...mutableState, _logIndentLevel: savedIndent };
                            }
                        }
                    }

                    mutableState = log(mutableState, discardActor, `${actorName} has no cards to discard - effect skipped.`);

                    // Clear context after logging
                    mutableState = setLogSource(mutableState, undefined);
                    mutableState = setLogPhase(mutableState, undefined);
                    mutableState = { ...mutableState, _logIndentLevel: 0 };

                    continue; // Skip to next queued action
                } else if (typeof requiredCount === 'number' && currentHandSize < requiredCount) {
                    // Actor has fewer cards than required - adjust count
                    (nextAction as any).count = currentHandSize;
                }
            }

            // --- If we reach here, the action is not auto-resolving and is possible ---
            mutableState.actionRequired = nextAction;
            mutableState.queuedActions = queuedActions; // Update the state with the rest of the queue
            return mutableState; // Break loop and return to wait for user/AI input
        }

        // All queued actions were auto-resolved or impossible.
        state = { ...mutableState, queuedActions: [], actionRequired: null };
    }

    // If a resolver has already advanced the phase (e.g., Speed-1 trigger), respect it.
    // Otherwise, start the end-of-turn sequence from the hand_limit phase.
    const startingPhase = state.phase === 'action' ? 'hand_limit' : state.phase;
    // FIX: Explicitly type `nextState` to prevent a type inference mismatch.
    let nextState: GameState = { ...state, phase: startingPhase as GamePhase, compilableLanes: [], processedUncoverEventIds: [] };

    const originalTurn = state.turn;

    // This loop will process the rest of the current player's turn (hand_limit, end)
    // and stop either when the turn has been passed to the next player,
    // or if a new action is required from the current player.
    while (nextState.turn === originalTurn && !nextState.winner) {
        const actionBeforeAdvance = nextState.actionRequired;
        const phaseBeforeAdvance = nextState.phase;

        nextState = advancePhase(nextState);

        const actionAfterAdvance = nextState.actionRequired;

        // If advancePhase generated a new action that didn't exist before,
        // it must be for the current player (from hand_limit or end phase effects),
        // so we should break the loop and wait for that action to be resolved.
        if (actionAfterAdvance && actionAfterAdvance !== actionBeforeAdvance) {
            break;
        }

        // Safety break to prevent infinite loops if advancePhase fails to change phase,
        // which can happen if it's waiting for an action that this loop doesn't account for.
        if (nextState.phase === phaseBeforeAdvance && nextState.turn === originalTurn) {
             console.error("Game is stuck in a phase loop:", nextState.phase);
             break;
        }
    }

    return nextState;
};

export const continueTurnProgression = (state: GameState): GameState => {
    if (state.winner) return state;

    let nextState = { ...state };

    // Check for a completed interrupt first.
    if (nextState._interruptedTurn) {
        const originalTurnPlayer = nextState._interruptedTurn;
        const originalPhase = nextState._interruptedPhase || nextState.phase;
        delete nextState._interruptedTurn;
        delete nextState._interruptedPhase;
        nextState.turn = originalTurnPlayer;
        nextState.phase = originalPhase;
    }

    const originalTurn = nextState.turn;

    // Process all automatic phases until an action is required or the turn ends.
    while (nextState.turn === originalTurn && !nextState.actionRequired && !nextState.winner) {
        const currentPhase = nextState.phase;

        // Stop if we reach a phase that requires user input.
        if (currentPhase === 'action') {
            break;
        }

        // The 'compile' phase is special: it only requires input if lanes are compilable.
        if (currentPhase === 'compile') {
            const compilableLanes = calculateCompilableLanes(nextState, originalTurn);
            if (compilableLanes.length > 0) {
                // Update state with compilable lanes and stop to wait for user input.
                nextState = { ...nextState, compilableLanes };
                break;
            }
        }

        const oldPhase = nextState.phase;
        nextState = advancePhase(nextState);

        // Safety break to prevent infinite loops.
        if (oldPhase === nextState.phase && !nextState.actionRequired) {
            console.error("Game is stuck in an automatic phase loop:", oldPhase);
            console.error("State:", {
                phase: nextState.phase,
                turn: nextState.turn,
                actionRequired: nextState.actionRequired,
                queuedActions: nextState.queuedActions,
                interruptedTurn: nextState._interruptedTurn
            });
            break;
        }
    }
    // CRITICAL: Clear animationState when progressing to a new phase/state
    // Animation should never persist across phase transitions
    return { ...nextState, animationState: null };
};

export const continueTurnAfterStartPhaseAction = (state: GameState): GameState => {
    // The previous action has been resolved, clear it.
    let stateAfterAction = { ...state, actionRequired: null };

    // CRITICAL FIX: If there's an active interrupt, delegate to processEndOfAction.
    // This ensures the turn is properly restored to the original player before continuing.
    // Example: Opponent's Start phase triggers Death-1 delete → Player's Speed-3 uncovered →
    // Speed-3 middle effect executes → After completion, turn must return to OPPONENT, not stay with PLAYER.
    if (stateAfterAction._interruptedTurn) {
        return processEndOfAction(stateAfterAction);
    }

    // CRITICAL FIX: Process queuedActions FIRST before continuing the turn.
    // This handles cases like Life-1's "Flip 1 card. Flip 1 card." where the second flip
    // is queued in queuedActions after the first flip completes during start phase.
    // Without this, the queued actions would be lost and cause a softlock.
    // CRITICAL FIX #2: Also check for _deferredParentEffects (same as in processEndOfAction)
    const hasDeferredStartPhase = (stateAfterAction as any)._deferredParentEffects && (stateAfterAction as any)._deferredParentEffects.length > 0;
    if ((stateAfterAction.queuedActions && stateAfterAction.queuedActions.length > 0) || hasDeferredStartPhase) {
        const stateAfterQueue = processQueuedActions(stateAfterAction);
        if (stateAfterQueue.actionRequired) {
            return stateAfterQueue;
        }
        stateAfterAction = stateAfterQueue;
    }

    // Now, re-evaluate the start phase to see if there are other start effects to process.
    // The `processedStartEffectIds` will prevent the same effect from running again.
    const stateAfterRecheck = executeStartPhaseEffects(stateAfterAction).newState;

    // If re-checking triggered another prompt (e.g., a second start-phase card),
    // then return the state immediately and wait for the new action.
    if (stateAfterRecheck.actionRequired) {
        return stateAfterRecheck;
    }

    // If there are no more start-phase actions, manually advance to the next interactive phase.
    // This prevents skipping the main Action phase.
    let nextState = stateAfterRecheck;
    if (nextState.phase !== 'control') {
        nextState = { ...nextState, phase: 'control' };
    }

    nextState = advancePhase(nextState); // -> compile
    if(nextState.actionRequired) return nextState;

    nextState = advancePhase(nextState); // -> action OR stays in compile if compilableLanes > 0
    return nextState;
};

export const processStartOfTurn = (state: GameState): GameState => {
    if (state.winner) return state;

    let stateAfterStartEffects = { ...state, phase: 'start' as GamePhase };

    // CRITICAL: Recalculate ALL lane values for BOTH players at the start of EVERY turn
    // This ensures passive value modifiers (like Clarity-0's +1 per card in hand) are always current
    stateAfterStartEffects = recalculateAllLaneValues(stateAfterStartEffects);

    stateAfterStartEffects = advancePhase(stateAfterStartEffects);

    if (stateAfterStartEffects.actionRequired) {
        return stateAfterStartEffects;
    }

    return continueTurnProgression(stateAfterStartEffects);
};
