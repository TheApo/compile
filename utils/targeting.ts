/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player } from "../types";

export const isCardTargetable = (card: PlayedCard, gameState: GameState): boolean => {
    const { actionRequired } = gameState;
    if (!actionRequired) {
        return false;
    }

    let owner: Player | null = null;
    let laneIndex: number = -1;
    let lane: PlayedCard[] = [];

    for (const p of ['player', 'opponent'] as Player[]) {
        for (let i = 0; i < gameState[p].lanes.length; i++) {
            if (gameState[p].lanes[i].some(c => c.id === card.id)) {
                owner = p;
                laneIndex = i;
                lane = gameState[p].lanes[i];
                break;
            }
        }
        if (owner) break;
    }

    if (!owner) return false;

    switch (actionRequired.type) {
        case 'select_opponent_face_up_card_to_flip':
            return owner === 'opponent' && card.isFaceUp;
        case 'select_own_face_up_covered_card_to_flip': {
            const cardIndex = lane.findIndex(c => c.id === card.id);
            return owner === 'player' && card.isFaceUp && cardIndex < lane.length - 1;
        }
        case 'select_opponent_covered_card_to_shift': { // Darkness-0
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const opponentOfTurnPlayer = gameState.turn === 'player' ? 'opponent' : 'player';
            return owner === opponentOfTurnPlayer && cardIndex < lane.length - 1;
        }
        case 'select_opponent_card_to_flip': // Darkness-1
            return owner === 'opponent';
        case 'shift_flipped_card_optional': // Darkness-1 (Part 2)
            return card.id === actionRequired.cardId;
        case 'select_own_covered_card_in_lane_to_flip': { // Darkness-2
            const cardIndex = lane.findIndex(c => c.id === card.id);
            return owner === 'player' && laneIndex === actionRequired.laneIndex && cardIndex < lane.length - 1;
        }
        case 'select_face_down_card_to_shift_for_darkness_4': // Darkness-4
            return !card.isFaceUp;
        case 'select_cards_to_delete':
            return !actionRequired.disallowedIds.includes(card.id);
        case 'select_card_to_delete_for_death_1':
            return card.id !== actionRequired.sourceCardId;
        case 'select_face_down_card_to_delete':
            return !card.isFaceUp;
        case 'select_low_value_card_to_delete':
            return card.isFaceUp && (card.value === 0 || card.value === 1);
        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = actionRequired;
            return laneIndex !== disallowedLaneIndex && !lanesSelected.includes(laneIndex);
        }
        case 'plague_4_opponent_delete': {
            // This action is for the opponent of the turn player to delete one of their own face-down cards.
            const actor = gameState.turn === 'player' ? 'opponent' : 'player';
            if (actor === 'player') { // Human player needs to act
                return owner === 'player' && !card.isFaceUp;
            }
            // If the AI needs to act, the player cannot target anything.
            return false;
        }
        case 'select_any_other_card_to_flip':
            return card.id !== actionRequired.sourceCardId;
        case 'select_card_to_return':
            return true; // Any card can be returned
        case 'select_card_to_flip_for_fire_3':
            return true; // Any card can be flipped
        case 'select_card_to_shift_for_gravity_1':
            return true; // Any card is a valid initial target
        case 'select_card_to_flip_and_shift_for_gravity_2':
            return true; // Any card is a valid initial target
        case 'select_face_down_card_to_shift_for_gravity_4':
            // The card to shift must not be in the target lane already.
            return !card.isFaceUp && laneIndex !== actionRequired.targetLaneIndex;
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional':
            return true; // Any card is targetable
        case 'select_any_face_down_card_to_flip_optional':
            return !card.isFaceUp;
        case 'select_card_to_flip_for_light_0':
            return true; // Any card on board
        case 'select_face_down_card_to_reveal_for_light_2':
            return !card.isFaceUp;
        case 'select_any_other_card_to_flip_for_water_0':
            return card.id !== actionRequired.sourceCardId;
        case 'select_own_card_to_return_for_water_4':
            return owner === gameState.turn;
        case 'select_own_other_card_to_shift': // Speed-3 Middle
            return owner === gameState.turn && card.id !== actionRequired.sourceCardId;
        case 'select_own_card_to_shift_for_speed_3': // Speed-3 End
            return owner === gameState.turn;
        case 'select_opponent_face_down_card_to_shift': // Speed-4
            return owner !== gameState.turn && !card.isFaceUp;
        case 'select_any_opponent_card_to_shift':
            return owner !== gameState.turn;
        case 'select_opponent_card_to_return':
            return owner === 'opponent';
        default:
            return false;
    }
}