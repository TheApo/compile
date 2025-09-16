/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { drawCards, checkForSpirit3Trigger } from "../../../utils/gameStateModifiers";
import { log } from "../../utils/log";

/**
 * Love-1: Draw the top card of your opponent's deck.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponentId = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    const opponentState = { ...newState[opponentId] };
    const actorState = { ...newState[actor] };

    const { drawnCards, remainingDeck, newDiscard } = drawCards(opponentState.deck, opponentState.discard, 1);
    
    if (drawnCards.length > 0) {
        const newCardForHand = { ...drawnCards[0], id: uuidv4(), isFaceUp: true };
        
        actorState.hand = [...actorState.hand, newCardForHand];
        opponentState.deck = remainingDeck;
        opponentState.discard = newDiscard;
        
        newState = {
            ...newState,
            [actor]: actorState,
            [opponentId]: opponentState,
        };
        
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, actor, `Love-1: ${actorName} draws the top card of the opponent's deck.`);

        // After adding card to hand, check for the trigger
        newState = checkForSpirit3Trigger(newState, actor);
    }

    return { newState };
}