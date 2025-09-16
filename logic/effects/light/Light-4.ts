/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Light-4: Your opponent reveals their hand.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponentId = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    const opponentState = { ...newState[opponentId] };

    if (opponentState.hand.length > 0) {
        // Mark the opponent's hand as revealed. The UI will update to show the card faces.
        opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
        newState[opponentId] = opponentState;
        
        const cardName = `${card.protocol}-${card.value}`;
        newState = log(newState, actor, `${cardName}: Your opponent reveals their hand.`);
    } else {
        const cardName = `${card.protocol}-${card.value}`;
        newState = log(newState, actor, `${cardName}: Opponent has no cards to reveal.`);
    }

    // This effect resolves immediately and does not require further action, so we don't set actionRequired.
    return { newState };
};