/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, AnimationRequest, EffectResult } from '../../../types';
import { drawForPlayer, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log } from '../../utils/log';
import { findCardOnBoard, internalResolveTargetedFlip, internalReturnCard, internalShiftCard, handleUncoverEffect, countValidDeleteTargets, handleOnFlipToFaceUp } from '../helpers/actionUtils';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
import { getEffectiveCardValue } from '../stateManager';

export type CardActionResult = {
    nextState: GameState;
    requiresAnimation?: {
        animationRequests: AnimationRequest[];
        onCompleteCallback: (s: GameState, endTurnCb: (s2: GameState) => GameState) => GameState;
    } | null;
    requiresTurnEnd?: boolean;
};

function handleMetal6Flip(state: GameState, targetCardId: string, action: ActionRequired): CardActionResult | null {
    const cardInfo = findCardOnBoard(state, targetCardId);
    if (cardInfo && cardInfo.card.protocol === 'Metal' && cardInfo.card.value === 6) {
        let newState = log(state, state.turn, `Metal-6 effect triggers on flip: deleting itself.`);
        
        const actor = state.turn;
        const newStats = { ...state.stats[actor], cardsDeleted: state.stats[actor].cardsDeleted + 1 };
        const newPlayerState = { ...state[actor], stats: newStats };
        newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };
        
        const onCompleteCallback = (s: GameState, endTurnCb: (s2: GameState) => GameState) => {
            let stateAfterTriggers = checkForHate3Trigger(s, s.turn);

            if (action?.type === 'select_card_to_flip_for_light_0') {
                const cardValue = 6; // Metal-6 value in trash is always its face-up value
                stateAfterTriggers = log(stateAfterTriggers, action.actor, `Light-0: Drawing ${cardValue} card(s) after Metal-6 was deleted.`);
                stateAfterTriggers = drawForPlayer(stateAfterTriggers, action.actor, cardValue);
                stateAfterTriggers.actionRequired = null; // Light-0 action is complete.
                if (stateAfterTriggers.actionRequired) return stateAfterTriggers; // Check for triggers from drawing
                return endTurnCb(stateAfterTriggers);
            }

            if (action?.type === 'select_any_other_card_to_flip_for_water_0') {
                // The self-flip is already in the queue, so we don't need to add it again.
                // We just need to ensure the turn proceeds correctly after this animation.
                stateAfterTriggers.actionRequired = null;
                return endTurnCb(stateAfterTriggers);
            }
            
            // FIX: Use a proper type guard for 'count' property and remove 'as any' cast.
            if (action && 'count' in action && action.count > 1) {
                const remainingCount = action.count - 1;
                stateAfterTriggers.actionRequired = { ...action, count: remainingCount };
                return stateAfterTriggers;
            }
            stateAfterTriggers.actionRequired = null;

            if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                const newQueue = [...stateAfterTriggers.queuedActions];
                const nextAction = newQueue.shift();
                return { ...stateAfterTriggers, actionRequired: nextAction, queuedActions: newQueue };
            }
            return endTurnCb(stateAfterTriggers);
        };

        return {
            nextState: { ...state, actionRequired: null },
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
        case 'select_any_other_card_to_flip':
        case 'select_opponent_face_up_card_to_flip':
        case 'select_own_face_up_covered_card_to_flip':
        case 'select_covered_card_in_line_to_flip_optional':
        case 'select_any_card_to_flip_optional':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_card_to_flip_for_fire_3': {
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const draws = 'draws' in prev.actionRequired ? prev.actionRequired.draws : 0;

            newState = internalResolveTargetedFlip(prev, targetCardId);

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
        
            if(newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            }
            break;
        }
        case 'select_opponent_card_to_flip': { // Darkness-1
            const { actor } = prev.actionRequired;
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const nextAction: ActionRequired = { type: 'shift_flipped_card_optional', cardId: targetCardId, sourceCardId: prev.actionRequired.sourceCardId, optional: true, actor };
            newState = internalResolveTargetedFlip(prev, targetCardId, nextAction);
            
            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                // The new action from on-play will overwrite the shift prompt. This is intended.
                newState = result.newState; 
                if (result.animationRequests) {
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s) => s // Just return the state, let the new action take over.
                    };
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_card_to_shift_for_gravity_1':
        case 'shift_flipped_card_optional':
        case 'select_opponent_covered_card_to_shift':
        case 'select_face_down_card_to_shift_for_darkness_4':
        case 'select_any_opponent_card_to_shift': {
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
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.turn,
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
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.turn,
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
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.turn,
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
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.turn,
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

            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [
                    { type: 'delete', cardId: targetCardId, owner: cardInfoToDelete.owner },
                    { type: 'delete', cardId: sourceCardId, owner: sourceCardInfo.owner }
                ],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateAfterDelete = checkForHate3Trigger(s, actor); // Trigger for target
                    stateAfterDelete = checkForHate3Trigger(stateAfterDelete, actor); // Trigger for self-delete
                    
                    // --- Uncover Logic Execution ---
                    if (targetWasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateAfterDelete, cardInfoToDelete.owner, targetLaneIndex);
                        stateAfterDelete = uncoverResult.newState;
                    }
                    if (sourceWasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateAfterDelete, sourceCardInfo.owner, sourceLaneIndex);
                        stateAfterDelete = uncoverResult.newState;
                    }

                    stateAfterDelete.actionRequired = null;
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
        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete':
        case 'select_low_value_card_to_delete':
        case 'select_card_from_other_lanes_to_delete': {
            // Rule: An effect is cancelled if its source card is no longer active (face-up on the board).
            const { sourceCardId, actor } = prev.actionRequired;
            const sourceCardInfoCheck = findCardOnBoard(prev, sourceCardId);
            if (!sourceCardInfoCheck || !sourceCardInfoCheck.card.isFaceUp) {
                const cardName = sourceCardInfoCheck ? `${sourceCardInfoCheck.card.protocol}-${sourceCardInfoCheck.card.value}` : 'the source card';
                newState = log(prev, actor, `Effect from ${cardName} was cancelled because the source is no longer active.`);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";
            const cardName = cardInfo.card.isFaceUp ? `${cardInfo.card.protocol}-${cardInfo.card.value}` : 'a face-down card';
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
            newState = log(newState, actor, `${sourceCardName}: ${actorName} deletes ${ownerName} ${cardName}.`);
            
            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };
            
            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    const deletingPlayer = prev.actionRequired.actor;
                    const originalAction = prev.actionRequired;

                    // 1. Apply post-animation triggers
                    let stateAfterTriggers = checkForHate3Trigger(s, deletingPlayer);

                    // 2. Determine the next step of the ORIGINAL multi-step delete action BEFORE uncovering
                    let nextStepOfDeleteAction: ActionRequired = null;
                    const sourceCardInfo = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);

                    if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                        if (originalAction.type === 'select_cards_to_delete' && originalAction.count > 1) {
                             nextStepOfDeleteAction = {
                                type: 'select_cards_to_delete',
                                count: originalAction.count - 1,
                                sourceCardId: originalAction.sourceCardId,
                                disallowedIds: [...originalAction.disallowedIds, targetCardId],
                                actor: originalAction.actor
                            };
                        } else if (originalAction.type === 'select_card_from_other_lanes_to_delete' && originalAction.count > 1) {
                            const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                            nextStepOfDeleteAction = {
                                type: 'select_card_from_other_lanes_to_delete',
                                count: originalAction.count - 1,
                                sourceCardId: originalAction.sourceCardId,
                                disallowedLaneIndex: originalAction.disallowedLaneIndex,
                                lanesSelected: [...originalAction.lanesSelected, cardLaneIndex],
                                actor: originalAction.actor
                            };
                        }
                    } else if ('count' in originalAction && originalAction.count > 1) {
                        const sourceName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                        stateAfterTriggers = log(stateAfterTriggers, originalAction.actor, `Remaining deletes from ${sourceName} were cancelled because the source is no longer active.`);
                    }

                    // 3. Handle uncovering with the pre-computed next delete action
                    if (wasTopCard) {
                        const stateBeforeUncover = stateAfterTriggers;
                        const uncoverResult = handleUncoverEffect(stateBeforeUncover, cardInfo.owner, laneIndex);

                        // Check if the uncover created an interrupt (turn switch)
                        const uncoverCreatedInterrupt = uncoverResult.newState._interruptedTurn !== undefined;

                        // Merge queues and preserve the next delete step
                        const mergedQueue = [
                            ...(stateBeforeUncover.queuedActions || []),
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
                        // Pop the first queued action and make it the current action
                        const queueCopy = [...stateAfterTriggers.queuedActions];
                        const nextAction = queueCopy.shift();
                        return {
                            ...stateAfterTriggers,
                            actionRequired: nextAction,
                            queuedActions: queueCopy
                        };
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
            
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateWithTriggers = checkForHate3Trigger(s, actor);
                    if (wasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateWithTriggers, cardInfo.owner, laneIndex);
                        stateWithTriggers = uncoverResult.newState;
                    }

                    const nextAction: ActionRequired = {
                        type: 'plague_4_player_flip_optional',
                        sourceCardId: prev.actionRequired.sourceCardId,
                        optional: true,
                        actor: prev.turn, // The prompt is for the turn player
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

            // Manually process the self-flip.
            const sourceCardInfo = findCardOnBoard(stateAfterReturn, sourceCardId);
            if (sourceCardInfo) {
                const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                stateAfterReturn = log(stateAfterReturn, actor, `${cardName}: Flips itself.`);
                stateAfterReturn = findAndFlipCards(new Set([sourceCardId]), stateAfterReturn);
                stateAfterReturn.animationState = { type: 'flipCard', cardId: sourceCardId };
            }

            newState = stateAfterReturn;
            requiresTurnEnd = true; // The multi-step action is fully complete.

            if (result.animationRequests) {
                requiresAnimation = {
                    animationRequests: result.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.actionRequired) return s; // An interrupt (e.g., from uncover) happened.
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
                        if (s.actionRequired) return s;
                        return endTurnCb(s);
                    }
                };
            }
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
        
            // 3. Perform the self-flip, but only if the on-flip effect didn't interrupt.
            // And only if Water-0 is still active.
            if (!stateAfterInterrupt.actionRequired) {
                const sourceCardInfo = findCardOnBoard(stateAfterInterrupt, sourceCardId);
                if (sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    stateAfterInterrupt = log(stateAfterInterrupt, actor, `${cardName}: Flips itself.`);
                    stateAfterInterrupt = findAndFlipCards(new Set([sourceCardId]), stateAfterInterrupt);
                    // Overwrite animation state to show the second flip
                    stateAfterInterrupt.animationState = { type: 'flipCard', cardId: sourceCardId };
                } else {
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Water-0';
                    stateAfterInterrupt = log(stateAfterInterrupt, actor, `The self-flip effect from ${cardName} was cancelled because the source is no longer active.`);
                }
            }
        
            newState = stateAfterInterrupt;
        
            // If the interrupt created a new action, we stop and wait for it. Otherwise, the turn ends.
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
                stateAfterFlip = result.newState;
            }

            const shiftResult = internalShiftCard(stateAfterFlip, targetCardId, cardInfoBeforeFlip!.owner, targetLaneIndex, actor);
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

        default: return { nextState: prev, requiresTurnEnd: true };
    }
    
    // Fallback check: if an action was supposed to be chained but isn't, end the turn.
    if (!requiresAnimation && newState.actionRequired === null) {
        if (newState.queuedActions && newState.queuedActions.length > 0) {
            const newQueue = [...newState.queuedActions];
            const nextAction = newQueue.shift();
            return { nextState: { ...newState, actionRequired: nextAction, queuedActions: newQueue }, requiresTurnEnd: false };
        }
    } else if (!requiresAnimation && newState.actionRequired !== null) {
        requiresTurnEnd = false;
    }


    return { nextState: newState, requiresAnimation, requiresTurnEnd };
};