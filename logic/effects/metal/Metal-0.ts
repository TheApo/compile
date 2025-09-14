/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Metal-0: Flip 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    // Ensure there's at least one other card to flip, though the effect text doesn't specify "other".
    // For safety, we check if there are any cards on board at all.
    if (allCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_any_card_to_flip',
                    count: 1,
                    sourceCardId: card.id,
                    actor,
                }
            }
        };
    }
    return { newState: state };
};