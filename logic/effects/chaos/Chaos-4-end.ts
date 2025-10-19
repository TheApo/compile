/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Chaos-4 End Effect: "Discard your hand. Draw the same amount of cards."
 *
 * Auto-execute: Discards all cards in hand, then draws that many cards.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const handSize = state[cardOwner].hand.length;

    if (handSize === 0) {
        // No cards to discard
        return { newState: state };
    }

    let newState = { ...state };

    // Discard entire hand
    const playerState = { ...newState[cardOwner] };
    playerState.discard = [...playerState.discard, ...playerState.hand];
    playerState.hand = [];
    newState[cardOwner] = playerState;

    newState = log(newState, cardOwner, `Chaos-4: Discarded ${handSize} card(s).`);

    // Draw same amount
    newState = drawForPlayer(newState, cardOwner, handSize);
    newState = log(newState, cardOwner, `Chaos-4: Drew ${handSize} card(s).`);

    return { newState };
};
