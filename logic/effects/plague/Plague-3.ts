/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Plague-3: Flip each other face-up card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    const cardsToFlip = new Set(allCards.filter(c => c.id !== card.id && c.isFaceUp).map(c => c.id));
    if (cardsToFlip.size > 0) {
        let newState = { ...state };
        newState = log(newState, actor, `Plague-3: Flip ${cardsToFlip.size} card(s) face-down.`);
        return { newState: findAndFlipCards(cardsToFlip, state) };
    }
    return { newState: state };
}