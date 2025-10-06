/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult, AnimationRequest, ActionRequired, EffectContext } from "../../../types";
import { getEffectiveCardValue } from "../../game/stateManager";
import { log } from "../../utils/log";
import { deleteCardFromBoard } from '../../utils/boardModifiers';
import { handleUncoverEffect } from '../../game/helpers/actionUtils';

/**
 * Hate-2: Delete your highest value uncovered card. Delete your opponent's highest value uncovered card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = { ...state };

    const cardsToDeleteMeta: { card: PlayedCard; owner: Player; laneIndex: number; wasTopCard: boolean }[] = [];

    // This effect is sequential. First, find and delete the actor's card.
    const actorUncovered = newState[cardOwner].lanes
        .map((lane, idx) => lane.length > 0 ? { card: lane[lane.length - 1], laneContext: lane, laneIndex: idx } : null)
        .filter((item): item is { card: PlayedCard; laneContext: PlayedCard[]; laneIndex: number } => item !== null);

    if (actorUncovered.length > 0) {
        const highestValueActorCard = actorUncovered.reduce((highest, current) => {
            const highestValue = getEffectiveCardValue(highest.card, highest.laneContext);
            const currentValue = getEffectiveCardValue(current.card, current.laneContext);
            return currentValue > highestValue ? current : highest;
        });

        const ownerName = "Your";
        const cardName = highestValueActorCard.card.isFaceUp ? `${highestValueActorCard.card.protocol}-${highestValueActorCard.card.value}` : 'a face-down card';
        const logMsg = `Hate-2: Deleting ${ownerName} highest value uncovered card (${cardName}).`;
        newState = log(newState, cardOwner, logMsg);

        newState = deleteCardFromBoard(newState, highestValueActorCard.card.id);
        const uncoverResult = handleUncoverEffect(newState, cardOwner, highestValueActorCard.laneIndex);
        newState = uncoverResult.newState;

        // If the card deleted itself, the effect stops here.
        if (highestValueActorCard.card.id === card.id) {
            return { newState };
        }
    }

    // If the effect didn't stop, proceed to delete the opponent's card.
    const opponentUncovered = newState[opponent].lanes
        .map((lane, idx) => lane.length > 0 ? { card: lane[lane.length - 1], laneContext: lane, laneIndex: idx } : null)
        .filter((item): item is { card: PlayedCard; laneContext: PlayedCard[]; laneIndex: number } => item !== null);

    if (opponentUncovered.length > 0) {
        const highestValueOpponentCard = opponentUncovered.reduce((highest, current) => {
            const highestValue = getEffectiveCardValue(highest.card, highest.laneContext);
            const currentValue = getEffectiveCardValue(current.card, current.laneContext);
            return currentValue > highestValue ? current : highest;
        });

        const ownerName = "Opponent's";
        const cardName = highestValueOpponentCard.card.isFaceUp ? `${highestValueOpponentCard.card.protocol}-${highestValueOpponentCard.card.value}` : 'a face-down card';
        const logMsg = `Hate-2: Deleting ${ownerName} highest value uncovered card (${cardName}).`;
        newState = log(newState, cardOwner, logMsg);
        
        newState = deleteCardFromBoard(newState, highestValueOpponentCard.card.id);
        const uncoverResult = handleUncoverEffect(newState, opponent, highestValueOpponentCard.laneIndex);
        newState = uncoverResult.newState;
    }

    return { newState };
};