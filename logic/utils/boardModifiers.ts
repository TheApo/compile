/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player } from "../../types";

export function deleteCardFromBoard(state: GameState, targetCardId: string): GameState {
    let cardOwner: Player | null = null;
    let cardToDelete: PlayedCard | null = null;
    const players: Player[] = ['player', 'opponent'];

    for (const player of players) {
        for (const lane of state[player].lanes) {
            const card = lane.find(c => c.id === targetCardId);
            if (card) {
                cardOwner = player;
                cardToDelete = card;
                break;
            }
        }
        if (cardOwner) break;
    }

    if (!cardOwner || !cardToDelete) {
        console.error("Card to delete not found on board:", targetCardId);
        return state;
    }
    
    const newState = { ...state };
    const ownerState = { ...newState[cardOwner] };
    
    ownerState.lanes = ownerState.lanes.map(lane => lane.filter(c => c.id !== targetCardId));
    
    const { id, isFaceUp, ...cardData } = cardToDelete;
    ownerState.discard = [...ownerState.discard, cardData];
    
    newState[cardOwner] = ownerState;
    
    return newState;
}