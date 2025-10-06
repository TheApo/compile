/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, PlayedCard, EffectResult, EffectContext, AnimationRequest } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { executeOnCoverEffect } from "../../effectExecutor";

/**
 * Water-1: Play the top card of your deck face-down in each other line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const stateBeforePlay = { ...state };
    const playerState = { ...stateBeforePlay[cardOwner] };

    const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
    if (otherLaneIndices.length === 0) return { newState: state };

    const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, otherLaneIndices.length);
    if (drawnCards.length === 0) {
        return { newState: state };
    }

    const newCardsToPlay = drawnCards.map(c => ({ ...c, id: uuidv4(), isFaceUp: false }));

    // --- On-Cover Logic ---
    // First, handle all on-cover effects sequentially before adding the new cards to the board.
    let stateAfterOnCover = stateBeforePlay;
    let combinedOnCoverAnimations: AnimationRequest[] = [];

    // Note: The game rules state that for "each", you note all valid targets and then process them sequentially.
    // The order is decided by the card's owner. We will process them in lane order for simplicity.
    for (let i = 0; i < otherLaneIndices.length; i++) {
        const targetLaneIndex = otherLaneIndices[i];
        const lane = stateAfterOnCover[cardOwner].lanes[targetLaneIndex];

        if (lane.length > 0) {
            const cardToBeCovered = lane[lane.length - 1];
            // IMPORTANT: The on-cover effect is called with the state *before* the new card is on the board.
            // The state is updated between each check to handle sequential triggers.
            const coverContext: EffectContext = {
                ...context,
                triggerType: 'cover'
            };
            const onCoverResult = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateAfterOnCover, coverContext);
            stateAfterOnCover = onCoverResult.newState;
            if (onCoverResult.animationRequests) {
                combinedOnCoverAnimations.push(...onCoverResult.animationRequests);
            }
            if (stateAfterOnCover.actionRequired) {
                // An interrupt occurred. The remaining card plays will not happen to prevent complex state issues.
                break;
            }
        }
    }

    // --- Play Cards Logic ---
    // Now, add the new cards to the state that has processed the on-cover effects.
    const finalPlayerState = { ...stateAfterOnCover[cardOwner] };
    const newPlayerLanes = [...finalPlayerState.lanes];
    for (let i = 0; i < newCardsToPlay.length; i++) {
        const targetLaneIndex = otherLaneIndices[i];
        newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCardsToPlay[i]];
    }

    finalPlayerState.lanes = newPlayerLanes;
    finalPlayerState.deck = remainingDeck;
    finalPlayerState.discard = newDiscard;

    let finalState = { ...stateAfterOnCover, [cardOwner]: finalPlayerState };
    finalState = log(finalState, cardOwner, `Water-1: Plays ${drawnCards.length} card(s) face-down in other lines.`);
    
    return { 
        newState: finalState, 
        animationRequests: combinedOnCoverAnimations.length > 0 ? combinedOnCoverAnimations : undefined 
    };
};
