/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, GamePhase, PlayedCard, EffectContext } from '../../../types';
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from '../../utils/log';
import { findAndFlipCards, drawForPlayer } from '../../../utils/gameStateModifiers';
import { findCardOnBoard, handleOnFlipToFaceUp } from '../helpers/actionUtils';
import { recalculateAllLaneValues } from '../stateManager';
import { performCompile } from './miscResolver';
import { performFillHand } from './playResolver';
import * as phaseManager from '../phaseManager';
import { queuePendingCustomEffects } from '../phaseManager';
import { canRearrangeProtocols } from '../passiveRuleChecker';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';

// NEW: Generic optional draw prompt resolver (composable for any card)
export const resolveOptionalDrawPrompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_optional_draw') {
        return prevState;
    }

    const { sourceCardId, actor, count, drawingPlayer, logSource, logPhase, logIndentLevel } = prevState.actionRequired as any;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    // CRITICAL: Restore log context from actionRequired for proper indentation/phase
    if (logSource !== undefined) newState = setLogSource(newState, logSource);
    if (logPhase !== undefined) newState = setLogPhase(newState, logPhase);
    if (logIndentLevel !== undefined) newState._logIndentLevel = logIndentLevel;

    if (accept) {
        newState = log(newState, actor, `${actorName} chooses to execute the optional draw effect.`);
        // Execute the draw
        newState = drawForPlayer(newState, drawingPlayer || actor, count);
        newState = log(newState, actor, `${actorName} draws ${count} card${count !== 1 ? 's' : ''}.`);

        // Check if there's a follow-up effect from conditional chaining (if_executed)
        const followUpEffect = (prevState.actionRequired as any).followUpEffect;
        const conditionalType = (prevState.actionRequired as any).conditionalType;

        if (followUpEffect) {
            // Execute the follow-up effect (e.g., delete other card for Death-1)
            const sourceCard = findCardOnBoard(newState, sourceCardId);

            if (sourceCard) {
                const laneIndex = newState[sourceCard.owner].lanes.findIndex(l => l.some(c => c.id === sourceCardId));
                const opponent: Player = actor === 'player' ? 'opponent' : 'player';
                const context: EffectContext = {
                    cardOwner: actor,
                    actor,
                    currentTurn: newState.turn,
                    opponent,
                    triggerType: 'start' as const
                };
                // CRITICAL: Log context is already set on newState from above, so followUpEffect will use it
                const result = executeCustomEffect(sourceCard.card, laneIndex, newState, context, followUpEffect);
                newState = result.newState;

                // CRITICAL: Queue pending custom effects (Death-1: nested conditionals)
                newState = queuePendingCustomEffects(newState);
            } else {
                // Source card not found on board - it was deleted or returned
                // CRITICAL: Don't execute follow-up effects for deleted source cards!
                // This prevents turn flow corruption when e.g., War-0 deletes Death-1 during its effect chain.
                const sourceCardName = (prevState.actionRequired as any).logSource || 'deleted card';
                newState = log(newState, actor, `${sourceCardName}: Follow-up effect skipped (source no longer active).`);
                newState.actionRequired = null;

                // CRITICAL: Also clear any pending effects from this source
                if ((newState as any)._pendingCustomEffects?.sourceCardId === sourceCardId) {
                    delete (newState as any)._pendingCustomEffects;
                }

                // Clear any queued actions that reference this deleted source card
                if (newState.queuedActions && newState.queuedActions.length > 0) {
                    newState.queuedActions = newState.queuedActions.filter(
                        (action: any) => action.sourceCardId !== sourceCardId
                    );
                }
            }
        } else {
            newState.actionRequired = null;
        }
    } else {
        newState = log(newState, actor, `${actorName} skips the draw.`);
        newState.actionRequired = null;
    }
    return newState;
};

// REMOVED: resolveDeath1Prompt - Death-1 now uses custom protocol with prompt_optional_draw + conditional
// REMOVED: resolveLove1Prompt - Love-1 now uses custom protocol with prompt_optional_effect
// REMOVED: resolvePlague4Flip - Plague-4 now uses custom protocol with flip + flipSelf + optional
// REMOVED: resolveFire3Prompt - Fire-3 now uses custom protocol with prompt_optional_discard_custom

export const resolveOptionalDiscardCustomPrompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_optional_discard_custom') return prevState;

    const { actor, count, sourceCardId } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    // CRITICAL: Save followUpEffect AND conditionalType before clearing
    const followUpEffect = (prevState.actionRequired as any)?.followUpEffect;
    const conditionalType = (prevState.actionRequired as any)?.conditionalType;

    if (accept) {
        newState = log(newState, actor, `${actorName} chooses to discard ${count} card(s).`);
        newState.actionRequired = {
            type: 'discard',
            actor: actor,
            count: count,
            sourceCardId: sourceCardId,
            followUpEffect: followUpEffect, // Pass through followUpEffect
            conditionalType: conditionalType, // CRITICAL: Pass through conditionalType for if_executed
            previousHandSize: newState[actor].hand.length,
        } as any;
    } else {
        newState = log(newState, actor, `${actorName} skips the discard.`);
        newState.actionRequired = null;
    }
    return newState;
};

/**
 * GENERIC optional effect prompt resolver
 * Works for ALL optional effects (flip, delete, shift, return, discard, etc.)
 */
export const resolveOptionalEffectPrompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_optional_effect') return prevState;

    const { actor, sourceCardId, effectDef, laneIndex, savedTargetCardId } = prevState.actionRequired as any;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    // CRITICAL: Restore the target card ID if it was saved (for useCardFromPreviousEffect)
    if (savedTargetCardId) {
        newState.lastCustomEffectTargetCardId = savedTargetCardId;
    }

    if (accept) {
        // User accepts the optional effect - execute it now
        const action = effectDef.params.action;
        newState = log(newState, actor, `${actorName} chooses to execute the optional ${action} effect.`);

        // CRITICAL: Clear actionRequired BEFORE executing the effect
        // Otherwise the old prompt_optional_effect will be inherited by the new state
        newState.actionRequired = null;

        // Find the card and execute the effect
        const sourceCard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()]
            .find(c => c.id === sourceCardId);

        if (!sourceCard) {
            console.error('[Optional Effect] Source card not found!');
            return newState;
        }

        const context = {
            cardOwner: actor,
            opponent: actor === 'player' ? 'opponent' as const : 'player' as const,
            currentTurn: newState.turn,
            actor: actor,
        };

        // Execute the effect (without optional flag to avoid recursion)
        // CRITICAL: Also remove the conditional to prevent re-evaluation
        // The conditional will be handled by this function after the effect executes
        const effectToExecute = {
            ...effectDef,
            params: { ...effectDef.params, optional: false },
            conditional: undefined  // Remove conditional - we handle it here
        };

        const result = executeCustomEffect(sourceCard, laneIndex, newState, context, effectToExecute);
        const hasActionRequired = !!result.newState.actionRequired;
        const hasSkipMarker = !!(result.newState as any)._effectSkippedNoTargets;

        // CRITICAL: Check if effect was skipped due to no valid targets
        // BUT: If actionRequired is set, the effect DID find targets and needs user input - don't skip!
        const effectWasSkipped = hasSkipMarker && !hasActionRequired;
        if (effectWasSkipped) {
            // Clean up the marker and ensure actionRequired is cleared
            const cleanedState = { ...result.newState };
            delete (cleanedState as any)._effectSkippedNoTargets;
            cleanedState.actionRequired = null;  // CRITICAL: Clear any stale actionRequired
            return cleanedState;
        }

        // Clean up stale marker if effect did execute (has actionRequired)
        if (hasSkipMarker && hasActionRequired) {
            delete (result.newState as any)._effectSkippedNoTargets;
        }

        // CRITICAL: Handle conditional follow-up effects (if_executed)
        if (effectDef.conditional && effectDef.conditional.type === 'if_executed' && effectDef.conditional.thenEffect) {

            // If the effect created an actionRequired, check if it's from the SAME card
            if (result.newState.actionRequired) {
                const actionSourceId = (result.newState.actionRequired as any).sourceCardId;

                // CRITICAL: If actionRequired is from a DIFFERENT card (e.g., War-0's after_opponent_draw
                // interrupted Death-1's draw), queue the followUp instead of attaching to foreign action.
                // This prevents the followUp from being lost when the interrupt completes.
                if (actionSourceId && actionSourceId !== sourceCardId) {
                    const followUpAction: any = {
                        type: 'execute_conditional_followup',
                        sourceCardId: sourceCardId,
                        laneIndex: laneIndex,
                        followUpEffect: effectDef.conditional.thenEffect,
                        context: context,
                        actor: actor,
                        // Preserve original log context for proper formatting
                        logSource: (prevState.actionRequired as any).logSource,
                        logPhase: (prevState.actionRequired as any).logPhase,
                        logIndentLevel: (prevState.actionRequired as any).logIndentLevel,
                    };
                    const stateWithQueue = {
                        ...result.newState,
                        queuedActions: [
                            ...(result.newState.queuedActions || []),
                            followUpAction
                        ]
                    };
                    return stateWithQueue;
                }

                // SAME card's action - attach followUp as before
                const stateWithFollowUp = {
                    ...result.newState,
                    actionRequired: {
                        ...result.newState.actionRequired,
                        followUpEffect: effectDef.conditional.thenEffect,
                        conditionalType: 'if_executed',
                    } as any
                };
                return stateWithFollowUp;
            }

            // Effect completed immediately (no actionRequired), execute followUp now
            // CRITICAL: Re-check if the source card still exists AFTER the effect executed
            // (e.g., War-0's reactive delete during Death-1's draw may have deleted Death-1)
            const sourceCardAfter = [...result.newState.player.lanes.flat(), ...result.newState.opponent.lanes.flat()]
                .find(c => c.id === sourceCardId);

            if (!sourceCardAfter) {
                // Source card was deleted during the effect - skip the followUp and log
                // CRITICAL: Restore the ORIGINAL log context (Death-1's Start) before logging,
                // not War-0's After context
                let newState = { ...result.newState };
                const originalLogSource = (prevState.actionRequired as any).logSource;
                const originalLogPhase = (prevState.actionRequired as any).logPhase;
                const originalLogIndent = (prevState.actionRequired as any).logIndentLevel;

                if (originalLogSource !== undefined) newState._currentEffectSource = originalLogSource;
                if (originalLogPhase !== undefined) newState._currentPhaseContext = originalLogPhase;
                if (originalLogIndent !== undefined) newState._logIndentLevel = originalLogIndent;

                newState = log(newState, actor, `Follow-up effect skipped (source no longer active).`);
                return newState;
            }

            const followUpEffect = effectDef.conditional.thenEffect;
            const followUpResult = executeCustomEffect(sourceCardAfter, laneIndex, result.newState, context, followUpEffect);

            // If the followUp created an actionRequired AND the followUp has its own conditional,
            // attach the nested conditional as a followUpEffect so it executes after the action completes
            if (followUpResult.newState.actionRequired && followUpEffect.conditional && followUpEffect.conditional.thenEffect) {
                const stateWithNestedFollowUp = {
                    ...followUpResult.newState,
                    actionRequired: {
                        ...followUpResult.newState.actionRequired,
                        followUpEffect: followUpEffect.conditional.thenEffect,
                        conditionalType: followUpEffect.conditional.type,
                    } as any
                };
                return stateWithNestedFollowUp;
            }

            return followUpResult.newState;
        }

        // CRITICAL FIX: Check if there's an OUTER followUpEffect (from an interrupted effect like Fire-0's on_cover)
        // This needs to be executed even if the optional effect (Spirit-3's shift) has no conditional
        const outerFollowUpEffect = (prevState.actionRequired as any)?.followUpEffect;
        const outerFollowUpSourceCardId = (prevState.actionRequired as any)?.outerSourceCardId;
        const outerFollowUpLaneIndex = (prevState.actionRequired as any)?.outerLaneIndex;

        if (outerFollowUpEffect && outerFollowUpSourceCardId) {
            let finalState = result.newState;

            // If the effect created an actionRequired (like lane selection for shift),
            // attach the outer followUpEffect to it for execution after user input
            if (finalState.actionRequired) {
                return {
                    ...finalState,
                    actionRequired: {
                        ...finalState.actionRequired,
                        followUpEffect: outerFollowUpEffect,
                        outerSourceCardId: outerFollowUpSourceCardId,
                        outerLaneIndex: outerFollowUpLaneIndex,
                    } as any
                };
            }

            // Effect completed immediately (no actionRequired), execute outer followUpEffect now
            const outerSourceCard = [...finalState.player.lanes.flat(), ...finalState.opponent.lanes.flat()]
                .find(c => c.id === outerFollowUpSourceCardId);

            if (outerSourceCard) {
                const outerSourceOwner = finalState.player.lanes.flat().some(c => c.id === outerFollowUpSourceCardId)
                    ? 'player' as const
                    : 'opponent' as const;

                const outerContext = {
                    cardOwner: outerSourceOwner,
                    opponent: outerSourceOwner === 'player' ? 'opponent' as const : 'player' as const,
                    currentTurn: finalState.turn,
                    actor: outerSourceOwner,
                };

                const followUpResult = executeCustomEffect(outerSourceCard, outerFollowUpLaneIndex || 0, finalState, outerContext, outerFollowUpEffect);

                // CRITICAL FIX: If the turn was restored during execution (by handleUncoverEffect),
                // but _interruptedTurn is still set, clear it to prevent inconsistent state.
                let resultState = followUpResult.newState;
                if (resultState._interruptedTurn && !resultState.actionRequired) {
                    resultState = {
                        ...resultState,
                        turn: resultState._interruptedTurn,
                        _interruptedTurn: undefined,
                        _interruptedPhase: undefined,
                    };
                }
                return resultState;
            }
        }

        return result.newState;
    } else {
        // User declines the optional effect
        const action = effectDef.params.action;
        newState = log(newState, actor, `${actorName} skips the optional ${action} effect.`);

        // CRITICAL: If there's an if_executed conditional, it should NOT execute
        // The effect was declined, so followUp is skipped
        newState.actionRequired = null;

        // CRITICAL FIX: Check if there was a followUpEffect from an OUTER effect (e.g., Fire-0's on_cover)
        // This happens when Spirit-3's after_draw interrupted Fire-0's "draw, then flip" sequence.
        // The followUpEffect was attached to Spirit-3's prompt, and now we need to execute it.
        const outerFollowUpEffect = (prevState.actionRequired as any)?.followUpEffect;
        const outerFollowUpSourceCardId = (prevState.actionRequired as any)?.outerSourceCardId;
        const outerFollowUpLaneIndex = (prevState.actionRequired as any)?.outerLaneIndex;

        if (outerFollowUpEffect && outerFollowUpSourceCardId) {
            const outerSourceCard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()]
                .find(c => c.id === outerFollowUpSourceCardId);

            if (outerSourceCard) {
                // Find the lane index of the outer source card
                let resolvedLaneIndex = outerFollowUpLaneIndex;
                if (resolvedLaneIndex === undefined) {
                    for (const player of ['player', 'opponent'] as const) {
                        for (let i = 0; i < newState[player].lanes.length; i++) {
                            if (newState[player].lanes[i].some(c => c.id === outerFollowUpSourceCardId)) {
                                resolvedLaneIndex = i;
                                break;
                            }
                        }
                    }
                }

                const outerSourceOwner = newState.player.lanes.flat().some(c => c.id === outerFollowUpSourceCardId)
                    ? 'player' as const
                    : 'opponent' as const;

                const outerContext = {
                    cardOwner: outerSourceOwner,
                    opponent: outerSourceOwner === 'player' ? 'opponent' as const : 'player' as const,
                    currentTurn: newState.turn,
                    actor: outerSourceOwner,
                };

                const followUpResult = executeCustomEffect(outerSourceCard, resolvedLaneIndex || 0, newState, outerContext, outerFollowUpEffect);

                // CRITICAL FIX: If the turn was restored during execution (by handleUncoverEffect),
                // but _interruptedTurn is still set, clear it to prevent inconsistent state.
                // This can happen when the outerFollowUpEffect triggers multiple uncovers in sequence.
                let finalState = followUpResult.newState;
                if (finalState._interruptedTurn && !finalState.actionRequired) {
                    // Turn should have been restored but wasn't cleared - do it now
                    finalState = {
                        ...finalState,
                        turn: finalState._interruptedTurn,
                        _interruptedTurn: undefined,
                        _interruptedPhase: undefined,
                    };
                }
                return finalState;
            }
        }

        return newState;
    }
};

// REMOVED: resolveSpeed3Prompt - Speed-3 now uses custom protocol system with generic select_card_to_shift
// REMOVED: resolveLight2Prompt - Light-2 now uses custom protocol system with prompt_shift_or_flip_board_card_custom
// REMOVED: resolveOptionalDiscardDeckTopPrompt - Clarity-1 now uses conditional.thenEffect with useCardFromPreviousEffect

export const resolveRearrangeProtocols = (
    prevState: GameState,
    newOrder: string[],
    onEndGame: (winner: Player, finalState: GameState) => void
): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_rearrange_protocols') return prevState;

    // NEW: Check passive rules for protocol rearrangement restrictions (Frost-1, custom cards)
    const rearrangeCheck = canRearrangeProtocols(prevState);
    if (!rearrangeCheck.allowed) {
        console.error(`Protocol rearrangement blocked: ${rearrangeCheck.reason}`);
        return prevState; // Block the rearrange
    }

    const { target, actor, originalAction, sourceCardId, disallowedProtocolForLane } = prevState.actionRequired;

    // CRITICAL VALIDATION for Anarchy-3 End Effect: "Anarchy cannot be on this line"
    if (disallowedProtocolForLane) {
        const { laneIndex, protocol } = disallowedProtocolForLane;
        if (newOrder[laneIndex] === protocol) {
            console.error(`Illegal rearrange: ${protocol} cannot be placed on lane ${laneIndex} due to Anarchy-3 restriction`);
            return prevState; // Block the illegal rearrange
        }
    }

    let newState = { ...prevState };
    const targetState = { ...newState[target] };

    // Create a map to preserve the compiled status of each protocol.
    const compiledStatusMap: { [key: string]: boolean } = {};
    targetState.protocols.forEach((proto, index) => {
        compiledStatusMap[proto] = targetState.compiled[index];
    });

    // Create the new array of compiled statuses based on the new protocol order.
    const newCompiled: boolean[] = newOrder.map(proto => compiledStatusMap[proto]);

    // Update only the protocols and their compiled status. The lanes (cards) remain in place.
    targetState.protocols = newOrder;
    targetState.compiled = newCompiled;

    newState[target] = targetState;
    newState.actionRequired = null; // Clear the rearrange action

    // NEW: Handle pending custom effects (for Chaos-1: two rearrange effects)
    // This is duplicated from the central logic because we need it BEFORE processQueuedActions
    const pendingEffects = (newState as any)._pendingCustomEffects;
    if (pendingEffects && pendingEffects.effects.length > 0) {
        const pendingAction: any = {
            type: 'execute_remaining_custom_effects',
            sourceCardId: pendingEffects.sourceCardId,
            laneIndex: pendingEffects.laneIndex,
            effects: pendingEffects.effects,
            context: pendingEffects.context,
            actor: actor,
            // Log-Kontext weitergeben für korrekte Einrückung/Quellkarte
            logSource: pendingEffects.logSource,
            logPhase: pendingEffects.logPhase,
            logIndentLevel: pendingEffects.logIndentLevel
        };

        // Queue the pending effects
        // CRITICAL FIX: Add at BEGINNING for LIFO order - child effects must complete before parent effects
        newState.queuedActions = [
            pendingAction,
            ...(newState.queuedActions || [])
        ];

        // Clear from state after queueing
        delete (newState as any)._pendingCustomEffects;
    }

    // Convert sourceCardId to a readable name
    let sourceText = 'Control Action';
    if (sourceCardId !== 'CONTROL_MECHANIC') {
        // Find the card and convert to Protocol-Value format
        const card = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()].find(c => c.id === sourceCardId);
        if (card) {
            sourceText = `${card.protocol}-${card.value}`;
        }
    }

    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    const targetName = target === actor ? 'their own' : `the opponent's`;

    // Log the new protocol order to make debugging easier
    const protocolOrder = newOrder.join(' | ');
    newState = log(newState, actor, `${sourceText}: ${actorName} rearranges ${targetName} protocols.`);
    newState = log(newState, actor, `New protocol order for ${target}: ${protocolOrder}`);

    let stateAfterRecalc = recalculateAllLaneValues(newState);

    if (originalAction) {
        // Reset indent to 0 before resuming the main action (compile/refresh)
        stateAfterRecalc = { ...stateAfterRecalc, _logIndentLevel: 0 };
        if (originalAction.type === 'compile') {
            return performCompile(stateAfterRecalc, originalAction.laneIndex, onEndGame);
        } else if (originalAction.type === 'fill_hand') {
            const stateAfterFill = performFillHand(stateAfterRecalc, actor);
            return stateAfterFill;
        } else if (originalAction.type === 'continue_turn') {
            // After compile + control rearrange, the turn should END (unless there are Speed-2 actions)
            if (originalAction.queuedSpeed2Actions && originalAction.queuedSpeed2Actions.length > 0) {
                stateAfterRecalc = log(stateAfterRecalc, actor, `Processing remaining Speed-2 effects...`);
                stateAfterRecalc.queuedActions = [
                    ...originalAction.queuedSpeed2Actions,
                    ...(stateAfterRecalc.queuedActions || [])
                ];
            } else {
                // No more actions - turn ends after compile
                stateAfterRecalc = log(stateAfterRecalc, actor, `Turn ends after compile.`);
                stateAfterRecalc.phase = 'hand_limit';
            }
        } else if (originalAction.type === 'resume_interrupted_turn') {
            // CRITICAL: Restore the interrupt after rearrange
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming interrupted turn...`);
            stateAfterRecalc._interruptedTurn = originalAction.interruptedTurn;
            stateAfterRecalc._interruptedPhase = originalAction.interruptedPhase;

            if (originalAction.queuedSpeed2Actions && originalAction.queuedSpeed2Actions.length > 0) {
                stateAfterRecalc.queuedActions = [
                    ...originalAction.queuedSpeed2Actions,
                    ...(stateAfterRecalc.queuedActions || [])
                ];
            }
        }
    }

    return stateAfterRecalc;
};


// REMOVED: resolvePsychic4Prompt - Psychic-4 now uses custom protocol with prompt_optional_effect
// REMOVED: resolveSpirit1Prompt - Spirit-1 now uses custom protocol with custom_choice
// REMOVED: resolveSpirit3Prompt - Spirit-3 now uses custom protocol system with after_draw trigger

export const resolveSwapProtocols = (prevState: GameState, indices: [number, number], onEndGame: (winner: Player, finalState: GameState) => void): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_swap_protocols') return prevState;
    
    const { actor, target, originalAction, sourceCardId } = prevState.actionRequired;
    const playerState = { ...prevState[target] };
    const [index1, index2] = indices.sort((a,b) => a-b);

    const newProtocols = [...playerState.protocols];
    const newCompiled = [...playerState.compiled];
    
    // Swap protocols and compiled status, but NOT the lanes themselves.
    [newProtocols[index1], newProtocols[index2]] = [newProtocols[index2], newProtocols[index1]];
    [newCompiled[index1], newCompiled[index2]] = [newCompiled[index2], newCompiled[index1]];

    playerState.protocols = newProtocols;
    playerState.compiled = newCompiled;
    
    let newState = { ...prevState, [target]: playerState, actionRequired: null };

    // NEW: Handle pending custom effects (for cards with multiple swap effects)
    // This is duplicated from the central logic because we need it BEFORE processQueuedActions
    const pendingEffects = (newState as any)._pendingCustomEffects;
    if (pendingEffects && pendingEffects.effects.length > 0) {
        const pendingAction: any = {
            type: 'execute_remaining_custom_effects',
            sourceCardId: pendingEffects.sourceCardId,
            laneIndex: pendingEffects.laneIndex,
            effects: pendingEffects.effects,
            context: pendingEffects.context,
            actor: actor,
            // Log-Kontext weitergeben für korrekte Einrückung/Quellkarte
            logSource: pendingEffects.logSource,
            logPhase: pendingEffects.logPhase,
            logIndentLevel: pendingEffects.logIndentLevel
        };

        // Queue the pending effects
        // CRITICAL FIX: Add at BEGINNING for LIFO order - child effects must complete before parent effects
        newState.queuedActions = [
            pendingAction,
            ...(newState.queuedActions || [])
        ];

        // Clear from state after queueing
        delete (newState as any)._pendingCustomEffects;
    }

    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    const targetName = target.charAt(0).toUpperCase() + target.slice(1);
    const sourceText = sourceCardId === 'CONTROL_MECHANIC' ? 'Control' : 'Spirit-4';
    newState = log(newState, actor, `${sourceText}: ${actorName} swaps ${targetName}'s protocols ${newProtocols[index2]} and ${newProtocols[index1]}.`);

    if (sourceCardId === 'CONTROL_MECHANIC') {
        newState.controlCardHolder = null;
    }
    
    let stateAfterRecalc = recalculateAllLaneValues(newState);

    if (originalAction) {
        if (originalAction.type === 'compile') {
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming Compile action...`);
            return performCompile(stateAfterRecalc, originalAction.laneIndex, onEndGame);
        } else if (originalAction.type === 'fill_hand') {
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming Refresh action...`);
            return performFillHand(stateAfterRecalc, actor);
        }
    }

    return stateAfterRecalc;
};

/**
 * NEW: Resolve Custom Protocol Reveal Board Card Prompt
 * Similar to Light-2 but for custom protocols with flexible followUpAction
 */
export const resolveRevealBoardCardPrompt = (prevState: GameState, choice: 'shift' | 'flip' | 'skip'): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_or_flip_board_card_custom') return prevState;

    const { actor, sourceCardId, revealedCardId, followUpAction, optional } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    const cardInfo = findCardOnBoard(prevState, revealedCardId);

    if (!cardInfo) return prevState;

    // If followUpAction specified, validate choice
    if (followUpAction && choice !== 'skip' && choice !== followUpAction) {
        console.error(`Invalid choice: ${choice}, followUpAction restricts to: ${followUpAction}`);
        return prevState;
    }

    const owner = cardInfo.owner;
    const laneIndex = prevState[owner].lanes.findIndex(l => l.some(c => c.id === revealedCardId));
    if (laneIndex === -1) return prevState;

    let newState = { ...prevState };

    switch (choice) {
        case 'shift': {
            // CRITICAL: Flip card back to face-down BEFORE shifting
            const lane = [...newState[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === revealedCardId);
            if (cardIndex !== -1) {
                lane[cardIndex] = { ...lane[cardIndex], isFaceUp: false };
                const newLanes = [...newState[owner].lanes];
                newLanes[laneIndex] = lane;
                newState = {
                    ...newState,
                    [owner]: { ...newState[owner], lanes: newLanes }
                };
            }

            newState = log(newState, actor, `${actorName} chooses to shift the revealed card (face-down).`);
            newState.actionRequired = {
                type: 'select_lane_to_shift_revealed_board_card_custom',
                sourceCardId,
                revealedCardId,
                actor,
            };
            break;
        }
        case 'flip': {
            // Card is already face-up from reveal, just trigger effects
            newState = log(newState, actor, `${actorName} chooses to flip the revealed card face-up permanently.`);
            const stateWithoutPrompt = { ...newState, actionRequired: null };

            // Trigger on-flip effects
            const result = handleOnFlipToFaceUp(stateWithoutPrompt, revealedCardId);
            newState = result.newState;
            break;
        }
        case 'skip': {
            // CRITICAL: Flip card back to face-down
            const lane = [...newState[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === revealedCardId);
            if (cardIndex !== -1) {
                lane[cardIndex] = { ...lane[cardIndex], isFaceUp: false };
                const newLanes = [...newState[owner].lanes];
                newLanes[laneIndex] = lane;
                newState = {
                    ...newState,
                    [owner]: { ...newState[owner], lanes: newLanes }
                };
            }

            newState = log(newState, actor, `${actorName} chooses to do nothing with the revealed card.`);
            newState.actionRequired = null;
            break;
        }
    }
    return newState;
};
