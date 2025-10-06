/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { v4 as uuidv4 } from 'uuid';
import { executeOnCoverEffect } from "../../effectExecutor";

/**
 * Gravity-6: Your opponent plays the top card of their deck face-down in this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner, opponent } = context;
    const stateBeforePlay = { ...state };

    const opponentState = { ...stateBeforePlay[opponent] };
    const { drawnCards, remainingDeck, newDiscard } = drawCards(opponentState.deck, opponentState.discard, 1);
    
    if (drawnCards.length === 0) {
        return { newState: state };
    }
    
    // --- On-Cover Logic ---
    let stateAfterOnCover = stateBeforePlay;
    let onCoverResult: EffectResult = { newState: stateAfterOnCover };
    const opponentLaneBeforePlay = stateBeforePlay[opponent].lanes[laneIndex];
    if (opponentLaneBeforePlay.length > 0) {
        const cardToBeCovered = opponentLaneBeforePlay[opponentLaneBeforePlay.length - 1];
        // Create a context for the on-cover effect (the opponent's card is being covered by Gravity-6's forced play)
        const onCoverContext: EffectContext = {
            cardOwner: opponent,
            actor: cardOwner, // The Gravity-6 owner is causing the cover
            currentTurn: context.currentTurn,
            opponent: cardOwner,
            triggerType: 'cover'
        };
        onCoverResult = executeOnCoverEffect(cardToBeCovered, laneIndex, stateBeforePlay, onCoverContext);
        stateAfterOnCover = onCoverResult.newState;
    }

    // --- Play Card Logic ---
    const newCard = { ...drawnCards[0], id: uuidv4(), isFaceUp: false };
    const finalOpponentState = { ...stateAfterOnCover[opponent] };

    const newOpponentLanes = [...finalOpponentState.lanes];
    newOpponentLanes[laneIndex] = [...newOpponentLanes[laneIndex], newCard];

    finalOpponentState.lanes = newOpponentLanes;
    finalOpponentState.deck = remainingDeck;
    finalOpponentState.discard = newDiscard;

    let finalState = { ...stateAfterOnCover, [opponent]: finalOpponentState };

    const protocolName = finalState[opponent].protocols[laneIndex];
    finalState = log(finalState, cardOwner, `Gravity-6: Opponent plays the top card of their deck face-down into Protocol ${protocolName}.`);
    
    return { 
        newState: finalState, 
        animationRequests: onCoverResult.animationRequests 
    };
};
