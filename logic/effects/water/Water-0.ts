/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";

/**
 * Water-0: Flip 1 other card. Flip this card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].filter(c => c.id !== card.id);
    if (allOtherCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_any_other_card_to_flip_for_water_0',
                    sourceCardId: card.id,
                }
            }
        };
    }
    
    // If no other cards, just flip self
    return { newState: findAndFlipCards(new Set([card.id]), state) };
}