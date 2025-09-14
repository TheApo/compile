/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Fire-0 On-Cover: When this card would be covered: First, draw 1 card and flip 1 other card.
 */
export const execute = (coveredCard: PlayedCard, laneIndex: number, state: GameState): EffectResult => {
    const player = state.turn;
    const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
    let newState = log(state, player, `${cardName} On-Cover: Draw 1 card.`);
    newState = drawForPlayer(newState, player, 1);
    
    const allOtherCards = [
        ...newState.player.lanes.flat(), 
        ...newState.opponent.lanes.flat()
    ].filter(c => c.id !== coveredCard.id);

    if (allOtherCards.length > 0) {
        newState = log(newState, player, `${cardName} On-Cover: Prompts to flip another card.`);
        newState.actionRequired = {
            type: 'select_any_other_card_to_flip',
            sourceCardId: coveredCard.id,
            draws: 0, // No draw after this flip
        };
    } else {
        newState = log(newState, player, `${cardName} On-Cover: No other cards to flip.`);
    }
    
    return { newState };
}