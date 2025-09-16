/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../../../types";
import { log } from "../../utils/log";

/**
 * Love-3: Take 1 random card from your opponent's hand. Give 1 card from your hand to your opponent.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult => {
    const opponentId = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...state };
    
    const opponentState = { ...newState[opponentId] };
    const actorState = { ...newState[actor] };

    if (opponentState.hand.length === 0) {
        newState = log(newState, actor, "Love-3: Opponent has no cards to take.");
        return { newState };
    }

    // Take a random card
    const randomIndex = Math.floor(Math.random() * opponentState.hand.length);
    const takenCard = opponentState.hand.splice(randomIndex, 1)[0];
    actorState.hand.push(takenCard);
    
    newState = {
        ...newState,
        [actor]: actorState,
        [opponentId]: opponentState,
    };

    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const takenCardName = actor === 'player' ? `${takenCard.protocol}-${takenCard.value}` : 'a random card';
    newState = log(newState, actor, `Love-3: ${actorName} takes ${takenCardName} from the opponent.`);

    // Set up the mandatory "give" action
    newState.actionRequired = {
        type: 'select_card_from_hand_to_give',
        sourceCardId: card.id,
        sourceEffect: 'love_3',
        actor,
    };

    return { newState };
}