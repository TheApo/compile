/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, PlayedCard } from '../../types';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { shuffleDeck } from '../../utils/gameLogic';

const getBestCardToPlay = (state: GameState): { cardId: string, laneIndex: number, isFaceUp: boolean } | null => {
    const { opponent, player } = state;
    if (opponent.hand.length === 0) return null;

    // 1. Super Simple Offensive Logic: If a lane is at 8 or 9, play any card face down to compile.
    for (let i = 0; i < 3; i++) {
        if (!opponent.compiled[i] && (opponent.laneValues[i] === 8 || opponent.laneValues[i] === 9)) {
            // Found a compile setup opportunity. Play the first available card face-down.
            return { cardId: opponent.hand[0].id, laneIndex: i, isFaceUp: false };
        }
    }

    // 2. Default Dumb Logic: Play the highest value card face up if possible, otherwise face down.
    const sortedHand = [...opponent.hand].sort((a, b) => b.value - a.value);
    const cardToPlay = sortedHand[0];

    // Try to find a lane where it can be played face up.
    for (let i = 0; i < 3; i++) {
        if (cardToPlay.protocol === opponent.protocols[i]) {
            return { cardId: cardToPlay.id, laneIndex: i, isFaceUp: true };
        }
    }

    // If not, just play it face down in a random lane.
    const randomLane = Math.floor(Math.random() * 3);
    return { cardId: cardToPlay.id, laneIndex: randomLane, isFaceUp: false };
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    // Easy AI makes simple, often suboptimal or random choices.
    switch (action.type) {
        case 'discard':
            // Discard the lowest value card(s).
            const sortedHand = [...state.opponent.hand].sort((a, b) => a.value - b.value);
            const cardsToDiscard = sortedHand.slice(0, action.count).map(c => c.id);
            return { type: 'discardCards', cardIds: cardsToDiscard };

        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete':
        case 'select_card_from_other_lanes_to_delete':
        case 'select_card_to_delete_for_death_1':
        case 'plague_4_opponent_delete': {
            // FIX: Check for `disallowedIds` property only on actions that have it.
            const disallowedIds = ('disallowedIds' in action && action.disallowedIds) ? action.disallowedIds : [];
            // Prioritize player cards, but otherwise make a simple choice.
            const allowedPlayerCards = state.player.lanes.flat().filter(c => !disallowedIds.includes(c.id));
            if (allowedPlayerCards.length > 0) {
                return { type: 'deleteCard', cardId: allowedPlayerCards[0].id };
            }
            
            const allowedOpponentCards = state.opponent.lanes.flat().filter(c => !disallowedIds.includes(c.id));
            if (allowedOpponentCards.length > 0) {
                return { type: 'deleteCard', cardId: allowedOpponentCards[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_low_value_card_to_delete': {
            const validTargets = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                .filter(c => c.isFaceUp && (c.value === 0 || c.value === 1));
            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_opponent_face_up_card_to_flip': {
            const validTargets = state.player.lanes.flat().filter(c => c.isFaceUp);
            if (validTargets.length > 0) {
                const randomCard = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'flipCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }
        case 'select_opponent_card_to_flip': {
            const validTargets = state.player.lanes.flat();
            if (validTargets.length > 0) {
                const randomCard = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'flipCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }
        case 'select_own_face_up_covered_card_to_flip':
        case 'select_any_other_card_to_flip':
        case 'select_any_card_to_flip':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_any_card_to_flip_optional':
        case 'select_card_to_flip_for_fire_3':
        case 'select_card_to_flip_for_light_0':
        case 'select_face_down_card_to_reveal_for_light_2':
        case 'select_any_other_card_to_flip_for_water_0': {
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) return { type: 'flipCard', cardId: allCards[0].id };
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }
        case 'select_own_covered_card_in_lane_to_flip': {
            const { laneIndex } = action;
            const ownLane = state.opponent.lanes[laneIndex];
            const coveredCards = ownLane.filter((c, i, arr) => i < arr.length - 1);
            if (coveredCards.length > 0) {
                // Just flip the first available one.
                return { type: 'flipCard', cardId: coveredCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) return { type: 'returnCard', cardId: allCards[0].id };
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }

        case 'select_own_card_to_return_for_water_4': {
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                // Easy AI: Pick a random card to return.
                const randomCard = ownCards[Math.floor(Math.random() * ownCards.length)];
                return { type: 'returnCard', cardId: randomCard.id };
            }
            // This shouldn't happen if the action was generated correctly, but as a fallback:
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }
        
        case 'select_card_to_shift_for_gravity_1': {
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex } = action;
            const validTargets: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as const) {
                for (let i = 0; i < state[p].lanes.length; i++) {
                    if (i === targetLaneIndex) continue; // Cannot shift from the target lane to itself.
                    for (const card of state[p].lanes[i]) {
                        if (!card.isFaceUp) {
                            validTargets.push(card);
                        }
                    }
                }
            }
            
            if (validTargets.length > 0) {
                // Easy AI: Pick a random valid target.
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                // Use 'deleteCard' as the vehicle type for the AIAction. It triggers the generic card resolver.
                return { type: 'deleteCard', cardId: randomTarget.id };
            }

            // If no valid targets, which shouldn't happen if the action was created correctly, skip.
            return { type: 'skip' };
        }

        case 'select_lane_for_shift':
        case 'shift_flipped_card_optional':
        case 'select_lane_for_play':
        case 'select_lane_for_death_2':
        case 'select_lane_for_life_3_play':
        case 'select_lane_to_shift_revealed_card_for_light_2':
        case 'select_lane_to_shift_cards_for_light_3':
        case 'select_lane_for_metal_3_delete':
        case 'select_lane_for_water_3': {
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }
            if ('originalLaneIndex' in action && action.originalLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.originalLaneIndex);
            }
            if (possibleLanes.length > 0) return { type: 'selectLane', laneIndex: possibleLanes[0] };
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }
        
        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: Math.random() > 0.7 }; // Rarely accepts
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: false };
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: false };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: false };
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: false };
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: false };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: false };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };
        case 'prompt_shift_or_flip_for_light_2': return { type: 'resolveLight2Prompt', choice: 'skip' };

        case 'plague_2_opponent_discard':
            if (state.opponent.hand.length > 0) return { type: 'resolvePlague2Discard', cardIds: [state.opponent.hand[0].id] };
            return { type: 'skip' };
        case 'select_cards_from_hand_to_discard_for_fire_4':
            if (state.opponent.hand.length > 0) return { type: 'resolveFire4Discard', cardIds: [state.opponent.hand[0].id] };
            return { type: 'skip' };
        case 'select_cards_from_hand_to_discard_for_hate_1':
            if (state.opponent.hand.length > 0) return { type: 'resolveHate1Discard', cardIds: state.opponent.hand.slice(0, action.count).map(c => c.id) };
            return { type: 'skip' };

        case 'select_card_from_hand_to_play':
             if (state.opponent.hand.length > 0) {
                const cardToPlay = state.opponent.hand[0];
                const playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);
                return { type: 'playCard', cardId: cardToPlay.id, laneIndex: playableLanes[0], isFaceUp: false };
             }
             return { type: 'skip' };
        case 'select_card_from_hand_to_give':
            if (state.opponent.hand.length > 0) return { type: 'giveCard', cardId: state.opponent.hand[0].id };
            return { type: 'skip' };
        case 'select_card_from_hand_to_reveal':
            if (state.opponent.hand.length > 0) return { type: 'revealCard', cardId: state.opponent.hand[0].id };
            return { type: 'skip' };

        case 'prompt_rearrange_protocols':
            const newOrder = shuffleDeck([...state[action.target].protocols]);
            return { type: 'rearrangeProtocols', newOrder };
        case 'prompt_swap_protocols':
            return { type: 'skip' };

        case 'select_own_other_card_to_shift': {
            const cardToShift = state.opponent.lanes.flat().find(c => c.id !== action.sourceCardId);
            if (cardToShift) return { type: 'deleteCard', cardId: cardToShift.id }; // Typo but fine for easy
            return { type: 'skip' };
        }
        case 'select_opponent_covered_card_to_shift': {
            const validTargets: PlayedCard[] = [];
            for (const lane of state.player.lanes) {
                // A card is covered if it's not the last one.
                for (let i = 0; i < lane.length - 1; i++) {
                    validTargets.push(lane[i]);
                }
            }
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                // Using 'deleteCard' as the action type to trigger resolveActionWithCard
                return { type: 'deleteCard', cardId: randomTarget.id };
            }
            return { type: 'skip' };
        }
    }
    return { type: 'skip' }; // Fallback for any unhandled action
}


export const easyAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        return { type: 'compile', laneIndex: state.compilableLanes[0] };
    }

    if (state.phase === 'action') {
        const bestPlay = getBestCardToPlay(state);
        if (bestPlay) {
            return { type: 'playCard', ...bestPlay };
        } else {
            return { type: 'fillHand' };
        }
    }

    return { type: 'fillHand' }; // Fallback
};
