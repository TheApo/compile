/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult, AnimationRequest } from "../../../types";
import { log } from "../../utils/log";

/**
 * Hate-2: Delete your highest value card. Delete your opponent's highest value card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';

    const playersToTarget: Player[] = [actor, opponent];
    const animationRequests: AnimationRequest[] = [];
    let newState = state;

    for (const target of playersToTarget) {
        const allCards = state[target].lanes.flat();
        if (allCards.length > 0) {
            const highestValueCard = allCards.reduce((highest, current) => {
                const highestValue = highest.isFaceUp ? highest.value : 2;
                const currentValue = current.isFaceUp ? current.value : 2;
                return currentValue > highestValue ? current : highest;
            });
            animationRequests.push({ type: 'delete', cardId: highestValueCard.id, owner: target });
            
            const ownerName = target === actor ? "Your" : "Opponent's";
            const cardName = highestValueCard.isFaceUp ? `${highestValueCard.protocol}-${highestValueCard.value}` : 'a face-down card';
            const logMsg = `Hate-2: Deleting ${ownerName} highest value card (${cardName}).`;
            newState = log(newState, actor, logMsg);
        }
    }
    
    return { newState, animationRequests };
};