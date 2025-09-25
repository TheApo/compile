/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult, AnimationRequest } from "../../../types";
import { getEffectiveCardValue } from "../../game/stateManager";
import { log } from "../../utils/log";

/**
 * Hate-2: Delete your highest value uncovered card. Delete your opponent's highest value uncovered card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';

    const playersToTarget: Player[] = [actor, opponent];
    const animationRequests: AnimationRequest[] = [];
    let newState = state;

    for (const target of playersToTarget) {
        // Get all uncovered cards for the target player, along with their lane context.
        const uncoveredCardsWithContext = state[target].lanes
            .map(lane => {
                if (lane.length > 0) {
                    // The last card in the array is the uncovered card.
                    return { card: lane[lane.length - 1], laneContext: lane };
                }
                return null;
            })
            .filter((item): item is { card: PlayedCard; laneContext: PlayedCard[] } => item !== null);

        if (uncoveredCardsWithContext.length > 0) {
            const highestValueCardWithContext = uncoveredCardsWithContext.reduce((highest, current) => {
                const highestValue = getEffectiveCardValue(highest.card, highest.laneContext);
                const currentValue = getEffectiveCardValue(current.card, current.laneContext);
                return currentValue > highestValue ? current : highest;
            });
            
            const highestValueCard = highestValueCardWithContext.card;

            animationRequests.push({ type: 'delete', cardId: highestValueCard.id, owner: target });
            
            const ownerName = target === actor ? "Your" : "Opponent's";
            const cardName = highestValueCard.isFaceUp ? `${highestValueCard.protocol}-${highestValueCard.value}` : 'a face-down card';
            const logMsg = `Hate-2: Deleting ${ownerName} highest value uncovered card (${cardName}).`;
            newState = log(newState, actor, logMsg);
        }
    }
    
    return { newState, animationRequests };
};
