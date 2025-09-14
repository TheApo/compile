/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Psychic-2: Your opponent discards 2 cards. Rearrange their protocols.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    // FIX: Explicitly type `opponent` as `Player` to prevent type widening to `string`.
    const opponent: Player = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    const opponentHandCount = newState[opponent].hand.length;

    const rearrangeAction = { type: 'prompt_rearrange_protocols' as const, sourceCardId: card.id, target: opponent, actor };
    
    if (opponentHandCount > 0) {
        newState.actionRequired = {
            type: 'discard',
            player: opponent,
            count: Math.min(2, opponentHandCount),
            sourceCardId: card.id,
        };
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            rearrangeAction
        ];
    } else {
        // No cards to discard, go straight to rearranging
        newState.actionRequired = rearrangeAction;
    }
    return { newState };
}