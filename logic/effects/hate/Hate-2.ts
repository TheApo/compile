/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult, AnimationRequest } from "../../../types";
import { getEffectiveCardValue } from "../../game/stateManager";
import { log } from "../../utils/log";
import { deleteCardFromBoard } from '../../utils/boardModifiers';
import { handleUncoverEffect } from '../../game/helpers/actionUtils';

/**
 * Hate-2: Delete your highest value uncovered card. Delete your opponent's highest value uncovered card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };

    const cardsToDeleteMeta: { card: PlayedCard; owner: Player; laneIndex: number; wasTopCard: boolean }[] = [];

    // FIX: Explicitly cast the array to Player[] to prevent TypeScript from widening the type of 'target' to 'string'.
    for (const target of [actor, opponent] as Player[]) {
        const uncoveredCardsWithContext = newState[target].lanes
            .map((lane, idx) => lane.length > 0 ? { card: lane[lane.length - 1], laneContext: lane, laneIndex: idx } : null)
            .filter((item): item is { card: PlayedCard; laneContext: PlayedCard[]; laneIndex: number } => item !== null);

        if (uncoveredCardsWithContext.length > 0) {
            const highestValueCardWithContext = uncoveredCardsWithContext.reduce((highest, current) => {
                const highestValue = getEffectiveCardValue(highest.card, highest.laneContext);
                const currentValue = getEffectiveCardValue(current.card, current.laneContext);
                return currentValue > highestValue ? current : highest;
            });
            
            cardsToDeleteMeta.push({ 
                card: highestValueCardWithContext.card, 
                owner: target,
                laneIndex: highestValueCardWithContext.laneIndex,
                wasTopCard: true // It's an uncovered card, so it was on top
            });
        }
    }
    
    // Remove duplicates in case a card tries to delete itself twice (e.g. it is its own highest value card)
    const uniqueDeletes = Array.from(new Map(cardsToDeleteMeta.map(item => [item.card.id, item])).values());
    
    if (uniqueDeletes.length > 0) {
        // Update stats for the actor triggering the effect
        const newStats = { ...newState[actor].stats, cardsDeleted: newState[actor].stats.cardsDeleted + uniqueDeletes.length };
        const newPlayerState = { ...newState[actor], stats: newStats };
        newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };
    }
    
    // Perform deletions and log them
    for (const { card, owner } of uniqueDeletes) {
        const ownerName = owner === actor ? "Your" : "Opponent's";
        const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'a face-down card';
        const logMsg = `Hate-2: Deleting ${ownerName} highest value uncovered card (${cardName}).`;
        newState = log(newState, actor, logMsg);
        
        // Directly delete the card from the board state
        newState = deleteCardFromBoard(newState, card.id);
    }
    
    // Handle any uncover effects that result from the deletions
    for (const { owner, laneIndex, wasTopCard } of uniqueDeletes) {
        if (wasTopCard) {
            const uncoverResult = handleUncoverEffect(newState, owner, laneIndex);
            newState = uncoverResult.newState;
            // Any animation requests from the new uncover effect will be ignored in this specific chain
            // to prevent the original bug, but the state changes will apply.
        }
    }
    
    return { newState };
};