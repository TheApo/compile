/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";
import { v4 as uuidv4 } from 'uuid';
import { executeOnCoverEffect } from "../../effectExecutor";

/**
 * Gravity-6: Your opponent plays the top card of their deck face-down in this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
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
        onCoverResult = executeOnCoverEffect(cardToBeCovered, laneIndex, stateBeforePlay);
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
    finalState = log(finalState, actor, `Gravity-6: Opponent plays the top card of their deck face-down into Protocol ${protocolName}.`);
    
    return { 
        newState: finalState, 
        animationRequests: onCoverResult.animationRequests 
    };
};
