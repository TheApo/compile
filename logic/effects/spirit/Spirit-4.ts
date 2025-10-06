/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Spirit-4: Swap the positions of 2 of your protocols
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const newState = log(state, cardOwner, `Spirit-4 prompts to swap protocols.`);
    newState.actionRequired = {
        type: 'prompt_swap_protocols',
        sourceCardId: card.id,
        actor: cardOwner,
        target: cardOwner,
    };
    return { newState };
}