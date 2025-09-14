/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Spirit-4: Swap the positions of 2 of your protocols
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'prompt_swap_protocols',
                sourceCardId: card.id,
                actor,
            }
        }
    };
}