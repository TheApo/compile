/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, AnimationRequest } from '../../../types';
// FIX: Import `findAndFlipCards` to resolve the missing name error.
import { drawForPlayer, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log } from '../../utils/log';
import { findCardOnBoard, internalResolveTargetedFlip, internalReturnCard, internalShiftCard } from '../helpers/actionUtils';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';

type CardActionResult = {
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
        newState[state.turn].stats.cardsDeleted++;
        
        const onCompleteCallback = (s: GameState, endTurnCb: (s2: GameState) => GameState) => {
            let stateAfterTriggers = checkForHate3Trigger(s, state.turn);

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
            newState = internalResolveTargetedFlip(prev, targetCardId);
            break;
        case 'select_opponent_card_to_flip': { // Darkness-1
            const { actor } = prev.actionRequired;
            newState = internalResolveTargetedFlip(prev, targetCardId, { type: 'shift_flipped_card_optional', cardId: targetCardId, sourceCardId: prev.actionRequired.sourceCardId, optional: true, actor });
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        case 'select_own_covered_card_in_lane_to_flip': // Darkness-2
            newState = internalResolveTargetedFlip(prev, targetCardId);
            break;
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
            newState[actor].stats.cardsDeleted += 2;

            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [
                    { type: 'delete', cardId: targetCardId, owner: cardInfoToDelete.owner },
                    { type: 'delete', cardId: sourceCardId, owner: sourceCardInfo.owner }
                ],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateAfterDelete = checkForHate3Trigger(s, actor); // Trigger for target
                    stateAfterDelete = checkForHate3Trigger(stateAfterDelete, actor); // Trigger for self-delete
                    
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
        case 'select_low_value_card_to_delete': {
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            const actorName = prev.turn === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";
            const cardName = cardInfo.card.isFaceUp ? `${cardInfo.card.protocol}-${cardInfo.card.value}` : 'a face-down card';
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
            newState = log(newState, prev.turn, `${sourceCardName}: ${actorName} deletes ${ownerName} ${cardName}.`);
            newState[prev.turn].stats.cardsDeleted++;

            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    const deletingPlayer = prev.turn;
                    let stateWithTriggers = checkForHate3Trigger(s, deletingPlayer);

                    if (prev.actionRequired?.type === 'select_cards_to_delete') {
                        const remainingCount = prev.actionRequired.count - 1;
                        if (remainingCount > 0) {
                            stateWithTriggers.actionRequired = {
                                ...prev.actionRequired,
                                count: remainingCount,
                                disallowedIds: [...prev.actionRequired.disallowedIds, targetCardId]
                            };
                            return stateWithTriggers; // Don't end turn yet
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
        case 'select_card_from_other_lanes_to_delete': {
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            let cardLaneIndex = -1;
            for (let i = 0; i < prev[cardInfo.owner].lanes.length; i++) {
                if (prev[cardInfo.owner].lanes[i].some(c => c.id === targetCardId)) {
                    cardLaneIndex = i;
                    break;
                }
            }
            if (cardLaneIndex === -1) return { nextState: prev };

            const actorName = prev.turn === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";
            const cardName = cardInfo.card.isFaceUp ? `${cardInfo.card.protocol}-${cardInfo.card.value}` : 'a face-down card';
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
            newState = log(newState, prev.turn, `${sourceCardName}: ${actorName} deletes ${ownerName} ${cardName}.`);
            newState[prev.turn].stats.cardsDeleted++;

            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    let stateWithTriggers = checkForHate3Trigger(s, prev.turn);
                    const currentAction = prev.actionRequired;
                    if (currentAction?.type !== 'select_card_from_other_lanes_to_delete') return endTurnCb(stateWithTriggers);

                    const remainingCount = currentAction.count - 1;
                    if (remainingCount > 0) {
                        return {
                            ...stateWithTriggers,
                            actionRequired: {
                                ...currentAction,
                                lanesSelected: [...currentAction.lanesSelected, cardLaneIndex],
                                count: remainingCount
                            }
                        };
                    } else {
                        let stateWithActionCleared = { ...stateWithTriggers, actionRequired: null };
                        
                        // Action is done, check queue
                        if (stateWithActionCleared.queuedActions && stateWithActionCleared.queuedActions.length > 0) {
                            const newQueue = [...stateWithActionCleared.queuedActions];
                            const nextAction = newQueue.shift();
                            return { ...stateWithActionCleared, actionRequired: nextAction, queuedActions: newQueue };
                        }

                        return endTurnCb(stateWithActionCleared);
                    }
                }
            };
            requiresTurnEnd = false;
            break;
        }
        case 'plague_4_opponent_delete': {
            const { actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };
            const opponentOfActor = actor === 'player' ? 'opponent' : 'player';
            // The person who needs to act is the opponent of the current turn player.
            // The card they target must be their own and face-down.
            if (cardInfo.owner === opponentOfActor && !cardInfo.card.isFaceUp) {
                const actorName = opponentOfActor === 'player' ? 'Player' : 'Opponent';
                const cardName = `${cardInfo.card.protocol}-${cardInfo.card.value}`; // Opponent knows their card
                newState = log(newState, opponentOfActor, `Plague-4: ${actorName} deletes their face-down card (${cardName}).`);
                newState[opponentOfActor].stats.cardsDeleted++;
                
                newState.actionRequired = null;
                requiresAnimation = {
                    animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                    onCompleteCallback: (s, endTurnCb) => {
                        // The optional flip is for the player whose card triggered the effect.
                        return {
                            ...s,
                            actionRequired: {
                                type: 'plague_4_player_flip_optional',
                                sourceCardId: prev.actionRequired!.sourceCardId,
                                optional: true,
                                actor,
                            }
                        };
                    }
                };
            }
            requiresTurnEnd = false;
            break;
        }
        case 'select_any_other_card_to_flip': {
            const { draws, sourceCardId } = prev.actionRequired;
            newState = internalResolveTargetedFlip(prev, targetCardId);
            if (draws > 0) {
                const sourceCardInfo = findCardOnBoard(newState, sourceCardId);
                const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
                newState = log(newState, newState.turn, `${sourceCardName}: Draw ${draws} card(s).`);
                newState = drawForPlayer(newState, newState.turn, draws);
            }
            break;
        }
        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            newState = internalReturnCard(prev, targetCardId);
            if(prev.actionRequired.type === 'select_opponent_card_to_return' && prev.actionRequired.sourceCardId) {
                const psychic4CardId = prev.actionRequired.sourceCardId;
                newState = log(newState, prev.turn, `Psychic-4: Flipping itself.`);
                newState = findAndFlipCards(new Set([psychic4CardId]), newState);
                newState.animationState = { type: 'flipCard', cardId: psychic4CardId };
            }
            break;
        }
        case 'select_card_to_flip_for_fire_3':
            newState = internalResolveTargetedFlip(prev, targetCardId);
            break;
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
                newState = internalShiftCard(prev, targetCardId, cardInfo.owner, sourceLaneIndex, prev.turn);
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
            stateAfterLog[actor].stats.cardsFlipped++;
            let stateAfterFlip = findAndFlipCards(new Set([targetCardId]), stateAfterLog);
            stateAfterFlip.animationState = { type: 'flipCard', cardId: targetCardId };
            
            newState = internalShiftCard(stateAfterFlip, targetCardId, cardInfo.owner, targetLaneIndex, actor);
            newState.actionRequired = null;
            break;
        }
        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex, actor } = prev.actionRequired;
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo || cardInfo.card.isFaceUp) { // Target must be face-down
                return { nextState: prev };
            }
            newState = internalShiftCard(prev, targetCardId, cardInfo.owner, targetLaneIndex, actor);
            break;
        }
        case 'select_any_card_to_flip': {
            const remainingFlips = prev.actionRequired.count - 1;
            let nextAction: ActionRequired = null;
            if (remainingFlips > 0) {
                nextAction = { ...prev.actionRequired, count: remainingFlips };
            }
            newState = internalResolveTargetedFlip(prev, targetCardId, nextAction);
            if (newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            } else {
                requiresTurnEnd = remainingFlips <= 0;
            }
            break;
        }
        case 'select_any_card_to_flip_optional':
        case 'select_any_face_down_card_to_flip_optional':
            newState = internalResolveTargetedFlip(prev, targetCardId);
            break;
        case 'select_card_to_flip_for_light_0': {
            const cardBeforeFlip = findCardOnBoard(prev, targetCardId)?.card;
            if (!cardBeforeFlip) return { nextState: prev };

            const stateAfterFlip = internalResolveTargetedFlip(prev, targetCardId);
            const cardAfterFlip = findCardOnBoard(stateAfterFlip, targetCardId)!.card;

            const valueToDraw = cardAfterFlip.isFaceUp ? cardAfterFlip.value : 2;
            newState = drawForPlayer(stateAfterFlip, prev.turn, valueToDraw);
            newState = log(newState, prev.turn, `Light-0: Drawing ${valueToDraw} card(s).`);
            break;
        }
        case 'select_face_down_card_to_reveal_for_light_2': {
            const { actor } = prev.actionRequired;
            newState = internalResolveTargetedFlip(prev, targetCardId, {
                type: 'prompt_shift_or_flip_for_light_2',
                sourceCardId: prev.actionRequired.sourceCardId,
                revealedCardId: targetCardId,
                optional: true,
                actor,
            });
            requiresTurnEnd = false;
            break;
        }
        case 'select_any_other_card_to_flip_for_water_0': {
            const stateAfterFirstFlip = internalResolveTargetedFlip(prev, targetCardId);
            const water0CardId = prev.actionRequired.sourceCardId;
            newState = internalResolveTargetedFlip(stateAfterFirstFlip, water0CardId);
            newState = log(newState, prev.turn, `Water-0: Flips itself.`);
            break;
        }
        case 'select_own_card_to_return_for_water_4': {
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (cardInfo && cardInfo.owner === prev.turn) {
                newState = internalReturnCard(prev, targetCardId);
            }
            break;
        }
        default: return { nextState: prev };
    }

    // If an action was just resolved and it resulted in a new action or a queued action, don't end the turn.
    if (newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
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
    return internalReturnCard(prevState, cardId);
}