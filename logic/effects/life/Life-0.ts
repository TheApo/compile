/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, AnimationRequest } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { v4 as uuidv4 } from 'uuid';
import { executeOnCoverEffect } from "../../effectExecutor";

/**
 * Life-0: Play the top card of your deck face-down in each line where you have a card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const stateBeforePlay = { ...state };
    const playerState = { ...stateBeforePlay[cardOwner] };

    const lanesWithCards = [];
    for (let i = 0; i < 3; i++) {
        // Check includes the just-played card.
        if (stateBeforePlay[cardOwner].lanes[i].length > 0) {
            lanesWithCards.push(i);
        }
    }
    if (lanesWithCards.length === 0) return { newState: state };

    const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, lanesWithCards.length);
    if (drawnCards.length === 0) return { newState: state };

    const newCardsToPlay = drawnCards.map(c => ({ ...c, id: uuidv4(), isFaceUp: false }));

    // --- On-Cover Logic ---
    let stateAfterOnCover = stateBeforePlay;
    let combinedOnCoverAnimations: AnimationRequest[] = [];
    for (let i = 0; i < lanesWithCards.length; i++) {
        const targetLaneIndex = lanesWithCards[i];
        const lane = stateAfterOnCover[cardOwner].lanes[targetLaneIndex];

        if (lane.length > 0) {
            const cardToBeCovered = lane[lane.length - 1];
            // Build context for executeOnCoverEffect
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
                break;
            }
        }
    }

    // --- Play Cards Logic ---
    const finalPlayerState = { ...stateAfterOnCover[cardOwner] };
    const newPlayerLanes = [...finalPlayerState.lanes];
    for (let i = 0; i < newCardsToPlay.length; i++) {
        const targetLaneIndex = lanesWithCards[i];
        newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCardsToPlay[i]];
    }

    finalPlayerState.lanes = newPlayerLanes;
    finalPlayerState.deck = remainingDeck;
    finalPlayerState.discard = newDiscard;

    let finalState = { ...stateAfterOnCover, [cardOwner]: finalPlayerState };
    finalState = log(finalState, cardOwner, `Life-0: Plays ${drawnCards.length} card(s) face-down.`);

    return {
        newState: finalState,
        animationRequests: combinedOnCoverAnimations.length > 0 ? combinedOnCoverAnimations : undefined
    };
};
