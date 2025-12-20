/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EffectEvaluator - Evaluates card effects in context
 *
 * This module provides intelligent evaluation of card effects based on
 * the current game state and strategy, not just raw card values.
 *
 * KEY INSIGHT: A flip effect on a 6-value card is GREAT (reduces by 4),
 * but on a 0-value card is TERRIBLE (increases by 2)!
 *
 * NEW: Uses AI Card Memory to remember face-down card values for smarter decisions.
 */

import { GameState, Player, PlayedCard } from '../../types';
import { GameAnalysis } from './analyzer';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { getKnownValue, aiKnowsCard } from './cardMemory';

// =============================================================================
// TYPES
// =============================================================================

export interface TargetScore {
    targetId: string;
    targetOwner: Player;
    laneIndex: number;
    score: number;
    reasoning: string;
}

export interface EffectEvaluation {
    effectType: string;
    bestTargets: TargetScore[];
    contextualValue: number;  // -100 to +100
    hasValidTargets: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the lane index for a card
 */
function getLaneIndex(state: GameState, cardId: string): number {
    for (const playerKey of ['player', 'opponent'] as const) {
        for (let i = 0; i < state[playerKey].lanes.length; i++) {
            if (state[playerKey].lanes[i].some(c => c.id === cardId)) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Get the owner of a card
 */
function getCardOwner(state: GameState, cardId: string): Player | null {
    for (const playerKey of ['player', 'opponent'] as const) {
        for (const lane of state[playerKey].lanes) {
            if (lane.some(c => c.id === cardId)) {
                return playerKey;
            }
        }
    }
    return null;
}

/**
 * Check if a card is uncovered (top of stack)
 */
function isUncovered(state: GameState, cardId: string): boolean {
    for (const playerKey of ['player', 'opponent'] as const) {
        for (const lane of state[playerKey].lanes) {
            if (lane.length > 0 && lane[lane.length - 1].id === cardId) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Get all uncovered cards for a player
 */
function getUncoveredCards(state: GameState, player: Player): PlayedCard[] {
    const uncovered: PlayedCard[] = [];
    for (const lane of state[player].lanes) {
        if (lane.length > 0) {
            uncovered.push(lane[lane.length - 1]);
        }
    }
    return uncovered;
}

/**
 * Check if a card has dangerous effects (for determining target priority)
 */
function hasDangerousEffects(card: PlayedCard): boolean {
    const keywords = card.keywords;
    return keywords['delete'] || keywords['return'] || keywords['discard'] ||
           card.top.length > 0 || card.bottom.includes('Start:') || card.bottom.includes('End:');
}

// =============================================================================
// EFFECT EVALUATORS
// =============================================================================

/**
 * Evaluate FLIP effect
 *
 * Flipping face-up to face-down: Good if high value (reduces enemy value)
 * Flipping face-down to face-up: Good for own cards (reveals value)
 *
 * CRITICAL: Flipping a 0-value card face-down INCREASES its value to 2!
 * This is BAD when flipping enemy cards!
 */
export function evaluateFlipTargets(
    state: GameState,
    analysis: GameAnalysis,
    targetFilter?: { owner?: 'own' | 'opponent' | 'any'; faceState?: 'face_up' | 'face_down' | 'any' },
    sourceCardId?: string
): TargetScore[] {
    const scored: TargetScore[] = [];
    const filter = targetFilter || {};

    for (const playerKey of ['player', 'opponent'] as const) {
        // Apply owner filter (from AI perspective: 'own' = opponent, 'opponent' = player)
        if (filter.owner === 'own' && playerKey !== 'opponent') continue;
        if (filter.owner === 'opponent' && playerKey !== 'player') continue;

        const uncovered = getUncoveredCards(state, playerKey);

        for (const card of uncovered) {
            if (sourceCardId && card.id === sourceCardId) continue;

            // Apply face state filter
            if (filter.faceState === 'face_up' && !card.isFaceUp) continue;
            if (filter.faceState === 'face_down' && card.isFaceUp) continue;

            const laneIndex = getLaneIndex(state, card.id);
            let score = 0;
            let reasoning = '';

            // Enemy card (player's)
            if (playerKey === 'player') {
                if (card.isFaceUp) {
                    // Flip face-up to face-down
                    // Value change: card.value -> 2
                    // Positive delta = good for us (enemy loses value)
                    const valueDelta = card.value - 2;
                    score = valueDelta * 25;  // 6->100, 4->50, 2->0, 0->-50

                    if (valueDelta > 0) {
                        reasoning = `Flip ${card.protocol}-${card.value}: Enemy loses ${valueDelta} value`;
                    } else if (valueDelta < 0) {
                        reasoning = `BAD: Flip ${card.protocol}-${card.value}: Enemy GAINS ${-valueDelta} value!`;
                    } else {
                        reasoning = `Neutral: Flip ${card.protocol}-${card.value}: No value change`;
                    }

                    // BONUS: Lane is near compile - disrupting is valuable
                    const lane = analysis.lanes[laneIndex];
                    if (lane && lane.playerValue >= 8) {
                        score += 40;
                        reasoning += ' [Near compile!]';
                    }

                    // BONUS: Card has dangerous effects
                    if (hasDangerousEffects(card)) {
                        score += 30;
                        reasoning += ' [Has dangerous effects]';
                    }
                } else {
                    // Flip face-down to face-up - reveals enemy card
                    // NEW: Check if we KNOW the value from memory!
                    const knownValue = getKnownValue(state, card.id);

                    if (knownValue !== null) {
                        // We know this card! Calculate actual impact
                        const valueDelta = knownValue - 2; // They gain (value - 2)
                        if (valueDelta > 0) {
                            // BAD: Enemy would GAIN value
                            score = -valueDelta * 20;
                            reasoning = `BAD: KNOWN card ${card.protocol}-${knownValue}: Enemy gains ${valueDelta}!`;
                        } else if (valueDelta < 0) {
                            // GOOD: Enemy would LOSE value
                            score = -valueDelta * 20;
                            reasoning = `GOOD: KNOWN card ${card.protocol}-${knownValue}: Enemy loses ${-valueDelta}`;
                        } else {
                            score = 10;
                            reasoning = `Neutral: KNOWN card ${card.protocol}-${knownValue}: No change`;
                        }
                    } else {
                        // Unknown card - slight info gain, risky
                        score = 5;
                        reasoning = `Reveal UNKNOWN enemy card (risky - might help them)`;
                    }
                }
            }
            // Our card (opponent's)
            else {
                if (!card.isFaceUp) {
                    // Flip our face-down to face-up
                    // NEW: AI always knows its own cards from memory!
                    const knownValue = getKnownValue(state, card.id);
                    const realValue = knownValue !== null ? knownValue : card.value;
                    const valueGain = realValue - 2;

                    if (valueGain > 0) {
                        score = valueGain * 25 + 20;
                        reasoning = `Flip own card: Gain ${valueGain} value (${realValue} - 2)`;
                    } else if (valueGain < 0) {
                        score = valueGain * 20;
                        reasoning = `BAD: Flip own card: LOSE ${-valueGain} value`;
                    } else {
                        score = 5;
                        reasoning = `Neutral: Flip own card: No value change`;
                    }

                    // If lane is near compile, this could be valuable!
                    const lane = analysis.lanes[laneIndex];
                    if (lane && !lane.isCompiled) {
                        const newLaneValue = lane.ourValue - 2 + realValue;
                        if (newLaneValue >= 10 && newLaneValue > lane.playerValue) {
                            score += 150;
                            reasoning += ' [ENABLES COMPILE!]';
                        } else if (lane.ourDistanceToCompile <= 4) {
                            score += 30;
                            reasoning += ' [Near compile]';
                        }
                    }
                } else {
                    // Flip own face-up to face-down - VERY BAD
                    const valueLost = card.value - 2;
                    score = -valueLost * 30;  // Heavy penalty
                    reasoning = `BAD: Flip own ${card.protocol}-${card.value}: We lose ${valueLost} value`;
                }
            }

            scored.push({
                targetId: card.id,
                targetOwner: playerKey,
                laneIndex,
                score,
                reasoning,
            });
        }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Evaluate DELETE effect
 *
 * Deleting enemy cards is almost always good
 * Deleting own cards is almost always bad
 */
export function evaluateDeleteTargets(
    state: GameState,
    analysis: GameAnalysis,
    targetFilter?: { owner?: 'own' | 'opponent' | 'any'; faceState?: 'face_up' | 'face_down' },
    sourceCardId?: string
): TargetScore[] {
    const scored: TargetScore[] = [];
    const filter = targetFilter || {};

    for (const playerKey of ['player', 'opponent'] as const) {
        // Apply owner filter
        if (filter.owner === 'own' && playerKey !== 'opponent') continue;
        if (filter.owner === 'opponent' && playerKey !== 'player') continue;

        const uncovered = getUncoveredCards(state, playerKey);

        for (const card of uncovered) {
            if (sourceCardId && card.id === sourceCardId) continue;

            // Apply face state filter
            if (filter.faceState === 'face_up' && !card.isFaceUp) continue;
            if (filter.faceState === 'face_down' && card.isFaceUp) continue;

            const laneIndex = getLaneIndex(state, card.id);
            const cardValue = card.isFaceUp ? card.value : 2;
            let score = 0;
            let reasoning = '';

            // Enemy card (player's)
            if (playerKey === 'player') {
                // Base score = value removed
                score = cardValue * 25;
                reasoning = `Delete ${card.isFaceUp ? card.protocol + '-' + card.value : 'face-down'}: Remove ${cardValue} value`;

                // BONUS: Lane is threatening compile
                const lane = analysis.lanes[laneIndex];
                if (lane) {
                    if (lane.playerValue >= 10 && lane.playerValue > lane.ourValue) {
                        score += 100;
                        reasoning += ' [BLOCKS COMPILE!]';
                    } else if (lane.playerValue >= 8) {
                        score += 50;
                        reasoning += ' [Near compile]';
                    }
                }

                // BONUS: Card has dangerous effects
                if (card.isFaceUp && hasDangerousEffects(card)) {
                    score += 40;
                    reasoning += ' [Has dangerous effects]';
                }
            }
            // Our card (opponent's) - BAD
            else {
                score = -cardValue * 30;  // Heavy penalty
                reasoning = `BAD: Delete own ${card.isFaceUp ? card.protocol + '-' + card.value : 'face-down'}: Lose ${cardValue} value`;

                // Slight reduction if lane is already compiled
                const lane = analysis.lanes[laneIndex];
                if (lane && lane.isCompiled) {
                    score += 50;  // Less bad
                    reasoning += ' [Lane already compiled]';
                }
            }

            scored.push({
                targetId: card.id,
                targetOwner: playerKey,
                laneIndex,
                score,
                reasoning,
            });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Evaluate RETURN effect
 *
 * Similar to delete but card goes to hand
 * Slightly less valuable than delete (card can be replayed)
 */
export function evaluateReturnTargets(
    state: GameState,
    analysis: GameAnalysis,
    targetFilter?: { owner?: 'own' | 'opponent' | 'any' },
    sourceCardId?: string
): TargetScore[] {
    const scored: TargetScore[] = [];
    const filter = targetFilter || {};

    for (const playerKey of ['player', 'opponent'] as const) {
        if (filter.owner === 'own' && playerKey !== 'opponent') continue;
        if (filter.owner === 'opponent' && playerKey !== 'player') continue;

        const uncovered = getUncoveredCards(state, playerKey);

        for (const card of uncovered) {
            if (sourceCardId && card.id === sourceCardId) continue;

            const laneIndex = getLaneIndex(state, card.id);
            const cardValue = card.isFaceUp ? card.value : 2;
            let score = 0;
            let reasoning = '';

            // Enemy card (player's)
            if (playerKey === 'player') {
                // Base score = 80% of delete (card can be replayed)
                score = cardValue * 20;
                reasoning = `Return ${card.isFaceUp ? card.protocol + '-' + card.value : 'face-down'}: Remove ${cardValue} value (to hand)`;

                // BONUS: Lane is threatening
                const lane = analysis.lanes[laneIndex];
                if (lane) {
                    if (lane.playerValue >= 10 && lane.playerValue > lane.ourValue) {
                        score += 80;
                        reasoning += ' [BLOCKS COMPILE!]';
                    } else if (lane.playerValue >= 8) {
                        score += 40;
                        reasoning += ' [Near compile]';
                    }
                }

                // BONUS: Tempo - enemy must spend another turn to replay
                score += 15;
                reasoning += ' [Tempo gain]';
            }
            // Our card
            else {
                // Returning own card is bad but less bad than delete
                score = -cardValue * 20;
                reasoning = `Return own ${card.isFaceUp ? card.protocol + '-' + card.value : 'face-down'}: Lose ${cardValue} value (recoverable)`;
            }

            scored.push({
                targetId: card.id,
                targetOwner: playerKey,
                laneIndex,
                score,
                reasoning,
            });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Evaluate SHIFT effect
 *
 * Moving enemy cards from strong to weak lanes is good
 * Moving own cards to lanes near compile is good
 */
export function evaluateShiftTargets(
    state: GameState,
    analysis: GameAnalysis,
    targetFilter?: { owner?: 'own' | 'opponent' | 'any' },
    sourceCardId?: string,
    sourceLaneIndex?: number
): TargetScore[] {
    const scored: TargetScore[] = [];
    const filter = targetFilter || {};

    for (const playerKey of ['player', 'opponent'] as const) {
        if (filter.owner === 'own' && playerKey !== 'opponent') continue;
        if (filter.owner === 'opponent' && playerKey !== 'player') continue;

        const uncovered = getUncoveredCards(state, playerKey);

        for (const card of uncovered) {
            if (sourceCardId && card.id === sourceCardId) continue;

            const currentLaneIndex = getLaneIndex(state, card.id);
            if (currentLaneIndex === -1) continue;

            const cardValue = card.isFaceUp ? card.value : 2;

            // Evaluate best destination lane
            let bestScore = -Infinity;
            let bestReasoning = '';

            for (let destLane = 0; destLane < 3; destLane++) {
                if (destLane === currentLaneIndex) continue;

                let score = 0;
                let reasoning = '';

                // Enemy card
                if (playerKey === 'player') {
                    const sourceLane = analysis.lanes[currentLaneIndex];
                    const destLaneInfo = analysis.lanes[destLane];

                    // Moving FROM strong lane = good
                    score += sourceLane.playerValue * 2;
                    reasoning = `Shift from lane ${currentLaneIndex} (${sourceLane.playerValue})`;

                    // Moving TO weak/compiled lane = good (wasted value)
                    if (destLaneInfo.playerLaneCompiled) {
                        score += 30;
                        reasoning += ` to compiled lane ${destLane}`;
                    } else {
                        score += (10 - destLaneInfo.playerValue);
                        reasoning += ` to lane ${destLane} (${destLaneInfo.playerValue})`;
                    }

                    // BONUS: Disrupting a compile threat
                    if (sourceLane.playerValue >= 10 && sourceLane.playerValue > sourceLane.ourValue) {
                        score += 60;
                        reasoning += ' [DISRUPTS COMPILE!]';
                    }
                }
                // Our card
                else {
                    const destLaneInfo = analysis.lanes[destLane];

                    // Moving to lane that's near compile = good
                    if (!destLaneInfo.isCompiled) {
                        const newValue = destLaneInfo.ourValue + cardValue;
                        if (newValue >= 10 && newValue > destLaneInfo.playerValue) {
                            score += 100;
                            reasoning = `Shift to lane ${destLane}: ENABLES COMPILE (${newValue})`;
                        } else {
                            score += destLaneInfo.ourValue;
                            reasoning = `Shift to lane ${destLane}: Build value (${destLaneInfo.ourValue} + ${cardValue})`;
                        }
                    } else {
                        score -= 50;  // Moving to compiled lane is bad
                        reasoning = `BAD: Shift to compiled lane ${destLane}`;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestReasoning = reasoning;
                }
            }

            if (bestScore > -Infinity) {
                scored.push({
                    targetId: card.id,
                    targetOwner: playerKey,
                    laneIndex: currentLaneIndex,
                    score: bestScore,
                    reasoning: bestReasoning,
                });
            }
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Evaluate DRAW effect value
 */
export function evaluateDrawValue(state: GameState, drawCount: number): { score: number; reasoning: string } {
    const currentHandSize = state.opponent.hand.length;
    const handSizeAfterDraw = currentHandSize - 1 + drawCount; // -1 for card we're playing

    if (handSizeAfterDraw > 5) {
        // Will cause discard - not ideal
        const discardCount = handSizeAfterDraw - 5;
        return {
            score: drawCount * 10 - discardCount * 15,
            reasoning: `Draw ${drawCount} but must discard ${discardCount}`,
        };
    }

    if (currentHandSize <= 2) {
        // Low hand - draw is very valuable
        return {
            score: drawCount * 20,
            reasoning: `Draw ${drawCount}: Low hand, very valuable`,
        };
    }

    return {
        score: drawCount * 12,
        reasoning: `Draw ${drawCount}`,
    };
}

/**
 * Evaluate DISCARD effect value
 * Opponent discarding is good, us discarding is bad
 */
export function evaluateDiscardValue(
    state: GameState,
    actor: 'self' | 'opponent',
    count: number
): { score: number; reasoning: string } {
    if (actor === 'opponent') {
        // Enemy discards - good for us
        const playerHandSize = state.player.hand.length;
        if (playerHandSize <= count) {
            return {
                score: playerHandSize * 15,
                reasoning: `Force enemy to discard ${playerHandSize} (all they have)`,
            };
        }
        return {
            score: count * 15,
            reasoning: `Force enemy to discard ${count}`,
        };
    } else {
        // We discard - generally bad
        return {
            score: -count * 10,
            reasoning: `Must discard ${count}`,
        };
    }
}

// =============================================================================
// MAIN EVALUATOR
// =============================================================================

/**
 * Evaluate a card's middle effect and return contextual value
 */
export function evaluateCardEffect(
    state: GameState,
    card: PlayedCard,
    analysis: GameAnalysis
): EffectEvaluation {
    let totalScore = 0;
    const allTargets: TargetScore[] = [];
    let hasValidTargets = true;

    // Check keywords and evaluate each effect
    if (card.keywords['flip']) {
        const flipTargets = evaluateFlipTargets(state, analysis, undefined, card.id);
        if (flipTargets.length > 0) {
            allTargets.push(...flipTargets.slice(0, 3));
            totalScore += flipTargets[0].score * 0.8; // Assume we get best target
        } else {
            hasValidTargets = false;
        }
    }

    if (card.keywords['delete']) {
        const deleteTargets = evaluateDeleteTargets(state, analysis, undefined, card.id);
        if (deleteTargets.length > 0) {
            allTargets.push(...deleteTargets.slice(0, 3));
            totalScore += deleteTargets[0].score * 0.8;
        } else {
            hasValidTargets = false;
        }
    }

    if (card.keywords['return']) {
        const returnTargets = evaluateReturnTargets(state, analysis, undefined, card.id);
        if (returnTargets.length > 0) {
            allTargets.push(...returnTargets.slice(0, 3));
            totalScore += returnTargets[0].score * 0.8;
        } else {
            hasValidTargets = false;
        }
    }

    if (card.keywords['shift']) {
        const shiftTargets = evaluateShiftTargets(state, analysis, undefined, card.id);
        if (shiftTargets.length > 0) {
            allTargets.push(...shiftTargets.slice(0, 3));
            totalScore += shiftTargets[0].score * 0.8;
        } else {
            hasValidTargets = false;
        }
    }

    if (card.keywords['draw']) {
        const drawEval = evaluateDrawValue(state, 2); // Assume draw 2
        totalScore += drawEval.score;
    }

    // Normalize to -100 to +100 range
    const contextualValue = Math.max(-100, Math.min(100, totalScore / 2));

    return {
        effectType: Object.keys(card.keywords).filter(k => card.keywords[k]).join(', '),
        bestTargets: allTargets,
        contextualValue,
        hasValidTargets,
    };
}

// =============================================================================
// CONTEXTUAL EFFECT EVALUATION - For getBestMove() scoring
// =============================================================================

/**
 * Evaluate a single effect from customEffects in context
 * Returns a score bonus/penalty based on:
 * - Available targets
 * - Strategic value (compile blocking, etc.)
 * - Potential downsides (must target own cards)
 */
function evaluateSingleEffectInContext(
    effect: any,
    state: GameState,
    laneIndex: number,
    sourceCard: PlayedCard,
    analysis: GameAnalysis
): number {
    const action = effect.params?.action;
    const targetFilter = effect.params?.targetFilter;
    const targetOwner = targetFilter?.owner || 'any';

    // Get available targets
    const opponentCards = getUncoveredCards(state, 'player'); // Player = opponent from AI view
    const ownCards = getUncoveredCards(state, 'opponent');   // Opponent = us (AI)

    switch (action) {
        case 'flip':
            return evaluateFlipEffectInContext(targetOwner, opponentCards, ownCards, state, analysis);

        case 'delete':
            return evaluateDeleteEffectInContext(targetOwner, opponentCards, ownCards, state, analysis);

        case 'draw':
            return evaluateDrawEffectInContext(effect.params?.count || 1, state);

        case 'shift':
            return evaluateShiftEffectInContext(targetOwner, opponentCards, ownCards, state, analysis);

        case 'return':
            return evaluateReturnEffectInContext(targetOwner, opponentCards, ownCards, state, analysis);

        case 'discard':
            // Opponent discard is good, self discard is bad
            if (effect.params?.actor === 'opponent') {
                return (effect.params?.count || 1) * 15;
            }
            return -(effect.params?.count || 1) * 10;

        case 'value_modifier':
            // Passive value modifiers are generally good
            return 10;

        default:
            return 0;
    }
}

/**
 * FLIP effect context evaluation
 * Human thinking: "Can I flip a high-value opponent card? Or do I have to flip my own?"
 */
function evaluateFlipEffectInContext(
    targetOwner: string,
    opponentCards: PlayedCard[],
    ownCards: PlayedCard[],
    state: GameState,
    analysis: GameAnalysis
): number {
    // Target opponent cards only
    if (targetOwner === 'opponent') {
        if (opponentCards.length === 0) return 0; // No targets = useless

        // Find best flip target (highest face-up value)
        const faceUpOpponentCards = opponentCards.filter(c => c.isFaceUp);
        if (faceUpOpponentCards.length > 0) {
            const bestTarget = faceUpOpponentCards.sort((a, b) => b.value - a.value)[0];
            // Flipping value X to face-down (2) = they lose (X - 2)
            const valueReduction = bestTarget.value - 2;
            return valueReduction * 12; // 5 -> +36, 3 -> +12, 0 -> -24
        }
        // Only face-down targets - revealing them is risky
        return 5;
    }

    // Target own cards only - this is usually BAD
    if (targetOwner === 'own') {
        if (ownCards.length === 0) return 0; // No targets = useless

        // Check if we have 0-1 value cards (flipping 0 to 2 is a GAIN!)
        const lowValueCards = ownCards.filter(c => c.isFaceUp && c.value <= 1);
        if (lowValueCards.length > 0) {
            return 15; // Can flip 0/1 to gain value
        }
        // Must flip valuable own cards - bad!
        return -25;
    }

    // Target ANY card - check if good opponent targets exist
    if (opponentCards.length > 0) {
        const faceUpOpponentCards = opponentCards.filter(c => c.isFaceUp && c.value >= 3);
        if (faceUpOpponentCards.length > 0) {
            // Good targets exist!
            const bestValue = Math.max(...faceUpOpponentCards.map(c => c.value));
            return (bestValue - 2) * 10; // Value reduction * 10
        }
        // Opponent has cards but they're low value
        return 5;
    }

    // No opponent cards - must flip own
    if (ownCards.length > 0) {
        // Check for 0-value cards that BENEFIT from flip
        const zeroValueCards = ownCards.filter(c => c.isFaceUp && c.value === 0);
        if (zeroValueCards.length > 0) {
            return 10; // 0 -> 2 is a gain!
        }
        // Must flip valuable own card - BAD
        return -30;
    }

    // No cards at all
    return 0;
}

/**
 * DELETE effect context evaluation
 * Human thinking: "Deleting opponent cards is ALWAYS good! Check what's underneath."
 * User feedback: Delete is ALWAYS super valuable, they only check what's underneath
 */
function evaluateDeleteEffectInContext(
    targetOwner: string,
    opponentCards: PlayedCard[],
    ownCards: PlayedCard[],
    state: GameState,
    analysis: GameAnalysis
): number {
    // Target opponent cards - ALWAYS GOOD per user feedback!
    if (targetOwner === 'opponent') {
        if (opponentCards.length === 0) return 0; // No targets = can't use

        // Base value: deleting is ALWAYS good
        let score = 40;

        // BONUS: Can prevent opponent compile?
        for (let i = 0; i < 3; i++) {
            if (state.player.laneValues[i] >= 10 && !state.player.compiled[i]) {
                // Opponent could compile! Delete is SUPER valuable
                const cardsInLane = state.player.lanes[i].filter(c =>
                    opponentCards.some(oc => oc.id === c.id)
                );
                if (cardsInLane.length > 0) {
                    score = 80; // Compile blocking is huge
                }
            } else if (state.player.laneValues[i] >= 8) {
                // Near compile - delete is very valuable
                score = Math.max(score, 60);
            }
        }

        return score;
    }

    // Target own cards - ALWAYS BAD
    if (targetOwner === 'own') {
        if (ownCards.length === 0) return 0; // No targets = can't use

        // Find lowest value target (minimize loss)
        const lowestValue = Math.min(...ownCards.map(c => c.isFaceUp ? c.value : 2));
        return -lowestValue * 8 - 20; // -20 base penalty + value loss
    }

    // Target ANY card - check if opponent targets exist
    if (opponentCards.length > 0) {
        // Has opponent targets - this is still good!
        let score = 35;

        // Check compile threat
        for (let i = 0; i < 3; i++) {
            if (state.player.laneValues[i] >= 8) {
                score = Math.max(score, 50);
            }
        }

        return score;
    }

    // No opponent cards - MUST delete own card - VERY BAD
    if (ownCards.length > 0) {
        const lowestValue = Math.min(...ownCards.map(c => c.isFaceUp ? c.value : 2));
        return -lowestValue * 10 - 40; // Heavy penalty
    }

    return 0;
}

/**
 * DRAW effect context evaluation
 * Drawing is almost always good, but check hand size
 */
function evaluateDrawEffectInContext(count: number, state: GameState): number {
    const currentHandSize = state.opponent.hand.length;
    const handAfterPlay = currentHandSize - 1; // After playing this card
    const handAfterDraw = handAfterPlay + count;

    if (handAfterDraw > 5) {
        // Will cause discard - still OK but less value
        const discardCount = handAfterDraw - 5;
        return count * 10 - discardCount * 8;
    }

    // Low hand = draw very valuable
    if (handAfterPlay <= 2) {
        return count * 20;
    }

    // Normal draw value
    return count * 12;
}

/**
 * SHIFT effect context evaluation
 * Moving opponent cards is good if they have targets
 */
function evaluateShiftEffectInContext(
    targetOwner: string,
    opponentCards: PlayedCard[],
    ownCards: PlayedCard[],
    state: GameState,
    analysis: GameAnalysis
): number {
    // Target opponent cards
    if (targetOwner === 'opponent') {
        if (opponentCards.length === 0) return 0; // No targets

        // Check if we can disrupt compile threat
        for (let i = 0; i < 3; i++) {
            if (state.player.laneValues[i] >= 8) {
                return 35; // Can disrupt near-compile
            }
        }

        return 20; // General disruption value
    }

    // Target own cards - could be useful for positioning
    if (targetOwner === 'own') {
        if (ownCards.length === 0) return 0;

        // Check if we can shift to complete a compile
        for (let i = 0; i < 3; i++) {
            if (!state.opponent.compiled[i] && state.opponent.laneValues[i] >= 6) {
                return 25; // Might enable compile
            }
        }

        return 5; // Minor repositioning value
    }

    // Target any
    if (opponentCards.length > 0) {
        return 15; // Has targets for disruption
    }

    return 0;
}

/**
 * RETURN effect context evaluation
 * Similar to delete but card goes to hand
 */
function evaluateReturnEffectInContext(
    targetOwner: string,
    opponentCards: PlayedCard[],
    ownCards: PlayedCard[],
    state: GameState,
    analysis: GameAnalysis
): number {
    // Target opponent cards
    if (targetOwner === 'opponent') {
        if (opponentCards.length === 0) return 0;

        // Check compile threat
        for (let i = 0; i < 3; i++) {
            if (state.player.laneValues[i] >= 8) {
                return 40; // Disrupt near-compile
            }
        }

        return 25; // Tempo gain - opponent must replay
    }

    // Target own cards - usually bad
    if (targetOwner === 'own') {
        if (ownCards.length === 0) return 0;
        return -20; // Lose board presence
    }

    // Target any
    if (opponentCards.length > 0) {
        return 20;
    }

    if (ownCards.length > 0) {
        return -25; // Must return own
    }

    return 0;
}

/**
 * MAIN FUNCTION: Evaluate all effects of a card in context
 *
 * This is called from getBestMove() to score a card based on its effects
 * and the current game situation, not just its raw value.
 *
 * @param card The card being evaluated
 * @param state Current game state
 * @param laneIndex The lane where the card would be played
 * @param analysis Game analysis (lane states, threats, etc.)
 * @returns Score bonus/penalty for the card's effects in this context
 */
export function evaluateEffectInContext(
    card: PlayedCard,
    state: GameState,
    laneIndex: number,
    analysis: GameAnalysis
): number {
    const customCard = card as any;
    if (!customCard.customEffects) return 0;

    let totalScore = 0;

    // Parse all effects from customEffects
    const allEffects = [
        ...(customCard.customEffects.topEffects || []),
        ...(customCard.customEffects.middleEffects || []),
        ...(customCard.customEffects.bottomEffects || [])
    ];

    // Only evaluate 'start' and 'instant' triggers (not 'on_cover', 'passive', etc.)
    // Those trigger immediately when played
    const relevantTriggers = ['start', 'instant', 'on_play', undefined];

    for (const effect of allEffects) {
        const trigger = effect.trigger;

        // Skip effects that don't trigger on play
        if (trigger && !relevantTriggers.includes(trigger)) continue;

        // Evaluate this effect
        const effectScore = evaluateSingleEffectInContext(effect, state, laneIndex, card, analysis);
        totalScore += effectScore;
    }

    return totalScore;
}

/**
 * Get the best target for a specific effect type
 */
export function getBestTarget(
    state: GameState,
    analysis: GameAnalysis,
    effectType: 'flip' | 'delete' | 'return' | 'shift',
    targetFilter?: { owner?: 'own' | 'opponent' | 'any'; faceState?: 'face_up' | 'face_down' },
    sourceCardId?: string
): TargetScore | null {
    let targets: TargetScore[];

    switch (effectType) {
        case 'flip':
            targets = evaluateFlipTargets(state, analysis, targetFilter, sourceCardId);
            break;
        case 'delete':
            targets = evaluateDeleteTargets(state, analysis, targetFilter, sourceCardId);
            break;
        case 'return':
            targets = evaluateReturnTargets(state, analysis, targetFilter, sourceCardId);
            break;
        case 'shift':
            targets = evaluateShiftTargets(state, analysis, targetFilter, sourceCardId);
            break;
    }

    return targets.length > 0 ? targets[0] : null;
}
