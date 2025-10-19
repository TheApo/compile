/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from "../../../types";
import { v4 as uuidv4 } from 'uuid';
import { log } from "../../utils/log";

/**
 * Chaos-0 Start Effect: "Draw the top card of your opponent's deck. Your opponent draws the top card of your deck."
 *
 * Auto-execute: Both players draw from each other's decks.
 * Ownership transfers to the new owner.
 */
export const execute = (card: PlayedCard, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    const opponent: Player = cardOwner === 'player' ? 'opponent' : 'player';

    let newState = { ...state };

    // CardOwner draws from opponent's deck
    if (newState[opponent].deck.length > 0) {
        const drawnCard = newState[opponent].deck.shift()!;
        drawnCard.id = uuidv4(); // New ID for tracking
        newState[cardOwner].hand.push(drawnCard);

        newState = log(
            newState,
            cardOwner,
            `${cardOwner === 'player' ? 'Player' : 'Opponent'} drew ${drawnCard.protocol}-${drawnCard.value} from ${opponent === 'player' ? 'Player' : 'Opponent'}'s deck via Chaos-0.`
        );
    } else {
        newState = log(
            newState,
            cardOwner,
            `${cardOwner === 'player' ? 'Player' : 'Opponent'} could not draw from ${opponent === 'player' ? 'Player' : 'Opponent'}'s deck (empty) via Chaos-0.`
        );
    }

    // Opponent draws from cardOwner's deck
    if (newState[cardOwner].deck.length > 0) {
        const drawnCard = newState[cardOwner].deck.shift()!;
        drawnCard.id = uuidv4(); // New ID for tracking
        newState[opponent].hand.push(drawnCard);

        newState = log(
            newState,
            opponent,
            `${opponent === 'player' ? 'Player' : 'Opponent'} drew ${drawnCard.protocol}-${drawnCard.value} from ${cardOwner === 'player' ? 'Player' : 'Opponent'}'s deck via Chaos-0.`
        );
    } else {
        newState = log(
            newState,
            opponent,
            `${opponent === 'player' ? 'Player' : 'Opponent'} could not draw from ${cardOwner === 'player' ? 'Player' : 'Opponent'}'s deck (empty) via Chaos-0.`
        );
    }

    return { newState };
}
