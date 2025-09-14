/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState } from '../../../types';
import { log } from '../../utils/log';
import { drawForPlayer } from '../../../utils/gameStateModifiers';

export const resolveActionWithHandCard = (prevState: GameState, cardId: string): GameState => {
    if (!prevState.actionRequired) return prevState;

    const { actionRequired } = prevState;
    const actor = prevState.turn;
    const opponent = actor === 'player' ? 'opponent' : 'player';

    switch (actionRequired.type) {
        case 'select_card_from_hand_to_give': {
            const cardToGive = prevState[actor].hand.find(c => c.id === cardId);
            if (!cardToGive) return prevState;

            let newState = { ...prevState };
            const actorState = { ...newState[actor] };
            const opponentState = { ...newState[opponent] };

            // Move card
            actorState.hand = actorState.hand.filter(c => c.id !== cardId);
            opponentState.hand = [...opponentState.hand, cardToGive];

            newState = { ...newState, [actor]: actorState, [opponent]: opponentState };

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const cardName = `${cardToGive.protocol}-${cardToGive.value}`;
            newState = log(newState, actor, `${actorName} gives ${cardName} to the opponent.`);

            // Handle specific effect follow-ups
            if (actionRequired.sourceEffect === 'love_1_end') {
                newState = log(newState, actor, `Love-1: ${actorName} draws 2 cards.`);
                newState = drawForPlayer(newState, actor, 2);
            }

            newState.actionRequired = null;
            return newState;
        }

        case 'select_card_from_hand_to_reveal': {
            const cardToReveal = prevState[actor].hand.find(c => c.id === cardId);
            if (!cardToReveal) return prevState;
            
            let newState = { ...prevState };
            const actorState = { ...newState[actor] };

            // Mark the card as revealed in the hand
            const newHand = actorState.hand.map(c => 
                c.id === cardId ? { ...c, isRevealed: true } : c
            );
            actorState.hand = newHand;
            newState = { ...newState, [actor]: actorState };

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            // FIX: Corrected typo from `cardToGive` to `cardToReveal`.
            const cardName = `${cardToReveal.protocol}-${cardToReveal.value}`;
            newState = log(newState, actor, `Love-4: ${actorName} reveals ${cardName} from their hand.`);
            
            // Set up the next part of the effect: Flip 1 card
            newState.actionRequired = {
                type: 'select_any_card_to_flip',
                count: 1,
                sourceCardId: actionRequired.sourceCardId,
                actor,
            };
            return newState;
        }

        default:
            return prevState;
    }
};