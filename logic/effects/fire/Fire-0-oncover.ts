/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Fire-0 On-Cover: When this card would be covered: First, draw 1 card and flip 1 other card.
 */
export const execute = (coveredCard: PlayedCard, laneIndex: number, state: GameState, owner: Player): EffectResult => {
    const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
    // The player who draws should be the OWNER of Fire-0.
    let newState = log(state, owner, `${cardName} On-Cover: Draw 1 card.`);
    newState = drawForPlayer(newState, owner, 1);
    
    const allOtherCards = [
        ...newState.player.lanes.flat(), 
        ...newState.opponent.lanes.flat()
    ].filter(c => c.id !== coveredCard.id);

    if (allOtherCards.length > 0) {
        newState = log(newState, owner, `${cardName} On-Cover: Prompts to flip another card.`);
        newState.actionRequired = {
            type: 'select_any_other_card_to_flip',
            sourceCardId: coveredCard.id,
            draws: 0, // No draw after this flip
            actor: owner,
        };
        // This requires an interrupt if the owner is not the current turn player.
        if (state.turn !== owner) {
            newState._interruptedTurn = state.turn;
            newState._interruptedPhase = state.phase;
            newState.turn = owner;
        }
    } else {
        newState = log(newState, owner, `${cardName} On-Cover: No other cards to flip.`);
    }
    
    return { newState };
}