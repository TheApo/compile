/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// FIX: Implemented the entire module which was missing and causing multiple import errors.
import { GameState, PlayedCard, Player, ActionRequired } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { recalculateAllLaneValues } from "../stateManager";
import { effectRegistryOnCover } from "../../effects/effectRegistryOnCover";

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
    newState = findAndFlipCards(new Set([targetCardId]), newState);
    newState[actor].stats.cardsFlipped++;
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

export function internalShiftCard(state: GameState, cardToShiftId: string, cardOwner: Player, targetLaneIndex: number, actor: Player): GameState {
    let newState = { ...state };
    const ownerState = { ...newState[cardOwner] };
    const cardToShift = ownerState.lanes.flat().find(c => c.id === cardToShiftId);
    if (!cardToShift) return state;

    // Remove card from its original lane
    let originalLaneIndex = -1;
    ownerState.lanes = ownerState.lanes.map((lane, index) => {
        if (lane.some(c => c.id === cardToShiftId)) {
            originalLaneIndex = index;
            return lane.filter(c => c.id !== cardToShiftId);
        }
        return lane;
    });

    if (originalLaneIndex === -1) return state; // Card not found

    const cardToBeCovered = ownerState.lanes[targetLaneIndex].length > 0
        ? ownerState.lanes[targetLaneIndex][ownerState.lanes[targetLaneIndex].length - 1]
        : null;

    // Add card to the new lane
    ownerState.lanes[targetLaneIndex] = [...ownerState.lanes[targetLaneIndex], cardToShift];
    
    newState[cardOwner] = ownerState;
    
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = cardOwner === 'player' ? "Player's" : "Opponent's";
    const cardName = cardToShift.isFaceUp ? `${cardToShift.protocol}-${cardToShift.value}` : 'a card';
    const targetProtocol = newState[cardOwner].protocols[targetLaneIndex];
    newState = log(newState, actor, `${actorName} shifts ${ownerName} ${cardName} to Protocol ${targetProtocol}.`);
    newState[actor].stats.cardsShifted++;
    
    newState.actionRequired = null;
    newState = recalculateAllLaneValues(newState);

    // After shifting, check for onCover effect
    if (cardToBeCovered) {
        const effectKey = `${cardToBeCovered.protocol}-${cardToBeCovered.value}`;
        const onCoverExecute = effectRegistryOnCover[effectKey];
        if (onCoverExecute) {
            // FIX: Added missing 'cardOwner' argument for the owner of the covered card.
            const result = onCoverExecute(cardToBeCovered, targetLaneIndex, newState, cardOwner);
            newState = result.newState;
            // Note: Shift does not currently handle animations from onCover effects.
        }
    }

    return newState;
}