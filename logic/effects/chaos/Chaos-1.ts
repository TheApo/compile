/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";
import { isFrost1BottomActive } from "../common/frost1Check";

/**
 * Chaos-1 Middle Command: "Rearrange your protocols. Rearrange your opponent's protocols."
 *
 * Triggers two rearrange actions:
 * 1. CardOwner rearranges their own protocols (actionRequired)
 * 2. CardOwner then rearranges opponent's protocols (queued)
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const opponent: Player = cardOwner === 'player' ? 'opponent' : 'player';

    let newState = log(state, cardOwner, `${cardOwner === 'player' ? 'Player' : 'Opponent'}'s Chaos-1 triggers.`);

    // Check if Frost-1 Bottom effect is active (blocks protocol rearrangement)
    if (isFrost1BottomActive(newState)) {
        newState = log(newState, cardOwner, `Frost-1 blocks protocol rearrangement. All protocols remain unchanged.`);
        return { newState };
    }

    // First action: Rearrange own protocols
    newState.actionRequired = {
        type: 'prompt_rearrange_protocols',
        sourceCardId: card.id,
        target: cardOwner,
        actor: cardOwner,
    };

    // Second action: Queue rearrange of opponent's protocols
    newState.queuedActions = [
        ...newState.queuedActions || [],
        {
            type: 'prompt_rearrange_protocols',
            sourceCardId: card.id,
            target: opponent,
            actor: cardOwner,
        }
    ];

    return { newState };
};
