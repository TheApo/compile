/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";

/**
 * Plague-4 End Phase Effect: Your opponent deletes 1 of their face-down cards. You may flip this card.
 */
export const execute = (card: PlayedCard, state: GameState): EffectResult => {
    const actor = state.turn;
    const opponent = actor === 'player' ? 'opponent' : 'player';
    const opponentFaceDownCards = state[opponent].lanes.flat().filter(c => !c.isFaceUp);

    if (opponentFaceDownCards.length > 0) {
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
    
    // If opponent has no face-down cards, skip straight to the player's optional flip
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'plague_4_player_flip_optional',
                sourceCardId: card.id,
                optional: true,
                actor,
            }
        }
    };
}