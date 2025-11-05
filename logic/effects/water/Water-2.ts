/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";
import { isFrost1BottomActive } from "../common/frost1Check";

/**
 * Water-2: Draw 2 cards. Rearrange your protocols.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawForPlayer(state, cardOwner, 2);
    newState = log(newState, cardOwner, "Water-2: Draw 2 cards.");

    // Check if Frost-1 Bottom effect is active (blocks protocol rearrangement)
    if (isFrost1BottomActive(newState)) {
        const targetName = cardOwner === 'player' ? "Player's" : "Opponent's";
        newState = log(newState, cardOwner, `Frost-1 blocks protocol rearrangement. ${targetName} protocols remain unchanged.`);
        return { newState };
    }

    newState.actionRequired = {
        type: 'prompt_rearrange_protocols',
        sourceCardId: card.id,
        target: cardOwner,
        actor: cardOwner,
    };

    return { newState };
};