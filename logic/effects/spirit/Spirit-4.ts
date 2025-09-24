/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Spirit-4: Swap the positions of 2 of your protocols
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const newState = log(state, actor, `Spirit-4 prompts to swap protocols.`);
    newState.actionRequired = {
        type: 'prompt_swap_protocols',
        sourceCardId: card.id,
        actor,
        target: actor,
    };
    return { newState };
}