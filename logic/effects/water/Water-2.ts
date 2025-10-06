/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Water-2: Draw 2 cards. Rearrange your protocols.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawForPlayer(state, cardOwner, 2);
    newState = log(newState, cardOwner, "Water-2: Draw 2 cards.");

    newState.actionRequired = {
        type: 'prompt_rearrange_protocols',
        sourceCardId: card.id,
        target: cardOwner,
        actor: cardOwner,
    };

    return { newState };
};