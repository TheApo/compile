/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";

/**
 * Anarchy-3 Middle Effect: "Swap the positions of 2 of your opponent's protocols"
 *
 * Similar to Spirit-4, but swaps OPPONENT's protocols instead of own protocols.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    const newState = log(state, cardOwner, `Anarchy-3 prompts to swap opponent's protocols.`);

    // Use existing swap protocol action, but target the opponent
    newState.actionRequired = {
        type: 'prompt_swap_protocols',
        sourceCardId: card.id,
        actor: cardOwner,
        target: opponent, // KEY: Swap opponent's protocols
    };

    return { newState };
};
