/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { shuffleDeck } from '../../utils/gameLogic';
import { easyAI } from './easy';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard } from '../game/helpers/actionUtils';

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
            const canPlayFaceUp = (card.protocol === opponent.protocols[i] || card.protocol === player.protocols[i]) && !playerHasPsychic1;
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
        
        case 'select_opponent_card_to_flip': { // Darkness-1
            const getUncovered = (p: Player): PlayedCard[] => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const opponentUncovered = getUncovered('player');
            if (opponentUncovered.length === 0) return { type: 'skip' };

            const potentialTargets: { cardId: string; score: number }[] = [];

            opponentUncovered.forEach(c => {
                if (c.isFaceUp) {
                    // Score is based on the value we are hiding from the player.
                    potentialTargets.push({ cardId: c.id, score: c.value });
                } else {
                    // Score is based on gaining information. Prioritize lanes with higher value.
                    const laneIndex = state.player.lanes.findIndex(lane => lane.some(card => card.id === c.id));
                    const score = 2 + (state.player.laneValues[laneIndex] / 2);
                    potentialTargets.push({ cardId: c.id, score });
                }
            });

            potentialTargets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: potentialTargets[0].cardId };
        }

        case 'select_cards_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = action.type === 'select_cards_to_delete'
                ? action.disallowedIds
                : (action.type === 'select_card_to_delete_for_death_1' ? [action.sourceCardId] : []);
            
            // FIX: Target only uncovered cards.
            const getUncoveredCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            // Target the player's highest value card.
            const allPlayerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));

            if (allPlayerCards.length > 0) {
                const highestValueTarget = allPlayerCards.reduce((highest, current) => {
                    const highestValue = getEffectiveCardValue(highest, []);
                    const currentValue = getEffectiveCardValue(current, []);
                    return currentValue > highestValue ? current : highest;
                });
                return { type: 'deleteCard', cardId: highestValueTarget.id };
            }
            
            // If player has no cards, target own lowest value card to minimize loss
            const allOpponentCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
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

        case 'select_face_down_card_to_reveal_for_light_2': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const potentialTargets: { card: PlayedCard; score: number }[] = [];

            // Score player's face-down cards
            getUncovered('player').forEach(c => {
                if (!c.isFaceUp) {
                    // Prioritize revealing cards in lanes where the player has a high score.
                    const laneIndex = state.player.lanes.findIndex(lane => lane.some(card => card.id === c.id));
                    const score = state.player.laneValues[laneIndex] + 5; // Add bonus for info
                    potentialTargets.push({ card: c, score });
                }
            });

            // Score own face-down cards (less priority)
            getUncovered('opponent').forEach(c => {
                if (!c.isFaceUp) {
                    const score = 1; // Low priority
                    potentialTargets.push({ card: c, score });
                }
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                return { type: 'flipCard', cardId: potentialTargets[0].card.id };
            }

            return { type: 'skip' };
        }

        case 'select_opponent_face_up_card_to_flip': {
            const getUncovered = (p: Player): PlayedCard[] => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);
        
            const validTargets = getUncovered('player').filter(c => c.isFaceUp);
        
            if (validTargets.length > 0) {
                // Normal AI: Target the highest value card.
                validTargets.sort((a, b) => b.value - a.value);
                return { type: 'flipCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' }; // Fallback
        }

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
            const cannotTargetSelfTypes: ActionRequired['type'][] = ['select_any_other_card_to_flip', 'select_any_other_card_to_flip_for_water_0'];
            const canTargetSelf = !cannotTargetSelfTypes.includes(action.type);
            const requiresFaceDown = action.type === 'select_any_face_down_card_to_flip_optional';

            // Special case for Darkness-2: "flip 1 covered card in this line."
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const playerCovered = state.player.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (playerCovered.length > 0) potentialTargets.push({ cardId: playerCovered[0].id, score: 5 });
                const opponentCovered = state.opponent.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (opponentCovered.length > 0) potentialTargets.push({ cardId: opponentCovered[0].id, score: 2 });
            } else {
                 // FIX: Only target uncovered cards for standard flip effects.
                const getUncovered = (player: Player): PlayedCard[] => {
                    return state[player].lanes
                        .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                        .filter((c): c is PlayedCard => c !== null);
                };
                
                const allUncoveredPlayer = getUncovered('player');
                const allUncoveredOpponent = getUncovered('opponent');

                // Score flipping opponent face-up cards (to disrupt)
                allUncoveredPlayer.forEach(c => {
                    if (c.isFaceUp && !requiresFaceDown) potentialTargets.push({ cardId: c.id, score: c.value + 2 });
                });
                // Score flipping opponent face-down cards (to reveal info, low priority)
                allUncoveredPlayer.forEach(c => {
                    if (!c.isFaceUp) potentialTargets.push({ cardId: c.id, score: 1 });
                });
                // Score flipping own face-down cards (to gain value)
                allUncoveredOpponent.forEach(c => {
                    if (!c.isFaceUp) potentialTargets.push({ cardId: c.id, score: 3 });
                });
                // Score flipping own face-up cards (bad move, negative score, unless it's the source card)
                allUncoveredOpponent.forEach(c => {
                    if (c.isFaceUp && !requiresFaceDown) {
                        if (!canTargetSelf && c.id === sourceCardId) return;
                        potentialTargets.push({ cardId: c.id, score: -c.value });
                    }
                });
            }


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
                    // FIX: Only target the uncovered card.
                    validTargets.push(playerLane[playerLane.length - 1]);
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
                // FIX: Only target uncovered face-down cards.
                const laneToCheck = state.player.lanes[lane.index];
                if (laneToCheck.length > 0) {
                    const topCard = laneToCheck[laneToCheck.length - 1];
                    if (!topCard.isFaceUp) {
                        return { type: 'deleteCard', cardId: topCard.id };
                    }
                }
            }
            // Fallback to own face down cards in lowest value lane
            const ownLaneValues = state.opponent.laneValues.map((value, index) => ({ value, index })).sort((a,b) => a.value - b.value);
            for (const lane of ownLaneValues) {
                // FIX: Only target uncovered face-down cards.
                const laneToCheck = state.opponent.lanes[lane.index];
                if (laneToCheck.length > 0) {
                    const topCard = laneToCheck[laneToCheck.length - 1];
                    if (!topCard.isFaceUp) {
                        return { type: 'deleteCard', cardId: topCard.id };
                    }
                }
            }
            return { type: 'skip' };
        }

        case 'plague_4_opponent_delete': {
            // Delete own face-down card in the lane where the AI is losing the most to cut losses
            const laneDiffs = state.opponent.laneValues.map((value, index) => ({ diff: value - state.player.laneValues[index], index })).sort((a,b) => a.diff - b.diff);
             for (const lane of laneDiffs) {
                const laneToCheck = state.opponent.lanes[lane.index];
                if (laneToCheck.length > 0) {
                    const topCard = laneToCheck[laneToCheck.length - 1];
                    if (!topCard.isFaceUp) {
                        return { type: 'deleteCard', cardId: topCard.id };
                    }
                }
            }
            // Fallback: delete any of its own face-down cards if the primary logic fails
            const anyFaceDown = state.opponent.lanes.map(l => l.length > 0 ? l[l.length - 1] : null).find(c => c && !c.isFaceUp);
            if (anyFaceDown) return { type: 'deleteCard', cardId: anyFaceDown.id };
            return { type: 'skip' };
        }
        
        case 'select_low_value_card_to_delete': {
            const uncoveredCards: { card: PlayedCard, owner: Player }[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (const lane of state[p].lanes) {
                    if (lane.length > 0) {
                        uncoveredCards.push({ card: lane[lane.length - 1], owner: p });
                    }
                }
            }
            const validTargets = uncoveredCards.filter(({ card }) => card.isFaceUp && (card.value === 0 || card.value === 1));

            if (validTargets.length > 0) {
                // Prioritize deleting player's cards, then own. Prioritize value 1 over 0.
                validTargets.sort((a, b) => {
                    const aIsPlayer = a.owner === 'player';
                    const bIsPlayer = b.owner === 'player';
                    if (aIsPlayer && !bIsPlayer) return -1;
                    if (!aIsPlayer && bIsPlayer) return 1;
                    return b.card.value - a.card.value;
                });
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
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

        case 'shift_flipped_card_optional': {
            // Normal AI: decide if shifting the player's card is beneficial.
            // A good shift makes a strong lane stronger for the player, or moves a card out of a contested lane.
            // Since this is a disruptive move, we want to move the card to the player's *strongest* lane.
            const cardInfo = findCardOnBoard(state, action.cardId);
            if (!cardInfo || cardInfo.owner !== 'player') return { type: 'skip' }; // Should only target player cards

            let originalLaneIndex = -1;
            for (let i = 0; i < state.player.lanes.length; i++) {
                if (state.player.lanes[i].some(c => c.id === action.cardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }
            if (originalLaneIndex === -1) return { type: 'skip' };

            const possibleLanes = [0, 1, 2]
                .filter(l => l !== originalLaneIndex)
                .map(index => ({ value: state.player.laneValues[index], index }))
                .sort((a, b) => b.value - a.value); // Sort descending by player's lane value

            if (possibleLanes.length > 0) {
                // Shift to the player's strongest other lane to consolidate their points and make other lanes weaker for them to build.
                return { type: 'selectLane', laneIndex: possibleLanes[0].index };
            }
            
            return { type: 'skip' };
        }
        case 'select_lane_for_water_3': {
            const getWater3TargetsInLane = (state: GameState, laneIndex: number): { playerTargets: number, opponentTargets: number } => {
                let playerTargets = 0;
                let opponentTargets = 0;
                for (const p of ['player', 'opponent'] as Player[]) {
                    const lane = state[p].lanes[laneIndex];
                    const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
                    const faceDownValue = hasDarkness2 ? 4 : 2;
                    
                    for (const card of lane) {
                        const value = card.isFaceUp ? card.value : faceDownValue;
                        if (value === 2) {
                            if (p === 'player') playerTargets++;
                            else opponentTargets++;
                        }
                    }
                }
                return { playerTargets, opponentTargets };
            };

            const scoredLanes = [0, 1, 2].map(i => {
                const { playerTargets, opponentTargets } = getWater3TargetsInLane(state, i);
                // Score is high for returning player cards, negative for returning own cards
                const score = (playerTargets * 10) - (opponentTargets * 5);
                return { laneIndex: i, score };
            });

            if (scoredLanes.some(l => l.score > 0)) {
                scoredLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }

            // If no beneficial targets, the action is mandatory, so just pick lane 0.
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'prompt_rearrange_protocols': {
            const originalOrder = state[action.target].protocols;
            if (originalOrder.length <= 1) {
                return { type: 'rearrangeProtocols', newOrder: [...originalOrder] };
            }
            const laneData = originalOrder.map((p, i) => ({
                protocol: p,
                value: state[action.target].laneValues[i]
            })).sort((a, b) => b.value - a.value);
            let newOrder = laneData.map(d => d.protocol);

            if (JSON.stringify(newOrder) === JSON.stringify(originalOrder)) {
                // If sorting doesn't change order (e.g., already sorted), swap the first two.
                [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
            }
            return { type: 'rearrangeProtocols', newOrder };
        }
        
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
            const uncoveredFaceDownCards: { card: PlayedCard, owner: Player, laneValue: number }[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                state[p].lanes.forEach((lane, i) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (!topCard.isFaceUp) {
                            uncoveredFaceDownCards.push({ card: topCard, owner: p, laneValue: state[p].laneValues[i] });
                        }
                    }
                });
            }

            if (uncoveredFaceDownCards.length > 0) {
                // Prioritize player cards in high-value lanes.
                uncoveredFaceDownCards.sort((a, b) => {
                    if (a.owner === 'player' && b.owner === 'opponent') return -1;
                    if (a.owner === 'opponent' && b.owner === 'player') return 1;
                    if (a.owner === 'player') return b.laneValue - a.laneValue; // high value lane first
                    return a.laneValue - b.laneValue; // low value lane first
                });
                return { type: 'deleteCard', cardId: uncoveredFaceDownCards[0].card.id };
            }
            return { type: 'skip' };
        }
        
        case 'select_opponent_face_down_card_to_shift': { // Speed-4
            const validTargets: { card: PlayedCard; laneIndex: number }[] = [];
            state.player.lanes.forEach((lane, index) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        validTargets.push({ card: topCard, laneIndex: index });
                    }
                }
            });

            if (validTargets.length > 0) {
                // Target the card in the player's highest value lane to disrupt it.
                validTargets.sort((a, b) => state.player.laneValues[b.laneIndex] - state.player.laneValues[a.laneIndex]);
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }

            return { type: 'skip' };
        }
        
        case 'select_any_opponent_card_to_shift': {
            // FIX: Only target uncovered cards.
            const validTargets = state.player.lanes.map(lane => lane.length > 0 ? lane[lane.length - 1] : null).filter((c): c is PlayedCard => c !== null);
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
