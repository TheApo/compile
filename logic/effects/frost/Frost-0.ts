/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Frost-0: Draw 1 card for each face-down card.
 * Counts ALL face-down cards on the entire field (both players).
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;

    // Count all face-down cards on both players' fields
    let faceDownCount = 0;

    // Count player's face-down cards
    state[cardOwner].lanes.forEach(lane => {
        lane.forEach(c => {
            if (!c.isFaceUp) faceDownCount++;
        });
    });

    // Count opponent's face-down cards
    state[opponent].lanes.forEach(lane => {
        lane.forEach(c => {
            if (!c.isFaceUp) faceDownCount++;
        });
    });

    let newState = { ...state };
    if (faceDownCount > 0) {
        newState = drawForPlayer(newState, cardOwner, faceDownCount);
        newState = log(newState, cardOwner, `Frost-0: Counted ${faceDownCount} face-down card(s). Draw ${faceDownCount} card(s).`);
    } else {
        newState = log(newState, cardOwner, "Frost-0: No face-down cards on the field. Draw 0 cards.");
    }

    return { newState };
}
