/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawCards } from "../../../utils/gameStateModifiers";
import { log } from "../../../logic/utils/log";
import { v4 as uuidv4 } from 'uuid';
import { effectRegistryOnCover } from "../effectRegistryOnCover";

/**
 * Gravity-6: Your opponent plays the top card of their deck face-down in this line.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponent = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };

    const opponentState = { ...newState[opponent] };
    const opponentLaneBeforePlay = opponentState.lanes[laneIndex];
    const cardToBeCovered = opponentLaneBeforePlay.length > 0 ? opponentLaneBeforePlay[opponentLaneBeforePlay.length - 1] : null;

    const { drawnCards, remainingDeck, newDiscard } = drawCards(opponentState.deck, opponentState.discard, 1);
    
    if (drawnCards.length > 0) {
        const newCard = { ...drawnCards[0], id: uuidv4(), isFaceUp: false };
        
        const newOpponentLanes = [...opponentState.lanes];
        newOpponentLanes[laneIndex] = [...newOpponentLanes[laneIndex], newCard];

        newState[opponent] = {
            ...opponentState,
            lanes: newOpponentLanes,
            deck: remainingDeck,
            discard: newDiscard,
        };

        const protocolName = newState[opponent].protocols[laneIndex];
        newState = log(newState, actor, `Gravity-6: Opponent plays the top card of their deck face-down into Protocol ${protocolName}.`);
        
        let finalResult: EffectResult = { newState };

        if (cardToBeCovered) {
            const effectKey = `${cardToBeCovered.protocol}-${cardToBeCovered.value}`;
            const onCoverExecute = effectRegistryOnCover[effectKey];
            if (onCoverExecute) {
                const onCoverResult = onCoverExecute(cardToBeCovered, laneIndex, finalResult.newState);
                finalResult.newState = onCoverResult.newState;
                if (onCoverResult.animationRequests) {
                    finalResult.animationRequests = [
                        ...(finalResult.animationRequests || []),
                        ...onCoverResult.animationRequests
                    ];
                }
            }
        }
        return finalResult;
    }

    return { newState };
};