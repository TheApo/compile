/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, AnimationRequest, Player, PlayedCard, EffectResult, ActionRequired, EffectContext } from '../../../types';
import { drawCards as drawCardsUtil, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { deleteCardFromBoard } from '../../utils/boardModifiers';
import { log, decreaseLogIndent } from '../../utils/log';
import { findCardOnBoard, internalShiftCard, handleUncoverEffect, internalReturnCard } from '../helpers/actionUtils';
import { recalculateAllLaneValues } from '../stateManager';
import { playCard } from './playResolver';
// NOTE: Old hardcoded effects removed - all protocols now use custom effects
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import { executeOnPlayEffect, executeOnCoverEffect } from '../../effectExecutor';
import { processQueuedActions, queuePendingCustomEffects, processEndOfAction } from '../phaseManager';
import { canShiftCard, hasAnyProtocolPlayRule, canPlayFaceUpDueToSameProtocolRule } from '../passiveRuleChecker';
import { queueFollowUpEffectSync, isFollowUpAlreadyQueued } from './followUpHelper';

export type LaneActionResult = {
    nextState: GameState;
    requiresAnimation?: {
        animationRequests: AnimationRequest[];
        // FIX: Replaced `originalAction` with `onCompleteCallback` to create a consistent and more flexible pattern for handling post-animation logic, resolving type errors in `aiManager` and `useGameState`.
        onCompleteCallback: (s: GameState, endTurnCb: (s2: GameState) => GameState) => GameState;
    } | null;
};

export const resolveActionWithLane = (prev: GameState, targetLaneIndex: number): LaneActionResult => {
    if (!prev.actionRequired) return { nextState: prev };

    let newState: GameState = { ...prev };
    let requiresAnimation: LaneActionResult['requiresAnimation'] = null;

    switch (prev.actionRequired.type) {
        case 'select_lane_for_shift_all': {
            // GENERIC: Shift ALL cards to selected lane (works for ANY custom protocol with count="all")
            const { cardsToShift, validDestinationLanes, sourceLaneIndex, actor, sourceCardId } = prev.actionRequired;

            // Validate the selected lane is in the valid list
            if (!validDestinationLanes.includes(targetLaneIndex)) {
                console.error(`Illegal shift: Lane ${targetLaneIndex} is not a valid destination`);
                return { nextState: prev };
            }

            // Validate cannot shift to same lane
            if (targetLaneIndex === sourceLaneIndex) {
                console.error(`Illegal shift: Cannot shift to the same lane ${sourceLaneIndex}`);
                return { nextState: prev };
            }

            // Shift all cards to the target lane
            let currentState = { ...prev };
            const animationRequests: AnimationRequest[] = [];
            const unaffectedCardIds: string[] = [];

            for (const { cardId, owner } of cardsToShift) {
                const cardInfo = findCardOnBoard(currentState, cardId);
                if (!cardInfo) {
                    // Card no longer exists (was deleted/returned during previous shifts)
                    continue;
                }

                // Validate shift is allowed by passive rules
                const currentLaneIdx = currentState[owner].lanes.findIndex(l => l.some(c => c.id === cardId));
                if (currentLaneIdx === -1) continue;

                const shiftCheck = canShiftCard(currentState, currentLaneIdx, targetLaneIndex);
                if (!shiftCheck.allowed) {
                    unaffectedCardIds.push(cardId);
                    continue;
                }

                // Perform the shift
                const shiftResult = internalShiftCard(currentState, cardId, owner, targetLaneIndex, actor);
                currentState = shiftResult.newState;

                if (shiftResult.animationRequests) {
                    animationRequests.push(...shiftResult.animationRequests);
                }
            }

            newState = currentState;
            newState = queuePendingCustomEffects(newState);

            // CRITICAL FIX: Only clear actionRequired if it's still the original select_lane_for_shift_all
            // If an uncover effect (e.g., Chaos-2's shift effect) set a NEW actionRequired, preserve it!
            if (!newState.actionRequired || newState.actionRequired.type === 'select_lane_for_shift_all') {
                newState.actionRequired = null;
            }

            if (animationRequests.length > 0) {
                // NEW: Extract followUpEffect for if_executed conditionals
                const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                const conditionalType = (prev.actionRequired as any)?.conditionalType;

                requiresAnimation = {
                    animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        // Check if any uncover effects were triggered
                        if (s.actionRequired) return s;
                        // Check for queued actions
                        if (s.queuedActions && s.queuedActions.length > 0) return s;

                        let finalState = s;

                        // NEW: Handle generic followUpEffect for custom protocols
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || animationRequests.length > 0;
                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(finalState, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIdx = finalState[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: finalState.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIdx, finalState, context, followUpEffect);
                                    finalState = result.newState;
                                    if (finalState.actionRequired) {
                                        return finalState;
                                    }
                                }
                            }
                        }

                        return endTurnCb(finalState);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_shift': {
            const { cardToShiftId, cardOwner, actor, sourceEffect, originalLaneIndex, sourceCardId } = prev.actionRequired;

            // RULE: Cannot shift to the same lane
            if (targetLaneIndex === originalLaneIndex) {
                console.error(`Illegal shift: Cannot shift to the same lane ${originalLaneIndex}`);
                return { nextState: prev }; // Block the illegal move
            }

            // NEW: Validate validLanes restriction (Courage-3: opponent_highest_value_lane)
            const validLanes = (prev.actionRequired as any).validLanes;
            if (validLanes && !validLanes.includes(targetLaneIndex)) {
                console.error(`Illegal shift: Lane ${targetLaneIndex} not in valid lanes ${validLanes}`);
                return { nextState: prev }; // Block the illegal move
            }

            // CRITICAL VALIDATION for Anarchy-1: "Shift 1 other card to a line without a matching protocol"
            // The destination lane must NOT have a matching protocol for the card being shifted
            // IMPORTANT: This rule only applies to face-up cards. Face-down cards can be shifted to any lane.
            const sourceCard = findCardOnBoard(prev, sourceCardId);
            const cardToShift = findCardOnBoard(prev, cardToShiftId);

            if (sourceCard && sourceCard.card.protocol === 'Anarchy' && sourceCard.card.value === 1) {
                if (cardToShift && cardToShift.card.isFaceUp) {
                    const playerProtocolAtTarget = prev.player.protocols[targetLaneIndex];
                    const opponentProtocolAtTarget = prev.opponent.protocols[targetLaneIndex];
                    const cardProtocol = cardToShift.card.protocol;

                    // RULE: Face-up card's protocol must NOT match either protocol in target lane
                    // Face-down cards are exempt from this rule
                    if (cardProtocol === playerProtocolAtTarget || cardProtocol === opponentProtocolAtTarget) {
                        console.error(`Illegal Anarchy-1 shift: ${cardProtocol}-${cardToShift.card.value} cannot be shifted to lane ${targetLaneIndex} (protocols: ${playerProtocolAtTarget}/${opponentProtocolAtTarget}) - matching protocol not allowed`);
                        return { nextState: prev }; // Block the illegal move
                    }
                }
            }

            // CRITICAL VALIDATION for Gravity-1: "Shift 1 card either to or from this line"
            // The shift must involve the Gravity-1's lane (either as source OR destination)
            if (sourceCard && sourceCard.card.protocol === 'Gravity' && sourceCard.card.value === 1) {
                // Find Gravity-1's lane
                let gravity1LaneIndex = -1;
                for (let i = 0; i < prev[sourceCard.owner].lanes.length; i++) {
                    if (prev[sourceCard.owner].lanes[i].some(c => c.id === sourceCardId)) {
                        gravity1LaneIndex = i;
                        break;
                    }
                }

                // RULE: Either originalLaneIndex OR targetLaneIndex must be the Gravity-1 lane
                if (gravity1LaneIndex !== -1) {
                    const isFromGravityLane = originalLaneIndex === gravity1LaneIndex;
                    const isToGravityLane = targetLaneIndex === gravity1LaneIndex;

                    if (!isFromGravityLane && !isToGravityLane) {
                        // ILLEGAL: Shifting between two lanes that are NOT the Gravity lane
                        console.error(`Illegal Gravity-1 shift: Must shift to or from Gravity lane ${gravity1LaneIndex}, but tried ${originalLaneIndex} → ${targetLaneIndex}`);
                        return { nextState: prev }; // Block the illegal move
                    }
                }
            }

            // GENERIC VALIDATION for custom protocol destinationRestriction
            if ((prev.actionRequired as any).destinationRestriction && cardToShift) {
                const destinationRestriction = (prev.actionRequired as any).destinationRestriction;

                if (destinationRestriction.type === 'non_matching_protocol' && cardToShift.card.isFaceUp) {
                    const playerProtocolAtTarget = prev.player.protocols[targetLaneIndex];
                    const opponentProtocolAtTarget = prev.opponent.protocols[targetLaneIndex];
                    const cardProtocol = cardToShift.card.protocol;

                    // RULE: Card's protocol must NOT match either protocol in target lane
                    if (cardProtocol === playerProtocolAtTarget || cardProtocol === opponentProtocolAtTarget) {
                        console.error(`Illegal shift: ${cardProtocol} cannot be shifted to lane ${targetLaneIndex} (protocols: ${playerProtocolAtTarget}/${opponentProtocolAtTarget}) - matching protocol not allowed`);
                        return { nextState: prev }; // Block the illegal move
                    }
                }

                // NEW: Validation for 'to_or_from_this_lane' (Gravity-1 style)
                if (destinationRestriction.type === 'to_or_from_this_lane') {
                    // Resolve 'current' laneIndex to actual lane number
                    const resolvedSourceLane = destinationRestriction.laneIndex === 'current' && sourceCard
                        ? (() => {
                            for (let i = 0; i < prev[sourceCard.owner].lanes.length; i++) {
                                if (prev[sourceCard.owner].lanes[i].some(c => c.id === sourceCardId)) {
                                    return i;
                                }
                            }
                            return -1;
                        })()
                        : destinationRestriction.laneIndex;

                    if (resolvedSourceLane !== undefined && resolvedSourceLane !== -1) {
                        // RULE: Either originalLaneIndex OR targetLaneIndex must be the specified lane
                        const isFromSpecifiedLane = originalLaneIndex === resolvedSourceLane;
                        const isToSpecifiedLane = targetLaneIndex === resolvedSourceLane;

                        if (!isFromSpecifiedLane && !isToSpecifiedLane) {
                            // ILLEGAL: Shifting between two lanes that are NOT the specified lane
                            console.error(`Illegal shift: Must shift to or from lane ${resolvedSourceLane}, but tried ${originalLaneIndex} → ${targetLaneIndex}`);
                            return { nextState: prev }; // Block the illegal move
                        }
                    }
                }
            }

            // CRITICAL VALIDATION: Check if shift is allowed by passive rules (generic)
            // This handles Frost-3, Frost_custom-3, and any future custom protocols with shift-blocking rules
            const shiftCheck = canShiftCard(prev, originalLaneIndex, targetLaneIndex);
            if (!shiftCheck.allowed) {
                console.error(`Illegal shift: Cannot shift from lane ${originalLaneIndex} to ${targetLaneIndex} - ${shiftCheck.reason}`);
                return { nextState: prev }; // Block the illegal move
            }

            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, actor);
            newState = shiftResult.newState;

            // CRITICAL: Check if the shift created an interrupt (e.g., uncover effect)
            const uncoverCreatedInterrupt = newState.actionRequired !== null;

            // === CRITICAL FIX: Queue followUpEffect SYNCHRONOUSLY ===
            // Using central helper to prevent async timing bugs (AI runs sync, never waits for callbacks)
            const wasActionExecuted = !!cardToShiftId;  // Did the shift actually happen?
            newState = queueFollowUpEffectSync(newState, prev.actionRequired, actor, wasActionExecuted);

            if (shiftResult.animationRequests) {
                // FIX: Implemented `onCompleteCallback` to correctly handle post-shift effects like Speed-3's self-flip and Anarchy-0's conditional draw after animations.
                requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        let finalState = s;

                        // CRITICAL: If uncover created an interrupt, we need to queue the follow-up effects
                        if (uncoverCreatedInterrupt) {
                            // LEGACY: Speed-3's speed_3_end effect
                            // NOTE: This is kept for backwards compatibility with old Speed-3 protocol
                            // The generic followUpEffect handling is now done synchronously BEFORE this callback
                            if (sourceEffect === 'speed_3_end') {
                                const speed3CardId = prev.actionRequired.sourceCardId;
                                const speed3FlipAction: ActionRequired = {
                                    type: 'speed_3_self_flip_after_shift',
                                    sourceCardId: speed3CardId,
                                    actor: actor,
                                };
                                finalState.queuedActions = [
                                    ...(finalState.queuedActions || []),
                                    speed3FlipAction
                                ];
                            }

                            // NOTE: Generic followUpEffect queueing has been moved to SYNCHRONOUS execution
                            // BEFORE this callback to fix the timing bug where turn changed before callback was called.
                            // See the code block at line ~257-291.

                            const sourceCard = findCardOnBoard(finalState, sourceCardId);
                            // CRITICAL: Only queue Anarchy-0 draw if it's still uncovered AND face-up
                            // If the shift covered Anarchy-0, its effect should be cancelled
                            // REMOVED: Legacy anarchy_0_conditional_draw - Anarchy-0 now uses custom protocol system
                            // The draw effect is handled via _pendingCustomEffects below

                            // NEW: Queue pending effects from custom cards if shift created an interrupt
                            const pendingEffects = (finalState as any)._pendingCustomEffects;
                            if (pendingEffects) {
                                const sourceCard = findCardOnBoard(finalState, pendingEffects.sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === pendingEffects.sourceCardId));
                                    const isStillUncovered = lane && lane.length > 0 && lane[lane.length - 1].id === pendingEffects.sourceCardId;

                                    if (isStillUncovered) {
                                        const pendingAction: ActionRequired = {
                                            type: 'execute_remaining_custom_effects' as any,
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
                                        // CRITICAL FIX: Add at BEGINNING for LIFO order - child effects must complete before parent effects
                                        finalState.queuedActions = [
                                            pendingAction,
                                            ...(finalState.queuedActions || [])
                                        ];
                                    }
                                }
                                // Clear from state after queueing
                                delete (finalState as any)._pendingCustomEffects;
                            }

                            // Return state with interrupt and queued follow-up actions
                            // NOTE: Do NOT decrease log indent here - the original effect is not complete yet
                            // The indent will be decreased when the queued action executes
                            return finalState;
                        }

                        // No interrupt - execute follow-up effects immediately
                        if (sourceEffect === 'speed_3_end') {
                            const speed3CardId = prev.actionRequired.sourceCardId;
                            finalState = log(finalState, actor, `Speed-3: Flipping itself after shifting a card.`);
                            finalState = findAndFlipCards(new Set([speed3CardId]), finalState);
                            finalState.animationState = { type: 'flipCard', cardId: speed3CardId };
                        }
                        // NOTE: Anarchy-0 conditional draw is now handled via custom protocol pending effects

                        // Execute pending effects from custom cards (e.g., Anarchy_custom-0)
                        const pendingEffects = (finalState as any)._pendingCustomEffects;
                        if (pendingEffects) {
                            // Check if source card is still uncovered and face-up
                            const sourceCard = findCardOnBoard(finalState, pendingEffects.sourceCardId);
                            if (sourceCard && sourceCard.card.isFaceUp) {
                                const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === pendingEffects.sourceCardId));
                                const isStillUncovered = lane && lane.length > 0 && lane[lane.length - 1].id === pendingEffects.sourceCardId;

                                if (isStillUncovered) {
                                    // Execute remaining effects
                                    for (const effectDef of pendingEffects.effects) {
                                        const result = executeCustomEffect(
                                            sourceCard.card,
                                            pendingEffects.laneIndex,
                                            finalState,
                                            pendingEffects.context,
                                            effectDef
                                        );
                                        finalState = result.newState;
                                    }
                                    // Clear the pending effects
                                    delete (finalState as any)._pendingCustomEffects;
                                } else {
                                    finalState = log(finalState, actor, `Pending effects cancelled because source card is now covered.`);
                                    delete (finalState as any)._pendingCustomEffects;
                                }
                            } else {
                                delete (finalState as any)._pendingCustomEffects;
                            }
                        }
                        // CRITICAL FIX: Decrease log indent and clear actionRequired before calling endTurnCb
                        // Decrease indent if this shift was triggered by an effect (has sourceCardId)
                        if (sourceCardId) {
                            finalState = decreaseLogIndent(finalState);
                        }

                        // NEW: Trigger reactive effects after shift
                        const reactiveShiftResult = processReactiveEffects(finalState, 'after_shift', { player: actor, cardId: cardToShiftId });
                        finalState = reactiveShiftResult.newState;

                        // NEW: Handle generic followUpEffect for custom protocols ("Shift 1. If you do, draw 2.")
                        const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                        const conditionalType = (prev.actionRequired as any)?.conditionalType;
                        if (followUpEffect && sourceCardId) {
                            // For 'if_executed' conditionals, only execute if the shift actually happened
                            const shouldExecute = conditionalType !== 'if_executed' || cardToShiftId; // shift happened if cardToShiftId exists

                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(finalState, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIndex = finalState[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: finalState.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    // CRITICAL: Set log context before executing followUp effect
                                    const cardName = `${sourceCard.card.protocol}-${sourceCard.card.value}`;
                                    const phaseContext = prev._currentPhaseContext || (prev.phase === 'start' ? 'start' : 'end');
                                    finalState = {
                                        ...finalState,
                                        _logIndentLevel: 1,
                                        _currentEffectSource: cardName,
                                        _currentPhaseContext: phaseContext as 'start' | 'end',
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIndex, finalState, context, followUpEffect);
                                    finalState = result.newState;
                                }
                            }
                        }

                        // CRITICAL: Queue pending custom effects before clearing actionRequired
                        finalState = queuePendingCustomEffects(finalState);
                        finalState.actionRequired = null;

                        // CRITICAL: Process queued actions after shift completes
                        // This ensures effects like anarchy_0_conditional_draw are executed automatically
                        if (finalState.queuedActions && finalState.queuedActions.length > 0) {
                            const nextAction = finalState.queuedActions[0];

                            // CRITICAL FIX: execute_remaining_custom_effects is an internal action
                            // that should be processed via processQueuedActions, NOT set as actionRequired
                            if (nextAction.type === 'execute_remaining_custom_effects') {
                                finalState = processQueuedActions(finalState);

                                // NOTE: If processQueuedActions set an animationState (e.g., draw animation),
                                // we just continue - the animation was already displayed synchronously
                                // and the state should now have the updated hand
                                if (finalState.animationState) {
                                    finalState = { ...finalState, animationState: null };
                                }
                            } else {
                                finalState.queuedActions = finalState.queuedActions.slice(1);
                                finalState.actionRequired = nextAction;
                            }
                        }

                        // CRITICAL FIX: If we're inside an interrupt (created by a previous effect like Death-2's uncover),
                        // we should NOT use endTurnCb (which uses the ORIGINAL turn player's phase progression).
                        // Instead, use processEndOfAction which properly handles interrupt resolution and turn switching.
                        if (finalState._interruptedTurn) {
                            // We're still in an interrupt - let processEndOfAction handle the turn restoration
                            return processEndOfAction(finalState);
                        }

                        return endTurnCb(finalState);
                    }
                };
            } else {
                // CRITICAL: If uncover created an interrupt, queue the follow-up effects
                if (uncoverCreatedInterrupt) {
                    // LEGACY: Speed-3's speed_3_end effect
                    if (sourceEffect === 'speed_3_end') {
                        const speed3CardId = prev.actionRequired.sourceCardId;
                        const speed3FlipAction: ActionRequired = {
                            type: 'speed_3_self_flip_after_shift',
                            sourceCardId: speed3CardId,
                            actor: actor,
                        };
                        newState.queuedActions = [
                            ...(newState.queuedActions || []),
                            speed3FlipAction
                        ];
                    }

                    // NEW: Queue generic followUpEffect for custom protocols (Speed-3 "If you do, flip this card")
                    // This ensures the followUp executes AFTER the uncover interrupt resolves
                    const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                    const conditionalType = (prev.actionRequired as any)?.conditionalType;
                    if (followUpEffect && sourceCardId) {
                        const shouldExecute = conditionalType !== 'if_executed' || cardToShiftId;
                        if (shouldExecute) {
                            // Get source card name for log context (state context may already be cleared)
                            const sourceCardForLog = findCardOnBoard(newState, sourceCardId);
                            // Determine phase from state (could be 'start' or 'end')
                            const phaseContext = prev._currentPhaseContext || (prev.phase === 'start' ? 'start' : 'end');
                            const queuedFollowUp = {
                                type: 'execute_follow_up_effect',
                                sourceCardId: sourceCardId,
                                followUpEffect: followUpEffect,
                                actor: actor,
                                // CRITICAL: Store card name explicitly since state context may be cleared
                                logContext: {
                                    indentLevel: 1,  // Follow-ups are always indented
                                    sourceCardName: sourceCardForLog ? `${sourceCardForLog.card.protocol}-${sourceCardForLog.card.value}` : undefined,
                                    phase: phaseContext,
                                },
                            };
                            newState.queuedActions = [
                                ...(newState.queuedActions || []),
                                queuedFollowUp
                            ];
                        }
                    }

                    // NOTE: Anarchy-0's conditional draw is now handled via custom protocol system
                    // (_pendingCustomEffects and execute_remaining_custom_effects)
                    // The legacy anarchy_0_conditional_draw code has been removed to avoid duplicate queueing
                    // NOTE: Do NOT decrease log indent here - the original effect is not complete yet
                    // The indent will be decreased when the queued action executes
                } else {
                    // No interrupt - execute immediately
                    if (sourceEffect === 'speed_3_end') {
                        const speed3CardId = prev.actionRequired.sourceCardId;
                        newState = log(newState, actor, `Speed-3: Flipping itself after shifting a card.`);
                        newState = findAndFlipCards(new Set([speed3CardId]), newState);
                        newState.animationState = { type: 'flipCard', cardId: speed3CardId };
                    }

                    // NEW: Execute pending effects from custom cards (e.g., Anarchy_custom-0) - NO ANIMATION case
                    const pendingEffects = (newState as any)._pendingCustomEffects;
                    if (pendingEffects) {
                        const sourceCardPending = findCardOnBoard(newState, pendingEffects.sourceCardId);
                        if (sourceCardPending && sourceCardPending.card.isFaceUp) {
                            const lane = newState[sourceCardPending.owner].lanes.find(l => l.some(c => c.id === pendingEffects.sourceCardId));
                            const isStillUncovered = lane && lane.length > 0 && lane[lane.length - 1].id === pendingEffects.sourceCardId;

                            if (isStillUncovered) {
                                for (const effectDef of pendingEffects.effects) {
                                    const result = executeCustomEffect(
                                        sourceCardPending.card,
                                        pendingEffects.laneIndex,
                                        newState,
                                        pendingEffects.context,
                                        effectDef
                                    );
                                    newState = result.newState;
                                }
                                delete (newState as any)._pendingCustomEffects;
                            } else {
                                newState = log(newState, actor, `Pending effects cancelled because source card is now covered.`);
                                delete (newState as any)._pendingCustomEffects;
                            }
                        } else {
                            delete (newState as any)._pendingCustomEffects;
                        }
                    }

                    // Anarchy-0: After shift is resolved, check for non-matching protocols and draw
                    // NOTE: Anarchy-0 conditional draw is now handled via custom protocol pending effects

                    // CRITICAL FIX: Decrease log indent and clear actionRequired after completing follow-up effects
                    // Without this, the game would softlock with the old 'select_card_to_shift' action still active
                    // Decrease indent if this shift was triggered by an effect (has sourceCardId)
                    if (sourceCardId) {
                        newState = decreaseLogIndent(newState);
                    }

                    // NEW: Trigger reactive effects after shift
                    const reactiveShiftResult = processReactiveEffects(newState, 'after_shift', { player: actor, cardId: cardToShiftId });
                    newState = reactiveShiftResult.newState;

                    // NEW: Handle generic followUpEffect for custom protocols (NO ANIMATION case)
                    // This handles "Shift 1. If you do, flip this card." like Speed-3
                    const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                    const conditionalType = (prev.actionRequired as any)?.conditionalType;
                    if (followUpEffect && sourceCardId) {
                        // For 'if_executed' conditionals, only execute if the shift actually happened
                        const shouldExecute = conditionalType !== 'if_executed' || cardToShiftId;

                        if (shouldExecute) {
                            const sourceCardForFollow = findCardOnBoard(newState, sourceCardId);
                            if (sourceCardForFollow && sourceCardForFollow.card.isFaceUp) {
                                const laneForFollow = newState[sourceCardForFollow.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                const laneIndexForFollow = newState[sourceCardForFollow.owner].lanes.indexOf(laneForFollow!);
                                const context = {
                                    cardOwner: sourceCardForFollow.owner,
                                    actor: actor,
                                    currentTurn: newState.turn,
                                    opponent: (sourceCardForFollow.owner === 'player' ? 'opponent' : 'player') as Player,
                                };
                                // CRITICAL: Set log context before executing followUp effect
                                const cardName = `${sourceCardForFollow.card.protocol}-${sourceCardForFollow.card.value}`;
                                const phaseContext = prev._currentPhaseContext || (prev.phase === 'start' ? 'start' : 'end');
                                newState = {
                                    ...newState,
                                    _logIndentLevel: 1,
                                    _currentEffectSource: cardName,
                                    _currentPhaseContext: phaseContext as 'start' | 'end',
                                };
                                const result = executeCustomEffect(sourceCardForFollow.card, laneIndexForFollow, newState, context, followUpEffect);
                                newState = result.newState;
                            }
                        }
                    }

                    // CRITICAL: Queue pending custom effects before clearing actionRequired
                    newState = queuePendingCustomEffects(newState);
                    newState.actionRequired = null;

                    // CRITICAL: Process queued actions after shift completes
                    // This ensures effects like anarchy_0_conditional_draw are executed automatically
                    if (newState.queuedActions && newState.queuedActions.length > 0) {
                        const nextAction = newState.queuedActions[0];

                        // CRITICAL FIX: execute_remaining_custom_effects is an internal action
                        // that should be processed via processQueuedActions, NOT set as actionRequired
                        if (nextAction.type === 'execute_remaining_custom_effects') {
                            newState = processQueuedActions(newState);

                            // CRITICAL: If processQueuedActions set an animationState (e.g., draw animation),
                            // we need to convert it to requiresAnimation so useGameState processes it correctly
                            if (newState.animationState && !newState.actionRequired) {
                                const animState = newState.animationState;
                                if (animState.type === 'draw') {
                                    requiresAnimation = {
                                        animationRequests: [{ type: 'draw', player: (animState as any).player, count: (animState as any).count }],
                                        onCompleteCallback: (s, endTurnCb) => {
                                            // After draw animation, check hand limit and continue turn
                                            const stateAfterAnim = { ...s, animationState: null };
                                            return endTurnCb(stateAfterAnim);
                                        }
                                    };
                                    newState = { ...newState, animationState: null };
                                }
                            }
                        } else {
                            newState.queuedActions = newState.queuedActions.slice(1);
                            newState.actionRequired = nextAction;
                        }
                    }
                }
            }
            break;
        }
        case 'shift_flipped_card_optional': {
            const cardToShiftId = prev.actionRequired.cardId;
            // FIX: Use actor from actionRequired, not prev.turn (critical for interrupt scenarios)
            const actor = prev.actionRequired.actor;


            // CRITICAL: Find which player owns the card (Spirit-3 on player side, Darkness-1 on opponent side)
            let cardOwner: Player | null = null;
            for (const player of ['player', 'opponent'] as Player[]) {
                if (prev[player].lanes.flat().some(c => c.id === cardToShiftId)) {
                    cardOwner = player;
                    break;
                }
            }

            if (!cardOwner) {
                console.error('[shift_flipped_card_optional] Card not found on board:', cardToShiftId);
                newState = prev;
                break;
            }

            // NEW: Extract followUpEffect for if_executed conditionals BEFORE shift
            const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
            const conditionalType = (prev.actionRequired as any)?.conditionalType;
            const sourceCardId = (prev.actionRequired as any)?.sourceCardId;


            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, actor);
            newState = shiftResult.newState;

            // CRITICAL FIX: If there's a followUpEffect (e.g., Speed-3's "If you do, flip this card"),
            // we need to queue it so it executes AFTER any uncover effects from the shift.
            // The shift may uncover a card (like Speed-5) that triggers its own effects first.
            if (followUpEffect && sourceCardId) {
                const shouldExecute = conditionalType !== 'if_executed' || cardToShiftId;
                if (shouldExecute) {
                    // Get source card name for log context (state context may already be cleared)
                    const sourceCardForLog = findCardOnBoard(newState, sourceCardId);
                    // Determine phase from state (could be 'start' or 'end')
                    const phaseContext = prev._currentPhaseContext || (prev.phase === 'start' ? 'start' : 'end');
                    // Queue the followUpEffect to execute after any pending actions
                    const queuedFollowUp = {
                        type: 'execute_follow_up_effect',
                        sourceCardId: sourceCardId,
                        followUpEffect: followUpEffect,
                        actor: actor,
                        // CRITICAL: Store card name explicitly since state context may be cleared
                        logContext: {
                            indentLevel: 1,  // Follow-ups are always indented
                            sourceCardName: sourceCardForLog ? `${sourceCardForLog.card.protocol}-${sourceCardForLog.card.value}` : undefined,
                            phase: phaseContext,
                        },
                    };
                    newState = {
                        ...newState,
                        queuedActions: [...(newState.queuedActions || []), queuedFollowUp]
                    };
                }
            }

            if (shiftResult.animationRequests) {
                 requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        // CRITICAL: ALWAYS call endTurnCb - processEndOfAction will handle the queue automatically
                        return endTurnCb(s);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_play': {
            const { cardInHandId, isFaceDown, actor, source, disallowedLaneIndex, validLanes, preSelectedLane, ignoreProtocolMatching } = prev.actionRequired as any;

            // NEW: Smoke-3 - if preSelectedLane is set, use it instead of targetLaneIndex
            // This allows automatic lane resolution after card selection
            const effectiveLaneIndex = preSelectedLane !== undefined ? preSelectedLane : targetLaneIndex;

            // CRITICAL: Server-side validation for disallowedLaneIndex (e.g., Darkness-3: "Play to other lines")
            if (disallowedLaneIndex !== undefined && effectiveLaneIndex === disallowedLaneIndex) {
                return { nextState: prev, requiresTurnEnd: false }; // Silently reject
            }

            // NEW: Smoke-3 validation - validLanes restricts which lanes can be selected
            if (validLanes && !validLanes.includes(effectiveLaneIndex)) {
                return { nextState: prev, requiresTurnEnd: false }; // Silently reject
            }

            // Play from deck to selected lane (Life-3, Luck-1, etc.)
            if (source === 'deck') {
                // Extract followUpEffect for conditional effects (e.g., Luck-1: "then flip that card")
                const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                const conditionalType = (prev.actionRequired as any)?.conditionalType;
                const sourceCardId = (prev.actionRequired as any)?.sourceCardId;
                const preDrawnCard = (prev.actionRequired as any)?.preDrawnCard;

                const stateBeforePlay = { ...prev, actionRequired: null };
                const playerState = stateBeforePlay[actor];

                let newCardToPlay: PlayedCard;
                let remainingDeck = playerState.deck;
                let newDiscard = playerState.discard;

                // CRITICAL: Use pre-drawn card if available (from preview modal)
                if (preDrawnCard) {
                    // Card was already drawn in playExecutor and shown in preview
                    newCardToPlay = { ...preDrawnCard, isFaceUp: !isFaceDown };
                } else {
                    // Fallback: Draw ONE card from deck (for Life-3 without preview)
                    const drawResult = drawCardsUtil(playerState.deck, playerState.discard, 1);
                    remainingDeck = drawResult.remainingDeck;
                    newDiscard = drawResult.newDiscard;

                    if (drawResult.drawnCards.length === 0) {
                        console.error("No cards in deck/discard to play");
                        newState = stateBeforePlay;
                        break;
                    }

                    // Create new card to play
                    newCardToPlay = { ...drawResult.drawnCards[0], id: uuidv4(), isFaceUp: !isFaceDown };
                }

                // Add card to the chosen lane
                const newPlayerLanes = [...playerState.lanes];
                newPlayerLanes[effectiveLaneIndex] = [...newPlayerLanes[effectiveLaneIndex], newCardToPlay];

                const updatedPlayerState = {
                    ...playerState,
                    lanes: newPlayerLanes,
                    deck: remainingDeck,
                    discard: newDiscard
                };

                newState = {
                    ...stateBeforePlay,
                    [actor]: updatedPlayerState,
                    // Store the played card ID for useCardFromPreviousEffect (e.g., Luck-1 flip)
                    lastCustomEffectTargetCardId: newCardToPlay.id
                };

                // Log the play
                const actorName = actor === 'player' ? 'Player' : 'Opponent';
                const faceText = isFaceDown ? 'face-down' : 'face-up';
                newState = log(newState, actor, `${actorName} plays ${newCardToPlay.protocol}-${newCardToPlay.value} ${faceText} from deck.`);

                // Add play animation with followUpEffect handling
                requiresAnimation = {
                    animationRequests: [{
                        type: 'play',
                        cardId: newCardToPlay.id,
                        owner: actor,
                        laneIndex: effectiveLaneIndex,
                        isFaceUp: newCardToPlay.isFaceUp
                    }],
                    onCompleteCallback: (s, endTurnCb) => {
                        let finalState = s;

                        // Handle followUpEffect (e.g., Luck-1: "then flip that card, ignoring its middle commands")
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || true; // Play succeeded
                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(finalState, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIdx = finalState[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: finalState.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIdx, finalState, context, followUpEffect);
                                    finalState = result.newState;
                                    if (finalState.actionRequired) {
                                        return finalState;
                                    }
                                }
                            }
                        }

                        return endTurnCb(finalState);
                    }
                };

                break;
            }

            // Play from trash (Time-0, Time-3: play card from discard pile)
            if (source === 'trash') {
                const preDrawnCard = (prev.actionRequired as any)?.preDrawnCard;
                const sourceCardId = (prev.actionRequired as any)?.sourceCardId;
                const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                const conditionalType = (prev.actionRequired as any)?.conditionalType;
                const useNormalPlayRules = (prev.actionRequired as any)?.useNormalPlayRules;

                if (!preDrawnCard) {
                    console.error("No preDrawnCard for trash play");
                    newState = { ...prev, actionRequired: null };
                    break;
                }

                const stateBeforePlay = { ...prev, actionRequired: null };
                const playerState = stateBeforePlay[actor];

                // Determine face state based on rules - use GENERIC passive rule system
                let shouldPlayFaceUp: boolean;
                if (typeof isFaceDown === 'boolean') {
                    // Explicit face-down setting (Time-3: play face-down)
                    shouldPlayFaceUp = !isFaceDown;
                } else if (useNormalPlayRules) {
                    // Normal play rules: use the same logic as hand plays
                    // Check protocol matching and passive rules generically
                    const opponentId = actor === 'player' ? 'opponent' : 'player';
                    const playerProtocol = prev[actor].protocols[effectiveLaneIndex];
                    const opponentProtocol = prev[opponentId].protocols[effectiveLaneIndex];
                    const protocolMatches = preDrawnCard.protocol === playerProtocol ||
                                           preDrawnCard.protocol === opponentProtocol;

                    // Use generic passive rule checks instead of hardcoded card names
                    const hasAnyProtocolRule = hasAnyProtocolPlayRule(prev, actor, effectiveLaneIndex);

                    // Face-up if protocol matches OR if any passive rule allows any protocol play
                    shouldPlayFaceUp = protocolMatches || hasAnyProtocolRule;
                } else {
                    // Default: face-up
                    shouldPlayFaceUp = true;
                }

                // Create new card to play from the pre-selected trash card
                const newCardToPlay: PlayedCard = { ...preDrawnCard, isFaceUp: shouldPlayFaceUp };

                // === BUG FIX: Trigger onCover effect for the top card in target lane ===
                // (Same pattern as playResolver.ts lines 175-207)
                let stateForPlay = stateBeforePlay;
                const targetLane = stateForPlay[actor].lanes[effectiveLaneIndex];

                if (targetLane.length > 0) {
                    const topCard = targetLane[targetLane.length - 1];

                    // Trigger reactive effects first (Metal-6 style: "When this card would be covered")
                    const beforeCoverResult = processReactiveEffects(
                        stateForPlay, 'on_cover',
                        { player: actor, cardId: topCard.id }
                    );
                    stateForPlay = beforeCoverResult.newState;

                    // Check if card still exists after reactive effects
                    const laneAfterReactive = stateForPlay[actor].lanes[effectiveLaneIndex];
                    const cardStillExists = laneAfterReactive.some(c => c.id === topCard.id);

                    if (cardStillExists && topCard.isFaceUp) {
                        // Card still exists - execute on_cover bottom effects (e.g., Hate-4)
                        const coverContext: EffectContext = {
                            cardOwner: actor,
                            actor: actor,
                            currentTurn: stateForPlay.turn,
                            opponent: (actor === 'player' ? 'opponent' : 'player') as Player,
                            triggerType: 'cover'
                        };
                        // Store covering card's protocol for on_cover restrictions
                        const stateWithCoveringProtocol = {
                            ...stateForPlay,
                            _coveringCardProtocol: newCardToPlay.protocol
                        } as GameState;
                        const onCoverResult = executeOnCoverEffect(
                            topCard, effectiveLaneIndex, stateWithCoveringProtocol, coverContext
                        );
                        stateForPlay = onCoverResult.newState;
                    }
                }

                // Use stateForPlay (may have been modified by onCover effects)
                const playerStateAfterCover = stateForPlay[actor];
                // === END BUG FIX ===

                // Add card to the chosen lane
                const newPlayerLanes = [...playerStateAfterCover.lanes];
                newPlayerLanes[effectiveLaneIndex] = [...newPlayerLanes[effectiveLaneIndex], newCardToPlay];

                const updatedPlayerState = {
                    ...playerStateAfterCover,
                    lanes: newPlayerLanes,
                };

                newState = {
                    ...stateForPlay,
                    [actor]: updatedPlayerState,
                    // Store the played card ID for useCardFromPreviousEffect
                    lastCustomEffectTargetCardId: newCardToPlay.id
                };

                // Log the play
                const actorName = actor === 'player' ? 'Player' : 'Opponent';
                const faceText = shouldPlayFaceUp ? 'face-up' : 'face-down';
                newState = log(newState, actor, `${actorName} plays ${newCardToPlay.protocol}-${newCardToPlay.value} ${faceText} from trash.`);

                // Recalculate lane values after playing the card
                newState = recalculateAllLaneValues(newState);

                // Add play animation with followUpEffect handling
                requiresAnimation = {
                    animationRequests: [{
                        type: 'play',
                        cardId: newCardToPlay.id,
                        owner: actor,
                        laneIndex: effectiveLaneIndex,
                        isFaceUp: newCardToPlay.isFaceUp
                    }],
                    onCompleteCallback: (s, endTurnCb) => {
                        let finalState = s;

                        // CRITICAL: First trigger the PLAYED card's on_play effects (like normal card play)
                        // Only trigger if card is face-up
                        if (newCardToPlay.isFaceUp) {
                            const playedCardOnBoard = findCardOnBoard(finalState, newCardToPlay.id);
                            if (playedCardOnBoard) {
                                const playContext: EffectContext = {
                                    cardOwner: actor,
                                    actor: actor,
                                    currentTurn: finalState.turn,
                                    opponent: (actor === 'player' ? 'opponent' : 'player') as Player,
                                    triggerType: 'play'
                                };
                                const playResult = executeOnPlayEffect(playedCardOnBoard.card, effectiveLaneIndex, finalState, playContext);
                                finalState = playResult.newState;

                                // If played card's effect created an action, pause and wait
                                if (finalState.actionRequired) {
                                    // Queue the Time-0 followUpEffect (shuffle_trash) for after the played card's effects
                                    if (followUpEffect && sourceCardId) {
                                        finalState = {
                                            ...finalState,
                                            queuedActions: [
                                                ...(finalState.queuedActions || []),
                                                {
                                                    type: 'execute_followup_effect',
                                                    sourceCardId,
                                                    followUpEffect,
                                                    conditionalType,
                                                    actor,
                                                }
                                            ]
                                        };
                                    }
                                    return finalState;
                                }
                            }
                        }

                        // Handle followUpEffect (e.g., Time-0's shuffle_trash after playing from trash)
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || true; // Play succeeded
                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(finalState, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIdx = finalState[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: finalState.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIdx, finalState, context, followUpEffect);
                                    finalState = result.newState;
                                    if (finalState.actionRequired) {
                                        return finalState;
                                    }
                                }
                            }
                        }

                        return endTurnCb(finalState);
                    }
                };

                break;
            }

            // Original: play from hand
            const cardInHand = prev[actor].hand.find(c => c.id === cardInHandId);

            if (!cardInHand) {
                console.error("Card for play not found in hand");
                newState = { ...prev, actionRequired: null };
                break;
            }

            // Pass ignoreProtocolMatching to playResolver via state (since actionRequired will be null)
            const stateBeforePlay = {
                ...prev,
                actionRequired: null,
                _ignoreProtocolMatching: ignoreProtocolMatching || false
            };

            let canPlayFaceUp: boolean;
            if (typeof isFaceDown === 'boolean') {
                canPlayFaceUp = !isFaceDown;
            } else {
                const playerHasSpiritOne = prev[actor].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

                // Check if the card being played has ignore_protocol_matching card_property (generic check)
                const thisCardIgnoresMatching = (cardInHand as any).customEffects?.bottomEffects?.some(
                    (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
                ) || (cardInHand as any).customEffects?.topEffects?.some(
                    (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
                ) || (cardInHand as any).customEffects?.middleEffects?.some(
                    (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
                );

                const opponentId = actor === 'player' ? 'opponent' : 'player';
                const opponentHasPsychic1 = prev[opponentId].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
                // Check Unity-1 same-protocol face-up rule
                const hasSameProtocolFaceUpRule = canPlayFaceUpDueToSameProtocolRule(prev, actor, effectiveLaneIndex, cardInHand.protocol);
                // NEW: ignoreProtocolMatching from effect (Diversity-0: player chooses orientation regardless of protocol)
                canPlayFaceUp = (playerHasSpiritOne || thisCardIgnoresMatching || ignoreProtocolMatching || hasSameProtocolFaceUpRule || cardInHand.protocol === prev[actor].protocols[effectiveLaneIndex] || cardInHand.protocol === prev[opponentId].protocols[effectiveLaneIndex]) && !opponentHasPsychic1;
            }

            const { newState: stateAfterPlay, animationRequests } = playCard(stateBeforePlay, cardInHandId, effectiveLaneIndex, canPlayFaceUp, actor);
            newState = stateAfterPlay;


            if (animationRequests) {
                // FIX: Implemented `onCompleteCallback` for card-play animations to ensure turn progression occurs correctly after animations complete.
                requiresAnimation = {
                    animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.queuedActions && s.queuedActions.length > 0) {
                        }
                        // CRITICAL: ALWAYS call endTurnCb - processEndOfAction will handle the queue automatically
                        return endTurnCb(s);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_delete': {
            // Generic lane selection for delete with composable filters
            // Used by Death-2, Courage-1 and other cards that need lane-based deletion
            const actor = prev.actionRequired.actor;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const targetProtocolName = prev.player.protocols[targetLaneIndex];
            const targetFilter = (prev.actionRequired as any).targetFilter || {};
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
            const deleteCount = (prev.actionRequired as any).count || 1;
            const deleteAll = (prev.actionRequired as any).deleteAll === true;

            // Validate validLanes restriction (Courage-1: opponent_higher_value)
            const validLanes = (prev.actionRequired as any).validLanes;
            if (validLanes && !validLanes.includes(targetLaneIndex)) {
                console.error(`Illegal delete lane selection: Lane ${targetLaneIndex} not in valid lanes ${validLanes}`);
                return { nextState: prev }; // Block the illegal move
            }

            newState = log(newState, actor, `${sourceCardName}: ${actorName} targets Protocol ${targetProtocolName}.`);

            // CRITICAL: Track top cards BEFORE deletion for uncover detection
            const topCardsBefore: Map<Player, string | null> = new Map();
            for (const p of ['player', 'opponent'] as Player[]) {
                const lane = prev[p].lanes[targetLaneIndex];
                topCardsBefore.set(p, lane.length > 0 ? lane[lane.length - 1].id : null);
            }

            const cardsToDelete: AnimationRequest[] = [];
            const deletedCardNames: string[] = [];
            const deletedCardIds = new Set<string>();

            for (const p of ['player', 'opponent'] as Player[]) {
                const playerState = prev[p];
                const faceDownValueInLane = playerState.lanes[targetLaneIndex]
                    .some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2) ? 4 : 2;

                const laneCards = playerState.lanes[targetLaneIndex];
                for (let cardIdx = 0; cardIdx < laneCards.length; cardIdx++) {
                    const card = laneCards[cardIdx];
                    const isUncovered = cardIdx === laneCards.length - 1;

                    // Apply targetFilter to determine if card should be deleted
                    const value = card.isFaceUp ? card.value : faceDownValueInLane;

                    // Check valueRange filter
                    if (targetFilter.valueRange) {
                        const { min, max } = targetFilter.valueRange;
                        if (value < min || value > max) continue;
                    }

                    // Check faceState filter
                    if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                    if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;

                    // Check owner filter
                    if (targetFilter.owner === 'own' && p !== actor) continue;
                    if (targetFilter.owner === 'opponent' && p === actor) continue;

                    // Check position filter (uncovered/covered/any)
                    if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                    if (targetFilter.position === 'covered' && isUncovered) continue;

                    // CRITICAL: Include snapshot data for animation - card will be deleted from state immediately
                    cardsToDelete.push({
                        type: 'delete',
                        cardId: card.id,
                        owner: p,
                        cardSnapshot: { ...card },
                        laneIndex: targetLaneIndex,
                        cardIndex: cardIdx
                    } as AnimationRequest);
                    deletedCardIds.add(card.id);
                    const ownerName = p === 'player' ? "Player's" : "Opponent's";
                    const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'a face-down card';
                    deletedCardNames.push(`${ownerName} ${cardName}`);

                    // Respect count limit (unless deleteAll is true)
                    if (!deleteAll && cardsToDelete.length >= deleteCount) break;
                }
                // Break outer loop too if we hit count limit
                if (!deleteAll && cardsToDelete.length >= deleteCount) break;
            }

            if (deletedCardNames.length > 0) {
                newState = log(newState, actor, `${sourceCardName}: Deleting ${deletedCardNames.join(', ')}.`);

                const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + deletedCardNames.length };
                const newPlayerState = { ...newState[actor], stats: newStats };
                newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };
            }

            // CRITICAL: Delete ALL cards from state IMMEDIATELY - logic must be independent of animation!
            // The animation system will use the cardSnapshot data to show cards flying to trash
            for (const req of cardsToDelete) {
                newState = deleteCardFromBoard(newState, req.cardId);
            }
            newState = recalculateAllLaneValues(newState);

            // CRITICAL: Queue pending custom effects before clearing actionRequired
            newState = queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            if (cardsToDelete.length > 0) {
                // NEW: Extract followUpEffect for if_executed conditionals
                const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                const conditionalType = (prev.actionRequired as any)?.conditionalType;
                const sourceCardId = prev.actionRequired.sourceCardId;

                requiresAnimation = {
                    animationRequests: cardsToDelete,
                    onCompleteCallback: (s, endTurnCb) => {
                        let stateAfterDelete = s;
                        // NOTE: Hate-3 trigger is now handled via processReactiveEffects (custom protocol)
                        const reactiveResult = processReactiveEffects(stateAfterDelete, 'after_delete', { player: actor });
                        stateAfterDelete = reactiveResult.newState;

                        // CRITICAL FIX: Check for uncover effects after bulk delete
                        // For each player, check if the old top card was deleted and a new card is now uncovered
                        // IMPORTANT: Collect ALL players that need uncover, then process them
                        const playersNeedingUncover: Player[] = [];
                        for (const p of ['player', 'opponent'] as Player[]) {
                            const oldTopCardId = topCardsBefore.get(p);
                            const laneAfter = stateAfterDelete[p].lanes[targetLaneIndex];

                            // If the old top card was deleted and there are still cards in the lane
                            if (oldTopCardId && deletedCardIds.has(oldTopCardId) && laneAfter.length > 0) {
                                playersNeedingUncover.push(p);
                            }
                        }

                        // Process uncover effects - if first creates actionRequired, queue remaining
                        for (let i = 0; i < playersNeedingUncover.length; i++) {
                            const p = playersNeedingUncover[i];
                            const uncoverResult = handleUncoverEffect(stateAfterDelete, p, targetLaneIndex);
                            stateAfterDelete = uncoverResult.newState;

                            // If uncover created an actionRequired and there are more players to process
                            if (stateAfterDelete.actionRequired && i < playersNeedingUncover.length - 1) {
                                // Queue remaining uncover effects
                                const remainingPlayers = playersNeedingUncover.slice(i + 1);
                                for (const remainingPlayer of remainingPlayers) {
                                    stateAfterDelete.queuedActions = [
                                        ...(stateAfterDelete.queuedActions || []),
                                        {
                                            type: 'pending_uncover_effect',
                                            owner: remainingPlayer,
                                            laneIndex: targetLaneIndex,
                                        } as any
                                    ];
                                }
                                return stateAfterDelete;
                            }
                        }

                        // NEW: Handle generic followUpEffect for custom protocols
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || cardsToDelete.length > 0;
                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(stateAfterDelete, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = stateAfterDelete[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIdx = stateAfterDelete[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: stateAfterDelete.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIdx, stateAfterDelete, context, followUpEffect);
                                    stateAfterDelete = result.newState;
                                    if (stateAfterDelete.actionRequired) {
                                        return stateAfterDelete;
                                    }
                                }
                            }
                        }

                        return endTurnCb(stateAfterDelete);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_return': {
            // NEW: Generic lane selection for return with composable filters
            // Used by Water_custom-3 and other custom cards that need lane-based return
            const actor = prev.actionRequired.actor;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const opponent = actor === 'player' ? 'opponent' : 'player';
            const targetProtocolName = prev.player.protocols[targetLaneIndex];
            const targetFilter = (prev.actionRequired as any).targetFilter || {};
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';

            newState = log(newState, actor, `${sourceCardName}: ${actorName} targets Protocol ${targetProtocolName}.`);

            const cardsToReturn: AnimationRequest[] = [];
            const returnedCardNames: string[] = [];

            for (const p of ['player', 'opponent'] as Player[]) {
                const playerState = prev[p];
                const faceDownValueInLane = playerState.lanes[targetLaneIndex]
                    .some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2) ? 4 : 2;

                const laneCards = playerState.lanes[targetLaneIndex];
                for (let cardIdx = 0; cardIdx < laneCards.length; cardIdx++) {
                    const card = laneCards[cardIdx];
                    // Apply targetFilter to determine if card should be returned
                    const value = card.isFaceUp ? card.value : faceDownValueInLane;

                    // Check valueEquals filter (Water-3: return all value 2 cards)
                    if (targetFilter.valueEquals !== undefined && value !== targetFilter.valueEquals) {
                        continue;
                    }

                    // Check faceState filter
                    if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                    if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;

                    // Check owner filter
                    if (targetFilter.owner === 'own' && p !== actor) continue;
                    if (targetFilter.owner === 'opponent' && p === actor) continue;

                    // CRITICAL: Include snapshot data for animation - card will be returned from state immediately
                    cardsToReturn.push({
                        type: 'return',
                        cardId: card.id,
                        owner: p,
                        cardSnapshot: { ...card },
                        laneIndex: targetLaneIndex,
                        cardIndex: cardIdx
                    } as AnimationRequest);
                    const ownerName = p === 'player' ? "Player's" : "Opponent's";
                    const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'a face-down card';
                    returnedCardNames.push(`${ownerName} ${cardName}`);
                }
            }

            if (cardsToReturn.length === 0) {
                newState = log(newState, actor, `${sourceCardName}: No matching cards in Protocol ${targetProtocolName}.`);
                // CRITICAL: Queue pending custom effects before clearing actionRequired
                newState = queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                break;
            }

            if (returnedCardNames.length > 0) {
                newState = log(newState, actor, `${sourceCardName}: Returning ${returnedCardNames.join(', ')}.`);
            }

            // CRITICAL: Return ALL cards to hand IMMEDIATELY - logic must be independent of animation!
            // The animation system will use the cardSnapshot data to show cards flying to hand
            for (const req of cardsToReturn) {
                const returnResult = internalReturnCard(newState, req.cardId);
                newState = returnResult.newState;
            }
            newState = recalculateAllLaneValues(newState);

            // CRITICAL: Queue pending custom effects before clearing actionRequired
            newState = queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            if (cardsToReturn.length > 0) {
                // NEW: Extract followUpEffect for if_executed conditionals
                const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                const conditionalType = (prev.actionRequired as any)?.conditionalType;
                const sourceCardId = prev.actionRequired.sourceCardId;

                requiresAnimation = {
                    animationRequests: cardsToReturn,
                    onCompleteCallback: (s, endTurnCb) => {
                        let finalState = s;

                        // NEW: Handle generic followUpEffect for custom protocols
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || cardsToReturn.length > 0;
                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(finalState, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIdx = finalState[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: finalState.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIdx, finalState, context, followUpEffect);
                                    finalState = result.newState;
                                    if (finalState.actionRequired) {
                                        return finalState;
                                    }
                                }
                            }
                        }

                        return endTurnCb(finalState);
                    }
                };
            }
            break;
        }
        // REMOVED: select_lane_for_death_2 - Death-2 now uses generic select_lane_for_delete with targetFilter
        // REMOVED: select_lane_for_metal_3_delete - Metal-3 now uses generic select_lane_for_delete_all
        case 'select_lane_for_delete_all': {
            // Generic handler for deleting all cards in a lane (used by Metal-3 custom, etc.)
            const actor = prev.actionRequired.actor;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const targetProtocolName = prev.player.protocols[targetLaneIndex];
            const minCards = prev.actionRequired.minCards || 8;
            const validLanes = prev.actionRequired.validLanes || [0, 1, 2];

            // Validate that the selected lane is in the valid list
            if (!validLanes.includes(targetLaneIndex)) {
                newState = log(newState, actor, `Cannot select this lane for deletion.`);
                break;
            }

            // Validate card count
            const totalCardsInLane = prev.player.lanes[targetLaneIndex].length + prev.opponent.lanes[targetLaneIndex].length;
            if (totalCardsInLane < minCards) {
                newState = log(newState, actor, `Cannot delete ${targetProtocolName} line (only ${totalCardsInLane} cards, need ${minCards}+).`);
                newState = queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                break;
            }

            // Find source card for log message
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Effect';
            newState = log(newState, actor, `${sourceCardName}: ${actorName} deletes all cards in ${targetProtocolName} line.`);

            const cardsToDelete: AnimationRequest[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                const laneCards = prev[p].lanes[targetLaneIndex];
                for (let cardIdx = 0; cardIdx < laneCards.length; cardIdx++) {
                    const card = laneCards[cardIdx];
                    // CRITICAL: Include snapshot data for animation - card will be deleted from state immediately
                    cardsToDelete.push({
                        type: 'delete',
                        cardId: card.id,
                        owner: p,
                        cardSnapshot: { ...card },
                        laneIndex: targetLaneIndex,
                        cardIndex: cardIdx
                    } as AnimationRequest);
                }
            }

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + cardsToDelete.length };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            // CRITICAL: Delete ALL cards from state IMMEDIATELY - logic must be independent of animation!
            for (const req of cardsToDelete) {
                newState = deleteCardFromBoard(newState, req.cardId);
            }
            newState = recalculateAllLaneValues(newState);

            newState = queuePendingCustomEffects(newState);
            newState.actionRequired = null;

            if (cardsToDelete.length > 0) {
                // NEW: Extract followUpEffect for if_executed conditionals
                const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
                const conditionalType = (prev.actionRequired as any)?.conditionalType;
                const sourceCardId = prev.actionRequired.sourceCardId;

                requiresAnimation = {
                    animationRequests: cardsToDelete,
                    onCompleteCallback: (s, endTurnCb) => {
                        let stateAfterDelete = s;
                        // NOTE: Hate-3 trigger is now handled via processReactiveEffects (custom protocol)
                        const reactiveResult = processReactiveEffects(stateAfterDelete, 'after_delete', { player: actor });
                        stateAfterDelete = reactiveResult.newState;

                        // NEW: Handle generic followUpEffect for custom protocols
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || cardsToDelete.length > 0;
                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(stateAfterDelete, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = stateAfterDelete[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIdx = stateAfterDelete[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: stateAfterDelete.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const result = executeCustomEffect(sourceCard.card, laneIdx, stateAfterDelete, context, followUpEffect);
                                    stateAfterDelete = result.newState;
                                    if (stateAfterDelete.actionRequired) {
                                        return stateAfterDelete;
                                    }
                                }
                            }
                        }

                        return endTurnCb(stateAfterDelete);
                    }
                };
            }
            break;
        }
        // REMOVED: select_lane_for_life_3_play - Life-3 now uses generic select_lane_for_play with source='deck'
        // LEGACY REMOVED: select_lane_to_shift_revealed_card_for_light_2 - now uses generic select_lane_for_shift
        case 'select_lane_to_shift_revealed_board_card_custom': {
            const { revealedCardId, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, revealedCardId);
            if (cardInfo) {
                const shiftResult = internalShiftCard(prev, revealedCardId, cardInfo.owner, targetLaneIndex, actor);
                newState = shiftResult.newState;
                if (shiftResult.animationRequests) {
                    requiresAnimation = {
                        animationRequests: shiftResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired) return s;
                            return endTurnCb(s);
                        }
                    };
                }
            }
            break;
        }
        // REMOVED: select_lane_to_shift_cards_for_light_3 - Light-3 now uses generic select_lane_for_shift_all
        // REMOVED: select_lane_for_water_3 - Water-3 now uses generic select_lane_for_return with targetFilter

        // =========================================================================
        // SWAP STACKS (Mirror-2)
        // =========================================================================
        case 'select_lanes_for_swap_stacks': {
            const { actor, sourceCardId, validLanes, selectedFirstLane } = prev.actionRequired;

            // Validate the selected lane is valid
            if (!validLanes.includes(targetLaneIndex)) {
                console.error(`Illegal swap_stacks: Lane ${targetLaneIndex} is not a valid selection`);
                return { nextState: prev };
            }

            // TWO-STEP SELECTION: First lane or second lane?
            if (selectedFirstLane === undefined) {
                // STEP 1: First lane selected, now wait for second lane
                newState.actionRequired = {
                    type: 'select_lanes_for_swap_stacks',
                    actor,
                    sourceCardId,
                    validLanes: validLanes.filter(l => l !== targetLaneIndex),  // Exclude first lane
                    selectedFirstLane: targetLaneIndex,
                } as any;
                newState = log(newState, actor, `Selected lane ${targetLaneIndex + 1} for swap.`);
            } else {
                // STEP 2: Second lane selected, perform the swap
                const firstLane = selectedFirstLane;
                const secondLane = targetLaneIndex;

                // Swap the cards between the two lanes
                const firstLaneCards = [...newState[actor].lanes[firstLane]];
                const secondLaneCards = [...newState[actor].lanes[secondLane]];

                newState[actor].lanes[firstLane] = secondLaneCards;
                newState[actor].lanes[secondLane] = firstLaneCards;

                // Log the swap
                newState = log(newState, actor,
                    `Swapped all cards between lane ${firstLane + 1} and lane ${secondLane + 1}.`
                );

                // Clear actionRequired
                newState.actionRequired = null;
            }
            break;
        }

        default: return { nextState: prev };
    }

    // DO NOT move queue to actionRequired here - processEndOfAction handles queue processing!
    // The queue contains auto-resolving actions that should be processed by processQueuedActions,
    // not treated as user actions.


    return { nextState: recalculateAllLaneValues(newState), requiresAnimation };
};
