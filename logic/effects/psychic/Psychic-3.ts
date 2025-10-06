/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Psychic-3: Your opponent discards 1 card. Shift 1 of their cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = { ...state };

    const opponentHandCount = newState[opponent].hand.length;

    // Card text: "Shift 1 of their cards" → cardOwner (you) shiftet
    const shiftAction = {
        type: 'select_any_opponent_card_to_shift' as const,
        sourceCardId: card.id,
        actor: cardOwner  // FIXED: cardOwner shiftet, nicht opponent!
    };

    if (opponentHandCount > 0) {
        // Card text: "Your opponent discards 1 card" → opponent discardet
        newState.actionRequired = {
            type: 'discard',
            actor: opponent,  // Opponent discardet
            count: 1,
            sourceCardId: card.id,
        };
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            shiftAction,  // Dann shiftet cardOwner
        ];
    } else {
        // No cards to discard, go straight to shifting if there are cards to shift
        if (newState[opponent].lanes.flat().length > 0) {
            newState.actionRequired = shiftAction;
        }
    }
    return { newState };
}