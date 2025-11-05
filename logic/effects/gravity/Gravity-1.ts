/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Gravity-1: Draw 2 cards. Shift 1 card either to or from this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = drawForPlayer(state, cardOwner, 2);
    newState = log(newState, cardOwner, "Gravity-1: Draw 2 cards.");

    const allCardsOnBoard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()];

    // Check if valid shift targets exist (considering Frost-3 blockades and Gravity-1 rules)
    const hasValidShiftTargets = (): boolean => {
        // Helper: Check if Frost-3 is in a lane (blocks shifts to/from that LINE - both sides)
        const hasFrost3InLane = (laneIdx: number): boolean => {
            const playerHasFrost3 = newState.player.lanes[laneIdx].some(c =>
                c.isFaceUp && c.protocol === 'Frost' && c.value === 3
            );
            const opponentHasFrost3 = newState.opponent.lanes[laneIdx].some(c =>
                c.isFaceUp && c.protocol === 'Frost' && c.value === 3
            );
            return playerHasFrost3 || opponentHasFrost3;
        };

        // For each card on the board, check if it has a valid destination lane
        for (const cardOnBoard of allCardsOnBoard) {
            // Find the source lane of this card
            let sourceLane = -1;
            let cardOwnerSide: 'player' | 'opponent' | null = null;

            for (let i = 0; i < 3; i++) {
                if (newState.player.lanes[i].some(c => c.id === cardOnBoard.id)) {
                    sourceLane = i;
                    cardOwnerSide = 'player';
                    break;
                }
                if (newState.opponent.lanes[i].some(c => c.id === cardOnBoard.id)) {
                    sourceLane = i;
                    cardOwnerSide = 'opponent';
                    break;
                }
            }

            if (sourceLane === -1) continue;

            // Check all 3 lanes as possible destinations
            for (let targetLane = 0; targetLane < 3; targetLane++) {
                // Cannot shift to the same lane
                if (targetLane === sourceLane) continue;

                // Must shift "to or from" Gravity-1's lane
                const isFromGravityLane = sourceLane === laneIndex;
                const isToGravityLane = targetLane === laneIndex;
                if (!isFromGravityLane && !isToGravityLane) continue;

                // Check if Frost-3 blocks the SOURCE lane
                if (hasFrost3InLane(sourceLane)) continue;

                // Check if Frost-3 blocks the DESTINATION lane
                if (hasFrost3InLane(targetLane)) continue;

                // Found at least one valid shift target
                return true;
            }
        }
        return false; // No valid lanes found
    };

    if (allCardsOnBoard.length > 0 && hasValidShiftTargets()) {
        newState.actionRequired = {
            type: 'select_card_to_shift_for_gravity_1',
            sourceCardId: card.id,
            sourceLaneIndex: laneIndex,
            actor: cardOwner,
        };
    } else if (allCardsOnBoard.length > 0) {
        // Cards exist but no valid shift targets available
        newState = log(newState, cardOwner, "Gravity-1: No valid shift targets available (blocked by Frost-3 or lane restrictions).");
    }

    return { newState };
};