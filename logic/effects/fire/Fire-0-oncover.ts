/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Fire-0 On-Cover: When this card would be covered: First, draw 1 card and flip 1 other card.
 */
export const execute = (coveredCard: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
    // The player who draws should be the OWNER of Fire-0.
    let newState = log(state, cardOwner, `${cardName} On-Cover: Draw 1 card.`);
    newState = drawForPlayer(newState, cardOwner, 1);

    const allOtherCards = [
        ...newState.player.lanes.flat(),
        ...newState.opponent.lanes.flat()
    ].filter(c => c.id !== coveredCard.id);

    if (allOtherCards.length > 0) {
        newState = log(newState, cardOwner, `${cardName} On-Cover: Prompts to flip another card.`);
        newState.actionRequired = {
            type: 'select_any_other_card_to_flip',
            sourceCardId: coveredCard.id,
            draws: 0, // No draw after this flip
            actor: cardOwner,
        };
        // This requires an interrupt if the owner is not the current turn player.
        if (state.turn !== cardOwner) {
            newState._interruptedTurn = state.turn;
            newState._interruptedPhase = state.phase;
            newState.turn = cardOwner;
        }
    } else {
        newState = log(newState, cardOwner, `${cardName} On-Cover: No other cards to flip.`);
    }

    return { newState };
}