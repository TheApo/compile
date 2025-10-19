/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player } from "../types";
import { findAllHighestUncoveredCards } from "../logic/game/helpers/actionUtils";

export const isCardTargetable = (card: PlayedCard, gameState: GameState): boolean => {
    const { actionRequired } = gameState;
    if (!actionRequired) {
        return false;
    }

    // Only the 'actor' specified in the action can perform it.
    // The UI is for the 'player', so if the actor isn't 'player', they can't target anything.
    if ('actor' in actionRequired && actionRequired.actor !== 'player') {
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

    // Rule: By default, only uncovered cards are targetable.
    const isUncovered = card.id === lane[lane.length - 1]?.id;

    switch (actionRequired.type) {
        case 'select_opponent_face_up_card_to_flip':
            return owner === 'opponent' && card.isFaceUp && isUncovered;

        // Rule: Keywords like "covered" override the default.
        case 'select_own_face_up_covered_card_to_flip': {
            const cardIndex = lane.findIndex(c => c.id === card.id);
            return owner === 'player' && card.isFaceUp && cardIndex < lane.length - 1;
        }
        case 'select_opponent_covered_card_to_shift': { // Darkness-0
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const opponentOfTurnPlayer = gameState.turn === 'player' ? 'opponent' : 'player';
            return owner === opponentOfTurnPlayer && cardIndex < lane.length - 1;
        }
        case 'select_own_covered_card_to_shift': { // Chaos-2
            const cardIndex = lane.findIndex(c => c.id === card.id);
            return owner === actionRequired.actor && cardIndex < lane.length - 1;
        }
        case 'select_covered_card_in_line_to_flip_optional': { // Darkness-2
            const cardIndex = lane.findIndex(c => c.id === card.id);
            // Card must be in the correct lane, and must be covered (not the last card in its stack).
            return laneIndex === actionRequired.laneIndex && cardIndex < lane.length - 1;
        }
        case 'select_covered_card_to_flip_for_chaos_0': { // Chaos-0
            const cardIndex = lane.findIndex(c => c.id === card.id);
            // Card must be in the current lane being processed, and must be covered
            return laneIndex === actionRequired.laneIndex && cardIndex < lane.length - 1;
        }

        // Rule: Keywords like "that card" override the default.
        case 'shift_flipped_card_optional': // Darkness-1 (Part 2)
            return card.id === actionRequired.cardId;

        // Default targeting rules apply to the following:
        case 'select_opponent_card_to_flip': // Darkness-1
            return owner === 'opponent' && isUncovered;
        case 'select_face_down_card_to_shift_for_darkness_4': // Darkness-4
            return !card.isFaceUp && isUncovered;
        case 'select_cards_to_delete':
            return !actionRequired.disallowedIds.includes(card.id) && isUncovered;
        case 'select_card_to_delete_for_death_1':
            return card.id !== actionRequired.sourceCardId && isUncovered;
        case 'select_face_down_card_to_delete':
            return !card.isFaceUp && isUncovered;
        case 'select_low_value_card_to_delete':
            return card.isFaceUp && (card.value === 0 || card.value === 1) && isUncovered;
        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = actionRequired;
            return laneIndex !== disallowedLaneIndex && !lanesSelected.includes(laneIndex) && isUncovered;
        }
        case 'plague_4_opponent_delete': {
            const actor = gameState.turn === 'player' ? 'opponent' : 'player';
            if (actor === 'player') { // Human player needs to act
                return owner === 'player' && !card.isFaceUp && isUncovered;
            }
            return false;
        }
        case 'select_any_other_card_to_flip':
            return card.id !== actionRequired.sourceCardId && isUncovered;
        case 'select_card_to_return':
            return isUncovered;
        case 'select_card_to_flip_for_fire_3':
            return isUncovered;
        case 'select_card_to_shift_for_gravity_1':
            return isUncovered;
        case 'select_card_to_flip_and_shift_for_gravity_2':
            return isUncovered;
        case 'select_face_down_card_to_shift_for_gravity_4':
            return !card.isFaceUp && laneIndex !== actionRequired.targetLaneIndex && isUncovered;
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional':
            return isUncovered;
        case 'select_any_face_down_card_to_flip_optional':
            return !card.isFaceUp && isUncovered;
        case 'select_card_to_flip_for_light_0':
            return isUncovered;
        case 'select_face_down_card_to_reveal_for_light_2':
            return !card.isFaceUp && isUncovered;
        case 'select_any_other_card_to_flip_for_water_0':
            return card.id !== actionRequired.sourceCardId && isUncovered;
        case 'select_own_card_to_return_for_water_4':
            return owner === gameState.turn && isUncovered;
        case 'select_own_other_card_to_shift': // Speed-3 Middle
            return owner === gameState.turn && card.id !== actionRequired.sourceCardId && isUncovered;
        case 'select_own_card_to_shift_for_speed_3': // Speed-3 End
            return owner === gameState.turn && isUncovered;
        case 'select_opponent_face_down_card_to_shift': // Speed-4
            return owner !== gameState.turn && !card.isFaceUp && isUncovered;
        case 'select_any_opponent_card_to_shift':
            return owner !== gameState.turn && isUncovered;
        case 'select_opponent_card_to_return':
            return owner === 'opponent' && isUncovered;
        case 'select_own_highest_card_to_delete_for_hate_2': {
            if (!isUncovered) return false;
            const highestCards = findAllHighestUncoveredCards(gameState, actionRequired.actor);
            return highestCards.some(c => c.card.id === card.id);
        }
        case 'select_opponent_highest_card_to_delete_for_hate_2': {
            if (!isUncovered) return false;
            const opponent = actionRequired.actor === 'player' ? 'opponent' : 'player';
            const highestCards = findAllHighestUncoveredCards(gameState, opponent);
            return highestCards.some(c => c.card.id === card.id);
        }

        default:
            return false;
    }
}
