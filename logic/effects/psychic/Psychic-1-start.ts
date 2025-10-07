/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Psychic-1 Start Phase: Flip this card.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const cardName = `${card.protocol}-${card.value}`;
    let newState = log(state, cardOwner, `${cardName} Start Phase: Flipping itself.`);
    newState = findAndFlipCards(new Set([card.id]), newState);
    newState.animationState = { type: 'flipCard', cardId: card.id };
    return { newState };
};