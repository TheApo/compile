/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, EffectResult } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { recalculateAllLaneValues } from "../stateManager";
import { executeOnCoverEffect, executeOnPlayEffect } from '../../effectExecutor';

export function findCardOnBoard(state: GameState, cardId: string | undefined): { card: PlayedCard, owner: Player } | null {
    if (!cardId) return null;
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            const card = lane.find(c => c.id === cardId);
            if (card) return { card, owner: p };
        }
    }
    return null;
}

export function handleChainedEffectsOnDiscard(state: GameState, player: Player, sourceEffect?: 'fire_1' | 'fire_2' | 'fire_3' | 'spirit_1_start', sourceCardId?: string): GameState {
    if (!sourceEffect || !sourceCardId) return state;

    let newState = { ...state };
    const sourceCard = findCardOnBoard(newState, sourceCardId)?.card;
    const sourceCardName = sourceCard ? `${sourceCard.protocol}-${sourceCard.value}` : 'A card effect';

    newState.actionRequired = null; // Clear the completed discard action before setting a new one

    switch (sourceEffect) {
        case 'fire_1':
            newState = log(newState, player, `${sourceCardName}: Discard successful. Prompting to delete 1 card.`);
            newState.actionRequired = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCardId,
                disallowedIds: [sourceCardId],
                actor: player,
            };
            break;
        case 'fire_2':
            newState = log(newState, player, `${sourceCardName}: Discard successful. Prompting to return 1 card.`);
            newState.actionRequired = {
                type: 'select_card_to_return',
                sourceCardId: sourceCardId,
                actor: player,
            };
            break;
        case 'fire_3':
            newState = log(newState, player, `${sourceCardName}: Discard successful. Prompting to flip 1 card.`);
            newState.actionRequired = {
                type: 'select_card_to_flip_for_fire_3',
                sourceCardId: sourceCardId,
                actor: player,
            };
            break;
        case 'spirit_1_start':
            // No chained effect, the action is complete.
            break;
    }

    return newState;
}

export function internalResolveTargetedFlip(state: GameState, targetCardId: string, nextAction: ActionRequired = null): GameState {
    const cardInfo = findCardOnBoard(state, targetCardId);
    if (!cardInfo) return state;

    const { card, owner } = cardInfo;
    const actor = state.turn;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = owner === 'player' ? "Player's" : "Opponent's";
    const faceDirection = card.isFaceUp ? "face-down" : "face-up";
    const cardName = `${card.protocol}-${card.value}`; // Always show card name

    let newState = log(state, actor, `${actorName} flips ${ownerName} ${cardName} ${faceDirection}.`);
    
    const newStats = { ...newState.stats[actor], cardsFlipped: newState.stats[actor].cardsFlipped + 1 };
    const newPlayerState = { ...newState[actor], stats: newStats };
    newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

    newState = findAndFlipCards(new Set([targetCardId]), newState);
    newState.animationState = { type: 'flipCard', cardId: targetCardId };
    newState.actionRequired = nextAction;
    return newState;
}


export function handleUncoverEffect(state: GameState, owner: Player, laneIndex: number): EffectResult {
    const lane = state[owner].lanes[laneIndex];
    if (lane.length === 0) {
        return { newState: state };
    }

    const uncoveredCard = lane[lane.length - 1];
    
    // The effect only triggers if the newly uncovered card is FACE UP.
    if (uncoveredCard.isFaceUp) {
        const newState = log(state, owner, `${uncoveredCard.protocol}-${uncoveredCard.value} is uncovered and its effects are re-triggered.`);
        // Re-triggering the on-play effect is the main part of the mechanic.
        const result = executeOnPlayEffect(uncoveredCard, laneIndex, newState, owner);
        
        // If the effect requires an action from the non-turn player,
        // we need to interrupt the current turn to resolve the action.
        if (result.newState.actionRequired && result.newState.actionRequired.actor !== state.turn) {
            result.newState._interruptedTurn = state.turn;
            result.newState.turn = result.newState.actionRequired.actor;
        }
        
        return result;
    }
    
    return { newState: state };
}

export function internalReturnCard(state: GameState, targetCardId: string): EffectResult {
    const cardInfo = findCardOnBoard(state, targetCardId);
    if (!cardInfo) return { newState: state };

    const { card, owner } = cardInfo;

    const laneIndex = state[owner].lanes.findIndex(l => l.some(c => c.id === card.id));
    if (laneIndex === -1) return { newState: state };

    // Snapshot before removal
    const laneBeforeRemoval = state[owner].lanes[laneIndex];
    const isRemovingTopCard = laneBeforeRemoval.length > 0 && laneBeforeRemoval[laneBeforeRemoval.length - 1].id === targetCardId;

    let newState = { ...state };
    const ownerState = { ...newState[owner] };

    // Remove from board
    ownerState.lanes = ownerState.lanes.map(lane => lane.filter(c => c.id !== targetCardId));
    // Add to hand
    ownerState.hand = [...ownerState.hand, { ...card, isFaceUp: true, isRevealed: false }];

    newState[owner] = ownerState;

    const actor = newState.turn;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = owner === 'player' ? "Player's" : "Opponent's";
    const cardName = `${card.protocol}-${card.value}`;
    newState = log(newState, actor, `${actorName} returns ${ownerName} ${cardName} to their hand.`);

    newState.actionRequired = null;
    const stateAfterRecalc = recalculateAllLaneValues(newState);

    if (isRemovingTopCard) {
        return handleUncoverEffect(stateAfterRecalc, owner, laneIndex);
    }

    return { newState: stateAfterRecalc };
}

export function internalShiftCard(state: GameState, cardToShiftId: string, cardOwner: Player, targetLaneIndex: number, actor: Player): EffectResult {
    const cardToShiftInfo = findCardOnBoard(state, cardToShiftId);
    if (!cardToShiftInfo || cardToShiftInfo.owner !== cardOwner) return { newState: state };
    const { card: cardToShift } = cardToShiftInfo;

    const ownerState = state[cardOwner];

    let originalLaneIndex = -1;
    for (let i = 0; i < ownerState.lanes.length; i++) {
        if (ownerState.lanes[i].some(c => c.id === cardToShiftId)) {
            originalLaneIndex = i;
            break;
        }
    }

    if (originalLaneIndex === -1) return { newState: state };
    
    // Snapshot before removal from original lane
    const laneBeforeRemoval = state[cardOwner].lanes[originalLaneIndex];
    const isRemovingTopCard = laneBeforeRemoval.length > 0 && laneBeforeRemoval[laneBeforeRemoval.length - 1].id === cardToShiftId;

    // Create a new lanes array with the card removed from the original lane.
    const lanesAfterRemoval = ownerState.lanes.map((lane, index) => {
        if (index === originalLaneIndex) {
            return lane.filter(c => c.id !== cardToShiftId);
        }
        return lane;
    });

    const cardToBeCovered = lanesAfterRemoval[targetLaneIndex].length > 0
        ? lanesAfterRemoval[targetLaneIndex][lanesAfterRemoval[targetLaneIndex].length - 1]
        : null;

    // Create another new lanes array with the card added to the target lane.
    const lanesAfterAddition = lanesAfterRemoval.map((lane, index) => {
        if (index === targetLaneIndex) {
            return [...lane, cardToShift];
        }
        return lane;
    });
    
    const newOwnerState = { ...ownerState, lanes: lanesAfterAddition };
    let newState = { ...state, [cardOwner]: newOwnerState };
    
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = cardOwner === 'player' ? "Player's" : "Opponent's";
    const cardName = cardToShift.isFaceUp ? `${cardToShift.protocol}-${cardToShift.value}` : 'a card';
    const targetProtocol = newState[cardOwner].protocols[targetLaneIndex];
    newState = log(newState, actor, `${actorName} shifts ${ownerName} ${cardName} to Protocol ${targetProtocol}.`);
    
    const newStats = { ...newState.stats[actor], cardsShifted: newState.stats[actor].cardsShifted + 1 };
    const newActorState = { ...newState[actor], stats: newStats };
    newState = { ...newState, [actor]: newActorState, stats: { ...newState.stats, [actor]: newStats } };
    
    newState.actionRequired = null;

    let stateAfterRecalc = recalculateAllLaneValues(newState);

    let resultAfterOnCover: EffectResult = { newState: stateAfterRecalc };
    if (cardToBeCovered) {
        resultAfterOnCover = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateAfterRecalc);
    }

    if (isRemovingTopCard) {
        const uncoverResult = handleUncoverEffect(resultAfterOnCover.newState, cardOwner, originalLaneIndex);
        
        const combinedAnimations = [
            ...(resultAfterOnCover.animationRequests || []),
            ...(uncoverResult.animationRequests || [])
        ];
        
        return {
            newState: uncoverResult.newState,
            animationRequests: combinedAnimations.length > 0 ? combinedAnimations : undefined,
        };
    }

    return resultAfterOnCover;
}

export const countValidDeleteTargets = (state: GameState, disallowedIds: string[], allowedLaneIndices?: number[]): number => {
    let count = 0;
    for (const p of ['player', 'opponent'] as Player[]) {
        for (let i = 0; i < state[p].lanes.length; i++) {
            if (allowedLaneIndices && !allowedLaneIndices.includes(i)) {
                continue;
            }
            const lane = state[p].lanes[i];
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1];
                if (!disallowedIds.includes(topCard.id)) {
                    count++;
                }
            }
        }
    }
    return count;
};

// FIX: Moved 'handleOnFlipToFaceUp' to this shared utility file and exported it.
/**
 * Handles the logic for triggering a card's on-play effect when it's flipped from face-down to face-up.
 * This respects the rule that middle-box effects only trigger if the card is uncovered.
 */
export const handleOnFlipToFaceUp = (state: GameState, cardId: string): EffectResult => {
    const cardInfo = findCardOnBoard(state, cardId);
    if (!cardInfo) return { newState: state };

    const { card, owner } = cardInfo;
    const laneIndex = state[owner].lanes.findIndex(l => l.some(c => c.id === card.id));
    if (laneIndex === -1) return { newState: state };

    // executeOnPlayEffect internally handles the "uncovered" check
    return executeOnPlayEffect(card, laneIndex, state, owner);
};
