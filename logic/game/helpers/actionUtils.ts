/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// FIX: Implemented the entire module which was missing and causing multiple import errors.
import { GameState, PlayedCard, Player, ActionRequired, EffectResult } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { recalculateAllLaneValues } from "../stateManager";
import { executeOnCoverEffect } from '../../effectExecutor';

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
    const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : `a face-down card`;

    let newState = log(state, actor, `${actorName} flips ${ownerName} ${cardName} ${faceDirection}.`);
    
    const newStats = { ...newState.stats[actor], cardsFlipped: newState.stats[actor].cardsFlipped + 1 };
    const newPlayerState = { ...newState[actor], stats: newStats };
    newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

    newState = findAndFlipCards(new Set([targetCardId]), newState);
    newState.animationState = { type: 'flipCard', cardId: targetCardId };
    newState.actionRequired = nextAction;
    return newState;
}

export function internalReturnCard(state: GameState, targetCardId: string): GameState {
    const cardInfo = findCardOnBoard(state, targetCardId);
    if (!cardInfo) return state;

    const { card, owner } = cardInfo;
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
    return recalculateAllLaneValues(newState);
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
    
    // Create a new player state with the updated lanes.
    const newOwnerState = {
        ...ownerState,
        lanes: lanesAfterAddition,
    };

    // Create a new game state.
    let newState = {
        ...state,
        [cardOwner]: newOwnerState,
    };
    
    // Log the action.
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = cardOwner === 'player' ? "Player's" : "Opponent's";
    const cardName = cardToShift.isFaceUp ? `${cardToShift.protocol}-${cardToShift.value}` : 'a card';
    const targetProtocol = newState[cardOwner].protocols[targetLaneIndex];
    newState = log(newState, actor, `${actorName} shifts ${ownerName} ${cardName} to Protocol ${targetProtocol}.`);
    
    // Update stats immutably.
    const newStats = { ...newState.stats[actor], cardsShifted: newState.stats[actor].cardsShifted + 1 };
    const newActorState = { ...newState[actor], stats: newStats };
    newState = { ...newState, [actor]: newActorState, stats: { ...newState.stats, [actor]: newStats } };
    
    newState.actionRequired = null;

    // Recalculate values based on the definitive new board state.
    let stateAfterRecalc = recalculateAllLaneValues(newState);

    // After shifting and recalculating, check for onCover effect.
    let finalResult: EffectResult = { newState: stateAfterRecalc };

    if (cardToBeCovered) {
        const onCoverResult = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateAfterRecalc);
        finalResult.newState = onCoverResult.newState;
        if (onCoverResult.animationRequests) {
            finalResult.animationRequests = onCoverResult.animationRequests;
        }
    }

    return finalResult;
}