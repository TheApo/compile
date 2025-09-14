/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";

/**
 * Darkness-0: Draw 3 cards. Shift 1 of your opponent's covered cards.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = drawForPlayer(state, actor, 3);
    newState = log(newState, actor, "Darkness-0: Draw 3 cards.");
    
    // After drawing, check for the shift condition
    const opponentCoveredCards = newState[opponent].lanes.flatMap(lane => 
        lane.filter((c, index) => index < lane.length - 1)
    );
    if (opponentCoveredCards.length > 0) {
        newState = log(newState, actor, "Darkness-0: Prompts to shift 1 of opponent's covered cards.");
        newState.actionRequired = {
            type: 'select_opponent_covered_card_to_shift',
            sourceCardId: card.id,
        };
    }

    return { newState };
}