/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";
import { effectRegistryOnCover } from "../effectRegistryOnCover";

/**
 * Water-1: Play the top card of your deck face-down in each other line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    let newState = { ...state };
    const playerState = { ...newState[actor] };

    const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
    if (otherLaneIndices.length === 0) return { newState };

    const cardsToBeCovered = otherLaneIndices
        .map(idx => {
            const lane = newState[actor].lanes[idx];
            return lane.length > 0 ? { card: lane[lane.length - 1], laneIndex: idx } : null;
        })
        .filter((item): item is { card: PlayedCard; laneIndex: number } => item !== null);

    const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, otherLaneIndices.length);

    if (drawnCards.length === 0) {
        return { newState };
    }

    const newPlayerLanes = [...playerState.lanes];
    for (let i = 0; i < drawnCards.length; i++) {
        const targetLaneIndex = otherLaneIndices[i];
        const newCard = { ...drawnCards[i], id: uuidv4(), isFaceUp: false };
        newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCard];
    }
    
    newState[actor] = {
        ...playerState,
        lanes: newPlayerLanes,
        deck: remainingDeck,
        discard: newDiscard,
    };
    
    newState = log(newState, actor, `Water-1: Plays ${drawnCards.length} card(s) face-down in other lines.`);

    let finalResult: EffectResult = { newState };

    for (const { card: coveredCard, laneIndex: coveredLaneIndex } of cardsToBeCovered) {
        const effectKey = `${coveredCard.protocol}-${coveredCard.value}`;
        const onCoverExecute = effectRegistryOnCover[effectKey];
        if (onCoverExecute) {
            // FIX: Added missing 'actor' argument for the owner of the covered card.
            const onCoverResult = onCoverExecute(coveredCard, coveredLaneIndex, finalResult.newState, actor);
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
