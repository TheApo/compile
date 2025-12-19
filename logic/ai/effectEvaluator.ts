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
