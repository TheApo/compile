/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { log } from "../../utils/log";
import { isFrost1BottomActive } from "../common/frost1Check";

/**
 * Anarchy-3 End Effect: "Rearrange your protocols. Anarchy cannot be on this line."
 *
 * This is similar to other rearrange effects, but with a critical restriction:
 * The player CANNOT place Anarchy protocol on the lane where this Anarchy-3 card is face-up and uncovered.
 *
 * The restriction is enforced in the promptResolver when processing the rearrange action.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Check if Frost-1 Bottom effect is active (blocks protocol rearrangement)
    if (isFrost1BottomActive(state)) {
        const targetName = cardOwner === 'player' ? "Player's" : "Opponent's";
        const newState = log(state, cardOwner, `Frost-1 blocks protocol rearrangement. ${targetName} protocols remain unchanged.`);
        return { newState };
    }

    // Find which lane this Anarchy-3 card is in
    let anarchyLaneIndex = -1;
    for (let i = 0; i < 3; i++) {
        const lane = state[cardOwner].lanes[i];
        const topCard = lane.length > 0 ? lane[lane.length - 1] : null;
        // Check if this card is uncovered (top of lane) and face-up
        if (topCard && topCard.id === card.id && topCard.isFaceUp) {
            anarchyLaneIndex = i;
            break;
        }
    }

    // If card is not found or not uncovered, no restriction applies (shouldn't happen in End phase)
    if (anarchyLaneIndex === -1) {
        return { newState: state };
    }

    const newState = log(state, cardOwner, `Anarchy-3: Rearrange protocols (Anarchy cannot be on line ${anarchyLaneIndex}).`);

    newState.actionRequired = {
        type: 'prompt_rearrange_protocols',
        sourceCardId: card.id,
        target: cardOwner,
        actor: cardOwner,
        // Store the restriction info so the resolver knows which lane to block Anarchy from
        disallowedProtocolForLane: {
            laneIndex: anarchyLaneIndex,
            protocol: 'Anarchy'
        }
    };

    return { newState };
};
