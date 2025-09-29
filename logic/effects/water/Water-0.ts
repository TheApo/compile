/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player, ActionRequired } from "../../../types";

/**
 * Water-0: Flip 1 other card. Flip this card.
 * This effect now only sets up the first part of the action. The second part (self-flip)
 * is handled contextually by the cardResolver to prevent soft-locks from interrupts.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].filter(c => c.id !== card.id);
    
    if (allOtherCards.length > 0) {
        const selectTargetAction: ActionRequired = {
            type: 'select_any_other_card_to_flip_for_water_0',
            sourceCardId: card.id,
            actor,
        };

        return {
            newState: {
                ...state,
                actionRequired: selectTargetAction,
            }
        };
    }
    
    // If there are no other cards, the effect does nothing.
    return { newState: state };
}