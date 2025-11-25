/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Hate-4: When this card would be covered: First, delete the lowest value covered card in this line.
 */
export const executeOnCover = (coveredCard: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const players: Player[] = ['player', 'opponent'];
    const allCoveredCardsInLine: { card: PlayedCard, owner: Player }[] = [];

    for (const player of players) {
        const lane = state[player].lanes[laneIndex];
        // A card is covered if it's not the last one in the array.
        // The Hate-4 card that is being covered is included (it's currently the top card of cardOwner's lane).
        // But opponent's top card is NOT covered - only cards below the top are covered.
        // Exception: The cardOwner's entire lane counts as covered because a new card is about to cover it.
        if (player === cardOwner) {
            // All cards in the owner's lane are about to be covered by the new card
            for (let i = 0; i < lane.length; i++) {
                allCoveredCardsInLine.push({ card: lane[i], owner: player });
            }
        } else {
            // For opponent, only cards below the top card are covered (exclude the last card)
            for (let i = 0; i < lane.length - 1; i++) {
                allCoveredCardsInLine.push({ card: lane[i], owner: player });
            }
        }
    }
    
    if (allCoveredCardsInLine.length === 0) {
        return { newState: state };
    }

    // Find the card with the lowest value
    const cardToDelete = allCoveredCardsInLine.reduce((lowest, current) => {
        const getEffectiveValue = (c: { card: PlayedCard, owner: Player }) => {
            if (c.card.isFaceUp) return c.card.value;
            // Check for Darkness-2 on the owner's side of the lane
            const hasDarkness2 = state[c.owner].lanes[laneIndex].some(card => card.isFaceUp && card.protocol === 'Darkness' && card.value === 2);
            return hasDarkness2 ? 4 : 2;
        };

        return getEffectiveValue(current) < getEffectiveValue(lowest) ? current : lowest;
    });

    const deletedCardName = cardToDelete.card.isFaceUp ? `${cardToDelete.card.protocol}-${cardToDelete.card.value}` : 'a face-down card';
    const deletedOwnerName = cardToDelete.owner === 'player' ? "Player's" : "Opponent's";

    // The log should be attributed to the card's owner, who is performing the effect.
    // Note: Card name prefix is added automatically by the logging context
    let newState = log(state, cardOwner, `Effect triggers, deleting the lowest value covered card (${deletedOwnerName} ${deletedCardName}).`);

    return {
        newState,
        animationRequests: [{ type: 'delete', cardId: cardToDelete.card.id, owner: cardToDelete.owner }]
    };
}