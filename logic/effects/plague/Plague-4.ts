/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Plague-4 End Phase Effect: Your opponent deletes 1 of their face-down cards. You may flip this card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;

    // Find opponent's UNCOVERED face-down cards, as per default targeting rules.
    const opponentUncoveredFaceDownCards: PlayedCard[] = [];
    for (const lane of state[opponent].lanes) {
        if (lane.length > 0) {
            const topCard = lane[lane.length - 1];
            if (!topCard.isFaceUp) {
                opponentUncoveredFaceDownCards.push(topCard);
            }
        }
    }

    if (opponentUncoveredFaceDownCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'plague_4_opponent_delete',
                    sourceCardId: card.id,
                    actor: opponent,
                }
            }
        };
    }

    // If opponent has no targetable face-down cards, skip straight to the player's optional flip
    const newState = log(state, cardOwner, "Plague-4: Opponent has no targetable face-down cards to delete.");
    return {
        newState: {
            ...newState,
            actionRequired: {
                type: 'plague_4_player_flip_optional',
                sourceCardId: card.id,
                optional: true,
                actor: cardOwner,
            }
        }
    };
}