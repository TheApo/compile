/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player, ActionRequired } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";

/**
 * Water-0: Flip 1 other card. Flip this card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].filter(c => c.id !== card.id);
    
    // Create the second part of the effect: flipping itself.
    const flipSelfAction: ActionRequired = {
        type: 'flip_self_for_water_0',
        sourceCardId: card.id,
        actor,
    };

    if (allOtherCards.length > 0) {
        const selectTargetAction: ActionRequired = {
            type: 'select_any_other_card_to_flip_for_water_0',
            sourceCardId: card.id,
            actor,
        };

        return {
            newState: {
                ...state,
                // The select action is first, the self-flip is second.
                queuedActions: [selectTargetAction, flipSelfAction],
            }
        };
    }
    
    // If no other cards, just queue the self-flip.
    return { 
        newState: {
            ...state,
            queuedActions: [flipSelfAction],
        }
    };
}