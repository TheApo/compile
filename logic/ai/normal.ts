/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { shuffleDeck } from '../../utils/gameLogic';
import { easyAI } from './easy';
import { getEffectiveCardValue } from '../game/stateManager';

type ScoredMove = {
    move: AIAction;
    score: number;
};

const DISRUPTION_KEYWORDS = ['delete', 'flip', 'shift', 'return', 'discard'];

const getCardPower = (card: PlayedCard): number => {
    let power = card.value;
    if (DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) power += 4; // Effects are valuable
    if (card.keywords['draw']) power += 3;
    if (card.keywords['play']) power += 5;
    return power;
}

// Evaluates all possible moves and returns the best one
const getBestMove = (state: GameState): AIAction => {
    const { opponent, player } = state;
    const possibleMoves: ScoredMove[] = [];

    const isLaneBlockedByPlague0 = (laneIndex: number): boolean => {
        const playerLane = state.player.lanes[laneIndex];
        if (playerLane.length === 0) return false;
        const topCard = playerLane[playerLane.length - 1];
        return topCard.isFaceUp && topCard.protocol === 'Plague' && topCard.value === 0;
    };

    const playerHasPsychic1 = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);

    // Evaluate playing each card in hand
    for (const card of opponent.hand) {
        for (let i = 0; i < 3; i++) {
            if (isLaneBlockedByPlague0(i)) continue;
            if (opponent.compiled[i]) continue; // Don't play in compiled lanes

            // --- Evaluate playing face-up ---
            const canPlayFaceUp = card.protocol === opponent.protocols[i] && !playerHasPsychic1;
            if (canPlayFaceUp) {
                let score = 0;
                const valueToAdd = card.value;
                const resultingValue = opponent.laneValues[i] + valueToAdd;

                // A: HUGE priority on setting up a compile
                if (resultingValue >= 10 && resultingValue > player.laneValues[i]) score += 200;
                else if (resultingValue >= 8) score += 100;
                
                // B: HUGE priority on preventing player compile
                if (player.laneValues[i] >= 8) {
                    const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                    if (hasDisruption) score += 150; // Massively incentivize playing this card here
                }

                // C: General value, effects are good
                score += getCardPower(card);
                 // D: Reward gaining/extending a lead
                score += (resultingValue - player.laneValues[i]);

                // E: Special strategy for Metal-6
                if (card.protocol === 'Metal' && card.value === 6) {
                    if (opponent.lanes[i].length < 4) {
                        score -= 50; // Penalize playing Metal-6 too early
                    }
                }

                possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true }, score });
            }

            // --- Evaluate playing face-down ---
            let score = 0;
            const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, opponent.lanes[i]);
            const resultingValue = opponent.laneValues[i] + valueToAdd;

            // A: HUGE priority on setting up a compile for a win
            if (resultingValue >= 10 && resultingValue > player.laneValues[i]) {
                score += 250;
            }

            // B: Still good to build up points, especially to contest a lane
            score += valueToAdd + (resultingValue - player.laneValues[i]);

            // C: Special strategy for Metal-6
            if (card.protocol === 'Metal' && card.value === 6) {
                if (opponent.lanes[i].length < 4) {
                    score -= 50; // Also penalize playing it face-down early
                }
            }

            possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false }, score });
        }
    }

    // Evaluate filling hand
    if (opponent.hand.length < 5) {
        const avgHandPower = opponent.hand.reduce((sum, c) => sum + getCardPower(c), 0) / (opponent.hand.length || 1);
        const score = 10 - avgHandPower; // Draw if hand is weak, don't if hand is strong.
        possibleMoves.push({ move: { type: 'fillHand' }, score });
    }
    
    if (possibleMoves.length === 0) {
        return { type: 'fillHand' };
    }

    // Sort moves by score, descending
    possibleMoves.sort((a, b) => b.score - a.score);

    return possibleMoves[0].move;
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    // Normal AI makes more sensible choices than Easy AI
    switch (action.type) {
        case 'discard':
            // Discard the lowest value card(s) that don't have good effects.
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            const cardsToDiscard = sortedHand.slice(0, action.count).map(c => c.id);
            return { type: 'discardCards', cardIds: cardsToDiscard };
        
        case 'select_cards_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = action.type === 'select_cards_to_delete'
                ? action.disallowedIds
                : (action.type === 'select_card_to_delete_for_death_1' ? [action.sourceCardId] : []);
            // Target the player's highest value card.
            const allPlayerCards = state.player.lanes.flat().filter(c => !disallowedIds.includes(c.id));

            if (allPlayerCards.length > 0) {
                const highestValueTarget = allPlayerCards.reduce((highest, current) => {
                    const highestValue = getEffectiveCardValue(highest, []);
                    const currentValue = getEffectiveCardValue(current, []);
                    return currentValue > highestValue ? current : highest;
                });
                return { type: 'deleteCard', cardId: highestValueTarget.id };
            }
            
            // If player has no cards, target own lowest value card to minimize loss
            const allOpponentCards = state.opponent.lanes.flat().filter(c => !disallowedIds.includes(c.id));
            if (allOpponentCards.length > 0) {
                 const lowestValueCard = allOpponentCards.reduce((lowest, current) => current.value < lowest.value ? current : lowest);
                 return { type: 'deleteCard', cardId: lowestValueCard.id };
            }
            return { type: 'skip' };
        }
        
        case 'select_own_face_up_covered_card_to_flip': {
            const potentialTargets: { card: PlayedCard; score: number }[] = [];

            // Find valid targets: opponent's (AI's) own face-up, covered cards.
            state.opponent.lanes.forEach(lane => {
                // A card is covered if it's not the last one in the stack.
                for (let i = 0; i < lane.length - 1; i++) {
                    const card = lane[i];
                    if (card.isFaceUp) {
                        const faceDownValue = getEffectiveCardValue({ ...card, isFaceUp: false }, lane);
                        const faceUpValue = card.value;
                        const score = faceDownValue - faceUpValue;
                        potentialTargets.push({ card, score });
                    }
                }
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                const bestTarget = potentialTargets[0];
                
                // It's optional, so only do it if there's a point gain.
                if (bestTarget.score > 0) {
                    return { type: 'flipCard', cardId: bestTarget.card.id };
                }
            }
            
            // If no beneficial targets, skip the action.
            return { type: 'skip' };
        }

        case 'select_opponent_face_up_card_to_flip':
        case 'select_opponent_card_to_flip':
        case 'select_any_card_to_flip_optional':
        case 'select_any_card_to_flip':
        case 'select_card_to_flip_for_fire_3':
        case 'select_any_other_card_to_flip':
        case 'select_card_to_flip_for_light_0':
        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_covered_card_in_line_to_flip_optional': {
            const potentialTargets: { cardId: string; score: number }[] = [];
            const isOptional = 'optional' in action && action.optional;
            const sourceCardId = action.sourceCardId;

            // Score flipping opponent face-up cards (to disrupt)
            state.player.lanes.flat().forEach(c => {
                if (c.isFaceUp) potentialTargets.push({ cardId: c.id, score: c.value + 2 });
            });
            // Score flipping opponent face-down cards (to reveal info, low priority)
            state.player.lanes.flat().forEach(c => {
                if (!c.isFaceUp) potentialTargets.push({ cardId: c.id, score: 1 });
            });
            // Score flipping own face-down cards (to gain value)
            state.opponent.lanes.flat().forEach(c => {
                if (!c.isFaceUp) potentialTargets.push({ cardId: c.id, score: 3 });
            });
            // Score flipping own face-up cards (bad move, negative score, unless it's the source card)
            state.opponent.lanes.flat().forEach(c => {
                if (c.isFaceUp && c.id !== sourceCardId) potentialTargets.push({ cardId: c.id, score: -c.value });
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                const bestTarget = potentialTargets[0];

                if (!isOptional) {
                    return { type: 'flipCard', cardId: bestTarget.cardId };
                }
                
                if (bestTarget.score >= 0) {
                    return { type: 'flipCard', cardId: bestTarget.cardId };
                }
            }
            
            return { type: 'skip' };
        }

        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            const validTargets: PlayedCard[] = [];
            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;
                // Get all valid player cards from valid lanes
                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    validTargets.push(...playerLane);
                }
            }
             if (validTargets.length > 0) {
                // Target highest value card among valid targets
                validTargets.sort((a, b) => b.value - a.value);
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_face_down_card_to_delete': {
            // Prioritize player's face down cards in their highest value lane
            const laneValues = state.player.laneValues.map((value, index) => ({ value, index })).sort((a,b) => b.value - a.value);
            for (const lane of laneValues) {
                const target = state.player.lanes[lane.index].find(c => !c.isFaceUp);
                if (target) return { type: 'deleteCard', cardId: target.id };
            }
            // Fallback to own face down cards in lowest value lane
            const ownLaneValues = state.opponent.laneValues.map((value, index) => ({ value, index })).sort((a,b) => a.value - b.value);
            for (const lane of ownLaneValues) {
                const target = state.opponent.lanes[lane.index].find(c => !c.isFaceUp);
                if (target) return { type: 'deleteCard', cardId: target.id };
            }
            return { type: 'skip' };
        }

        case 'plague_4_opponent_delete': {
            // Delete own face-down card in the lane where the AI is losing the most to cut losses
            const laneDiffs = state.opponent.laneValues.map((value, index) => ({ diff: value - state.player.laneValues[index], index })).sort((a,b) => a.diff - b.diff);
             for (const lane of laneDiffs) {
                const target = state.opponent.lanes[lane.index].find(c => !c.isFaceUp);
                if (target) return { type: 'deleteCard', cardId: target.id };
            }
            // Fallback: delete any of its own face-down cards if the primary logic fails
            const anyFaceDown = state.opponent.lanes.flat().find(c => !c.isFaceUp);
            if (anyFaceDown) return { type: 'deleteCard', cardId: anyFaceDown.id };
            return { type: 'skip' };
        }
        
        case 'select_low_value_card_to_delete': {
            const validTargets = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                .filter(c => c.isFaceUp && (c.value === 0 || c.value === 1));
            if (validTargets.length > 0) {
                // Prioritize deleting player's cards, then own. Prioritize value 1 over 0.
                validTargets.sort((a, b) => {
                    const aIsPlayer = state.player.lanes.flat().some(c => c.id === a.id);
                    const bIsPlayer = state.player.lanes.flat().some(c => c.id === b.id);
                    if (aIsPlayer && !bIsPlayer) return -1;
                    if (!aIsPlayer && bIsPlayer) return 1;
                    return b.value - a.value;
                });
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_own_card_to_return_for_water_4': {
            // Find all own cards with their lane context
            const ownCardsWithContext: { card: PlayedCard, lane: PlayedCard[] }[] = [];
            state.opponent.lanes.forEach(lane => {
                lane.forEach(card => {
                    ownCardsWithContext.push({ card, lane });
                });
            });

            if (ownCardsWithContext.length > 0) {
                // Normal AI: Return the card with the lowest effective value to minimize point loss.
                ownCardsWithContext.sort((a, b) => 
                    getEffectiveCardValue(a.card, a.lane) - getEffectiveCardValue(b.card, b.lane)
                );
                return { type: 'returnCard', cardId: ownCardsWithContext[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'prompt_rearrange_protocols':
            // Simple rearrangement: put highest value lane first. Not smart, but better than random.
            const laneData = state[action.target].protocols.map((p, i) => ({
                protocol: p,
                value: state[action.target].laneValues[i]
            })).sort((a, b) => b.value - a.value);
            const newOrder = laneData.map(d => d.protocol);
            return { type: 'rearrangeProtocols', newOrder };
        
        case 'prompt_swap_protocols': {
            const { opponent, player } = state;
            const laneData = opponent.protocols.map((p, i) => ({
                protocol: p,
                index: i,
                diff: opponent.laneValues[i] - player.laneValues[i]
            })).sort((a, b) => a.diff - b.diff); // Sort by worst difference first

            // Swap the protocol from the worst lane with the middle one.
            const worstLaneIndex = laneData[0].index;
            const middleLaneIndex = laneData[1].index;
            return { type: 'resolveSwapProtocols', indices: [worstLaneIndex, middleLaneIndex] };
        }

        case 'select_card_to_shift_for_gravity_1': {
            const playerCards = state.player.lanes.flat();
            if (playerCards.length > 0) {
                // Target player's highest value card
                playerCards.sort((a,b) => b.value - a.value);
                return { type: 'deleteCard', cardId: playerCards[0].id };
            }
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                 // Fallback: shift own lowest value card
                ownCards.sort((a,b) => a.value - b.value);
                return { type: 'deleteCard', cardId: ownCards[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const faceUpPlayerCards = state.player.lanes.flat().filter(c => c.isFaceUp);
            if (faceUpPlayerCards.length > 0) {
                // Target highest value face-up card
                faceUpPlayerCards.sort((a,b) => b.value - a.value);
                return { type: 'deleteCard', cardId: faceUpPlayerCards[0].id };
            }
            const faceDownPlayerCards = state.player.lanes.flat().filter(c => !c.isFaceUp);
            if (faceDownPlayerCards.length > 0) {
                 // Target a random face-down card
                const randomCard = faceDownPlayerCards[Math.floor(Math.random() * faceDownPlayerCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex } = action;
            const opponentTargets: PlayedCard[] = [];
            for (let i = 0; i < state.player.lanes.length; i++) {
                if (i === targetLaneIndex) continue;
                state.player.lanes[i].forEach(c => { if (!c.isFaceUp) opponentTargets.push(c); });
            }
            if (opponentTargets.length > 0) {
                return { type: 'deleteCard', cardId: opponentTargets[0].id };
            }

            const ownTargets: PlayedCard[] = [];
            for (let i = 0; i < state.opponent.lanes.length; i++) {
                if (i === targetLaneIndex) continue;
                 state.opponent.lanes[i].forEach(c => { if (!c.isFaceUp) ownTargets.push(c); });
            }
            if (ownTargets.length > 0) {
                return { type: 'deleteCard', cardId: ownTargets[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_face_down_card_to_shift_for_darkness_4': {
            // Prioritize player's face down cards in their highest value lane
            const playerLaneValues = state.player.laneValues.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
            for (const lane of playerLaneValues) {
                const target = state.player.lanes[lane.index].find(c => !c.isFaceUp);
                if (target) return { type: 'deleteCard', cardId: target.id };
            }
            // Fallback to own face down cards in lowest value lane to move it
            const ownLaneValues = state.opponent.laneValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
            for (const lane of ownLaneValues) {
                const target = state.opponent.lanes[lane.index].find(c => !c.isFaceUp);
                if (target) return { type: 'deleteCard', cardId: target.id };
            }
            return { type: 'skip' }; // Should not happen
        }

        case 'select_any_opponent_card_to_shift': {
            const validTargets = state.player.lanes.flat();
            if (validTargets.length > 0) {
                // Target player's highest value card to disrupt their strongest lane
                validTargets.sort((a, b) => b.value - a.value);
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        // --- Default/Simple handlers for other actions ---
        case 'select_lane_for_shift': {
            const { cardOwner, originalLaneIndex } = action;
            const possibleLanes = [0, 1, 2].filter(i => i !== originalLaneIndex);
            
            if (cardOwner === 'opponent') { // AI shifts its own card
                // Move to its weakest lane to build it up
                const targetLanes = possibleLanes
                    .map(index => ({ value: state.opponent.laneValues[index], index }))
                    .sort((a, b) => a.value - b.value); // sort ascending by value
                return { type: 'selectLane', laneIndex: targetLanes[0].index };
            } else { // AI shifts player's card
                // Move to player's strongest lane to concentrate their power / disrupt
                const targetLanes = possibleLanes
                    .map(index => ({ value: state.player.laneValues[index], index }))
                    .sort((a, b) => b.value - a.value); // sort descending by value
                return { type: 'selectLane', laneIndex: targetLanes[0].index };
            }
        }
        
        case 'select_own_card_to_shift_for_speed_3': {
            const ownCards = state.opponent.lanes.flat();
            // This action is mandatory and is only dispatched if the AI has at least one card.
            // Normal AI: shift the card with the lowest power to move it to a better lane.
            ownCards.sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'deleteCard', cardId: ownCards[0].id };
        }

        // For most optional effects, a normal AI will usually accept if it seems beneficial
        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: true };
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: true };
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: false };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: state.opponent.hand.length > 2 };
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: true };
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: true };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: true };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };
        case 'prompt_shift_or_flip_for_light_2': return { type: 'resolveLight2Prompt', choice: 'shift' };
        
        case 'select_opponent_covered_card_to_shift': {
            const validTargets: { card: PlayedCard; laneIndex: number }[] = [];
            for (let i = 0; i < state.player.lanes.length; i++) {
                const lane = state.player.lanes[i];
                for (let j = 0; j < lane.length - 1; j++) {
                    validTargets.push({ card: lane[j], laneIndex: i });
                }
            }

            if (validTargets.length > 0) {
                // Normal AI: prioritize highest-value face-up covered cards.
                validTargets.sort((a, b) => {
                    if (a.card.isFaceUp && !b.card.isFaceUp) return -1;
                    if (!a.card.isFaceUp && b.card.isFaceUp) return 1;
                    if (a.card.isFaceUp && b.card.isFaceUp) return b.card.value - a.card.value;
                    return 0; // if both face-down, order doesn't matter
                });
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        // --- Fallback to easy logic for unhandled complex actions ---
        default:
             const easyLogic = easyAI(state, action);
             if (easyLogic) return easyLogic;
             return { type: 'skip' };
    }
}

export const normalAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        // Compile the lane with the highest value
        const bestLane = state.compilableLanes.reduce((a, b) => state.opponent.laneValues[a] > state.opponent.laneValues[b] ? a : b);
        return { type: 'compile', laneIndex: bestLane };
    }

    if (state.phase === 'action') {
        return getBestMove(state);
    }

    return { type: 'fillHand' }; // Fallback
};
