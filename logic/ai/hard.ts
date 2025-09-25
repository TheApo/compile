/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { shuffleDeck } from '../../utils/gameLogic';
import { normalAI } from './normal';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { handleControlRearrange } from './controlMechanicLogic';

type ScoredMove = {
    move: AIAction;
    score: number;
    description: string;
};

const DISRUPTION_KEYWORDS = ['delete', 'flip', 'shift', 'return', 'discard'];

const getCardPower = (card: PlayedCard): number => {
    // Low value cards with good effects are more powerful.
    let power = 10 - card.value;
    if (DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) power += 5;
    if (card.keywords['draw']) power += 3;
    if (card.keywords['play']) power += 6;
    return power;
};

// Evaluates the threat of a card already on the board. Used for targeting.
const getCardThreat = (card: PlayedCard, owner: Player, state: GameState): number => {
    // Find the lane the card is in to get context
    let lane: PlayedCard[] | undefined;
    for (const l of state[owner].lanes) {
        if (l.some(c => c.id === card.id)) {
            lane = l;
            break;
        }
    }
    if (!lane) return 0; // Should not happen

    if (!card.isFaceUp) {
        const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
        return hasDarkness2 ? 4 : 2;
    }
    
    let threat = card.value * 2; // Base threat is its point value, weighted heavily.

    // Add threat for powerful static effects (TOP box)
    if (card.top.length > 0) {
        threat += 5;
    }
    // Add threat for recurring effects (START/END in BOTTOM box)
    if (card.bottom.includes("Start:") || card.bottom.includes("End:")) {
        threat += 6;
    }
    // Add threat for powerful on-cover effects (BOTTOM box)
    if (card.bottom.includes("covered:")) {
        threat += 4;
    }

    return threat;
}

const getBestMove = (state: GameState): AIAction => {
    const { opponent, player } = state;
    const possibleMoves: ScoredMove[] = [];

    // --- Threat Assessment ---
    const playerThreatLevels = player.laneValues.map((value, i) => {
        if (player.compiled[i]) return 0;
        if (value >= 10) return 3; // Immediate threat
        if (value >= 8) return 2;  // High threat
        if (value >= 6) return 1;  // Medium threat
        return 0;
    });

    const playerStrongestFaceUpCard = player.lanes.flat()
        .filter(c => c.isFaceUp)
        .sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state))[0];

    const playerHasPsychic1 = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);

    const isLaneBlockedByPlague0 = (laneIndex: number): boolean => {
        const playerLane = state.player.lanes[laneIndex];
        if (playerLane.length === 0) return false;
        const topCard = playerLane[playerLane.length - 1];
        return topCard.isFaceUp && topCard.protocol === 'Plague' && topCard.value === 0;
    };

    // --- Evaluate Playing Cards ---
    for (const card of opponent.hand) {
        if (card.protocol === 'Water' && card.value === 4 && opponent.lanes.flat().length === 0) {
            continue;
        }
        
        for (let i = 0; i < 3; i++) {
            if (isLaneBlockedByPlague0(i)) continue;
            if (opponent.compiled[i]) continue;
            
            // FIX: Prevent AI from playing Metal-6 on a lane with less than 4 points.
            if (card.protocol === 'Metal' && card.value === 6 && opponent.laneValues[i] < 4) {
                continue;
            }
            
            const canPlayerCompileThisLane = player.laneValues[i] >= 10 && player.laneValues[i] > opponent.laneValues[i];
            const baseScore = getCardPower(card);
            
            // 1. Evaluate Face-Up Play
            if ((card.protocol === opponent.protocols[i] || card.protocol === player.protocols[i]) && !playerHasPsychic1) {
                let score = 0;
                let description = `Play ${card.protocol}-${card.value} face-up in lane ${i}.`;
                const valueToAdd = card.value;
                const resultingValue = opponent.laneValues[i] + valueToAdd;

                if (canPlayerCompileThisLane) {
                    if (resultingValue > player.laneValues[i]) {
                        score = 1000 + resultingValue; // BLOCKING MOVE - HIGHEST PRIORITY
                        description += ` [BLOCKS COMPILE]`;
                    } else {
                        score = -1000; // WASTED MOVE - HIGHEST PENALTY
                        description += ` [FAILS TO BLOCK COMPILE]`;
                    }
                } else {
                    // OFFENSIVE & STRATEGIC SCORING
                    score += baseScore;
                    score += valueToAdd;

                    if (resultingValue >= 10 && resultingValue > player.laneValues[i]) {
                        score += 500; 
                        description += ` [SETS UP WINNING COMPILE]`;
                    } else {
                        score += (resultingValue - player.laneValues[i]) * 2;
                    }

                    const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                    if (hasDisruption) {
                        if (playerThreatLevels[i] > 0) {
                            score += 50 * playerThreatLevels[i];
                            description += ` [Disrupts player threat L${playerThreatLevels[i]}]`;
                        }
                        if (playerStrongestFaceUpCard && (card.keywords['flip'] || card.keywords['delete'])) {
                            score += getCardThreat(playerStrongestFaceUpCard, 'player', state);
                            description += ` [Targets strongest card ${playerStrongestFaceUpCard.protocol}-${playerStrongestFaceUpCard.value}]`;
                        }
                    }
                }
                
                possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true }, score, description });
            }

            // 2. Evaluate Face-Down Play
            const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, opponent.lanes[i]);
            const resultingValue = opponent.laneValues[i] + valueToAdd;
            let score = 0;
            let description = `Play ${card.protocol}-${card.value} face-down in lane ${i}.`;

            if (canPlayerCompileThisLane) {
                if (resultingValue > player.laneValues[i]) {
                    score = 1000 + resultingValue; // BLOCKING MOVE - HIGHEST PRIORITY
                    description += ` [BLOCKS COMPILE]`;
                } else {
                    score = -1000; // WASTED MOVE - HIGHEST PENALTY
                    description += ` [FAILS TO BLOCK COMPILE]`;
                }
            } else {
                if (resultingValue >= 10 && resultingValue > player.laneValues[i]) {
                    score += 500; 
                    description += ` [SETS UP WINNING COMPILE]`;
                } else {
                    score += valueToAdd;
                    score += (resultingValue - player.laneValues[i]) * 2;
                }
            }
             
            possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false }, score, description });
        }
    }
    
    // Evaluate Filling Hand - should be a last resort for Hard AI
    if (opponent.hand.length < 5) {
        let fillHandScore = 1; // Very low base score
        const avgHandPower = opponent.hand.reduce((sum, c) => sum + getCardPower(c), 0) / (opponent.hand.length || 1);
        if (avgHandPower < 8) {
            fillHandScore = 5; // Slightly better idea to draw if hand is very weak
        }
        if (opponent.hand.length === 0) {
            fillHandScore = 500; // Must draw
        }
        possibleMoves.push({ move: { type: 'fillHand' }, score: fillHandScore, description: "Fill hand." });
    }

    if (possibleMoves.length === 0) {
        return { type: 'fillHand' };
    }

    possibleMoves.sort((a, b) => b.score - a.score);
    return possibleMoves[0].move;
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    // Hard AI makes optimal choices for required actions.
    const { player, opponent } = state;
    switch (action.type) {
        case 'prompt_use_control_mechanic': {
            const { player } = state; // human player
            const playerHasCompiled = player.compiled.some(c => c);
            const uncompiledLaneCount = player.compiled.filter(c => !c).length;

            // Condition for strategic swap: player has at least one compiled and one uncompiled protocol.
            if (playerHasCompiled && uncompiledLaneCount > 0) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            } else {
                // No strategic swap available, so skip.
                return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
            }
        }

        case 'discard':
            // Discard the absolute worst cards (low value, no effects)
            const sortedHand = [...opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'discardCards', cardIds: sortedHand.slice(0, action.count).map(c => c.id) };

        case 'select_opponent_card_to_flip': { // Darkness-1
            const getUncovered = (p: Player): PlayedCard[] => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const opponentUncovered = getUncovered('player');
            if (opponentUncovered.length === 0) return { type: 'skip' };

            const potentialTargets: { cardId: string; score: number }[] = [];

            opponentUncovered.forEach(c => {
                if (c.isFaceUp) {
                    // Score is based on the threat we are hiding.
                    potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) });
                } else {
                    // Score is based on gaining information about a high-threat lane.
                    const laneIndex = state.player.lanes.findIndex(lane => lane.some(card => card.id === c.id));
                    const score = 5 + state.player.laneValues[laneIndex];
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
            
            const getUncoveredCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            // Delete the player's most threatening card on board.
            const allowedPlayerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
            if (allowedPlayerCards.length > 0) {
                const bestTarget = allowedPlayerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state))[0];
                return { type: 'deleteCard', cardId: bestTarget.id };
            }
            
            // If player has no cards, must delete own. Pick lowest threat to minimize self-harm.
            const allowedOpponentCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
            if (allowedOpponentCards.length > 0) {
                const worstCard = allowedOpponentCards.sort((a, b) => getCardThreat(a, 'opponent', state) - getCardThreat(b, 'opponent', state))[0];
                return { type: 'deleteCard', cardId: worstCard.id };
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

            // Score player's face-down cards based on lane threat. Revealing a card in a high-threat lane is valuable.
            getUncovered('player').forEach(c => {
                if (!c.isFaceUp) {
                    const laneIndex = state.player.lanes.findIndex(lane => lane.some(card => card.id === c.id));
                    const score = state.player.laneValues[laneIndex];
                    potentialTargets.push({ card: c, score });
                }
            });

            // Score own face-down cards (low priority, only if no player targets)
            getUncovered('opponent').forEach(c => {
                if (!c.isFaceUp) {
                    const score = -10; // Avoid revealing own cards if possible.
                    potentialTargets.push({ card: c, score });
                }
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: potentialTargets[0].card.id };
            }

            return { type: 'skip' };
        }

        case 'select_opponent_face_up_card_to_flip': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);
        
            const validTargets = getUncovered('player').filter(c => c.isFaceUp);
        
            if (validTargets.length > 0) {
                // Hard AI: Flip the player's most threatening card.
                validTargets.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'flipCard', cardId: validTargets[0].id };
            }
            
            return { type: 'skip' };
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

            // Special case for effects targeting covered cards
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const playerCovered = player.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                playerCovered.forEach(c => potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) }));
                const opponentCovered = opponent.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                opponentCovered.forEach(c => potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'opponent', state) / 2 }));
            } else {
                 // FIX: Only target uncovered cards for standard flip effects.
                const getUncovered = (p: Player): PlayedCard[] => {
                    return state[p].lanes
                        .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                        .filter((c): c is PlayedCard => c !== null);
                };

                const allUncoveredPlayer = getUncovered('player');
                const allUncoveredOpponent = getUncovered('opponent');

                // 1. Score flipping opponent's face-up cards (high threat = high score)
                allUncoveredPlayer.forEach(c => {
                    if (c.isFaceUp && !requiresFaceDown) potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) });
                });
                // 2. Score flipping own face-down cards (value gain + reveal)
                allUncoveredOpponent.forEach(c => {
                    if (!c.isFaceUp) {
                        const valueGain = getCardThreat({ ...c, isFaceUp: true }, 'opponent', state) - getCardThreat(c, 'opponent', state);
                        potentialTargets.push({ cardId: c.id, score: valueGain + 3 });
                    }
                });
                // 3. Score flipping opponent's face-down cards (info gain)
                allUncoveredPlayer.forEach(c => {
                    if (!c.isFaceUp) potentialTargets.push({ cardId: c.id, score: 2 });
                });
                // 4. Score flipping own face-up cards (usually bad, negative score)
                allUncoveredOpponent.forEach(c => {
                    if (c.isFaceUp && !requiresFaceDown) {
                        if (!canTargetSelf && c.id === sourceCardId) return;
                        potentialTargets.push({ cardId: c.id, score: -getCardThreat(c, 'opponent', state) });
                    }
                });
            }


            if (potentialTargets.length === 0) {
                return { type: 'skip' };
            }
            
            potentialTargets.sort((a, b) => b.score - a.score);
            const bestTarget = potentialTargets[0];
            
            if (isOptional && bestTarget.score <= 0) {
                return { type: 'skip' };
            }
            
            return { type: 'flipCard', cardId: bestTarget.cardId };
        }

        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            const playerTargets: PlayedCard[] = [];
            const opponentTargets: PlayedCard[] = [];

            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;

                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    playerTargets.push(playerLane[playerLane.length - 1]);
                }
                
                const opponentLane = state.opponent.lanes[i];
                if (opponentLane.length > 0) {
                    opponentTargets.push(opponentLane[opponentLane.length - 1]);
                }
            }

            if (playerTargets.length > 0) {
                // Target player's highest threat card
                playerTargets.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'deleteCard', cardId: playerTargets[0].id };
            }

            if (opponentTargets.length > 0) {
                // Must delete own card, pick lowest threat card to minimize self-harm
                opponentTargets.sort((a, b) => getCardThreat(a, 'opponent', state) - getCardThreat(b, 'opponent', state));
                return { type: 'deleteCard', cardId: opponentTargets[0].id };
            }

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
                // Prioritize deleting player's cards with highest threat (e.g., a value 0/1 card with a strong static effect).
                validTargets.sort((a, b) => {
                    const aIsPlayer = a.owner === 'player';
                    const bIsPlayer = b.owner === 'player';
                    if (aIsPlayer && !bIsPlayer) return -1;
                    if (!aIsPlayer && bIsPlayer) return 1;
                    return getCardThreat(b.card, b.owner, state) - getCardThreat(a.card, a.owner, state);
                });
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'select_own_card_to_return_for_water_4': {
            const ownCardsWithContext: { card: PlayedCard, lane: PlayedCard[] }[] = [];
            opponent.lanes.forEach(lane => {
                lane.forEach(card => {
                    ownCardsWithContext.push({ card, lane });
                });
            });

            if (ownCardsWithContext.length > 0) {
                // Hard AI: Prioritize returning a card that minimizes point loss on the board,
                // while also considering the value of reusing its on-play effect.
                const scoredCards = ownCardsWithContext.map(({ card, lane }) => {
                    const effectiveValue = getEffectiveCardValue(card, lane);
                    // Base score is negative effective value. We want to maximize this (i.e., minimize value).
                    let score = -effectiveValue; 
                    
                    const hasGoodEffect = card.keywords.delete || card.keywords.play || card.keywords.draw || card.keywords.flip || card.keywords.return;
                    
                    // Add bonus for reusing a good effect, but not for the source card itself.
                    if (hasGoodEffect && card.id !== action.sourceCardId) {
                        score += 5;
                    }
                    
                    return { card, score };
                });

                scoredCards.sort((a, b) => b.score - a.score); // Higher score is better.
                return { type: 'returnCard', cardId: scoredCards[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'shift_flipped_card_optional': {
            // Hard AI: calculate the best lane to shift the player's card to, to cause maximum disruption
            // or minimal benefit to the player.
            const cardInfo = findCardOnBoard(state, action.cardId);
            if (!cardInfo || cardInfo.owner !== 'player') return { type: 'skip' }; // Should only target player cards

            const { card: cardToShift } = cardInfo;

            let originalLaneIndex = -1;
            for (let i = 0; i < state.player.lanes.length; i++) {
                if (state.player.lanes[i].some(c => c.id === action.cardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }
            if (originalLaneIndex === -1) return { type: 'skip' };

            const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
            
            if (possibleLanes.length === 0) return { type: 'skip' };

            // Score each possible shift. A good shift for the AI minimizes the player's score advantage.
            const scoredLanes = possibleLanes.map(laneIndex => {
                const valueToAdd = getEffectiveCardValue(cardToShift, state.player.lanes[laneIndex]);
                const futurePlayerLaneValue = state.player.laneValues[laneIndex] + valueToAdd;
                const futurePlayerLead = futurePlayerLaneValue - state.opponent.laneValues[laneIndex];
                // AI wants to MINIMIZE the player's future lead. A negative score is better.
                let score = -futurePlayerLead; 

                // Heavily penalize shifting a card to a lane that could help the player compile.
                if (futurePlayerLaneValue >= 10 && futurePlayerLaneValue > state.opponent.laneValues[laneIndex]) {
                    score -= 200;
                }

                return { laneIndex, score };
            });

             scoredLanes.sort((a, b) => b.score - a.score); // Highest score is the best move for the AI.

            // Hard AI will always shift if it's an option.
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_lane_for_shift': {
            const { cardToShiftId, cardOwner, originalLaneIndex } = action;
            const cardToShift = findCardOnBoard(state, cardToShiftId)?.card;
            if (!cardToShift) return { type: 'skip' };

            const possibleLanes = [0, 1, 2].filter(i => i !== originalLaneIndex);
            
            if (cardOwner === 'opponent') { // AI is shifting its own card
                // Score each possible lane based on how much it helps the AI.
                const scoredLanes = possibleLanes.map(laneIndex => {
                    const valueToAdd = getEffectiveCardValue(cardToShift, state.opponent.lanes[laneIndex]);
                    const futureLaneValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                    const futureLead = futureLaneValue - state.player.laneValues[laneIndex];
                    let score = futureLead; // Higher lead is better.
                    if (futureLaneValue >= 10 && futureLaneValue > state.player.laneValues[laneIndex]) score += 100; // Compile setup is great.
                    return { laneIndex, score };
                });
                scoredLanes.sort((a, b) => b.score - a.score); // Best lane first
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            } else { // AI is shifting player's card
                // Score each possible lane based on how much it hurts the player.
                const scoredLanes = possibleLanes.map(laneIndex => {
                    const valueToAdd = getEffectiveCardValue(cardToShift, state.player.lanes[laneIndex]);
                    const futureLaneValue = state.player.laneValues[laneIndex] + valueToAdd;
                    const futureLead = futureLaneValue - state.opponent.laneValues[laneIndex];
                    // AI wants to MINIMIZE the player's future lead. So we sort ascending.
                    return { laneIndex, score: futureLead };
                });
                 scoredLanes.sort((a, b) => a.score - b.score); // Worst lane for player first
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
        }
        
        case 'select_own_card_to_shift_for_speed_3': {
            const ownCards = state.opponent.lanes.flat();
            // This action is mandatory and is only dispatched if the AI has at least one card.
            // Hard AI: shift its highest-threat card, assuming it's moving it to an even better position.
            ownCards.sort((a, b) => getCardThreat(b, 'opponent', state) - getCardThreat(a, 'opponent', state));
            return { type: 'deleteCard', cardId: ownCards[0].id };
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
                // Score is high for returning player cards, negative for returning own cards.
                // Hard AI also considers player hand size. Returning cards to a player with a full hand is less bad.
                const playerHandSizeModifier = 5 - state.player.hand.length; // Max modifier is 5 (empty hand), min is 0 (full hand)
                const score = (playerTargets * (10 + playerHandSizeModifier)) - (opponentTargets * 5);
                return { laneIndex: i, score };
            });

            if (scoredLanes.some(l => l.score > 0)) {
                scoredLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }

            // If no beneficial targets, the action is mandatory, so just pick lane 0.
            return { type: 'selectLane', laneIndex: 0 };
        }
        
        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);

        case 'prompt_swap_protocols': {
            const { opponent } = state;
            const possibleSwaps: [number, number][] = [[0, 1], [0, 2], [1, 2]];
            let bestSwap: [number, number] = [0, 1]; // Default swap
            let bestScore = -Infinity;

            for (const swap of possibleSwaps) {
                const [i, j] = swap;
                const newProtocols = [...opponent.protocols];
                [newProtocols[i], newProtocols[j]] = [newProtocols[j], newProtocols[i]];
                
                let score = 0;
                
                // Calculate the score change based on hand playability.
                for (const card of opponent.hand) {
                    const couldPlayBeforeI = card.protocol === opponent.protocols[i];
                    const couldPlayBeforeJ = card.protocol === opponent.protocols[j];
                    const canPlayNowI = card.protocol === newProtocols[i]; // which is opponent.protocols[j]
                    const canPlayNowJ = card.protocol === newProtocols[j]; // which is opponent.protocols[i]

                    // It's a gain if a card can now be played face up where it couldn't before.
                    if (canPlayNowI && !couldPlayBeforeI) score += getCardPower(card);
                    if (canPlayNowJ && !couldPlayBeforeJ) score += getCardPower(card);
                    
                    // It's a loss if a card can no longer be played face up where it could before.
                    if (!canPlayNowI && couldPlayBeforeI) score -= getCardPower(card);
                    if (!canPlayNowJ && couldPlayBeforeJ) score -= getCardPower(card);
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestSwap = swap;
                }
            }
            return { type: 'resolveSwapProtocols', indices: bestSwap };
        }

        case 'select_card_to_shift_for_gravity_1': {
            const playerCards = state.player.lanes.flat();
            if (playerCards.length > 0) {
                // Target player's most threatening card
                playerCards.sort((a,b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'deleteCard', cardId: playerCards[0].id };
            }
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                 // Fallback: shift own least powerful card
                ownCards.sort((a,b) => getCardPower(a) - getCardPower(b));
                return { type: 'deleteCard', cardId: ownCards[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const allUncovered = [...getUncovered('player'), ...getUncovered('opponent')];
            if (allUncovered.length === 0) return { type: 'skip' };
            
            const sortedTargets = allUncovered.sort((a, b) => {
                const aIsPlayer = state.player.lanes.flat().some(c => c.id === a.id);
                const bIsPlayer = state.player.lanes.flat().some(c => c.id === b.id);
                
                // Prioritize flipping player's most threatening face-up card
                if (aIsPlayer && a.isFaceUp && (!bIsPlayer || !b.isFaceUp)) return -1;
                if (bIsPlayer && b.isFaceUp && (!aIsPlayer || !a.isFaceUp)) return 1;
                if (aIsPlayer && a.isFaceUp && bIsPlayer && b.isFaceUp) {
                    return getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state);
                }

                // Otherwise, flip own most valuable face-down card
                const aScore = !aIsPlayer && !a.isFaceUp ? 50 + a.value : 1;
                const bScore = !bIsPlayer && !b.isFaceUp ? 50 + b.value : 1;

                return bScore - aScore;
            });

            return { type: 'deleteCard', cardId: sortedTargets[0].id };
        }

        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex } = action;
            let bestTarget: PlayedCard | null = null;
            let highestThreat = -1;

            for (let i = 0; i < state.player.lanes.length; i++) {
                if (i === targetLaneIndex) continue;
                const laneValue = state.player.laneValues[i];
                if (laneValue > highestThreat) {
                    const faceDownCardInLane = state.player.lanes[i].find(c => !c.isFaceUp);
                    if (faceDownCardInLane) {
                        highestThreat = laneValue;
                        bestTarget = faceDownCardInLane;
                    }
                }
            }
            if (bestTarget) {
                return { type: 'deleteCard', cardId: bestTarget.id };
            }
            
            const ownTargets: PlayedCard[] = [];
             for (let i = 0; i < state.opponent.lanes.length; i++) {
                if (i === targetLaneIndex) continue;
                 state.opponent.lanes[i].forEach(c => { if (!c.isFaceUp) ownTargets.push(c); });
            }
            if(ownTargets.length > 0) {
                return { type: 'deleteCard', cardId: ownTargets[0].id };
            }

            return { type: 'skip' };
        }

        case 'select_face_down_card_to_shift_for_darkness_4': {
            const potentialTargets: { cardId: string; score: number }[] = [];

            // Player's uncovered face-down cards
            state.player.lanes.forEach((lane, i) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        const score = state.player.laneValues[i]; // Score is the value of the lane it's in
                        potentialTargets.push({ cardId: topCard.id, score });
                    }
                }
            });

            // Opponent's (AI's) uncovered face-down cards. Negative score to avoid unless necessary.
            state.opponent.lanes.forEach((lane, i) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        const score = -5 - state.opponent.laneValues[i]; // Avoid shifting own cards from high-value lanes.
                        potentialTargets.push({ cardId: topCard.id, score });
                    }
                }
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: potentialTargets[0].cardId };
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
                // Target the card in the player's highest threat lane.
                // Threat is measured by lane value.
                validTargets.sort((a, b) => state.player.laneValues[b.laneIndex] - state.player.laneValues[a.laneIndex]);
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }

            return { type: 'skip' };
        }
        
        case 'select_any_opponent_card_to_shift': {
            // FIX: Only target uncovered cards.
            const validTargets = state.player.lanes.map(lane => lane.length > 0 ? lane[lane.length - 1] : null).filter((c): c is PlayedCard => c !== null);
            if (validTargets.length > 0) {
                // Target player's highest threat card
                validTargets.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        // Hard AI always accepts potentially beneficial optional effects
        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: true };
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: true };
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: false };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: state.opponent.hand.length > 1 };
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: true };
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: true };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: true };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };
        
        case 'prompt_shift_or_flip_for_light_2': {
            const { revealedCardId } = action;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'skip' };
            const { card, owner } = cardInfo;

            // --- Score flipping ---
            let flipScore = 0;
            if (owner === 'opponent') { // AI's card
                flipScore = getCardPower(card) + card.value; // Value + effect power
            } else { // Player's card
                flipScore = -getCardThreat(card, 'player', state); // Flipping a player card is generally bad
            }

            // --- Score shifting ---
            let shiftScore = 0;
            let bestShiftLane = -1;

            let originalLaneIndex = -1;
            for (let i = 0; i < state[owner].lanes.length; i++) {
                if (state[owner].lanes[i].some(c => c.id === revealedCardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }
            if (originalLaneIndex !== -1) {
                const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
                if (possibleLanes.length > 0) {
                    let bestLaneScore = -Infinity;
                    for (const targetLane of possibleLanes) {
                        let currentLaneScore = 0;
                        if (owner === 'opponent') { // Shift own card
                            const newLead = (state.opponent.laneValues[targetLane] + getEffectiveCardValue(card, [])) - state.player.laneValues[targetLane];
                            const oldLead = state.opponent.laneValues[originalLaneIndex] - state.player.laneValues[originalLaneIndex];
                            currentLaneScore = newLead - oldLead;
                        } else { // Shift player's card
                            const newPlayerLead = (state.player.laneValues[targetLane] + getEffectiveCardValue(card, [])) - state.opponent.laneValues[targetLane];
                            const oldPlayerLead = state.player.laneValues[originalLaneIndex] - state.opponent.laneValues[originalLaneIndex];
                            currentLaneScore = oldPlayerLead - newPlayerLead; // AI wants to reduce player lead
                        }
                        if (currentLaneScore > bestLaneScore) {
                            bestLaneScore = currentLaneScore;
                            bestShiftLane = targetLane;
                        }
                    }
                    shiftScore = bestLaneScore;
                }
            }

            // --- Decision ---
            if (flipScore > shiftScore && flipScore > 0) {
                return { type: 'resolveLight2Prompt', choice: 'flip' };
            }
            if (shiftScore > 0) {
                return { type: 'resolveLight2Prompt', choice: 'shift' };
            }
            return { type: 'resolveLight2Prompt', choice: 'skip' };
        }
        
        case 'select_opponent_covered_card_to_shift': {
            const validTargets: { card: PlayedCard; laneIndex: number }[] = [];
            for (let i = 0; i < state.player.lanes.length; i++) {
                const lane = state.player.lanes[i];
                for (let j = 0; j < lane.length - 1; j++) {
                    validTargets.push({ card: lane[j], laneIndex: i });
                }
            }

            if (validTargets.length > 0) {
                // Hard AI: shift the card from the player's strongest lane to weaken it.
                // Prioritize high-threat face-up cards within that lane.
                validTargets.sort((a, b) => {
                    const laneValueA = state.player.laneValues[a.laneIndex];
                    const laneValueB = state.player.laneValues[b.laneIndex];
                    if (laneValueA !== laneValueB) {
                        return laneValueB - laneValueA; // 1. Strongest lane
                    }
                    return getCardThreat(b.card, 'player', state) - getCardThreat(a.card, 'player', state);
                });
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        default:
            // Fallback to normal AI logic for unhandled actions.
            const normalLogic = normalAI(state, action);
            if (normalLogic) return normalLogic;
            return { type: 'skip' };
    }
}

export const hardAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        // Compile the lane with the highest value lead
        const bestLane = state.compilableLanes.reduce((a, b) => {
            const leadA = state.opponent.laneValues[a] - state.player.laneValues[a];
            const leadB = state.opponent.laneValues[b] - state.player.laneValues[b];
            return leadA > leadB ? a : b;
        });
        return { type: 'compile', laneIndex: bestLane };
    }

    if (state.phase === 'action') {
        return getBestMove(state);
    }

    return { type: 'fillHand' }; // Fallback
};