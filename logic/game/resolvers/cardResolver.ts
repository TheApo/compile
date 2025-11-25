/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, AnimationRequest, EffectResult } from '../../../types';
import { drawForPlayer, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log, decreaseLogIndent, setLogSource, setLogPhase } from '../../utils/log';
import { findCardOnBoard, isCardUncovered, internalResolveTargetedFlip, internalReturnCard, internalShiftCard, handleUncoverEffect, countValidDeleteTargets, handleOnFlipToFaceUp, findAllHighestUncoveredCards, handleChainedEffectsOnFlip } from '../helpers/actionUtils';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
import { getEffectiveCardValue } from '../stateManager';
import * as phaseManager from '../phaseManager';
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';

export type CardActionResult = {
    nextState: GameState;
    requiresAnimation?: {
        animationRequests: AnimationRequest[];
        onCompleteCallback: (s: GameState, endTurnCb: (s2: GameState) => GameState) => GameState;
    } | null;
    requiresTurnEnd?: boolean;
};

// List of action types that trigger Metal-6's self-delete (flip actions only)
const METAL6_FLIP_ACTION_TYPES = [
    'select_covered_card_to_flip_for_chaos_0',
    'select_any_other_card_to_flip',
    'select_opponent_face_up_card_to_flip',
    'select_own_face_up_covered_card_to_flip',
    'select_covered_card_in_line_to_flip_optional',
    'select_any_card_to_flip_optional',
    'select_any_face_down_card_to_flip_optional',
    'select_card_to_flip_for_fire_3',
    'select_card_to_flip',
    'select_opponent_card_to_flip',
    'select_any_card_to_flip',
    'select_card_to_flip_for_light_0',
    'select_any_other_card_to_flip_for_water_0',
    'select_card_to_flip_and_shift_for_gravity_2',
    'select_face_down_card_to_reveal_for_light_2',
];

function handleMetal6Flip(state: GameState, targetCardId: string, action: ActionRequired): CardActionResult | null {
    // CRITICAL: Metal-6 should ONLY delete itself when FLIPPED, not when returned/shifted/deleted
    // Check if this is a flip action before proceeding
    if (!action || !METAL6_FLIP_ACTION_TYPES.includes(action.type)) {
        return null; // Not a flip action - Metal-6 should not trigger
    }

    const cardInfo = findCardOnBoard(state, targetCardId);
    if (cardInfo && cardInfo.card.protocol === 'Metal' && cardInfo.card.value === 6) {
        // FIX: Use actor from action parameter, not state.turn (critical for interrupts)
        const actor = 'actor' in action ? action.actor : state.turn;
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";

        // Determine source card name for better logging
        let sourceCardName = 'An effect';
        if ('sourceCardId' in action && action.sourceCardId) {
            const sourceCard = findCardOnBoard(state, action.sourceCardId);
            if (sourceCard) {
                sourceCardName = `${sourceCard.card.protocol}-${sourceCard.card.value}`;
            }
        }

        // Log which card is being flipped and by what
        let newState = log(state, actor, `${sourceCardName}: ${actorName} flips ${ownerName} Metal-6.`);
        newState = log(newState, actor, `Metal-6: Deletes itself when flipped.`);

        const newStats = { ...state.stats[actor], cardsDeleted: state.stats[actor].cardsDeleted + 1 };
        const newPlayerState = { ...state[actor], stats: newStats };
        newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

        // CRITICAL: Store lane info BEFORE the callback (card will be gone after animation)
        const cardOwner = cardInfo.owner;
        const laneIndex = state[cardOwner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
        const lane = state[cardOwner].lanes[laneIndex];
        const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;
        const hadCardBelow = lane && lane.length > 1;

        const onCompleteCallback = (s: GameState, endTurnCb: (s2: GameState) => GameState) => {
            let stateAfterTriggers = checkForHate3Trigger(s, s.turn);

            // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
            const reactiveResult = processReactiveEffects(stateAfterTriggers, 'after_delete', { player: s.turn });
            stateAfterTriggers = reactiveResult.newState;

            // CRITICAL: Handle uncover effect if Metal-6 was top card and there was a card below
            if (wasTopCard && hadCardBelow) {
                const uncoverResult = handleUncoverEffect(stateAfterTriggers, cardOwner, laneIndex);
                stateAfterTriggers = uncoverResult.newState;
                console.log('[Metal-6 Delete] Uncover effect triggered. actionRequired:', stateAfterTriggers.actionRequired?.type || 'null');
            }

            if (action?.type === 'select_card_to_flip_for_light_0') {
                const cardValue = 6; // Metal-6 value in trash is always its face-up value
                stateAfterTriggers = log(stateAfterTriggers, action.actor, `Light-0: Drawing ${cardValue} card(s) after Metal-6 was deleted.`);
                stateAfterTriggers = drawForPlayer(stateAfterTriggers, action.actor, cardValue);
                stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);
                stateAfterTriggers.actionRequired = null; // Light-0 action is complete.
                if (stateAfterTriggers.actionRequired) return stateAfterTriggers; // Check for triggers from drawing
                return endTurnCb(stateAfterTriggers);
            }

            if (action?.type === 'select_any_other_card_to_flip_for_water_0') {
                // CRITICAL FIX: When Metal-6 is deleted via handleMetal6Flip, the switch-block
                // for 'select_any_other_card_to_flip_for_water_0' is NEVER executed (early return).
                // This means the self-flip was NEVER added to the queue!
                // We must add it here.
                const selfFlipAction: ActionRequired = {
                    type: 'flip_self_for_water_0',
                    sourceCardId: action.sourceCardId,
                    actor: action.actor,
                };

                // Check if Metal-1 (or another card) was uncovered and triggered an effect
                if (stateAfterTriggers.actionRequired) {
                    // An uncover effect created an interrupt - queue the self-flip at BEGINNING
                    stateAfterTriggers.queuedActions = [
                        selfFlipAction,  // Self-flip FIRST (before any other queued effects)
                        ...(stateAfterTriggers.queuedActions || []),
                    ];
                    console.log('[WATER-0 + Metal-6] Interrupt detected, queued self-flip. Queue:', stateAfterTriggers.queuedActions.length);
                    return stateAfterTriggers;
                }

                // No interrupt - queue the self-flip and process it
                stateAfterTriggers.queuedActions = [selfFlipAction];
                stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);
                stateAfterTriggers = phaseManager.processQueuedActions(stateAfterTriggers);
                console.log('[WATER-0 + Metal-6] No interrupt, processed self-flip. actionRequired:', stateAfterTriggers.actionRequired?.type || 'null');

                if (stateAfterTriggers.actionRequired) {
                    return stateAfterTriggers;
                }
                return endTurnCb(stateAfterTriggers);
            }

            // FIX: Use a proper type guard for 'count' property and remove 'as any' cast.
            if (action && 'count' in action && action.count > 1) {
                const remainingCount = action.count - 1;
                stateAfterTriggers.actionRequired = { ...action, count: remainingCount };
                return stateAfterTriggers;
            }
            // CRITICAL: If the input state already has actionRequired or queuedActions,
            // it means processQueuedActions already ran and set up the next action.
            // We should NOT override it by calling queuePendingCustomEffects again.
            if (s.actionRequired || (s.queuedActions && s.queuedActions.length > 0)) {
                // Preserve actionRequired/queuedActions from input state
                return {
                    ...stateAfterTriggers,
                    actionRequired: s.actionRequired,
                    queuedActions: s.queuedActions
                };
            }

            stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);
            stateAfterTriggers.actionRequired = null;

            if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                const newQueue = [...stateAfterTriggers.queuedActions];
                const nextAction = newQueue.shift();
                return { ...stateAfterTriggers, actionRequired: nextAction, queuedActions: newQueue };
            }
            return endTurnCb(stateAfterTriggers);
        };

        return {
            nextState: { ...newState, actionRequired: null },
            requiresAnimation: {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback,
            },
            requiresTurnEnd: false,
        };
    }
    return null;
}

export const resolveActionWithCard = (prev: GameState, targetCardId: string): CardActionResult => {
    if (!prev.actionRequired) return { nextState: prev };

    let newState: GameState = { ...prev };
    let requiresTurnEnd = true;
    let requiresAnimation: CardActionResult['requiresAnimation'] = null;

    const metal6Result = handleMetal6Flip(prev, targetCardId, prev.actionRequired);
    if (metal6Result) return metal6Result;

    switch (prev.actionRequired.type) {
        case 'select_covered_card_to_flip_for_chaos_0': { // Chaos-0
            const { actor, sourceCardId, remainingLanes } = prev.actionRequired;
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);

            newState = internalResolveTargetedFlip(prev, targetCardId);

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                newState = result.newState;
                if (result.animationRequests) {
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired || (s.queuedActions && s.queuedActions.length > 0)) return s;
                            return endTurnCb(s);
                        }
                    };
                }
            }

            // Check if there are more lanes to process
            if (remainingLanes.length > 0) {
                const nextLane = remainingLanes[0];
                const newRemainingLanes = remainingLanes.slice(1);
                newState.actionRequired = {
                    type: 'select_covered_card_to_flip_for_chaos_0',
                    sourceCardId,
                    laneIndex: nextLane,
                    remainingLanes: newRemainingLanes,
                    actor,
                };
                requiresTurnEnd = false;
            } else {
                // No more lanes, clear action
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                if (newState.queuedActions && newState.queuedActions.length > 0) {
                    requiresTurnEnd = false;
                }
            }
            break;
        }
        case 'select_any_other_card_to_flip':
        case 'select_opponent_face_up_card_to_flip':
        case 'select_own_face_up_covered_card_to_flip':
        case 'select_covered_card_in_line_to_flip_optional':
        case 'select_any_card_to_flip_optional':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_card_to_flip_for_fire_3':
        case 'select_card_to_flip': {  // NEW: Generic flip for custom protocols
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const draws = 'draws' in prev.actionRequired ? prev.actionRequired.draws : 0;

            newState = internalResolveTargetedFlip(prev, targetCardId);

            // CRITICAL: Save this value to restore after handleOnFlipToFaceUp
            const savedTargetCardId = targetCardId;
            newState.lastCustomEffectTargetCardId = savedTargetCardId;

            if (draws && draws > 0) {
                const { actor, sourceCardId } = prev.actionRequired as { actor: Player, sourceCardId: string };
                const sourceCardInfo = findCardOnBoard(newState, sourceCardId);
                const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'A card effect';
                newState = log(newState, actor, `${sourceCardName}: Drawing ${draws} card(s).`);
                newState = drawForPlayer(newState, actor, draws);
            }

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                newState = result.newState;
                // CRITICAL: Restore lastCustomEffectTargetCardId after handleOnFlipToFaceUp
                newState.lastCustomEffectTargetCardId = savedTargetCardId;
                if (result.animationRequests) {
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired || (s.queuedActions && s.queuedActions.length > 0)) return s;
                            return endTurnCb(s);
                        }
                    };
                }
            }

            // NEW: Handle custom protocol follow-up effects (e.g., "Flip 1 card. Draw cards equal to that card's value")
            const hasFollowUpEffect = (prev.actionRequired as any)?.followUpEffect;
            const sourceCardId = (prev.actionRequired as any)?.sourceCardId;
            if (hasFollowUpEffect && sourceCardId) {
                newState = handleChainedEffectsOnFlip(newState, targetCardId, sourceCardId);
            }

            // NEW: Trigger reactive effects after flip
            const flipActor = (prev.actionRequired as any)?.actor || prev.turn;
            const reactiveFlipResult = processReactiveEffects(newState, 'after_flip', { player: flipActor, cardId: targetCardId });
            newState = reactiveFlipResult.newState;

            // NEW: Handle pending custom effects (for "Flip 1 card. Shift THAT card" chains)
            // CRITICAL: ALWAYS queue pending effects to execute after the flipped card's on-flip effects complete
            const pendingEffects = (newState as any)._pendingCustomEffects;
            if (pendingEffects && pendingEffects.effects.length > 0) {
                console.log('[SOFTLOCK DEBUG] Queueing pending effects after flip:');
                console.log('  - cardOwner from context:', pendingEffects.context.cardOwner);
                console.log('  - flipActor (prev actor):', flipActor);
                console.log('  - current turn:', newState.turn);
                console.log('  - actionRequired actor:', newState.actionRequired?.actor);
                console.log('  - remaining effects:', pendingEffects.effects.length);

                // ALWAYS queue the pending effects - never execute immediately
                // This ensures the flipped card's on-flip effects (which may set actionRequired) complete first
                const pendingAction: ActionRequired = {
                    type: 'execute_remaining_custom_effects' as any,
                    sourceCardId: pendingEffects.sourceCardId,
                    laneIndex: pendingEffects.laneIndex,
                    effects: pendingEffects.effects,
                    context: pendingEffects.context,
                    actor: pendingEffects.context.cardOwner,  // CRITICAL: Use cardOwner from context, NOT flipActor (which could be from an uncover interrupt)
                    // Store the flipped card ID if needed for "that card" effects
                    selectedCardFromPreviousEffect: pendingEffects.effects[0].useCardFromPreviousEffect ? targetCardId : undefined,
                } as any;

                console.log('  - queued action actor:', pendingAction.actor);

                // ALWAYS queue the pending effects, never set as actionRequired!
                // execute_remaining_custom_effects is an internal action, not a user action
                newState.queuedActions = [
                    ...(newState.queuedActions || []),
                    pendingAction
                ];

                console.log('  - queue length after:', newState.queuedActions.length);

                // Clear from state after queueing
                delete (newState as any)._pendingCustomEffects;
            }

            // NEW: Handle each_lane continuation (scope: 'each_lane' parameter)
            const remainingLanes = (prev.actionRequired as any)?.remainingLanes;
            if (remainingLanes && remainingLanes.length > 0 && !newState.actionRequired) {
                // Continue with next lane
                const nextLane = remainingLanes[0];
                const newRemainingLanes = remainingLanes.slice(1);
                const actionParams = (prev.actionRequired as any)?.params;
                const actionSourceCardId = (prev.actionRequired as any)?.sourceCardId;
                const actionActor = (prev.actionRequired as any)?.actor;
                const actionTargetFilter = (prev.actionRequired as any)?.targetFilter;

                newState.actionRequired = {
                    type: 'select_card_to_flip',
                    sourceCardId: actionSourceCardId,
                    actor: actionActor,
                    currentLaneIndex: nextLane,
                    remainingLanes: newRemainingLanes,
                    targetFilter: actionTargetFilter,  // CRITICAL: Pass targetFilter for targeting
                    params: actionParams,
                } as any;
            }

            if(newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            }
            break;
        }
        case 'select_opponent_card_to_flip': { // Darkness-1
            const { actor, sourceCardId } = prev.actionRequired;
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const nextAction: ActionRequired = { type: 'shift_flipped_card_optional', cardId: targetCardId, sourceCardId, optional: true, actor };
            newState = internalResolveTargetedFlip(prev, targetCardId, nextAction);

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                const interruptAction = result.newState.actionRequired;

                // CRITICAL: If the on-flip effect creates an interrupt action,
                // we need to QUEUE the shift prompt ONLY if:
                // 1. The flipped card still exists (not deleted/returned)
                // 2. The source card (Darkness-1) still exists (not deleted/returned)
                if (interruptAction && interruptAction !== nextAction) {
                    // If there's an interrupt, queue the shift prompt.
                    // The validation (checking if source is still face-up) happens at the end of this function.
                    const flippedCardStillExists = findCardOnBoard(result.newState, targetCardId);

                    if (flippedCardStillExists) {
                        // Flipped card still exists - queue the shift prompt AFTER the interrupt
                        // Note: We don't check if source is face-up here because the interrupt hasn't been resolved yet!
                        result.newState.queuedActions = [
                            ...(result.newState.queuedActions || []),
                            nextAction
                        ];
                    }
                    // If the flipped card was deleted/returned during the interrupt, don't queue the shift
                }

                newState = result.newState;
                if (result.animationRequests) {
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s) => s // Just return the state, let the queued actions process.
                    };
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_card_to_shift_for_anarchy_0':
        case 'select_card_to_shift_for_anarchy_1':
        case 'select_card_to_shift_for_gravity_1':
        case 'shift_flipped_card_optional':
        case 'select_opponent_covered_card_to_shift':
        case 'select_own_covered_card_to_shift':
        case 'select_face_down_card_to_shift_for_darkness_4':
        case 'select_any_opponent_card_to_shift':
        case 'select_card_to_shift': {  // NEW: Generic shift for custom protocols
            // CRITICAL: For optional shift actions (like Darkness-1), validate that the source card still exists AND is face-up!
            // If the source card was deleted/returned/flipped during an interrupt, the shift is cancelled.
            if (prev.actionRequired.type === 'shift_flipped_card_optional') {
                const sourceCardId = prev.actionRequired.sourceCardId;
                const sourceCardInfo = findCardOnBoard(prev, sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                    // Source card (e.g., Darkness-1) was deleted/returned/flipped → Cancel the shift
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                    newState = log(prev, prev.actionRequired.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);
                    newState = phaseManager.queuePendingCustomEffects(newState);
                    newState.actionRequired = null;
                    requiresTurnEnd = true;
                    break;
                }
            }

            const cardInfo = findCardOnBoard(prev, targetCardId);


            if (cardInfo) {
                const { owner: cardOwner } = cardInfo;
                let originalLaneIndex = -1;
                for (let i = 0; i < prev[cardOwner].lanes.length; i++) {
                    if (prev[cardOwner].lanes[i].some(c => c.id === targetCardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
                if (originalLaneIndex !== -1) {
                    // CRITICAL: If targetLaneIndex is specified (like Gravity-4 and custom 'to_this_lane'), shift directly!
                    // No lane selection needed - destination is fixed
                    const fixedTargetLane = (prev.actionRequired as any).targetLaneIndex;
                    if (fixedTargetLane !== undefined) {
                        // Execute shift immediately like Gravity-4
                        const actor = prev.actionRequired.actor;
                        const shiftResult = internalShiftCard(prev, targetCardId, cardOwner, fixedTargetLane, actor);
                        newState = shiftResult.newState;
                        requiresTurnEnd = !newState.actionRequired;
                        break;
                    }

                    // No fixed destination - ask user to select lane
                    // FIX: Use actor from the current action, not prev.turn
                    // This is critical for interrupt scenarios (e.g., Psychic-3 uncovered during opponent's turn)
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.actionRequired.actor,
                        destinationRestriction: (prev.actionRequired as any).destinationRestriction,  // Pass through for custom protocols
                    };
                    newState.actionRequired = nextAction;
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev, requiresTurnEnd: true };


            const shiftResult = internalShiftCard(prev, targetCardId, cardInfo.owner, targetLaneIndex, actor);
            newState = shiftResult.newState;

            if (shiftResult.animationRequests) {
                requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.actionRequired) return s; // Handle potential interrupts from uncover
                        return endTurnCb(s);
                    }
                };
                requiresTurnEnd = false;
            } else {
                requiresTurnEnd = !newState.actionRequired;
            }
            break;
        }
        case 'select_own_other_card_to_shift': {
            const cardInfo = findCardOnBoard(prev, targetCardId);


            if (cardInfo) {
                const { owner: cardOwner } = cardInfo;
                let originalLaneIndex = -1;
                for (let i = 0; i < prev[cardOwner].lanes.length; i++) {
                    if (prev[cardOwner].lanes[i].some(c => c.id === targetCardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
                if (originalLaneIndex !== -1) {
                    // FIX: Use actor from action, not prev.turn
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.actionRequired.actor,
                    };
                    newState.actionRequired = nextAction;
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_opponent_face_down_card_to_shift': { // Speed-4
            const cardInfo = findCardOnBoard(prev, targetCardId);


            if (cardInfo) {
                const { owner: cardOwner } = cardInfo;
                let originalLaneIndex = -1;
                for (let i = 0; i < prev[cardOwner].lanes.length; i++) {
                    if (prev[cardOwner].lanes[i].some(c => c.id === targetCardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
                if (originalLaneIndex !== -1) {
                    // FIX: Use actor from action, not prev.turn
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.actionRequired.actor,
                    };
                    newState.actionRequired = nextAction;
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_own_card_to_shift_for_speed_3': {
            const cardInfo = findCardOnBoard(prev, targetCardId);


            if (cardInfo) {
                const { owner: cardOwner } = cardInfo;
                let originalLaneIndex = -1;
                for (let i = 0; i < prev[cardOwner].lanes.length; i++) {
                    if (prev[cardOwner].lanes[i].some(c => c.id === targetCardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
                if (originalLaneIndex !== -1) {
                    // FIX: Use actor from action, not prev.turn
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.actionRequired.actor,
                        sourceEffect: 'speed_3_end',
                    };
                    newState.actionRequired = nextAction;
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_card_to_delete_for_death_1': {
            const { sourceCardId, actor } = prev.actionRequired;
            const cardInfoToDelete = findCardOnBoard(prev, targetCardId);
            const sourceCardInfo = findCardOnBoard(prev, sourceCardId);

            if (!cardInfoToDelete || !sourceCardInfo) return { nextState: prev };


            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfoToDelete.owner === 'player' ? "Player's" : "Opponent's";
            const cardName = cardInfoToDelete.card.isFaceUp ? `${cardInfoToDelete.card.protocol}-${cardInfoToDelete.card.value}` : 'a face-down card';
            
            newState = log(newState, actor, `Death-1: ${actorName} deletes ${ownerName} ${cardName} and the Death-1 card itself.`);
            
            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 2 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            // --- Uncover Logic Setup ---
            const targetLaneIndex = prev[cardInfoToDelete.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const targetLane = prev[cardInfoToDelete.owner].lanes[targetLaneIndex];
            const targetWasTopCard = targetLane && targetLane.length > 0 && targetLane[targetLane.length - 1].id === targetCardId;

            const sourceLaneIndex = prev[sourceCardInfo.owner].lanes.findIndex(l => l.some(c => c.id === sourceCardId));
            const sourceLane = prev[sourceCardInfo.owner].lanes[sourceLaneIndex];
            const sourceWasTopCard = sourceLane && sourceLane.length > 0 && sourceLane[sourceLane.length - 1].id === sourceCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [
                    { type: 'delete', cardId: targetCardId, owner: cardInfoToDelete.owner },
                    { type: 'delete', cardId: sourceCardId, owner: sourceCardInfo.owner }
                ],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateAfterDelete = checkForHate3Trigger(s, actor); // Trigger for target
                    stateAfterDelete = checkForHate3Trigger(stateAfterDelete, actor); // Trigger for self-delete

                    // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(stateAfterDelete, 'after_delete', { player: actor });
                    stateAfterDelete = reactiveResult.newState;

                    // --- Uncover Logic Execution ---
                    if (targetWasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateAfterDelete, cardInfoToDelete.owner, targetLaneIndex);
                        stateAfterDelete = uncoverResult.newState;
                    }
                    if (sourceWasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateAfterDelete, sourceCardInfo.owner, sourceLaneIndex);
                        stateAfterDelete = uncoverResult.newState;
                    }

                    // IMPORTANT: Decrease indent after uncover effects complete (from on-cover effects)
                    // This closes the indentation from executeOnCoverEffect
                    stateAfterDelete = decreaseLogIndent(stateAfterDelete);

                    // CRITICAL FIX: Don't clear actionRequired if uncover set one!
                    // If there's an actionRequired from uncover, return it immediately
                    if (stateAfterDelete.actionRequired) {
                        return stateAfterDelete;
                    }

                    // Otherwise, check for queued actions
                    if (stateAfterDelete.queuedActions && stateAfterDelete.queuedActions.length > 0) {
                        const newQueue = [...stateAfterDelete.queuedActions];
                        const nextAction = newQueue.shift();
                        return { ...stateAfterDelete, actionRequired: nextAction, queuedActions: newQueue };
                    }

                    // This action happened in the start phase, so we use a different turn progression.
                    return endTurnCb(stateAfterDelete);
                }
            };
            requiresTurnEnd = false; // The onComplete callback will decide the turn progression.
            break;
        }
        case 'delete_self': {
            // NEW: Composable self-delete (Death-1: "then delete this card")
            const { sourceCardId, cardToDeleteId, actor } = prev.actionRequired as any;
            const cardInfo = findCardOnBoard(prev, cardToDeleteId);

            if (!cardInfo) {
                newState = log(prev, actor, `Card no longer on board. Delete skipped.`);
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            const { owner, laneIndex } = cardInfo;
            const wasTopCard = prev[owner].lanes[laneIndex][prev[owner].lanes[laneIndex].length - 1].id === cardToDeleteId;

            // Delete the card
            const lane = [...prev[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === cardToDeleteId);
            lane.splice(cardIndex, 1);

            const newLanes = [...prev[owner].lanes];
            newLanes[laneIndex] = lane;

            let stateAfterDelete = {
                ...prev,
                [owner]: { ...prev[owner], lanes: newLanes },
            };

            newState = phaseManager.queuePendingCustomEffects(stateAfterDelete);
            newState.actionRequired = null;

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            newState = { ...newState, stats: { ...newState.stats, [actor]: newStats } };

            // Handle uncover if was top card
            if (wasTopCard && lane.length > 0) {
                const uncoverResult = handleUncoverEffect(newState, owner, laneIndex);
                newState = uncoverResult.newState;
            }

            requiresTurnEnd = true;
            break;
        }
        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete':
        case 'select_low_value_card_to_delete':
        case 'select_card_from_other_lanes_to_delete':
        case 'select_card_to_delete_for_anarchy_2': {
            // Rule: An effect is cancelled if its source card is no longer active (face-up on the board).
            const { sourceCardId, actor } = prev.actionRequired;
            const sourceCardInfoCheck = findCardOnBoard(prev, sourceCardId);
            if (!sourceCardInfoCheck || !sourceCardInfoCheck.card.isFaceUp) {
                const cardName = sourceCardInfoCheck ? `${sourceCardInfoCheck.card.protocol}-${sourceCardInfoCheck.card.value}` : 'the source card';
                newState = log(prev, actor, `Effect from ${cardName} was cancelled because the source is no longer active.`);
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };


            // CRITICAL VALIDATION for Anarchy-2: "Delete a covered or uncovered card in a line with a matching protocol"
            if (prev.actionRequired.type === 'select_card_to_delete_for_anarchy_2') {
                // Find which lane the card to delete is in
                const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                if (cardLaneIndex !== -1) {
                    const playerProtocolAtLane = prev.player.protocols[cardLaneIndex];
                    const opponentProtocolAtLane = prev.opponent.protocols[cardLaneIndex];
                    const cardProtocol = cardInfo.card.protocol;

                    // RULE: Card's protocol MUST match at least one protocol in its lane
                    if (cardProtocol !== playerProtocolAtLane && cardProtocol !== opponentProtocolAtLane) {
                        console.error(`Illegal Anarchy-2 delete: ${cardProtocol}-${cardInfo.card.value} in lane ${cardLaneIndex} (protocols: ${playerProtocolAtLane}/${opponentProtocolAtLane}) - card must be in lane with matching protocol`);
                        return { nextState: prev }; // Block the illegal delete
                    }
                }
            }

            // GENERIC VALIDATION for protocolMatching (custom protocols)
            if ((prev.actionRequired as any).protocolMatching) {
                const protocolMatching = (prev.actionRequired as any).protocolMatching;
                const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                if (cardLaneIndex !== -1) {
                    const playerProtocolAtLane = prev.player.protocols[cardLaneIndex];
                    const opponentProtocolAtLane = prev.opponent.protocols[cardLaneIndex];
                    const cardProtocol = cardInfo.card.protocol;
                    const hasMatch = cardProtocol === playerProtocolAtLane || cardProtocol === opponentProtocolAtLane;

                    if (protocolMatching === 'must_match' && !hasMatch) {
                        console.error(`Illegal delete: ${cardProtocol}-${cardInfo.card.value} in lane ${cardLaneIndex} (protocols: ${playerProtocolAtLane}/${opponentProtocolAtLane}) - card must be in lane with matching protocol`);
                        return { nextState: prev }; // Block the illegal delete
                    } else if (protocolMatching === 'must_not_match' && hasMatch) {
                        console.error(`Illegal delete: ${cardProtocol}-${cardInfo.card.value} in lane ${cardLaneIndex} (protocols: ${playerProtocolAtLane}/${opponentProtocolAtLane}) - card must be in lane without matching protocol`);
                        return { nextState: prev }; // Block the illegal delete
                    }
                }
            }

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";
            const laneIdx = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const protocolName = laneIdx !== -1 ? prev[cardInfo.owner].protocols[laneIdx] : 'unknown';
            const cardName = cardInfo.card.isFaceUp
                ? `${cardInfo.card.protocol}-${cardInfo.card.value}`
                : `face-down card in Protocol ${protocolName}`;
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
            newState = log(newState, actor, `${sourceCardName}: ${actorName} deletes ${ownerName} ${cardName}.`);

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    const deletingPlayer = prev.actionRequired.actor;
                    const originalAction = prev.actionRequired;

                    console.log('[DELETE CALLBACK] Started! followUpEffect?', !!(originalAction as any).followUpEffect);

                    // 1. Apply post-animation triggers
                    let stateAfterTriggers = checkForHate3Trigger(s, deletingPlayer);

                    // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(stateAfterTriggers, 'after_delete', { player: deletingPlayer });
                    stateAfterTriggers = reactiveResult.newState;

                    // CRITICAL: Queue pending custom effects after delete completes (Hate-1: multiple deletes)
                    stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);

                    // 2. Determine the next step of the ORIGINAL multi-step delete action BEFORE uncovering
                    let nextStepOfDeleteAction: ActionRequired = null;
                    const sourceCardInfo = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);
                    const sourceIsUncovered = isCardUncovered(stateAfterTriggers, originalAction.sourceCardId);

                    // Check if there's a follow-up effect (Death-1: "then delete this card")
                    const followUpEffect = (originalAction as any).followUpEffect;

                    // CRITICAL: Multi-step effects (like Hate-1) require the source to be UNCOVERED AND face-up
                    if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                        // NEW: Handle each_lane continuation (scope: 'each_lane' parameter)
                        const remainingLanes = (originalAction as any).remainingLanes;
                        if (originalAction.type === 'select_cards_to_delete' && remainingLanes && remainingLanes.length > 0) {
                            // Continue with next lane
                            const nextLane = remainingLanes[0];
                            const newRemainingLanes = remainingLanes.slice(1);

                            nextStepOfDeleteAction = {
                                type: 'select_cards_to_delete',
                                count: (originalAction as any).params?.count || originalAction.count,  // Reset count for next lane
                                sourceCardId: originalAction.sourceCardId,
                                actor: originalAction.actor,
                                currentLaneIndex: nextLane,
                                remainingLanes: newRemainingLanes,
                                disallowedIds: (originalAction as any).params?.excludeSelf ? [originalAction.sourceCardId] : [],
                                targetFilter: (originalAction as any).targetFilter,
                                scope: (originalAction as any).scope,
                                protocolMatching: (originalAction as any).protocolMatching,
                                params: (originalAction as any).params,
                            } as any;
                        } else if (originalAction.type === 'select_cards_to_delete' && originalAction.count > 1) {
                             nextStepOfDeleteAction = {
                                type: 'select_cards_to_delete',
                                count: originalAction.count - 1,
                                sourceCardId: originalAction.sourceCardId,
                                disallowedIds: [...originalAction.disallowedIds, targetCardId],
                                actor: originalAction.actor,
                                followUpEffect: followUpEffect  // Preserve followUpEffect for subsequent deletes
                            } as any;
                        } else if (originalAction.type === 'select_card_from_other_lanes_to_delete' && originalAction.count > 1) {
                            const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));

                            // CRITICAL: Check if remaining lanes have any cards (Death-0 validation)
                            const allSelectedLanes = [...originalAction.lanesSelected, cardLaneIndex];
                            const remainingLanes = [0, 1, 2].filter(i =>
                                i !== originalAction.disallowedLaneIndex && !allSelectedLanes.includes(i)
                            );
                            const hasCardsInRemainingLanes = remainingLanes.some(laneIdx =>
                                stateAfterTriggers.player.lanes[laneIdx].length > 0 ||
                                stateAfterTriggers.opponent.lanes[laneIdx].length > 0
                            );

                            if (hasCardsInRemainingLanes) {
                                nextStepOfDeleteAction = {
                                    type: 'select_card_from_other_lanes_to_delete',
                                    count: originalAction.count - 1,
                                    sourceCardId: originalAction.sourceCardId,
                                    disallowedLaneIndex: originalAction.disallowedLaneIndex,
                                    lanesSelected: allSelectedLanes,
                                    actor: originalAction.actor
                                };
                            } else {
                                // No cards left in remaining lanes - skip the rest
                                stateAfterTriggers = log(stateAfterTriggers, originalAction.actor, `No cards left in remaining lanes. Effect skipped.`);
                            }
                        }
                    } else if ('count' in originalAction && originalAction.count > 1) {
                        const sourceName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                        const reason = !sourceCardInfo || !sourceCardInfo.card.isFaceUp
                            ? "the source is no longer active"
                            : "the source was covered";
                        stateAfterTriggers = log(stateAfterTriggers, originalAction.actor, `Remaining deletes from ${sourceName} were cancelled because ${reason}.`);
                    }

                    // 3. Handle uncovering with the pre-computed next delete action
                    let hadInterruptThatResolved = false;
                    if (wasTopCard) {
                        const stateBeforeUncover = stateAfterTriggers;
                        const uncoverResult = handleUncoverEffect(stateBeforeUncover, cardInfo.owner, laneIndex);

                        // Check if the uncover created an interrupt (turn switch)
                        const uncoverCreatedInterrupt = uncoverResult.newState._interruptedTurn !== undefined;

                        // Check if an interrupt was resolved during this callback
                        if (stateBeforeUncover._interruptedTurn && !uncoverResult.newState._interruptedTurn) {
                            hadInterruptThatResolved = true;
                        }

                        // Use the queue from the uncover result (it already includes any existing queued actions)
                        // IMPORTANT: Don't merge with stateBeforeUncover.queuedActions because that would duplicate
                        // actions that were created by the uncover effect itself!
                        const mergedQueue = [
                            ...(uncoverResult.newState.queuedActions || [])
                        ];

                        // If we have a next delete step, ensure it's preserved
                        if (nextStepOfDeleteAction) {
                            if (uncoverCreatedInterrupt) {
                                // The uncover interrupted - queue the next delete for AFTER the interrupt resolves
                                mergedQueue.push(nextStepOfDeleteAction);
                            } else {
                                // No interrupt - the next delete should happen immediately after the uncover effect
                                mergedQueue.unshift(nextStepOfDeleteAction);
                            }
                        }

                        stateAfterTriggers = {
                            ...uncoverResult.newState,
                            queuedActions: mergedQueue
                        };
                    } else if (nextStepOfDeleteAction) {
                        // No uncover happened, but we have a next delete step
                        stateAfterTriggers.queuedActions = [
                            ...(stateAfterTriggers.queuedActions || []),
                            nextStepOfDeleteAction
                        ];
                    }

                    // 4. Handle action priority
                    const actionFromTriggers = stateAfterTriggers.actionRequired;

                    if (actionFromTriggers) {
                        // Uncover created an interrupt - the next delete is already in the queue
                        return stateAfterTriggers;
                    }

                    // No interrupt from uncover - check if we have queued actions
                    if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                        // CRITICAL: Auto-resolve actions should be processed via processQueuedActions
                        // instead of being set as actionRequired (which expects user input)
                        const firstAction = stateAfterTriggers.queuedActions[0];
                        if (firstAction?.type === 'execute_remaining_custom_effects') {
                            const stateAfterQueue = phaseManager.processQueuedActions(stateAfterTriggers);

                            // If processQueuedActions set an actionRequired, return it
                            if (stateAfterQueue.actionRequired) {
                                return stateAfterQueue;
                            }

                            // Otherwise end turn
                            return endTurnCb(stateAfterQueue);
                        }

                        // Pop the first queued action and make it the current action
                        const queueCopy = [...stateAfterTriggers.queuedActions];
                        const nextAction = queueCopy.shift();

                        // CRITICAL: Validate shift actions before setting as actionRequired!
                        if (nextAction?.type === 'shift_flipped_card_optional' || nextAction?.type === 'gravity_2_shift_after_flip') {
                            const sourceCardInfo = findCardOnBoard(stateAfterTriggers, nextAction.sourceCardId);
                            const sourceIsUncovered = isCardUncovered(stateAfterTriggers, nextAction.sourceCardId);

                            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp || !sourceIsUncovered) {
                                // Source card was deleted/returned/flipped face-down/covered → Cancel the shift
                                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                                let loggedState = log(stateAfterTriggers, nextAction.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);

                                // Continue processing remaining queue
                                if (queueCopy.length > 0) {
                                    const nextNextAction = queueCopy.shift();
                                    return { ...loggedState, actionRequired: nextNextAction, queuedActions: queueCopy };
                                } else {
                                    // No more queued actions - end turn
                                    return endTurnCb({ ...loggedState, actionRequired: null, queuedActions: [] });
                                }
                            }
                        }

                        return {
                            ...stateAfterTriggers,
                            actionRequired: nextAction,
                            queuedActions: queueCopy
                        };
                    }

                    // CRITICAL: If we just resolved an interrupt, DON'T call endTurnCb
                    // because it would progress phases based on the ORIGINAL phase (before interrupt).
                    // Instead, check if there are queued actions (like the second delete from Hate-1)
                    // and process them before returning.
                    if (hadInterruptThatResolved) {
                        console.log('[DELETE CALLBACK] Interrupt resolved, checking for queued actions');

                        // CRITICAL FIX: After interrupt resolves, we need to process any queued actions
                        // (like the second delete from Hate-1) before returning.
                        if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                            console.log('[DELETE CALLBACK] Found queued actions after interrupt:', stateAfterTriggers.queuedActions.length);
                            const queueCopy = [...stateAfterTriggers.queuedActions];
                            const nextAction = queueCopy.shift();

                            // Return state with next queued action as actionRequired
                            return {
                                ...stateAfterTriggers,
                                actionRequired: nextAction,
                                queuedActions: queueCopy
                            };
                        }

                        // No queued actions - just return the state without ending the turn
                        console.log('[DELETE CALLBACK] No queued actions after interrupt, returning early');
                        return stateAfterTriggers;
                    }

                    console.log('[DELETE CALLBACK] Reached followUpEffect check. followUpEffect?', !!followUpEffect, 'sourceCardInfo?', !!sourceCardInfo, 'isFaceUp?', sourceCardInfo?.card.isFaceUp);

                    // NEW: Execute follow-up effect if it exists (Death-1: "then delete this card")
                    if (followUpEffect && sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                        // CRITICAL: Only TOP effects can execute when covered
                        // Middle and Bottom effects require uncovered status
                        const followUpPosition = followUpEffect.position || 'middle';
                        const requiresUncovered = followUpPosition !== 'top';
                        const canExecute = !requiresUncovered || sourceIsUncovered;

                        if (canExecute) {
                            console.log('[Death-1 Follow-up] Executing follow-up effect after delete:', followUpEffect);

                            const cardLaneIndex = stateAfterTriggers[sourceCardInfo.owner].lanes.findIndex(l => l.some(c => c.id === originalAction.sourceCardId));
                            const opponent = originalAction.actor === 'player' ? 'opponent' : 'player';
                            const followUpTrigger = followUpEffect.trigger || 'on_play';
                            const context = {
                                cardOwner: originalAction.actor,
                                actor: originalAction.actor,
                                currentTurn: stateAfterTriggers.turn,
                                opponent,
                                triggerType: followUpTrigger as any
                            };
                            const result = executeCustomEffect(sourceCardInfo.card, cardLaneIndex, stateAfterTriggers, context, followUpEffect);
                            stateAfterTriggers = result.newState;
                            console.log('[Death-1 Follow-up] Result actionRequired:', stateAfterTriggers.actionRequired);

                            // DEBUG: Check if card still exists after deleteSelf
                            const cardStillExists = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);
                            console.log('[Death-1 Follow-up] Card still exists after deleteSelf?', !!cardStillExists);

                            // If followUpEffect created an action, return it (don't end turn yet)
                            if (stateAfterTriggers.actionRequired) {
                                return stateAfterTriggers;
                            }
                        } else {
                            console.log('[Death-1 Follow-up] Follow-up effect requires uncovered but card is covered');
                        }
                    } else {
                        console.log('[Death-1 Follow-up] No follow-up effect or source card not valid:', {
                            hasFollowUp: !!followUpEffect,
                            hasSourceCard: !!sourceCardInfo,
                            isFaceUp: sourceCardInfo?.card.isFaceUp,
                            isUncovered: sourceIsUncovered
                        });
                    }

                    return endTurnCb(stateAfterTriggers);
                }
            };
            requiresTurnEnd = false; // Callback handles turn progression
            break;
        }
        case 'plague_4_opponent_delete': {
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            const actor = prev.actionRequired.actor; // The opponent is the one deleting


            newState = log(newState, actor, `Plague-4: Opponent deletes one of their face-down cards.`);

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateWithTriggers = checkForHate3Trigger(s, actor);

                    // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(stateWithTriggers, 'after_delete', { player: actor });
                    stateWithTriggers = reactiveResult.newState;

                    if (wasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateWithTriggers, cardInfo.owner, laneIndex);
                        stateWithTriggers = uncoverResult.newState;
                    }

                    // CRITICAL: The flip prompt is for the Plague-4 card owner (the "you" in card text).
                    // We need to find who owns the source card to determine the correct actor.
                    const sourceCardInfo = findCardOnBoard(stateWithTriggers, prev.actionRequired.sourceCardId);
                    const plague4Owner = sourceCardInfo?.owner || prev.turn;

                    const nextAction: ActionRequired = {
                        type: 'plague_4_player_flip_optional',
                        sourceCardId: prev.actionRequired.sourceCardId,
                        optional: true,
                        actor: plague4Owner, // The prompt is for the Plague-4 owner
                    };

                    // If uncover effect created an action, queue the plague_4 flip action
                    if (stateWithTriggers.actionRequired) {
                        stateWithTriggers.queuedActions = [
                            ...(stateWithTriggers.queuedActions || []),
                            nextAction
                        ];
                    } else {
                        stateWithTriggers.actionRequired = nextAction;
                    }
                    return stateWithTriggers;
                }
            };
            requiresTurnEnd = false;
            break;
        }
        case 'select_own_highest_card_to_delete_for_hate_2': {
            const { sourceCardId, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            // Validation: Must be one of the actor's highest uncovered cards
            const highestCards = findAllHighestUncoveredCards(prev, actor);
            const isValid = highestCards.some(c => c.card.id === targetCardId);
            if (!isValid) {
                newState = log(prev, actor, `Invalid selection: Card is not one of your highest value uncovered cards.`);
                return { nextState: prev };
            }


            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const cardName = cardInfo.card.isFaceUp ? `${cardInfo.card.protocol}-${cardInfo.card.value}` : 'a face-down card';
            newState = log(newState, actor, `Hate-2: ${actorName} deletes their highest value uncovered card (${cardName}).`);

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateAfterTriggers = checkForHate3Trigger(s, actor);

                    // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(stateAfterTriggers, 'after_delete', { player: actor });
                    stateAfterTriggers = reactiveResult.newState;

                    // Handle uncovering
                    if (wasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateAfterTriggers, cardInfo.owner, laneIndex);
                        stateAfterTriggers = uncoverResult.newState;
                    }

                    // CRITICAL: Only proceed to second clause if Hate-2 still exists, is face-up, and is uncovered
                    const hate2CardInfo = findCardOnBoard(stateAfterTriggers, sourceCardId);
                    const hate2IsUncovered = hate2CardInfo && isCardUncovered(stateAfterTriggers, sourceCardId);

                    if (hate2CardInfo && hate2CardInfo.card.isFaceUp && hate2IsUncovered) {
                        // Hate-2 still exists, is face-up, and is uncovered → Second clause: Select opponent's highest card
                        const opponent = actor === 'player' ? 'opponent' : 'player';
                        const nextAction: ActionRequired = {
                            type: 'select_opponent_highest_card_to_delete_for_hate_2',
                            sourceCardId: sourceCardId,
                            actor: actor, // Same actor selects opponent's card
                            count: 1
                        };

                        // If uncover created an action, queue the opponent delete
                        if (stateAfterTriggers.actionRequired) {
                            stateAfterTriggers.queuedActions = [
                                ...(stateAfterTriggers.queuedActions || []),
                                nextAction
                            ];
                        } else {
                            stateAfterTriggers.actionRequired = nextAction;
                        }
                        return stateAfterTriggers;
                    } else {
                        // Hate-2 was deleted, covered, or flipped face-down → Effect ends here (second clause does not trigger)
                        const reason = !hate2CardInfo ? 'deleted itself' :
                                      !hate2CardInfo.card.isFaceUp ? 'was flipped face-down' :
                                      'is now covered';
                        stateAfterTriggers = log(stateAfterTriggers, actor, `Hate-2 ${reason}, second clause does not trigger.`);
                        return endTurnCb(stateAfterTriggers);
                    }
                }
            };
            requiresTurnEnd = false;
            break;
        }
        case 'select_opponent_highest_card_to_delete_for_hate_2': {
            const { sourceCardId, actor } = prev.actionRequired;
            const opponent = actor === 'player' ? 'opponent' : 'player';
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            // Validation: Must be one of the opponent's highest uncovered cards
            const opponentHighestCards = findAllHighestUncoveredCards(prev, opponent);
            const isValid = opponentHighestCards.some(c => c.card.id === targetCardId);
            if (!isValid) {
                newState = log(prev, actor, `Invalid selection: Card is not one of opponent's highest value uncovered cards.`);
                return { nextState: prev };
            }


            // CRITICAL: Set log context to Hate-2 to ensure correct source in logs
            // This is especially important if this action was queued after an interrupt
            newState = setLogSource(newState, 'Hate-2');
            newState = setLogPhase(newState, 'middle');

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";
            const cardName = cardInfo.card.isFaceUp ? `${cardInfo.card.protocol}-${cardInfo.card.value}` : 'a face-down card';
            newState = log(newState, actor, `${actorName} deletes ${ownerName} highest value uncovered card (${cardName}).`);

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateAfterTriggers = checkForHate3Trigger(s, actor);

                    // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(stateAfterTriggers, 'after_delete', { player: actor });
                    stateAfterTriggers = reactiveResult.newState;

                    // Handle uncovering
                    if (wasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateAfterTriggers, cardInfo.owner, laneIndex);
                        stateAfterTriggers = uncoverResult.newState;
                    }

                    // Hate-2 effect is complete, end turn
                    return endTurnCb(stateAfterTriggers);
                }
            };
            requiresTurnEnd = false;
            break;
        }
        case 'select_card_to_return': {

            const result = internalReturnCard(prev, targetCardId);
            newState = result.newState;
            if (result.animationRequests) {
                 requiresAnimation = {
                    animationRequests: result.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.actionRequired) return s;
                        return endTurnCb(s);
                    }
                };
            }
            requiresTurnEnd = !newState.actionRequired;
            break;
        }
        case 'select_opponent_card_to_return': { // Psychic-4
            const { sourceCardId, actor } = prev.actionRequired;


            const result = internalReturnCard(prev, targetCardId);
            let stateAfterReturn = result.newState;

            // FIX: If the return triggered an interrupt (e.g., uncover effect),
            // queue the Psychic-4 self-flip to happen after the interrupt resolves.
            if (stateAfterReturn.actionRequired) {
                const flipAction: ActionRequired = {
                    type: 'flip_self_for_psychic_4',
                    sourceCardId: sourceCardId,
                    actor: actor,
                };
                // CRITICAL: Like Water-0, Psychic-4's self-flip should execute BEFORE pending effects
                stateAfterReturn.queuedActions = [
                    flipAction,  // ← AN DEN ANFANG!
                    ...(stateAfterReturn.queuedActions || []),
                ];
                newState = stateAfterReturn;
                requiresTurnEnd = false; // There's still an action pending
            } else {
                // No interrupt - flip immediately
                const sourceCardInfo = findCardOnBoard(stateAfterReturn, sourceCardId);
                if (sourceCardInfo) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    stateAfterReturn = log(stateAfterReturn, actor, `${cardName}: Flips itself.`);
                    stateAfterReturn = findAndFlipCards(new Set([sourceCardId]), stateAfterReturn);
                    stateAfterReturn.animationState = { type: 'flipCard', cardId: sourceCardId };
                }
                newState = stateAfterReturn;
                requiresTurnEnd = true;
            }

            if (result.animationRequests) {
                requiresAnimation = {
                    animationRequests: result.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.actionRequired) return s; // An interrupt happened, will be resolved separately
                        return endTurnCb(s);
                    },
                };
            }
            break;
        }
        case 'select_own_card_to_return_for_water_4': {

            const result = internalReturnCard(prev, targetCardId);
            newState = result.newState;
            if (result.animationRequests) {
                 requiresAnimation = {
                    animationRequests: result.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        // Process any queued actions
                        const stateAfterQueue = phaseManager.processQueuedActions(s);

                        // If a queued action created a new actionRequired, return it
                        if (stateAfterQueue.actionRequired) {
                            return stateAfterQueue;
                        }

                        // Otherwise, END THE TURN (Water-4 effect is done)
                        return endTurnCb(stateAfterQueue);
                    }
                };
            } else {
                // No animation - process queue immediately
                newState = phaseManager.processQueuedActions(newState);
            }
            // CRITICAL FIX: Turn should end after Water-4 return (like all other on-play effects)
            requiresTurnEnd = !newState.actionRequired;
            break;
        }
        case 'select_any_card_to_flip': { // Life-1
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const { count, sourceCardId, actor } = prev.actionRequired;

            // Rule: An effect is cancelled if its source card is no longer active.
            const sourceCardInfo = findCardOnBoard(prev, sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                newState = log(prev, actor, `Effect from ${cardName} was cancelled because the source is no longer active.`);
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            let nextActionInChain: ActionRequired = null;
            if (count > 1) {
                nextActionInChain = {
                    type: 'select_any_card_to_flip',
                    count: count - 1,
                    sourceCardId,
                    actor,
                };
            }
        
            let stateAfterFlip = internalResolveTargetedFlip(prev, targetCardId, nextActionInChain);
            
            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const onFlipResult = handleOnFlipToFaceUp(stateAfterFlip, targetCardId);
                const interruptAction = onFlipResult.newState.actionRequired;
                
                if (interruptAction && interruptAction !== nextActionInChain) {
                    if (nextActionInChain) {
                        onFlipResult.newState.queuedActions = [
                            ...(onFlipResult.newState.queuedActions || []),
                            nextActionInChain
                        ];
                    }
                }
        
                newState = onFlipResult.newState;
                if (onFlipResult.animationRequests) {
                    requiresAnimation = {
                        animationRequests: onFlipResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired || (s.queuedActions && s.queuedActions.length > 0)) return s;
                            return endTurnCb(s);
                        }
                    };
                }
            } else {
                newState = stateAfterFlip;
            }
            
            requiresTurnEnd = !newState.actionRequired && (!newState.queuedActions || newState.queuedActions.length === 0);
            break;
        }
        case 'select_card_to_flip_for_light_0': {
            const { sourceCardId, actor } = prev.actionRequired;
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            
            let stateAfterFlip = internalResolveTargetedFlip(prev, targetCardId, null);
            
            // Get the card's info from the NEW state to check its current value
            const cardInfoAfterFlip = findCardOnBoard(stateAfterFlip, targetCardId);
            
            let cardValue = 0;
            if (cardInfoAfterFlip) {
                const owner = cardInfoAfterFlip.owner;
                const laneContext = stateAfterFlip[owner].lanes.find(l => l.some(c => c.id === targetCardId)) || [];
                cardValue = getEffectiveCardValue(cardInfoAfterFlip.card, laneContext);
            }

            if (cardValue > 0) {
                stateAfterFlip = log(stateAfterFlip, actor, `Light-0: Drawing ${cardValue} card(s).`);
                stateAfterFlip = drawForPlayer(stateAfterFlip, actor, cardValue);
            }

            // Handle on-flip-to-face-up trigger. This is only necessary if the card was flipped from face-down to face-up.
            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(stateAfterFlip, targetCardId);
                newState = result.newState;
            } else {
                newState = stateAfterFlip;
            }
            
            requiresTurnEnd = !newState.actionRequired;
            break;
        }
        case 'select_any_other_card_to_flip_for_water_0': {
            const { sourceCardId, actor } = prev.actionRequired;
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
        
            // 1. Flip the target card.
            let stateAfterTargetFlip = internalResolveTargetedFlip(prev, targetCardId, null);
        
            // 2. Handle any on-flip effects from the just-flipped card. This might set a new actionRequired.
            let onFlipResult: EffectResult = { newState: stateAfterTargetFlip };
            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                onFlipResult = handleOnFlipToFaceUp(stateAfterTargetFlip, targetCardId);
            }
            let stateAfterInterrupt = onFlipResult.newState;
        
            // 3. ALWAYS queue the self-flip (don't execute immediately)
            // The check for uncovered status will be done in phaseManager when the queued action is processed
            // This prevents the bug where player can play another card before self-flip executes
            const selfFlipAction: ActionRequired = {
                type: 'flip_self_for_water_0',
                sourceCardId: sourceCardId,
                actor: actor,
            };

            console.log('[DEBUG] cardResolver - Water-0 self-flip action CREATED:', {
                sourceCardId,
                actor,
                hasInterrupt: !!stateAfterInterrupt.actionRequired,
                existingQueueLength: stateAfterInterrupt.queuedActions?.length || 0
            });

            if (stateAfterInterrupt.actionRequired) {
                // Interrupt occurred - add self-flip to BEGINNING of queue
                // CRITICAL: Water-0's self-flip must execute BEFORE any pending effects from the interrupted card chain
                stateAfterInterrupt.queuedActions = [
                    selfFlipAction,  // ← AN DEN ANFANG!
                    ...(stateAfterInterrupt.queuedActions || []),
                ];
                console.log('[WATER-0 QUEUE] Added to BEGINNING of queue (interrupt case), new queue length:', stateAfterInterrupt.queuedActions.length);
                console.log('[WATER-0 QUEUE] Current actionRequired:', stateAfterInterrupt.actionRequired.type);
            } else {
                // No interrupt - add self-flip as the ONLY queued action
                stateAfterInterrupt.queuedActions = [selfFlipAction];
                console.log('[WATER-0 QUEUE] Created NEW queue (no interrupt), queue length:', stateAfterInterrupt.queuedActions.length);
            }
        
            newState = stateAfterInterrupt;

            // If the interrupt created a new action, we stop and wait for it.
            // If NO interrupt but queue exists, process the queue immediately!
            const hasQueue = newState.queuedActions && newState.queuedActions.length > 0;

            if (hasQueue && !newState.actionRequired) {
                console.log('[WATER-0 NO INTERRUPT] Queue exists but no actionRequired - processing queue immediately');
                newState = phaseManager.processQueuedActions(newState);
                console.log('[WATER-0 NO INTERRUPT] After queue processing - actionRequired?', newState.actionRequired?.type || 'null');
            }

            requiresTurnEnd = !newState.actionRequired;
        
            // Pass on any animation requests from the interrupt.
            if (onFlipResult.animationRequests) {
                requiresAnimation = {
                    animationRequests: onFlipResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        // After animations, if there's no action, end the turn.
                        if (s.actionRequired) return s;
                        return endTurnCb(s);
                    }
                };
            }
            break;
        }
        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const { sourceCardId, targetLaneIndex, actor } = prev.actionRequired;

            let stateAfterFlip = internalResolveTargetedFlip(prev, targetCardId, null);

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(stateAfterFlip, targetCardId);
                const interruptAction = result.newState.actionRequired;

                console.log(`[Gravity-2] After flip, interruptAction:`, interruptAction?.type || 'none');

                // CRITICAL: If the flipped card triggers an effect, we need to COMPLETE that first,
                // then do the shift ONLY if:
                // 1. The flipped card still exists (not deleted/returned)
                // 2. The source card (Gravity-2) still exists (not deleted/returned)
                if (interruptAction) {
                    // If there's an interrupt, queue the shift action.
                    // The validation (checking if source is still face-up) happens in processQueuedActions.
                    const flippedCardStillExists = findCardOnBoard(result.newState, targetCardId);

                    console.log(`[Gravity-2] Flipped card still exists:`, !!flippedCardStillExists);

                    if (flippedCardStillExists) {
                        // Flipped card still exists - queue the shift to happen AFTER the interrupt
                        // Note: We don't check if source is face-up here because the interrupt hasn't been resolved yet!
                        const shiftAction: ActionRequired = {
                            type: 'gravity_2_shift_after_flip',
                            cardToShiftId: targetCardId,
                            targetLaneIndex,
                            cardOwner: cardInfoBeforeFlip!.owner,
                            sourceCardId,
                            actor,
                        };
                        result.newState.queuedActions = [
                            ...(result.newState.queuedActions || []),
                            shiftAction
                        ];

                        console.log(`[Gravity-2] Queued shift action. Queue length:`, result.newState.queuedActions.length);
                    }
                    // If the flipped card was deleted/returned during the interrupt, don't queue the shift

                    newState = result.newState;
                    requiresTurnEnd = false;
                    break;
                }
                stateAfterFlip = result.newState;
            }

            console.log(`[Gravity-2] No interrupt detected, performing immediate shift`);
            // No interrupt - perform shift immediately
            const shiftResult = internalShiftCard(stateAfterFlip, targetCardId, cardInfoBeforeFlip!.owner, targetLaneIndex, actor);
            newState = shiftResult.newState;

            requiresTurnEnd = !newState.actionRequired;
            break;
        }
        case 'gravity_2_shift_after_flip': {
            // This is the queued shift action after Gravity-2 flip triggered an interrupt
            const { cardToShiftId, targetLaneIndex, cardOwner, actor, sourceCardId } = prev.actionRequired;

            // CRITICAL: Validate that both cards still exist AND source is still face-up before performing the shift!
            const flippedCardStillExists = findCardOnBoard(prev, cardToShiftId);
            const sourceCardInfo = findCardOnBoard(prev, sourceCardId);
            const sourceCardStillValid = sourceCardInfo && sourceCardInfo.card.isFaceUp;

            if (!flippedCardStillExists || !sourceCardStillValid) {
                // One of the cards was deleted/returned, or source was flipped face-down → Cancel the shift
                newState = { ...prev, actionRequired: null };
                requiresTurnEnd = true;
                break;
            }

            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, actor);
            newState = shiftResult.newState;
            requiresTurnEnd = !newState.actionRequired;
            break;
        }
        case 'select_face_down_card_to_reveal_for_light_2': {
            const { sourceCardId, actor } = prev.actionRequired;
            const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
            const cardInfo = findCardOnBoard(prev, targetCardId);
            const cardName = cardInfo ? `${cardInfo.card.protocol}-${cardInfo.card.value}` : 'a card';
            newState = log(prev, actor, `Light-2: ${actorName} reveals ${cardName}.`);
            newState.actionRequired = {
                type: 'prompt_shift_or_flip_for_light_2',
                sourceCardId,
                revealedCardId: targetCardId,
                optional: true,
                actor,
            };
            requiresTurnEnd = false; // Action has a follow-up
            break;
        }
        case 'select_board_card_to_reveal_custom': {
            const { sourceCardId, actor, followUpAction, optional } = prev.actionRequired;
            const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
            const cardInfo = findCardOnBoard(prev, targetCardId);

            if (!cardInfo) return { nextState: prev, requiresTurnEnd: true };

            // CRITICAL: Temporarily flip the card face-up so the player can see it
            const owner = cardInfo.owner;
            const laneIndex = prev[owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            if (laneIndex === -1) return { nextState: prev, requiresTurnEnd: true };

            const lane = [...prev[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === targetCardId);
            if (cardIndex === -1) return { nextState: prev, requiresTurnEnd: true };

            // Flip the card temporarily
            lane[cardIndex] = { ...lane[cardIndex], isFaceUp: true };
            const newLanes = [...prev[owner].lanes];
            newLanes[laneIndex] = lane;

            newState = {
                ...prev,
                [owner]: { ...prev[owner], lanes: newLanes }
            };

            const cardName = `${lane[cardIndex].protocol}-${lane[cardIndex].value}`;
            newState = log(newState, actor, `${actorName} reveals ${cardName}.`);

            // NOTE: No animation here - card is just revealed (temporarily shown), not flipped
            // The visual update happens through state change (isFaceUp: true)

            newState.actionRequired = {
                type: 'prompt_shift_or_flip_board_card_custom',
                sourceCardId,
                revealedCardId: targetCardId,
                followUpAction,
                optional: optional !== false,
                actor,
            };
            requiresTurnEnd = false; // Action has a follow-up
            break;
        }

        default: return { nextState: prev, requiresTurnEnd: true };
    }
    
    // Fallback check: if an action was supposed to be chained but isn't, end the turn.
    if (!requiresAnimation && newState.actionRequired === null) {
        if (newState.queuedActions && newState.queuedActions.length > 0) {
            const newQueue = [...newState.queuedActions];
            const nextAction = newQueue.shift();

            // CRITICAL: execute_remaining_custom_effects should NOT be set as actionRequired!
            // It's an internal action that should be processed by processQueuedActions in phaseManager
            if (nextAction?.type === 'execute_remaining_custom_effects') {
                // Put it back in queue and return with no action required
                // This will trigger turnProgressionCb -> processEndOfAction -> processQueuedActions
                const stateWithQueue = phaseManager.queuePendingCustomEffects(newState);
                return { nextState: { ...stateWithQueue, actionRequired: null, queuedActions: [nextAction, ...newQueue] }, requiresTurnEnd: false };
            }

            // CRITICAL: Validate shift actions before setting as actionRequired!
            // If the source card (e.g., Darkness-1, Gravity-2) was flipped face-down/covered during the interrupt,
            // the shift action must be cancelled.
            if (nextAction?.type === 'shift_flipped_card_optional' || nextAction?.type === 'gravity_2_shift_after_flip') {
                const sourceCardInfo = findCardOnBoard(newState, nextAction.sourceCardId);
                const sourceIsUncovered = isCardUncovered(newState, nextAction.sourceCardId);

                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp || !sourceIsUncovered) {
                    // Source card was deleted/returned/flipped face-down/covered → Cancel the shift
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                    const loggedState = log(newState, nextAction.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);

                    // Continue processing remaining queue
                    if (newQueue.length > 0) {
                        const nextNextAction = newQueue.shift();
                        return { nextState: { ...loggedState, actionRequired: nextNextAction, queuedActions: newQueue }, requiresTurnEnd: false };
                    } else {
                        return { nextState: { ...loggedState, actionRequired: null, queuedActions: [] }, requiresTurnEnd: true };
                    }
                }
            }

            return { nextState: { ...newState, actionRequired: nextAction, queuedActions: newQueue }, requiresTurnEnd: false };
        }
    } else if (!requiresAnimation && newState.actionRequired !== null) {
        requiresTurnEnd = false;
    }


    return { nextState: newState, requiresAnimation, requiresTurnEnd };
};