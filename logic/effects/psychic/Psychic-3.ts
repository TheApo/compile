/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Psychic-3: Your opponent discards 1 card. Shift 1 of their cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    const opponentHandCount = newState[opponent].hand.length;
    const shiftAction = { type: 'select_any_opponent_card_to_shift' as const, sourceCardId: card.id };

    if (opponentHandCount > 0) {
        newState.actionRequired = {
            type: 'discard',
            player: opponent,
            count: 1,
            sourceCardId: card.id,
        };
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            shiftAction,
        ];
    } else {
        // No cards to discard, go straight to shifting if there are cards to shift
        if (newState[opponent].lanes.flat().length > 0) {
            newState.actionRequired = shiftAction;
        }
    }
    return { newState };
}
