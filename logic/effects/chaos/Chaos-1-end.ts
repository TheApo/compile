/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Chaos-1 End Effect: "Rearrange your protocols. Rearrange your opponent's protocols."
 *
 * Triggers two rearrange actions:
 * 1. CardOwner rearranges their own protocols (actionRequired)
 * 2. CardOwner then rearranges opponent's protocols (queued)
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const opponent: Player = cardOwner === 'player' ? 'opponent' : 'player';

    let newState = log(state, cardOwner, `${cardOwner === 'player' ? 'Player' : 'Opponent'}'s Chaos-1 end effect triggers.`);

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
