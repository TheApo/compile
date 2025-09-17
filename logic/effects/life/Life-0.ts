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
 * Life-0: Play the top card of your deck face-down in each line where you have a card.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const playerState = { ...newState[actor] };

    const lanesWithCards = [];
    for (let i = 0; i < 3; i++) {
        // Check includes the just-played card.
        if (newState[actor].lanes[i].length > 0) {
            lanesWithCards.push(i);
        }
    }

    if (lanesWithCards.length === 0) {
        return { newState };
    }

    const cardsToBeCovered = lanesWithCards
        .map(idx => {
            const lane = newState[actor].lanes[idx];
            return lane.length > 0 ? { card: lane[lane.length - 1], laneIndex: idx } : null;
        })
        .filter((item): item is { card: PlayedCard; laneIndex: number } => item !== null);

    const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, lanesWithCards.length);

    if (drawnCards.length === 0) {
        return { newState };
    }

    const newPlayerLanes = [...playerState.lanes];
    for (let i = 0; i < drawnCards.length; i++) {
        const targetLaneIndex = lanesWithCards[i];
        const newCard = { ...drawnCards[i], id: uuidv4(), isFaceUp: false };
        newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCard];
    }
    
    newState[actor] = {
        ...playerState,
        lanes: newPlayerLanes,
        deck: remainingDeck,
        discard: newDiscard,
    };
    
    newState = log(newState, actor, `Life-0: Plays ${drawnCards.length} card(s) face-down.`);

    let finalResult: EffectResult = { newState };

    for (const { card: coveredCard, laneIndex: coveredLaneIndex } of cardsToBeCovered) {
        const onCoverResult = executeOnCoverEffect(coveredCard, coveredLaneIndex, finalResult.newState);
        if (onCoverResult.newState !== finalResult.newState || onCoverResult.animationRequests) {
            finalResult.newState = onCoverResult.newState;
            if (onCoverResult.animationRequests) {
                finalResult.animationRequests = [
                    ...(finalResult.animationRequests || []),
                    ...onCoverResult.animationRequests
                ];
            }
            if (finalResult.newState.actionRequired) {
                break; 
            }
        }
    }

    return finalResult;
};