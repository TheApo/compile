/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../../types";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { log, setLogSource, setLogPhase } from "../../utils/log";

/**
 * Anarchy-0: Shift 1 card. For each line that contains a face-up card without matching protocol, draw 1 card.
 *
 * Effect breakdown:
 * 1. Player must shift 1 card (any uncovered card on board)
 * 2. Then, check all 3 lines:
 *    - For each line where a face-up card exists that doesn't match EITHER protocol in that line
 *    - Draw 1 card per such line
 *
 * Example: Fire-3 (face-up) in Death/Water line = non-matching → draw 1 card
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // CRITICAL FIX: Check if there are any UNCOVERED cards to shift (standard targeting rule)
    const uncoveredCards: PlayedCard[] = [];
    for (const player of ['player', 'opponent'] as const) {
        for (const lane of newState[player].lanes) {
            if (lane.length > 0) {
                uncoveredCards.push(lane[lane.length - 1]); // Only top card is uncovered
            }
        }
    }

    if (uncoveredCards.length === 0) {
        // No uncovered cards to shift, skip directly to conditional draw
        newState = log(newState, cardOwner, "Anarchy-0: No uncovered cards to shift. Skipping to conditional draw.");
        newState = handleAnarchyConditionalDraw(newState, cardOwner);
        return { newState };
    }

    // Request player to shift a card
    newState.actionRequired = {
        type: 'select_card_to_shift_for_anarchy_0',
        sourceCardId: card.id,
        actor: cardOwner,
    };

    return { newState };
};

/**
 * Helper function: Check all lines for non-matching face-up cards and draw accordingly
 * This is called AFTER the shift is resolved
 */
export const handleAnarchyConditionalDraw = (state: GameState, cardOwner: 'player' | 'opponent'): GameState => {
    let newState = { ...state };

    // IMPORTANT: Set context for Anarchy-0 effect
    // This ensures the logs are properly indented and prefixed
    newState = setLogSource(newState, 'Anarchy-0');
    newState = setLogPhase(newState, 'middle');

    let cardsToDraw = 0;

    // Check all 3 lines
    for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
        const playerProtocol = newState.player.protocols[laneIdx];
        const opponentProtocol = newState.opponent.protocols[laneIdx];

        // Get all face-up cards in this line (both players' stacks)
        const playerCardsInLane = newState.player.lanes[laneIdx].filter(c => c.isFaceUp);
        const opponentCardsInLane = newState.opponent.lanes[laneIdx].filter(c => c.isFaceUp);
        const allFaceUpCardsInLane = [...playerCardsInLane, ...opponentCardsInLane];

        // Check if ANY face-up card in this line doesn't match EITHER protocol
        const hasNonMatchingCard = allFaceUpCardsInLane.some(c =>
            c.protocol !== playerProtocol && c.protocol !== opponentProtocol
        );

        if (hasNonMatchingCard) {
            cardsToDraw++;
        }
    }

    if (cardsToDraw > 0) {
        newState = drawForPlayer(newState, cardOwner, cardsToDraw);
        const playerName = cardOwner === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, cardOwner, `${playerName} draws ${cardsToDraw} card(s) from non-matching protocols.`);
    } else {
        newState = log(newState, cardOwner, "No non-matching face-up cards found. No draw.");
    }

    // Clear context after the effect completes
    newState = setLogSource(newState, undefined);
    newState = setLogPhase(newState, undefined);

    return newState;
};
