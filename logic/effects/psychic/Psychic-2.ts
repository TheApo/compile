/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Psychic-2: Your opponent discards 2 cards. Rearrange their protocols.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = { ...state };

    const opponentHandCount = newState[opponent].hand.length;

    // CRITICAL: The actor who performs the rearrange is the OWNER of the card (cardOwner),
    // and the target is their opponent's protocols.
    const rearrangeAction = { type: 'prompt_rearrange_protocols' as const, sourceCardId: card.id, target: opponent, actor: cardOwner };

    if (opponentHandCount > 0) {
        newState.actionRequired = {
            type: 'discard',
            actor: opponent,
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