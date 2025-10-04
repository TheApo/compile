/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, AnimationRequest, Player, PlayedCard, EffectResult, ActionRequired } from '../../../types';
import { drawCards as drawCardsUtil, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log } from '../../utils/log';
import { findCardOnBoard, internalShiftCard } from '../helpers/actionUtils';
import { getEffectiveCardValue, recalculateAllLaneValues } from '../stateManager';
import { playCard } from './playResolver';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
import { effectRegistryOnCover } from '../../effects/effectRegistryOnCover';
import { executeOnCoverEffect } from '../../effectExecutor';

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

            // CRITICAL VALIDATION for Gravity-1: "Shift 1 card either to or from this line"
            // The shift must involve the Gravity-1's lane (either as source OR destination)
            const sourceCard = findCardOnBoard(prev, sourceCardId);
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

            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, actor);
            newState = shiftResult.newState;
            if (shiftResult.animationRequests) {
                // FIX: Implemented `onCompleteCallback` to correctly handle post-shift effects like Speed-3's self-flip after animations.
                requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        let finalState = s;
                        if (sourceEffect === 'speed_3_end') {
                            const speed3CardId = prev.actionRequired.sourceCardId;
                            finalState = log(finalState, actor, `Speed-3: Flipping itself after shifting a card.`);
                            finalState = findAndFlipCards(new Set([speed3CardId]), finalState);
                            finalState.animationState = { type: 'flipCard', cardId: speed3CardId };
                        }
                        return endTurnCb(finalState);
                    }
                };
            } else {
                 if (sourceEffect === 'speed_3_end') {
                    const speed3CardId = prev.actionRequired.sourceCardId;
                    newState = log(newState, actor, `Speed-3: Flipping itself after shifting a card.`);
                    newState = findAndFlipCards(new Set([speed3CardId]), newState);
                    newState.animationState = { type: 'flipCard', cardId: speed3CardId };
                }
            }
            break;
        }
        case 'shift_flipped_card_optional': {
            const cardToShiftId = prev.actionRequired.cardId;
            const cardOwner: Player = prev.turn === 'player' ? 'opponent' : 'player';
            const shiftResult = internalShiftCard(prev, cardToShiftId, cardOwner, targetLaneIndex, prev.turn);
            newState = shiftResult.newState;
            if (shiftResult.animationRequests) {
                 // FIX: Implemented `onCompleteCallback` for consistency, ensuring any post-animation logic can be handled.
                 requiresAnimation = {
                    animationRequests: shiftResult.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
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
                const opponentId = actor === 'player' ? 'opponent' : 'player';
                const opponentHasPsychic1 = prev[opponentId].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
                canPlayFaceUp = (playerHasSpiritOne || cardInHand.protocol === prev[actor].protocols[targetLaneIndex] || cardInHand.protocol === prev[opponentId].protocols[targetLaneIndex]) && !opponentHasPsychic1;
            }

            const { newState: stateAfterPlay, animationRequests } = playCard(stateBeforePlay, cardInHandId, targetLaneIndex, canPlayFaceUp, actor);
            newState = stateAfterPlay;

            if (animationRequests) {
                // FIX: Implemented `onCompleteCallback` for card-play animations to ensure turn progression occurs correctly after animations complete.
                requiresAnimation = {
                    animationRequests,
                    onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
                };
            }
            break;
        }
        case 'select_lane_for_death_2': {
            const actor = prev.turn;
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
                        return endTurnCb(stateAfterDelete);
                    }
                };
            }
            break;
        }
        case 'select_lane_for_metal_3_delete': {
            const actor = prev.turn;
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
                onCoverResult = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateBeforePlay);
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
                        onCompleteCallback: (s, endTurnCb) => endTurnCb(s)
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
            const player = prev.turn;
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
                newState = log(newState, player, `${sourceName}: ${playerName} returns ${totalReturned} card(s) with value 2.`);
            }
            break;
        }
        default: return { nextState: prev };
    }

    if (!requiresAnimation && newState.actionRequired === null) {
        if (newState.queuedActions && newState.queuedActions.length > 0) {
            const newQueue = [...newState.queuedActions];
            const nextAction = newQueue.shift();
            newState = { ...newState, actionRequired: nextAction, queuedActions: newQueue };
        }
    }

    return { nextState: recalculateAllLaneValues(newState), requiresAnimation };
};
