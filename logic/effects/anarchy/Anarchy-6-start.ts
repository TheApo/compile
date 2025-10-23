/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Anarchy-6 Start Phase: "Flip this card, if this card is in the line with the Anarchy protocol."
 *
 * Checks if the card is in a lane where one of the two protocols is "Anarchy".
 * If yes: Flips this card (from face-up to face-down).
 * If no: Does nothing.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;

    // Find which lane this card is in
    let cardLaneIndex = -1;
    for (let i = 0; i < 3; i++) {
        const lane = state[cardOwner].lanes[i];
        if (lane.some(c => c.id === card.id)) {
            cardLaneIndex = i;
            break;
        }
    }

    if (cardLaneIndex === -1) {
        // Card not found (shouldn't happen)
        return { newState: state };
    }

    // Check if either protocol in this lane is "Anarchy"
    const playerProtocol = state.player.protocols[cardLaneIndex];
    const opponentProtocol = state.opponent.protocols[cardLaneIndex];
    const isInAnarchyLane = playerProtocol === 'Anarchy' || opponentProtocol === 'Anarchy';

    if (isInAnarchyLane) {
        // Flip this card
        const cardName = `${card.protocol}-${card.value}`;
        let newState = log(state, cardOwner, `${cardName} Start Phase: In Anarchy line - flipping itself.`);
        newState = findAndFlipCards(new Set([card.id]), newState);
        newState.animationState = { type: 'flipCard', cardId: card.id };
        return { newState };
    } else {
        // Not in Anarchy lane - do nothing
        return { newState: state };
    }
};
