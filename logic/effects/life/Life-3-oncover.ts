/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Life-3: When this card would be covered: First, play the top card of your deck face-down in another line.
 */
export const execute = (coveredCard: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    // Check if the OWNER has cards in deck or discard to play
    if (state[cardOwner].deck.length > 0 || state[cardOwner].discard.length > 0) {
        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_lane_for_life_3_play',
            sourceCardId: coveredCard.id,
            disallowedLaneIndex: laneIndex,
            actor: cardOwner,
        };
        // This requires an interrupt if the owner is not the current turn player.
        if (state.turn !== cardOwner) {
            newState._interruptedTurn = state.turn;
            newState._interruptedPhase = state.phase;
            newState.turn = cardOwner;
        }
        return { newState };
    }
    return { newState: state };
};