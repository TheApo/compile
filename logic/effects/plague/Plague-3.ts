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
    const cardsToFlip = new Set<string>();

    // Per default targeting rules, "Flip card" targets only uncovered cards.
    // "each" implies all valid targets are affected automatically.
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1]; // This is the uncovered card
                // Card must be face-up and not the Plague-3 card that is triggering the effect.
                if (topCard.id !== card.id && topCard.isFaceUp) {
                    cardsToFlip.add(topCard.id);
                }
            }
        }
    }
    
    if (cardsToFlip.size > 0) {
        let newState = { ...state };
        newState = log(newState, actor, `Plague-3: Flip ${cardsToFlip.size} card(s) face-down.`);
        // Note: findAndFlipCards will also update lane values.
        return { newState: findAndFlipCards(new Set(cardsToFlip), newState) };
    }
    
    return { newState: state };
}
