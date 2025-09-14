/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";

/**
 * Light-0: Flip 1 card. Draw cards equal to that card's value.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allCardsOnBoard = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];

    if (allCardsOnBoard.length > 0) {
        return {
            newState: {
                ...state,
                actionRequired: {
                    type: 'select_card_to_flip_for_light_0',
                    sourceCardId: card.id,
                    actor,
                }
            }
        };
    }

    return { newState: state };
};