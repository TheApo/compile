/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";

/**
 * Fire-2: Discard 1 card. If you do, return 1 card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };
    if (newState[cardOwner].hand.length > 0) {
        newState.actionRequired = {
            type: 'discard',
            actor: cardOwner,
            count: 1,
            sourceCardId: card.id,
            sourceEffect: 'fire_2',
            previousHandSize: newState[cardOwner].hand.length, // Track for "If you do" check
        } as any;
    }
    return { newState };
}