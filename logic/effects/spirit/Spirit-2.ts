/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Spirit-2: You may flip 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    if (allCards.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_any_card_to_flip_optional',
                    sourceCardId: card.id,
                    optional: true,
                    actor,
                }
            }
        };
    }
    return { newState: state };
}