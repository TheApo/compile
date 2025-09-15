/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { shuffleDeck } from '../../utils/gameLogic';
import { normalAI } from './normal';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard } from '../game/helpers/actionUtils';

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

    // Find player's most powerful face-up card to target proactively
    const playerStrongestFaceUpCard = player.lanes.flat()
        .filter(c => c.isFaceUp)
        .sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state))[0];

    const playerHasPsychic1 = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);

    // --- Evaluate Playing Cards ---
    for (const card of opponent.hand) {
        for (let i = 0; i < 3; i++) {
            if (opponent.compiled[i]) continue;

            const baseScore = getCardPower(card);
            
            // 1. Evaluate Face-Up Play
            if (card.protocol === opponent.protocols[i] && !playerHasPsychic1) {
                // Special strategy for Metal-6
                if (card.protocol === 'Metal' && card.value === 6 && opponent.lanes[i].length < 4) {
                    // Hard AI avoids this move unless it's a game-winning compile setup.
                    const valueToAdd = card.value;
                    const resultingValue = opponent.laneValues[i] + valueToAdd;
                    if (!(resultingValue >= 10 && resultingValue > player.laneValues[i])) {
                        continue; // Skip this bad move
                    }
                }

                let score = baseScore;
                let description = `Play ${card.protocol}-${card.value} face-up in lane ${i}.`;
                const valueToAdd = card.value;
                const resultingValue = opponent.laneValues[i] + valueToAdd;

                // OFFENSIVE SCORING
                score += valueToAdd; // Points are good
                if (resultingValue >= 10 && resultingValue > player.laneValues[i]) score += 200; // Compile setup!
                else if (resultingValue >= 8) score += 100; // Strong setup
                score += (resultingValue - player.laneValues[i]); // Reward gaining a lead

                // DEFENSIVE SCORING
                const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                if (hasDisruption) {
                    // Prioritize disrupting high-threat lanes
                    if (playerThreatLevels[i] > 0) {
                        score += 150 * playerThreatLevels[i];
                        description += ` [DEFENSIVE: Disrupts player threat level ${playerThreatLevels[i]}]`;
                    }
                    // Prioritize disrupting player's strongest card
                    if (playerStrongestFaceUpCard && (card.keywords['flip'] || card.keywords['delete'])) {
                        score += getCardThreat(playerStrongestFaceUpCard, 'player', state) * 2;
                        description += ` [PROACTIVE: Targets strongest card ${playerStrongestFaceUpCard.protocol}-${playerStrongestFaceUpCard.value}]`;
                    }
                }
                possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true }, score, description });
            }

            // 2. Evaluate Face-Down Play
             // Special strategy for Metal-6
            if (card.protocol === 'Metal' && card.value === 6 && opponent.lanes[i].length < 4) {
                // Playing face down is never a good idea with Metal-6 early on.
                continue; // Skip this bad move
            }
            let score = 0; // Face-down plays are purely positional
            let description = `Play ${card.protocol}-${card.value} face-down in lane ${i}.`;
            const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, opponent.lanes[i]);
            const resultingValue = opponent.laneValues[i] + valueToAdd;

            if (resultingValue >= 10 && resultingValue > player.laneValues[i] && opponent.laneValues[i] >= 8) {
                score += 250; // WINNING MOVE, HIGHEST PRIORITY
                description += ` [WINNING MOVE: Sets up compile]`;
            } else if (opponent.laneValues[i] >= 6) {
                // If the lane is already strong, adding a face-down card is a good way to secure it
                score += (20 * opponent.laneValues[i]);
                description += ` [Secures strong lane]`;
            } else {
                score += 1; // It's a valid move, but not a great one.
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
        case 'discard':
            // Discard the absolute worst cards (low value, no effects)
            const sortedHand = [...opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'discardCards', cardIds: sortedHand.slice(0, action.count).map(c => c.id) };

        case 'select_cards_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = action.type === 'select_cards_to_delete'
                ? action.disallowedIds
                : (action.type === 'select_card_to_delete_for_death_1' ? [action.sourceCardId] : []);
            // Delete the player's most threatening card on board.
            const allowedPlayerCards = player.lanes.flat().filter(c => !disallowedIds.includes(c.id));
            if (allowedPlayerCards.length > 0) {
                const bestTarget = allowedPlayerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state))[0];
                return { type: 'deleteCard', cardId: bestTarget.id };
            }
            return { type: 'skip' };
        }

        case 'select_any_face_down_card_to_flip_optional': {
            const potentialTargets: { card: PlayedCard; score: number }[] = [];

            // Evaluate flipping own face-down cards
            state.opponent.lanes.forEach((lane, i) => {
                lane.forEach(c => {
                    if (!c.isFaceUp) {
                        const faceDownValue = getEffectiveCardValue(c, lane);
                        // Value gain is the card's real value minus what it was contributing as face-down
                        const valueGain = c.value - faceDownValue;
                        let score = 5 + valueGain;
                        // Huge bonus if this flip helps compile
                        if ((state.opponent.laneValues[i] + valueGain) >= 10) {
                            score += 100;
                        }
                        potentialTargets.push({ card: c, score });
                    }
                });
            });

            // Evaluate flipping player's face-down cards. This is risky, could help the player.
            // Hard AI might do this to gain information.
            state.player.lanes.forEach((lane, i) => {
                lane.forEach(c => {
                    if (!c.isFaceUp) {
                        // Low score, it's just for information. Less valuable if player lane is already strong.
                        let score = 3 - state.player.laneValues[i]; 
                        potentialTargets.push({ card: c, score });
                    }
                });
            });
            
            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                // Hard AI will only make the move if it's beneficial (score > 0)
                if (potentialTargets[0].score > 0) {
                    return { type: 'flipCard', cardId: potentialTargets[0].card.id };
                }
            }

            return { type: 'skip' }; // It's optional, skip if no good move.
        }

        case 'select_any_card_to_flip_optional':
        case 'select_any_card_to_flip':
        case 'select_card_to_flip_for_fire_3':
        case 'select_any_other_card_to_flip':
        case 'select_card_to_flip_for_light_0':
        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_opponent_face_up_card_to_flip':
        case 'select_opponent_card_to_flip': {
            const potentialTargets: { cardId: string; score: number }[] = [];
            // 1. Score flipping opponent's face-up cards (high threat = high score)
            player.lanes.flat().forEach(c => {
                if (c.isFaceUp) {
                    potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) });
                }
            });
            // 2. Score flipping own face-down cards (consistent gain + reveals card)
            opponent.lanes.flat().forEach(c => {
                if (!c.isFaceUp) {
                    const valueGain = (getCardThreat({ ...c, isFaceUp: true }, 'opponent', state)) - getCardThreat(c, 'opponent', state);
                    potentialTargets.push({ cardId: c.id, score: valueGain + 3 }); // +3 for reveal utility
                }
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                if (potentialTargets[0].score > 0) {
                    return { type: 'flipCard', cardId: potentialTargets[0].cardId };
                }
            }
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }

        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            const validTargets: PlayedCard[] = [];
             for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;
                 // Get all valid player cards from valid lanes
                const playerLane = state.player.lanes[i];
                validTargets.push(...playerLane);
            }
             if (validTargets.length > 0) {
                // Target highest threat card among valid targets
                validTargets.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }
            
        case 'select_low_value_card_to_delete': {
            const validTargets = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                .filter(c => c.isFaceUp && (c.value === 0 || c.value === 1));
            if (validTargets.length > 0) {
                // Prioritize deleting player's cards with highest threat (e.g., a value 0/1 card with a strong static effect).
                validTargets.sort((a, b) => {
                    const aIsPlayer = state.player.lanes.flat().some(c => c.id === a.id);
                    const bIsPlayer = state.player.lanes.flat().some(c => c.id === b.id);
                    if (aIsPlayer && !bIsPlayer) return -1;
                    if (!aIsPlayer && bIsPlayer) return 1;
                    return getCardThreat(b, aIsPlayer ? 'player' : 'opponent', state) - getCardThreat(a, bIsPlayer ? 'player' : 'opponent', state);
                });
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_own_covered_card_in_lane_to_flip': {
            const { laneIndex } = action;
            const ownLane = state.opponent.lanes[laneIndex];
            const coveredCards = ownLane.filter((c, i, arr) => i < arr.length - 1);
            
            // Hard AI sees the value in revealing its own cards. It will always flip a face-down card.
            const faceDownTarget = coveredCards.find(c => !c.isFaceUp);
            if (faceDownTarget) {
                return { type: 'flipCard', cardId: faceDownTarget.id };
            }
            
            // It's a bad move to flip your own powerful face-up cards face-down.
            return { type: 'skip' };
        }

        case 'select_own_card_to_return_for_water_4': {
            const ownCards = opponent.lanes.flat();
            if (ownCards.length > 0) {
                // Hard AI: Prioritize returning a low-value card with a reusable on-play effect.
                const scoredCards = ownCards.map(card => {
                    let score = 10 - card.value; // Higher score for lower value
                    const hasGoodEffect = card.keywords.delete || card.keywords.play || card.keywords.draw || card.keywords.flip;
                    if (hasGoodEffect) {
                        score += 5; // Bonus for good on-play effect
                    }
                    return { card, score };
                });

                scoredCards.sort((a, b) => b.score - a.score); // Sort descending by score
                return { type: 'returnCard', cardId: scoredCards[0].card.id };
            }
            return { type: 'skip' };
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
        
        case 'prompt_rearrange_protocols':
            // Smart rearrangement: put lanes where AI is winning/strongest first.
            const laneData = state[action.target].protocols.map((p, i) => ({
                protocol: p,
                valueDifference: state.opponent.laneValues[i] - state.player.laneValues[i]
            })).sort((a, b) => b.valueDifference - a.valueDifference);
            const newOrder = laneData.map(d => d.protocol);
            return { type: 'rearrangeProtocols', newOrder };

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
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                // Target the most threatening card on the board, prioritizing player cards
                allCards.sort((a, b) => {
                    const aIsPlayer = state.player.lanes.flat().some(c => c.id === a.id);
                    const bIsPlayer = state.player.lanes.flat().some(c => c.id === b.id);
                    if (aIsPlayer && !bIsPlayer) return -1;
                    if (!aIsPlayer && bIsPlayer) return 1;
                    return getCardThreat(b, aIsPlayer ? 'player' : 'opponent', state) - getCardThreat(a, bIsPlayer ? 'player' : 'opponent', state);
                });
                return { type: 'deleteCard', cardId: allCards[0].id };
            }
            return { type: 'skip' };
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
        
        case 'select_any_opponent_card_to_shift': {
            const validTargets = state.player.lanes.flat();
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
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: true };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: state.opponent.hand.length > 1 };
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