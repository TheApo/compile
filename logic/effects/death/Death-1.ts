/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult } from "../../../types";

export const execute = (card: PlayedCard, state: GameState): EffectResult => {
    return {
        newState: {
            ...state,
            actionRequired: {
                type: 'prompt_death_1_effect',
                sourceCardId: card.id,
                optional: true,
            }
        }
    };
};