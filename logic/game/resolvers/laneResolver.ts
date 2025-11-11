/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, AnimationRequest, Player, PlayedCard, EffectResult, ActionRequired, EffectContext } from '../../../types';
import { drawCards as drawCardsUtil, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log, decreaseLogIndent } from '../../utils/log';
import { findCardOnBoard, internalShiftCard } from '../helpers/actionUtils';
import { getEffectiveCardValue, recalculateAllLaneValues } from '../stateManager';
import { playCard } from './playResolver';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
import { effectRegistryOnCover } from '../../effects/effectRegistryOnCover';
import { executeOnCoverEffect } from '../../effectExecutor';
import { handleAnarchyConditionalDraw } from '../../effects/anarchy/Anarchy-0';
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import { processQueuedActions } from '../phaseManager';

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
        case 'select_lane_for_shift': {
            const { cardToShiftId, cardOwner, actor, sourceEffect, originalLaneIndex, sourceCardId } = prev.actionRequired;

            // RULE: Cannot shift to the same lane
            if (targetLaneIndex === originalLaneIndex) {
                console.error(`Illegal shift: Cannot shift to the same lane ${originalLaneIndex}`);
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

            // CRITICAL VALIDATION: Check for Frost-3 in SOURCE or DESTINATION lane
            // Frost-3 Top effect: "Cards cannot shift from or to this line" (affects BOTH sides of the lane)
            const hasFrost3InSourceLane =
                prev.player.lanes[originalLaneIndex].some(c => c.isFaceUp && c.protocol === 'Frost' && c.value === 3) ||
                prev.opponent.lanes[originalLaneIndex].some(c => c.isFaceUp && c.protocol === 'Frost' && c.value === 3);

            const hasFrost3InDestination =
                prev.player.lanes[targetLaneIndex].some(c => c.isFaceUp && c.protocol === 'Frost' && c.value === 3) ||
                prev.opponent.lanes[targetLaneIndex].some(c => c.isFaceUp && c.protocol === 'Frost' && c.value === 3);

            if (hasFrost3InSourceLane) {
                console.error(`Illegal shift: Cannot shift from lane ${originalLaneIndex} - blocked by Frost-3`);
                return { nextState: prev }; // Block the illegal move
            }

            if (hasFrost3InDestination) {
                console.error(`Illegal shift: Cannot shift to lane ${targetLaneIndex} - blocked by Frost-3`);
                return { nextState: prev }; // Block the illegal move
            }

            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, actor);
            newState = shiftResult.newState;

            // CRITICAL: Check if the shift created an interrupt (e.g., uncover effect)
            const uncoverCreatedInterrupt = newState.actionRequired !== null;

            if (shiftResult.animationRequests) {
                // FIX: Implemented `onCompleteCallback` to correctly handle post-shift effects like Speed-3's self-flip and Anarchy-0's conditional draw after animations.
                requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        let finalState = s;

                        // CRITICAL: If uncover created an interrupt, we need to queue the follow-up effects
                        if (uncoverCreatedInterrupt) {
                            // Speed-3 or Anarchy-0 effects need to happen AFTER the interrupt resolves
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

                            const sourceCard = findCardOnBoard(finalState, sourceCardId);
                            // CRITICAL: Only queue Anarchy-0 draw if it's still uncovered AND face-up
                            // If the shift covered Anarchy-0, its effect should be cancelled
                            if (sourceCard && sourceCard.card.protocol === 'Anarchy' && sourceCard.card.value === 0 && sourceCard.card.isFaceUp) {
                                const anarchyLane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                const isStillUncovered = anarchyLane && anarchyLane.length > 0 && anarchyLane[anarchyLane.length - 1].id === sourceCardId;

                                if (isStillUncovered) {
                                    const anarchyDrawAction: ActionRequired = {
                                        type: 'anarchy_0_conditional_draw',
                                        sourceCardId: sourceCardId,
                                        actor: actor,
                                    };
                                    finalState.queuedActions = [
                                        ...(finalState.queuedActions || []),
                                        anarchyDrawAction
                                    ];
                                } else {
                                    finalState = log(finalState, actor, `Anarchy-0's conditional draw is cancelled because the card is now covered.`);
                                }
                            }

                            // NEW: Queue pending effects from custom cards if shift created an interrupt
                            const pendingEffects = (finalState as any)._pendingCustomEffects;
                            if (pendingEffects) {
                                console.log(`[laneResolver] Queueing ${pendingEffects.effects.length} pending effects due to interrupt`);
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
                                        };
                                        finalState.queuedActions = [
                                            ...(finalState.queuedActions || []),
                                            pendingAction
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
                        // Anarchy-0: After shift is resolved, check for non-matching protocols and draw
                        // CRITICAL: Only execute if Anarchy-0 is still uncovered AND face-up
                        const sourceCard = findCardOnBoard(finalState, sourceCardId);
                        if (sourceCard && sourceCard.card.protocol === 'Anarchy' && sourceCard.card.value === 0 && sourceCard.card.isFaceUp) {
                            const anarchyLane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                            const isStillUncovered = anarchyLane && anarchyLane.length > 0 && anarchyLane[anarchyLane.length - 1].id === sourceCardId;

                            if (isStillUncovered) {
                                finalState = handleAnarchyConditionalDraw(finalState, actor);
                            } else {
                                finalState = log(finalState, actor, `Anarchy-0's conditional draw is cancelled because the card is now covered.`);
                            }
                        }

                        // NEW: Execute pending effects from custom cards (e.g., Anarchy_custom-0)
                        const pendingEffects = (finalState as any)._pendingCustomEffects;
                        if (pendingEffects) {
                            console.log(`[laneResolver] Executing ${pendingEffects.effects.length} pending effects after shift`);
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
                        finalState.actionRequired = null;

                        // NEW: Trigger reactive effects after shift
                        const reactiveShiftResult = processReactiveEffects(finalState, 'after_shift', { player: actor, cardId: cardToShiftId });
                        finalState = reactiveShiftResult.newState;

                        // CRITICAL: Process queued actions after shift completes
                        // This ensures effects like anarchy_0_conditional_draw are executed automatically
                        if (finalState.queuedActions && finalState.queuedActions.length > 0) {
                            const nextAction = finalState.queuedActions[0];
                            finalState.queuedActions = finalState.queuedActions.slice(1);
                            finalState.actionRequired = nextAction;
                        }

                        return endTurnCb(finalState);
                    }
                };
            } else {
                // CRITICAL: If uncover created an interrupt, queue the follow-up effects
                if (uncoverCreatedInterrupt) {
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

                    const sourceCard = findCardOnBoard(newState, sourceCardId);
                    // CRITICAL: Only queue Anarchy-0 draw if it's still uncovered AND face-up
                    if (sourceCard && sourceCard.card.protocol === 'Anarchy' && sourceCard.card.value === 0 && sourceCard.card.isFaceUp) {
                        const anarchyLane = newState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                        const isStillUncovered = anarchyLane && anarchyLane.length > 0 && anarchyLane[anarchyLane.length - 1].id === sourceCardId;

                        if (isStillUncovered) {
                            const anarchyDrawAction: ActionRequired = {
                                type: 'anarchy_0_conditional_draw',
                                sourceCardId: sourceCardId,
                                actor: actor,
                            };
                            newState.queuedActions = [
                                ...(newState.queuedActions || []),
                                anarchyDrawAction
                            ];
                        } else {
                            newState = log(newState, actor, `Anarchy-0's conditional draw is cancelled because the card is now covered.`);
                        }
                    }
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
                        console.log(`[laneResolver NO ANIM] Executing ${pendingEffects.effects.length} pending effects after shift`);
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
                    // CRITICAL: Only execute if Anarchy-0 is still uncovered AND face-up
                    const sourceCard = findCardOnBoard(newState, sourceCardId);
                    if (sourceCard && sourceCard.card.protocol === 'Anarchy' && sourceCard.card.value === 0 && sourceCard.card.isFaceUp) {
                        const anarchyLane = newState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                        const isStillUncovered = anarchyLane && anarchyLane.length > 0 && anarchyLane[anarchyLane.length - 1].id === sourceCardId;

                        if (isStillUncovered) {
                            newState = handleAnarchyConditionalDraw(newState, actor);
                        } else {
                            newState = log(newState, actor, `Anarchy-0's conditional draw is cancelled because the card is now covered.`);
                        }
                    }
                    // CRITICAL FIX: Decrease log indent and clear actionRequired after completing follow-up effects
                    // Without this, the game would softlock with the old 'select_card_to_shift' action still active
                    // Decrease indent if this shift was triggered by an effect (has sourceCardId)
                    if (sourceCardId) {
                        newState = decreaseLogIndent(newState);
                    }
                    newState.actionRequired = null;

                    // NEW: Trigger reactive effects after shift
                    const reactiveShiftResult = processReactiveEffects(newState, 'after_shift', { player: actor, cardId: cardToShiftId });
                    newState = reactiveShiftResult.newState;

                    // CRITICAL: Process queued actions after shift completes
                    // This ensures effects like anarchy_0_conditional_draw are executed automatically
                    if (newState.queuedActions && newState.queuedActions.length > 0) {
                        const nextAction = newState.queuedActions[0];
                        newState.queuedActions = newState.queuedActions.slice(1);
                        newState.actionRequired = nextAction;
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

            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, actor);
            newState = shiftResult.newState;
            if (shiftResult.animationRequests) {
                 // FIX: Implemented `onCompleteCallback` for consistency, ensuring any post-animation logic can be handled.
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
            const { cardInHandId, isFaceDown, actor } = prev.actionRequired;
            const cardInHand = prev[actor].hand.find(c => c.id === cardInHandId);

            if (!cardInHand) {
                console.error("Card for play not found in hand");
                newState = { ...prev, actionRequired: null };
                break;
            }

            const stateBeforePlay = { ...prev, actionRequired: null };

            let canPlayFaceUp: boolean;
            if (typeof isFaceDown === 'boolean') {
                canPlayFaceUp = !isFaceDown;
            } else {
                const playerHasSpiritOne = prev[actor].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

                // Check for Chaos-3: Must be uncovered (last in lane) AND face-up
                const playerHasChaosThree = prev[actor].lanes.some((lane) => {
                    if (lane.length === 0) return false;
                    const uncoveredCard = lane[lane.length - 1];
                    return uncoveredCard.isFaceUp && uncoveredCard.protocol === 'Chaos' && uncoveredCard.value === 3;
                });

                const opponentId = actor === 'player' ? 'opponent' : 'player';
                const opponentHasPsychic1 = prev[opponentId].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
                canPlayFaceUp = (playerHasSpiritOne || playerHasChaosThree || cardInHand.protocol === prev[actor].protocols[targetLaneIndex] || cardInHand.protocol === prev[opponentId].protocols[targetLaneIndex]) && !opponentHasPsychic1;
            }

            const { newState: stateAfterPlay, animationRequests } = playCard(stateBeforePlay, cardInHandId, targetLaneIndex, canPlayFaceUp, actor);
            newState = stateAfterPlay;

            console.log('[LANE RESOLVER] After playCard - actionRequired?', newState.actionRequired?.type || 'null', 'queuedActions?', newState.queuedActions?.length || 0, 'animationRequests?', animationRequests?.length || 0);

            if (animationRequests) {
                // FIX: Implemented `onCompleteCallback` for card-play animations to ensure turn progression occurs correctly after animations complete.
                requiresAnimation = {
                    animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        console.log('[PLAY CALLBACK] Animation complete. queuedActions?', s.queuedActions?.length || 0);
                        if (s.queuedActions && s.queuedActions.length > 0) {
                            console.log('[PLAY CALLBACK] Queue found! First action:', s.queuedActions[0].type);
                        }
                        // CRITICAL: ALWAYS call endTurnCb - processEndOfAction will handle the queue automatically
                        console.log('[PLAY CALLBACK] Calling endTurnCb');
                        return endTurnCb(s);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_delete': {
            // NEW: Generic lane selection for delete with composable filters
            // Used by Death-2 and other cards that need lane-based deletion
            const actor = prev.actionRequired.actor;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const targetProtocolName = prev.player.protocols[targetLaneIndex];
            const targetFilter = (prev.actionRequired as any).targetFilter || {};
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';

            newState = log(newState, actor, `${sourceCardName}: ${actorName} targets Protocol ${targetProtocolName}.`);

            const cardsToDelete: AnimationRequest[] = [];
            const deletedCardNames: string[] = [];

            for (const p of ['player', 'opponent'] as Player[]) {
                const playerState = prev[p];
                const faceDownValueInLane = playerState.lanes[targetLaneIndex]
                    .some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2) ? 4 : 2;

                for (const card of playerState.lanes[targetLaneIndex]) {
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

                    cardsToDelete.push({ type: 'delete', cardId: card.id, owner: p });
                    const ownerName = p === 'player' ? "Player's" : "Opponent's";
                    const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'a face-down card';
                    deletedCardNames.push(`${ownerName} ${cardName}`);
                }
            }

            if (deletedCardNames.length > 0) {
                newState = log(newState, actor, `${sourceCardName}: Deleting ${deletedCardNames.join(', ')}.`);

                const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + deletedCardNames.length };
                const newPlayerState = { ...newState[actor], stats: newStats };
                newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };
            }

            newState.actionRequired = null;
            if (cardsToDelete.length > 0) {
                requiresAnimation = {
                    animationRequests: cardsToDelete,
                    onCompleteCallback: (s, endTurnCb) => {
                        let stateAfterDelete = s;
                        for (let i = 0; i < cardsToDelete.length; i++) {
                            stateAfterDelete = checkForHate3Trigger(stateAfterDelete, actor);
                        }
                        const reactiveResult = processReactiveEffects(stateAfterDelete, 'after_delete', { player: actor });
                        stateAfterDelete = reactiveResult.newState;

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

                for (const card of playerState.lanes[targetLaneIndex]) {
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

                    cardsToReturn.push({ type: 'return', cardId: card.id, owner: p });
                    const ownerName = p === 'player' ? "Player's" : "Opponent's";
                    const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'a face-down card';
                    returnedCardNames.push(`${ownerName} ${cardName}`);
                }
            }

            if (cardsToReturn.length === 0) {
                newState = log(newState, actor, `${sourceCardName}: No matching cards in Protocol ${targetProtocolName}.`);
                newState.actionRequired = null;
                break;
            }

            if (returnedCardNames.length > 0) {
                newState = log(newState, actor, `${sourceCardName}: Returning ${returnedCardNames.join(', ')}.`);
            }

            newState.actionRequired = null;
            if (cardsToReturn.length > 0) {
                requiresAnimation = {
                    animationRequests: cardsToReturn,
                    onCompleteCallback: (s, endTurnCb) => {
                        return endTurnCb(s);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_death_2': {
            // DEPRECATED: Keep for backwards compatibility with original Death-2
            // FIX: Use actor from actionRequired, not prev.turn (critical for interrupt scenarios)
            const actor = prev.actionRequired.actor;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const targetProtocolName = prev.player.protocols[targetLaneIndex];
            newState = log(newState, actor, `Death-2: ${actorName} targets Protocol ${targetProtocolName}.`);

            const cardsToDelete: AnimationRequest[] = [];
            const deletedCardNames: string[] = [];

            for (const p of ['player', 'opponent'] as Player[]) {
                const playerState = prev[p];
                const faceDownValueInLane = playerState.lanes[targetLaneIndex]
                    .some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2) ? 4 : 2;

                for (const card of playerState.lanes[targetLaneIndex]) {
                    const value = card.isFaceUp ? card.value : faceDownValueInLane;
                    if (value === 1 || value === 2) {
                        cardsToDelete.push({ type: 'delete', cardId: card.id, owner: p });
                        const ownerName = p === 'player' ? "Player's" : "Opponent's";
                        const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'a face-down card';
                        deletedCardNames.push(`${ownerName} ${cardName}`);
                    }
                }
            }

            if (deletedCardNames.length > 0) {
                const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
                const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Death-2';
                newState = log(newState, actor, `${sourceCardName}: Deleting ${deletedCardNames.join(', ')}.`);

                const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + deletedCardNames.length };
                const newPlayerState = { ...newState[actor], stats: newStats };
                newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };
            }

            newState.actionRequired = null;
            if (cardsToDelete.length > 0) {
                // FIX: Implemented `onCompleteCallback` to handle post-delete triggers (like Hate-3) after the animations have finished.
                requiresAnimation = {
                    animationRequests: cardsToDelete,
                    onCompleteCallback: (s, endTurnCb) => {
                        let stateAfterDelete = s;
                        for (let i = 0; i < cardsToDelete.length; i++) {
                            stateAfterDelete = checkForHate3Trigger(stateAfterDelete, actor);
                        }
                        // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                        const reactiveResult = processReactiveEffects(stateAfterDelete, 'after_delete', { player: actor });
                        stateAfterDelete = reactiveResult.newState;

                        return endTurnCb(stateAfterDelete);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_metal_3_delete': {
            // FIX: Use actor from actionRequired, not prev.turn (critical for interrupt scenarios)
            const actor = prev.actionRequired.actor;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const targetProtocolName = prev.player.protocols[targetLaneIndex];

            // CRITICAL VALIDATION: Only delete if the lane has 8 or more cards
            const totalCardsInLane = prev.player.lanes[targetLaneIndex].length + prev.opponent.lanes[targetLaneIndex].length;
            if (totalCardsInLane < 8) {
                newState = log(newState, actor, `Metal-3: ${actorName} cannot delete Protocol ${targetProtocolName} (only ${totalCardsInLane} cards, need 8+).`);
                newState.actionRequired = null;
                break;
            }

            newState = log(newState, actor, `Metal-3: ${actorName} targets Protocol ${targetProtocolName} for deletion.`);

            const cardsToDelete: AnimationRequest[] = [];

            for (const p of ['player', 'opponent'] as Player[]) {
                for (const card of prev[p].lanes[targetLaneIndex]) {
                    cardsToDelete.push({ type: 'delete', cardId: card.id, owner: p });
                }
            }
            
            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + cardsToDelete.length };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            newState.actionRequired = null;
            if (cardsToDelete.length > 0) {
                // FIX: Implemented `onCompleteCallback` to handle post-delete triggers (like Hate-3).
                requiresAnimation = {
                    animationRequests: cardsToDelete,
                    onCompleteCallback: (s, endTurnCb) => {
                        let stateAfterDelete = s;
                        for (let i = 0; i < cardsToDelete.length; i++) {
                            stateAfterDelete = checkForHate3Trigger(stateAfterDelete, actor);
                        }
                        // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                        const reactiveResult = processReactiveEffects(stateAfterDelete, 'after_delete', { player: actor });
                        stateAfterDelete = reactiveResult.newState;

                        return endTurnCb(stateAfterDelete);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_life_3_play': {
            const { actor } = prev.actionRequired;
            const stateBeforePlay = { ...prev, actionRequired: null };
            
            let stateAfterOnCover = stateBeforePlay;
            let onCoverResult: EffectResult = { newState: stateAfterOnCover };
            const cardToBeCovered = stateBeforePlay[actor].lanes[targetLaneIndex].length > 0
                ? stateBeforePlay[actor].lanes[targetLaneIndex][stateBeforePlay[actor].lanes[targetLaneIndex].length - 1]
                : null;
            if (cardToBeCovered) {
                const coverContext: EffectContext = {
                    cardOwner: actor,
                    actor: actor,
                    currentTurn: stateBeforePlay.turn,
                    opponent: actor === 'player' ? 'opponent' : 'player',
                    triggerType: 'cover'
                };
                onCoverResult = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateBeforePlay, coverContext);
                stateAfterOnCover = onCoverResult.newState;
            }

            const playerStateAfterOnCover = { ...stateAfterOnCover[actor] };
            const { drawnCards, remainingDeck, newDiscard } = drawCardsUtil(playerStateAfterOnCover.deck, playerStateAfterOnCover.discard, 1);

            if (drawnCards.length > 0) {
                const newCard = { ...drawnCards[0], id: uuidv4(), isFaceUp: false };
                const newLanes = [...playerStateAfterOnCover.lanes];
                newLanes[targetLaneIndex] = [...newLanes[targetLaneIndex], newCard];

                const newPlayerState = {
                    ...playerStateAfterOnCover,
                    lanes: newLanes,
                    deck: remainingDeck,
                    discard: newDiscard,
                };

                newState = { ...stateAfterOnCover, [actor]: newPlayerState };
                newState = log(newState, actor, `Life-3 On-Cover: Plays a card face-down.`);
                
                if(onCoverResult.animationRequests) {
                    // FIX: Implemented `onCompleteCallback` for on-cover animations.
                    requiresAnimation = {
                        animationRequests: onCoverResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            // CRITICAL: ALWAYS call endTurnCb - processEndOfAction will handle the queue automatically
                            return endTurnCb(s);
                        }
                    };
                }
            } else {
                newState = stateAfterOnCover;
            }
            break;
        }
        case 'select_lane_to_shift_revealed_card_for_light_2': {
            const { revealedCardId, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, revealedCardId);
            if (cardInfo) {
                const shiftResult = internalShiftCard(prev, revealedCardId, cardInfo.owner, targetLaneIndex, actor);
                newState = shiftResult.newState;
                if (shiftResult.animationRequests) {
                    // FIX: Implemented `onCompleteCallback` for consistency.
                    requiresAnimation = {
                        animationRequests: shiftResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired) return s; // Handle potential interrupts from uncover
                            return endTurnCb(s);
                        }
                    };
                }
            }
            break;
        }
        case 'select_lane_to_shift_cards_for_light_3': {
            const { sourceLaneIndex, actor } = prev.actionRequired;
            const opponent = actor === 'player' ? 'opponent' : 'player';

            const actorFaceDown = prev[actor].lanes[sourceLaneIndex].filter(c => !c.isFaceUp);
            const opponentFaceDown = prev[opponent].lanes[sourceLaneIndex].filter(c => !c.isFaceUp);

            const newActorLanes = prev[actor].lanes.map((lane, i) => {
                if (i === sourceLaneIndex) return lane.filter(c => c.isFaceUp);
                if (i === targetLaneIndex) return [...lane, ...actorFaceDown];
                return lane;
            });

            const newOpponentLanes = prev[opponent].lanes.map((lane, i) => {
                if (i === sourceLaneIndex) return lane.filter(c => c.isFaceUp);
                if (i === targetLaneIndex) return [...lane, ...opponentFaceDown];
                return lane;
            });
            
            const totalShifted = actorFaceDown.length + opponentFaceDown.length;
            const newStats = { ...prev.stats[actor], cardsShifted: prev.stats[actor].cardsShifted + totalShifted };
            const newPlayerState = { ...prev[actor], lanes: newActorLanes, stats: newStats };

            newState = {
                ...prev,
                [actor]: newPlayerState,
                [opponent]: { ...prev[opponent], lanes: newOpponentLanes },
                stats: { ...prev.stats, [actor]: newStats },
                actionRequired: null,
            };
            
            if (totalShifted > 0) {
                const sourceProtocol = prev[actor].protocols[sourceLaneIndex];
                const targetProtocol = prev[actor].protocols[targetLaneIndex];
                newState = log(newState, actor, `Light-3: Shifts ${totalShifted} face-down card(s) from Protocol ${sourceProtocol} to Protocol ${targetProtocol}.`);
            }
            break;
        }
        case 'select_lane_for_water_3': {
            // FIX: Use actor from actionRequired, not prev.turn (critical for interrupt scenarios)
            const player = prev.actionRequired.actor;
            const opponent = player === 'player' ? 'opponent' : 'player';
            
            const playerState = { ...prev[player] };
            const opponentState = { ...prev[opponent] };

            const playerCardsToReturn = playerState.lanes[targetLaneIndex].filter(c => getEffectiveCardValue(c, playerState.lanes[targetLaneIndex]) === 2);
            const opponentCardsToReturn = opponentState.lanes[targetLaneIndex].filter(c => getEffectiveCardValue(c, opponentState.lanes[targetLaneIndex]) === 2);

            if (playerCardsToReturn.length === 0 && opponentCardsToReturn.length === 0) {
                newState = { ...prev, actionRequired: null };
                break;
            }

            const playerReturnIds = new Set(playerCardsToReturn.map(c => c.id));
            const opponentReturnIds = new Set(opponentCardsToReturn.map(c => c.id));

            playerState.lanes[targetLaneIndex] = playerState.lanes[targetLaneIndex].filter(c => !playerReturnIds.has(c.id));
            opponentState.lanes[targetLaneIndex] = opponentState.lanes[targetLaneIndex].filter(c => !opponentReturnIds.has(c.id));

            playerState.hand.push(...playerCardsToReturn);
            opponentState.hand.push(...opponentCardsToReturn);

            newState = {
                ...prev,
                [player]: playerState,
                [opponent]: opponentState,
                actionRequired: null,
            };
            
            const totalReturned = playerCardsToReturn.length + opponentCardsToReturn.length;
            if (totalReturned > 0) {
                const playerName = player === 'player' ? 'Player' : 'Opponent';
                const sourceCard = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
                const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'a card effect';
                const laneNames = ['left', 'middle', 'right'];
                newState = log(newState, player, `${sourceName}: ${playerName} selects ${laneNames[targetLaneIndex]} lane and returns ${totalReturned} card(s) with value 2 (Player: ${playerCardsToReturn.length}, Opponent: ${opponentCardsToReturn.length}).`);
            }
            break;
        }
        default: return { nextState: prev };
    }

    // DO NOT move queue to actionRequired here - processEndOfAction handles queue processing!
    // The queue contains auto-resolving actions that should be processed by processQueuedActions,
    // not treated as user actions.

    console.log('[LANE RESOLVER END] Returning - actionRequired?', newState.actionRequired?.type || 'null', 'queuedActions?', newState.queuedActions?.length || 0, 'requiresAnimation?', requiresAnimation ? 'yes' : 'no');

    return { nextState: recalculateAllLaneValues(newState), requiresAnimation };
};
