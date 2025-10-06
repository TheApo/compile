/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Psychic-0: Draw 2 cards. Your opponent discards 2 cards, then reveals their hand.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    let newState = drawForPlayer(state, cardOwner, 2);
    newState = log(newState, cardOwner, "Psychic-0: Draw 2 cards.");

    const opponentHandCount = newState[opponent].hand.length;
    if (opponentHandCount > 0) {
        newState.actionRequired = {
            type: 'discard',
            actor: opponent,
            count: Math.min(2, opponentHandCount),
            sourceCardId: card.id,
        };
        // Queue the hand reveal after the discard
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            { type: 'reveal_opponent_hand', sourceCardId: card.id, actor: cardOwner }
        ];
    }
    return { newState };
}