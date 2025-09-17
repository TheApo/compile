/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, AnimationRequest, EffectResult } from '../../../types';
import { drawForPlayer, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log } from '../../utils/log';
import { findCardOnBoard, internalResolveTargetedFlip, internalReturnCard, internalShiftCard, handleUncoverEffect, countValidDeleteTargets } from '../helpers/actionUtils';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
import { executeOnPlayEffect } from '../../effectExecutor';

type CardActionResult = {
    nextState: GameState;
    requiresAnimation?: {
        animationRequests: AnimationRequest[];
        onCompleteCallback: (s: GameState, endTurnCb: (s2: GameState) => GameState) => GameState;
    } | null;
    requiresTurnEnd?: boolean;
};

/**
 * Handles the logic for triggering a card's on-play effect when it's flipped from face-down to face-up.
 * This respects the rule that middle-box effects only trigger if the card is uncovered.
 */
const handleOnFlipToFaceUp = (state: GameState, cardId: string): EffectResult => {
    const cardInfo = findCardOnBoard(state, cardId);
    if (!cardInfo) return { newState: state };

    const { card, owner } = cardInfo;
    const laneIndex = state[owner].lanes.findIndex(l => l.some(c => c.id === card.id));
    if (laneIndex === -1) return { newState: state };

    // executeOnPlayEffect internally handles the "uncovered" check
    return executeOnPlayEffect(card, laneIndex, state, owner);
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

            if (action && 'count' in action && (action as any).count > 1) {
                const remainingCount = (action as any).count - 1;
                stateAfterTriggers.actionRequired = { ...(action as any), count: remainingCount };
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
        case 'select_opponent_face_up_card_to_flip':
        case 'select_own_face_up_covered_card_to_flip':
        case 'select_covered_card_in_line_to_flip_optional':
        case 'select_any_card_to_flip_optional':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_card_to_flip_for_fire_3': {
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
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            const actor = prev.turn;
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
                    const deletingPlayer = prev.turn;
                    let stateWithTriggers = checkForHate3Trigger(s, deletingPlayer);
                    let uncoverResult: EffectResult | null = null;
        
                    if (wasTopCard) {
                        uncoverResult = handleUncoverEffect(stateWithTriggers, cardInfo.owner, laneIndex);
                        stateWithTriggers = uncoverResult.newState;
                    }
        
                    // If the uncover effect created an interrupting action, queue the rest of the original action.
                    if (uncoverResult && uncoverResult.newState.actionRequired) {
                        const currentAction = prev.actionRequired;
                        let remainingCount = 0;
                        
                        if (currentAction?.type === 'select_cards_to_delete') {
                            remainingCount = currentAction.count - 1;
                            if (remainingCount > 0) {
                                const queuedAction: ActionRequired = {
                                    ...currentAction,
                                    count: remainingCount,
                                    disallowedIds: [...currentAction.disallowedIds, targetCardId]
                                };
                                stateWithTriggers.queuedActions = [queuedAction, ...(stateWithTriggers.queuedActions || [])];
                            }
                        } else if (currentAction?.type === 'select_card_from_other_lanes_to_delete') {
                            remainingCount = currentAction.count - 1;
                            if (remainingCount > 0) {
                                const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                                const queuedAction: ActionRequired = {
                                    ...currentAction,
                                    lanesSelected: [...currentAction.lanesSelected, cardLaneIndex],
                                    count: remainingCount
                                };
                                stateWithTriggers.queuedActions = [queuedAction, ...(stateWithTriggers.queuedActions || [])];
                            }
                        }
                        
                        return stateWithTriggers; // Return with the new interrupting action.
                    }
        
                    // No interrupt, continue processing the original action.
                    const currentAction = prev.actionRequired;
                    if (currentAction?.type === 'select_cards_to_delete') {
                        const remainingCount = currentAction.count - 1;
                        if (remainingCount > 0) {
                            const newDisallowedIds = [...currentAction.disallowedIds, targetCardId];
                            if (countValidDeleteTargets(s, newDisallowedIds) > 0) {
                                stateWithTriggers.actionRequired = {
                                    ...currentAction,
                                    count: remainingCount,
                                    disallowedIds: newDisallowedIds,
                                };
                                return stateWithTriggers;
                            } else {
                                stateWithTriggers = log(stateWithTriggers, prev.turn, `No more valid targets to delete. Effect ends.`);
                                stateWithTriggers.actionRequired = null;
                            }
                        }
                    } else if (currentAction?.type === 'select_card_from_other_lanes_to_delete') {
                        const remainingCount = currentAction.count - 1;
                        if (remainingCount > 0) {
                            const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                            const newLanesSelected = [...currentAction.lanesSelected, cardLaneIndex];
                            const allowedLanes = [0, 1, 2].filter(i => i !== currentAction.disallowedLaneIndex && !newLanesSelected.includes(i));
                            const areThereTargetsInRemainingLanes = allowedLanes.some(laneIdx => s.player.lanes[laneIdx].length > 0 || s.opponent.lanes[laneIdx].length > 0);

                            if (areThereTargetsInRemainingLanes) {
                                stateWithTriggers.actionRequired = {
                                    ...currentAction,
                                    lanesSelected: newLanesSelected,
                                    count: remainingCount
                                };
                                return stateWithTriggers;
                            } else {
                                stateWithTriggers = log(stateWithTriggers, prev.turn, `No more valid targets to delete. Effect ends.`);
                                stateWithTriggers.actionRequired = null;
                            }
                        }
                    }

                    // Action is done, check queue before ending turn
                    stateWithTriggers.actionRequired = null;
                    if (stateWithTriggers.queuedActions && stateWithTriggers.queuedActions.length > 0) {
                        const newQueue = [...stateWithTriggers.queuedActions];
                        const nextAction = newQueue.shift();
                        return { ...stateWithTriggers, actionRequired: nextAction, queuedActions: newQueue };
                    }
        
                    return endTurnCb(stateWithTriggers);
                }
            };
            requiresTurnEnd = false;
            break;
        }
        case 'plague_4_opponent_delete': {
            const { actor, sourceCardId } = prev.actionRequired; // The actor is the player who must delete a card.
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            // The actor must delete one of THEIR OWN face-down cards.
            if (cardInfo.owner === actor && !cardInfo.card.isFaceUp) {
                const actorName = actor === 'player' ? 'Player' : 'Opponent';
                const cardName = `${cardInfo.card.protocol}-${cardInfo.card.value}`;
                newState = log(newState, actor, `Plague-4: ${actorName} deletes their face-down card (${cardName}).`);
                
                const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
                const newPlayerState = { ...newState[actor], stats: newStats };
                newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

                const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                const wasTopCard = prev[cardInfo.owner].lanes[laneIndex].length > 0 && prev[cardInfo.owner].lanes[laneIndex][prev[cardInfo.owner].lanes[laneIndex].length - 1].id === targetCardId;

                newState.actionRequired = null;
                requiresAnimation = {
                    animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                    onCompleteCallback: (s, endTurnCb) => {
                        let stateAfterDelete = s;
                        if (wasTopCard) {
                            const uncoverResult = handleUncoverEffect(stateAfterDelete, cardInfo.owner, laneIndex);
                            stateAfterDelete = uncoverResult.newState;
                        }
                        const originalTurnPlayer = prev.turn; // The one who owns Plague-4
                        // The optional flip is for the player whose card triggered the effect.
                        return {
                            ...stateAfterDelete,
                            actionRequired: {
                                type: 'plague_4_player_flip_optional',
                                sourceCardId: sourceCardId,
                                optional: true,
                                actor: originalTurnPlayer,
                            }
                        };
                    }
                };
            }
            requiresTurnEnd = false; // Turn doesn't end here, it goes to the flip prompt.
            break;
        }
        case 'select_any_other_card_to_flip': {
            const { draws, sourceCardId } = prev.actionRequired;
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

            if (draws > 0) {
                const sourceCardInfo = findCardOnBoard(newState, sourceCardId);
                const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
                newState = log(newState, newState.turn, `${sourceCardName}: Draw ${draws} card(s).`);
                newState = drawForPlayer(newState, newState.turn, draws);
            }

            if(newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            }
            break;
        }
        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            const returnResult = internalReturnCard(prev, targetCardId);
            newState = returnResult.newState;
            if (returnResult.animationRequests) {
                requiresAnimation = {
                    animationRequests: returnResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
                };
            }

            if(prev.actionRequired.type === 'select_opponent_card_to_return' && prev.actionRequired.sourceCardId) {
                const psychic4CardId = prev.actionRequired.sourceCardId;
                newState = log(newState, prev.turn, `Psychic-4: Flipping itself.`);
                newState = findAndFlipCards(new Set([psychic4CardId]), newState);
                newState.animationState = { type: 'flipCard', cardId: psychic4CardId };
            }
            break;
        }
        case 'select_card_to_shift_for_gravity_1': {
            const { sourceLaneIndex, sourceCardId, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            let originalLaneIndex = -1;
            for (let i = 0; i < prev[cardInfo.owner].lanes.length; i++) {
                if (prev[cardInfo.owner].lanes[i].some(c => c.id === targetCardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }

            if (originalLaneIndex === sourceLaneIndex) {
                // Card is FROM the source lane, now needs a target lane.
                newState.actionRequired = {
                    type: 'select_lane_for_shift',
                    cardToShiftId: targetCardId,
                    cardOwner: cardInfo.owner,
                    originalLaneIndex: sourceLaneIndex,
                    sourceCardId: sourceCardId,
                    actor,
                };
                requiresTurnEnd = false;
            } else {
                // Card is TO the source lane, execute immediately.
                const shiftResult = internalShiftCard(prev, targetCardId, cardInfo.owner, sourceLaneIndex, prev.turn);
                newState = shiftResult.newState;
                if (shiftResult.animationRequests) {
                    requiresAnimation = {
                        animationRequests: shiftResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
                    };
                }
            }
            break;
        }
        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const { targetLaneIndex, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            // Manual log and flip to use the correct actor
            const { card, owner } = cardInfo;
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const ownerName = owner === 'player' ? "Player's" : "Opponent's";
            const faceDirection = card.isFaceUp ? "face-down" : "face-up";
            const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : `a face-down card`;
            let stateAfterLog = log(prev, actor, `${actorName} flips ${ownerName} ${cardName} ${faceDirection}.`);
            
            const newStats = { ...stateAfterLog.stats[actor], cardsFlipped: stateAfterLog.stats[actor].cardsFlipped + 1 };
            const newPlayerState = { ...stateAfterLog[actor], stats: newStats };
            stateAfterLog = { ...stateAfterLog, [actor]: newPlayerState, stats: { ...stateAfterLog.stats, [actor]: newStats } };

            let stateAfterFlip = findAndFlipCards(new Set([targetCardId]), stateAfterLog);
            stateAfterFlip.animationState = { type: 'flipCard', cardId: targetCardId };
            
            const shiftResult = internalShiftCard(stateAfterFlip, targetCardId, cardInfo.owner, targetLaneIndex, actor);
            newState = shiftResult.newState;
            if (shiftResult.animationRequests) {
                requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
                };
            }
            newState.actionRequired = null;
            break;
        }
        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo || cardInfo.card.isFaceUp) { // Target must be face-down
                return { nextState: prev };
            }
            const shiftResult = internalShiftCard(prev, targetCardId, cardInfo.owner, targetLaneIndex, actor);
            newState = shiftResult.newState;
            if (shiftResult.animationRequests) {
                requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
                };
            }
            break;
        }
        case 'select_any_card_to_flip': {
            const remainingFlips = prev.actionRequired.count - 1;
            let nextAction: ActionRequired = null;
            if (remainingFlips > 0) {
                nextAction = { ...prev.actionRequired, count: remainingFlips };
            }

            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            newState = internalResolveTargetedFlip(prev, targetCardId, nextAction);
        
            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                const onPlayAction = result.newState.actionRequired;
                
                // If the on-flip effect created a new action, we must prioritize it
                // and queue the remaining flips.
                if (onPlayAction && onPlayAction !== nextAction) {
                    result.newState.actionRequired = onPlayAction;
                    if (nextAction) {
                        result.newState.queuedActions = [...(result.newState.queuedActions || []), nextAction];
                    }
                }
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

            if (newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            } else {
                requiresTurnEnd = remainingFlips <= 0;
            }
            break;
        }
        case 'select_card_to_flip_for_light_0': {
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            if (!cardInfoBeforeFlip) return { nextState: prev };
        
            let stateAfterFlip = internalResolveTargetedFlip(prev, targetCardId);
        
            if (!cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(stateAfterFlip, targetCardId);
                stateAfterFlip = result.newState;
                if (result.animationRequests) {
                    // Light-0's draw needs to happen *after* any potential on-flip animation.
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            const cardAfterAnims = findCardOnBoard(s, targetCardId)!.card;
                            const valueToDraw = cardAfterAnims.isFaceUp ? cardAfterAnims.value : 2;
                            const stateAfterDraw = drawForPlayer(s, s.turn, valueToDraw);
                            const stateWithLog = log(stateAfterDraw, s.turn, `Light-0: Drawing ${valueToDraw} card(s).`);
                            return endTurnCb(stateWithLog);
                        }
                    };
                }
            }

            // If there were animations, the draw happens in the callback. If not, do it now.
            if (!requiresAnimation) {
                const cardAfterFlip = findCardOnBoard(stateAfterFlip, targetCardId)!.card;
                const valueToDraw = cardAfterFlip.isFaceUp ? cardAfterFlip.value : 2;
                newState = drawForPlayer(stateAfterFlip, prev.turn, valueToDraw);
                newState = log(newState, prev.turn, `Light-0: Drawing ${valueToDraw} card(s).`);
            } else {
                newState = stateAfterFlip;
            }

            if(newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            }
            break;
        }
        case 'select_face_down_card_to_reveal_for_light_2': {
            const { actor } = prev.actionRequired;
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const nextAction: ActionRequired = {
                type: 'prompt_shift_or_flip_for_light_2',
                sourceCardId: prev.actionRequired.sourceCardId,
                revealedCardId: targetCardId,
                optional: true,
                actor,
            };

            newState = internalResolveTargetedFlip(prev, targetCardId, nextAction);
        
            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                newState = result.newState;
                if (result.animationRequests) {
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s) => s
                    };
                }
            }
            requiresTurnEnd = false;
            break;
        }
        case 'select_any_other_card_to_flip_for_water_0': {
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            let stateAfterFirstFlip = internalResolveTargetedFlip(prev, targetCardId);

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(stateAfterFirstFlip, targetCardId);
                stateAfterFirstFlip = result.newState;
                if (result.animationRequests) {
                    // This case gets complex. For now, we assume no animations from on-flip.
                }
            }

            const water0CardId = prev.actionRequired.sourceCardId;
            newState = internalResolveTargetedFlip(stateAfterFirstFlip, water0CardId);
            newState = log(newState, prev.turn, `Water-0: Flips itself.`);
            
            if(newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            }
            break;
        }
        case 'select_own_card_to_return_for_water_4': {
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (cardInfo && cardInfo.owner === prev.turn) {
                const returnResult = internalReturnCard(prev, targetCardId);
                newState = returnResult.newState;
                if (returnResult.animationRequests) {
                    requiresAnimation = {
                        animationRequests: returnResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
                    };
                }
            }
            break;
        }
        default: return { nextState: prev };
    }

    // If an action was just resolved and it resulted in a new action or a queued action, don't end the turn.
    if (!requiresAnimation && (newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0))) {
        requiresTurnEnd = false;
    }

    return { nextState: newState, requiresAnimation, requiresTurnEnd };
};

export const flipCard = (prevState: GameState, cardId: string): GameState => {
    const action = prevState.actionRequired;
    if (action?.type === 'select_opponent_card_to_flip') { // Darkness-1 context
        const { actor } = action;
        const stateAfterFlip = internalResolveTargetedFlip(prevState, cardId, { type: 'shift_flipped_card_optional', cardId: cardId, sourceCardId: action.sourceCardId, optional: true, actor });
        return stateAfterFlip;
    }

    const stateAfterFlip = internalResolveTargetedFlip(prevState, cardId);
    return stateAfterFlip;
}

export const returnCard = (prevState: GameState, cardId: string): GameState => {
    const { newState } = internalReturnCard(prevState, cardId);
    return newState;
}