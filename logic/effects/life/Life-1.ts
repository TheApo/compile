/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../../logic/utils/log";

/**
 * Life-1: Flip 1 card. Flip 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    if (allCards.length > 0) {
        let newState = { ...state };
        newState = log(newState, actor, "Life-1: Prompts to flip 2 cards.");
        newState.actionRequired = {
            type: 'select_any_card_to_flip',
            count: 2,
            sourceCardId: card.id,
        };
        return { newState };
    }
    return { newState: state };
};