/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Life-3: When this card would be covered: First, play the top card of your deck face-down in another line.
 */
export const execute = (coveredCard: PlayedCard, laneIndex: number, state: GameState, owner: Player): EffectResult => {
    // Check if the OWNER has cards in deck or discard to play
    if (state[owner].deck.length > 0 || state[owner].discard.length > 0) {
        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_lane_for_life_3_play',
            sourceCardId: coveredCard.id,
            disallowedLaneIndex: laneIndex,
            actor: owner,
        };
        // This requires an interrupt if the owner is not the current turn player.
        if (state.turn !== owner) {
            newState._interruptedTurn = state.turn;
            newState.turn = owner;
        }
        return { newState };
    }
    return { newState: state };
};