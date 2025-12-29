/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NORMAL AI - Strategic AI that plays to win
 *
 * NEW ARCHITECTURE:
 * - Uses GameStateAnalyzer to understand the current situation
 * - Uses EffectEvaluator to score card effects contextually
 * - Uses Strategies to make decisions based on game phase
 * - 5% chance to make suboptimal moves for slight unpredictability
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player, TargetFilter } from '../../types';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard, isCardCommitted, isCardAtIndexUncovered, countUniqueProtocolsOnField } from '../game/helpers/actionUtils';
import { handleControlRearrange, canBenefitFromPlayerRearrange, canBenefitFromOwnRearrange } from './controlMechanicLogic';
import { isFrost1Active } from '../game/passiveRuleChecker';
import {
    canPlayCard,
    hasAnyProtocolPlayRule,
    hasRequireNonMatchingProtocolRule,
    canPlayFaceUpDueToSameProtocolRule,
    hasPlayOnOpponentSideRule
} from '../game/passiveRuleChecker';
import {
    hasRequireFaceDownPlayRule,
    hasDeleteSelfOnCoverEffect,
    hasReturnOwnCardEffect,
    hasDeleteHighestOwnCardEffect,
    hasShiftToFromLaneEffect,
    hasShiftToNonMatchingProtocolEffect,
    getLaneFaceDownValueBoost,
    getTopCardDeleteSelfValue,
    hasFlipOwnCardEffect,
    hasDeleteOwnCardInStackEffect
} from './aiEffectUtils';

// NEW: Strategic modules
import { analyzeGameState, GameAnalysis, describeStrategy, getLaneRecommendations } from './analyzer';
import { evaluateCardEffect, evaluateFlipTargets, evaluateDeleteTargets, evaluateReturnTargets, evaluateShiftTargets, getBestTarget, evaluateEffectInContext } from './effectEvaluator';
import { calculateMoveScore, getMoveReasoning, shouldPlayFaceUp, shouldRefresh, MoveScore } from './strategies';
import { cleanupMemory } from './cardMemory';

type ScoredMove = {
    move: AIAction;
    score: number;
    reason: string;
};

const DISRUPTION_KEYWORDS = ['delete', 'flip', 'shift', 'return', 'discard'];

// Helper: Get card power (for hand evaluation)
const getCardPower = (card: PlayedCard): number => {
    let power = 12 - card.value; // Lower cost = higher priority
    if (DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) power += 6;
    if (card.keywords['draw']) power += 3;
    if (card.keywords['play']) power += 8;
    if (card.keywords['prevent']) power += 4;
    return power;
};

// Helper: Estimate threat of a card on board (no memory, just current state)
const getCardThreat = (card: PlayedCard, owner: Player, state: GameState): number => {
    let lane: PlayedCard[] | undefined;
    for (const l of state[owner].lanes) {
        if (l.some(c => c.id === card.id)) {
            lane = l;
            break;
        }
    }
    if (!lane) return 0;

    if (!card.isFaceUp) {
        // No memory - just estimate based on lane
        const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
        return hasDarkness2 ? 4 : 2;
    }

    let threat = card.value * 2.5;
    if (card.top.length > 0) threat += 6;
    if (card.bottom.includes("Start:") || card.bottom.includes("End:")) threat += 8;
    if (card.bottom.includes("covered:")) threat += 5;
    if (DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) threat += 4;
    return threat;
};

// Helper: Sometimes make suboptimal decisions (5% chance - reduced from 20% for smarter play)
const shouldMakeMistake = (): boolean => Math.random() < 0.05;

// Helper: Add some randomness to scores for human-like play
const addNoise = (score: number): number => {
    return score + (Math.random() * 4 - 2); // ±2 noise (reduced from ±5)
};

// TargetFilter is imported from '../../types'

// Helper: Check if a card matches ALL targetFilter criteria
// This is the SINGLE source of truth for filter matching in normal AI
const matchesTargetFilter = (
    card: PlayedCard,
    isTopCard: boolean,
    targetFilter: TargetFilter,
    sourceCardId?: string
): boolean => {
    // Position filter - DEFAULT IS UNCOVERED if not specified!
    // This is a game rule: effects target uncovered cards unless explicitly stated otherwise
    const position = targetFilter.position || 'uncovered';
    if (position === 'uncovered' && !isTopCard) return false;
    if (position === 'covered' && isTopCard) return false;

    // Face state filter
    if (targetFilter.faceState === 'face_up' && !card.isFaceUp) return false;
    if (targetFilter.faceState === 'face_down' && card.isFaceUp) return false;

    // Exclude self
    if (targetFilter.excludeSelf && sourceCardId && card.id === sourceCardId) return false;

    // Value range filter (Death-4: only value 0 or 1)
    if (targetFilter.valueRange) {
        // For face-down cards, we can't know the value - skip them if filter requires specific values
        if (!card.isFaceUp) return false;
        if (card.value < targetFilter.valueRange.min || card.value > targetFilter.valueRange.max) return false;
    }

    // Value equals filter (e.g., return all cards with value X)
    if (targetFilter.valueEquals !== undefined) {
        if (!card.isFaceUp) return false;
        if (card.value !== targetFilter.valueEquals) return false;
    }

    return true;
};

const getBestMove = (state: GameState): AIAction => {
    // Clean up memory for deleted/returned cards before making decisions
    state = cleanupMemory(state);

    const possibleMoves: ScoredMove[] = [];

    // =========================================================================
    // NEW: Strategic Analysis - Understand the game state before making decisions
    // =========================================================================
    const analysis = analyzeGameState(state);
    const { gamePhase, threats, position, lanes, recommendedStrategy, urgency } = analysis;

    // Use generic passive rule check for "require face down play" rules (like Psychic-1)
    const playerHasRequireFaceDownRule = hasRequireFaceDownPlayRule(state, 'opponent');

    // Legacy variables (kept for backward compatibility with existing code)
    const totalCardsOnBoard = state.player.lanes.flat().length + state.opponent.lanes.flat().length;
    const isEarlyGame = gamePhase === 'early';
    const isMidGame = gamePhase === 'mid';

    // Count cards on opponent's (player's) board for disruption targeting
    const playerCardsOnBoard = state.player.lanes.flat().length;
    const opponentHasTargets = playerCardsOnBoard > 0;

    // =========================================================================
    // Use analysis for strategic decisions
    // =========================================================================
    const playerCompiledCount = threats.playerCompiledCount;
    const weHaveControl = position.weHaveControl;
    const playerHasControl = threats.playerHasControl;
    const lanesWeAreLead = position.lanesWeLeadIn;
    const lanesPlayerLeads = 3 - lanesWeAreLead - lanes.filter(l => l.isTied && !l.isCompiled).length;

    // Control hunting uses analyzer's strategy recommendation
    const controlMechanicEnabled = state.useControlMechanic === true;
    const controlHuntingMode = recommendedStrategy === 'control' && controlMechanicEnabled;
    const controlDefenseMode = weHaveControl && playerCompiledCount >= 1;

    // Check if player is threatening to win
    const playerThreateningWin = threats.playerCanCompile;
    const playerThreateningLaneIndex = threats.playerCompileLanes[0] ?? -1;

    // =========================================================================
    // LANE FOCUS: Use analyzer's lane recommendations
    // =========================================================================
    const ourCompiledCount = position.ourCompiledCount;

    // =========================================================================
    // CRITICAL ENDGAME: When OPPONENT has 2 compiles - CONTROL IS EVERYTHING!
    // Next compile wins the game, so whoever has control wins.
    // This applies whether we have 0, 1, or 2 compiles - opponent at 2 = critical!
    // =========================================================================
    const opponentNearWin = playerCompiledCount === 2;
    const criticalEndgameControlMode = opponentNearWin && controlMechanicEnabled;

    // If opponent has 2 compiles and we don't have control, we MUST get control!
    // Otherwise opponent wins on their next compile
    const mustHuntControl = criticalEndgameControlMode && !weHaveControl;

    // If we have control and opponent has 2, we're in good shape
    // But we still need to be careful not to lose control
    const weAreWinning = criticalEndgameControlMode && weHaveControl;

    // Override controlHuntingMode when opponent is near win
    const effectiveControlHuntingMode = controlHuntingMode || mustHuntControl;

    // Get lane recommendations from analyzer - sorted by strategic priority
    const laneRecommendations = getLaneRecommendations(analysis);
    const focusLaneIndex = laneRecommendations.length > 0 ? laneRecommendations[0].laneIndex : -1;

    // Helper: Check if a card's effect has valid targets
    const effectHasValidTargets = (card: PlayedCard, laneIndex: number): boolean => {
        // Cards with "flip other" or "delete other" need targets
        const needsOtherTargets = card.keywords['flip'] || card.keywords['delete'] || card.keywords['shift'] || card.keywords['return'];
        if (!needsOtherTargets) return true;

        // Check if there are any other cards on board
        const otherCardsExist = state.player.lanes.flat().length > 0 ||
            state.opponent.lanes.some((lane, idx) => idx !== laneIndex && lane.length > 0) ||
            (state.opponent.lanes[laneIndex].length > 0); // Cards already in this lane

        return otherCardsExist;
    };

    // Helper: Check if draw effect would cause discard
    const drawWouldCauseDiscard = (card: PlayedCard): boolean => {
        if (!card.keywords['draw']) return false;
        // After playing this card, hand will have (current - 1) cards
        // If draw 2, we'd have (current - 1 + 2) = current + 1 cards
        // Max hand size is 5, so if current >= 5, we'd have to discard
        return state.opponent.hand.length >= 5;
    };

    // Evaluate all possible card plays
    for (const card of state.opponent.hand) {
        for (let i = 0; i < 3; i++) {
            // Use generic canPlayCard check which handles all passive rules
            const playCheckFaceUp = canPlayCard(state, 'opponent', i, true, card.protocol);
            const playCheckFaceDown = canPlayCard(state, 'opponent', i, false, card.protocol);

            // Skip if neither face-up nor face-down play is allowed
            if (!playCheckFaceUp.allowed && !playCheckFaceDown.allowed) continue;
            if (state.opponent.compiled[i]) continue; // Don't play in compiled lanes

            // CRITICAL: Check if player can compile this lane and we can't block
            // If player has 10+ and we can't overtake them, DON'T play here (waste of card)
            const playerCanCompileHere = state.player.laneValues[i] >= 10 &&
                state.player.laneValues[i] > state.opponent.laneValues[i] &&
                !state.player.compiled[i];

            if (playerCanCompileHere) {
                // Can ANY of our plays block them? (equal value also blocks - neither can compile!)
                const maxValueWeCanAdd = Math.max(
                    playCheckFaceUp.allowed ? card.value : 0,
                    playCheckFaceDown.allowed ? getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]) : 0
                );

                const ourPotentialValue = state.opponent.laneValues[i] + maxValueWeCanAdd;
                if (ourPotentialValue < state.player.laneValues[i]) {
                    // We can't block (can't even reach equal) - SKIP this lane entirely for this card
                    // (unless we want to try disruption effects, which we evaluate later)
                    if (!DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) {
                        continue;
                    }
                }
            }

            // GENERIC: Check if card has "return own card" effect (like Water-4, Fire-2)
            // Only play face-up if we have OTHER uncovered cards to return.
            // Face-down is still OK (effect won't trigger).
            let blockFaceUpDueToReturn = false;
            if (hasReturnOwnCardEffect(card as PlayedCard)) {
                // Count all OTHER uncovered cards (excluding the card we're about to play)
                let otherUncoveredCardCount = 0;
                for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                    const lane = state.opponent.lanes[laneIdx];
                    if (lane.length > 0) {
                        // If this is the target lane, there will be 1 card after we play (ourselves)
                        // We can't count that as a valid return target
                        if (laneIdx === i) {
                            // Only count existing cards in the lane (not the card we're playing)
                            // These would become covered after we play
                            continue;
                        }
                        // Other lanes: the top card is a valid return target
                        otherUncoveredCardCount++;
                    }
                }
                // If no other uncovered cards exist, playing face-up would force us to return itself
                if (otherUncoveredCardCount === 0) {
                    // Block face-up play, but face-down is still allowed
                    blockFaceUpDueToReturn = true;
                }
            }

            // GENERIC: Check if card has "delete self on cover" effect (like Metal-6)
            // Only play if lane already has enough value (4+) so we can reach compile (10+)
            // Because if something is played on top later, this card deletes itself
            if (hasDeleteSelfOnCoverEffect(card as PlayedCard)) {
                const currentLaneValue = state.opponent.laneValues[i];
                // Lane needs at least 4 so that card.value + 4 >= 10
                const minLaneValueNeeded = Math.max(0, 10 - card.value);
                if (currentLaneValue < minLaneValueNeeded) continue;
                // Also check we'd actually beat the player
                const valueAfterPlaying = currentLaneValue + card.value;
                const playerValue = state.player.laneValues[i];
                if (valueAfterPlaying <= playerValue) continue;
            }

            // GENERIC: Check if TOP card in lane has "delete self on cover" effect
            // If we play on top of such a card (like Metal-6), it will delete itself
            // Only do this if the lane already has good value OR we'd reach compile
            const topCardDeleteValue = getTopCardDeleteSelfValue(state, 'opponent', i);
            if (topCardDeleteValue !== null) {
                const currentLaneValue = state.opponent.laneValues[i];
                const valueAfterPlayingMinusDeleted = currentLaneValue + card.value - topCardDeleteValue;
                // Only play on top if:
                // 1. We'd still reach compile (10+) after the deletion, OR
                // 2. The lane already has enough base value (4+) that losing the card is acceptable
                const wouldStillCompile = valueAfterPlayingMinusDeleted >= 10 &&
                    valueAfterPlayingMinusDeleted > state.player.laneValues[i];
                const laneHasGoodBase = (currentLaneValue - topCardDeleteValue) >= 4;
                if (!wouldStillCompile && !laneHasGoodBase) {
                    continue; // Skip - would waste the top card's value
                }
            }

            // Use the already computed playerCanCompileHere check
            const canPlayerCompileThisLane = playerCanCompileHere;

            // GENERIC: Check if card has "delete highest own card" effect (like Hate-2)
            // Would it delete itself?
            let deleteHighestWouldSuicide = false;
            if (hasDeleteHighestOwnCardEffect(card as PlayedCard)) {
                let maxOtherValue = 0;
                for (let checkLane = 0; checkLane < 3; checkLane++) {
                    const checkLaneCards = state.opponent.lanes[checkLane];
                    if (checkLaneCards.length > 0 && checkLane !== i) {
                        const uncovered = checkLaneCards[checkLaneCards.length - 1];
                        const uncoveredValue = uncovered.isFaceUp ? uncovered.value : 2;
                        if (uncoveredValue > maxOtherValue) {
                            maxOtherValue = uncoveredValue;
                        }
                    }
                }
                if (card.value >= maxOtherValue) {
                    deleteHighestWouldSuicide = true;
                }
            }

            // FACE-UP PLAY - use generic canPlayCard result
            let canPlayFaceUp = playCheckFaceUp.allowed && !playerHasRequireFaceDownRule && !deleteHighestWouldSuicide && !blockFaceUpDueToReturn;

            if (canPlayFaceUp) {
                let score = 0;
                let reason = `Play ${card.protocol}-${card.value} face-up in lane ${i}`;
                const valueToAdd = card.value;
                const resultingValue = state.opponent.laneValues[i] + valueToAdd;

                // CRITICAL: Block player compile
                if (canPlayerCompileThisLane) {
                    if (resultingValue > state.player.laneValues[i]) {
                        score = 180 + resultingValue * 5;
                        reason += ` [Blocks compile!]`;
                    } else if (resultingValue === state.player.laneValues[i]) {
                        // Equal value = neither can compile = we blocked them!
                        score = 160 + resultingValue * 3;
                        reason += ` [Blocks compile with tie!]`;
                    } else {
                        // MASSIVE PENALTY: Card goes to TRASH immediately when player compiles!
                        // This is a complete waste of a card
                        score = -500;
                        reason += ` [WASTE: Card goes to trash when player compiles!]`;
                    }
                } else {
                    // PRIMARY GOAL: Build lane value toward compile (10+)
                    // Higher value cards are MUCH better for this
                    score += valueToAdd * 10; // Value is king!

                    // EMPTY BOARD BONUS: Strongly prefer high-value face-up on turn 1
                    // A strong opening puts immediate pressure on opponent!
                    const totalCardsOnBoard = state.player.lanes.flat().length + state.opponent.lanes.flat().length;
                    if (totalCardsOnBoard === 0 && valueToAdd >= 4) {
                        score += 50;  // Strong opening - dominate from the start!
                        reason += ` [STRONG OPENING: ${valueToAdd}]`;
                    } else if (totalCardsOnBoard <= 2 && valueToAdd >= 5) {
                        score += 30;  // Early game high-value play
                        reason += ` [Early pressure: ${valueToAdd}]`;
                    }

                    // Setup own compile - COMPLETING a compile is the highest priority
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 200; // HIGH - Actually completing a compile!
                        reason += ` [COMPILE: ${resultingValue}]`;
                    } else if (resultingValue >= 8 && resultingValue < 10 && !state.opponent.compiled[i]) {
                        // Near compile but not there yet - check if face-down could complete it
                        const faceDownValueInLane = state.opponent.lanes[i].some(
                            c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2
                        ) ? 4 : 2;
                        const couldCompileWithFaceDown = state.opponent.laneValues[i] + faceDownValueInLane >= 10;

                        if (couldCompileWithFaceDown && resultingValue < 10) {
                            // PENALTY: Playing face-up that doesn't compile when face-down COULD compile
                            score -= 50;
                            reason += ` [Near ${resultingValue} but face-down could compile!]`;
                        } else {
                            score += 40;
                            reason += ` [Near compile: ${resultingValue}]`;
                        }
                    }

                    // PENALTY: Low-value cards (0-2) in early game are BAD
                    // They waste a turn without building toward compile
                    if (isEarlyGame && valueToAdd <= 2) {
                        score -= 50;
                        reason += ` [Low value early game penalty]`;
                    }

                    // PENALTY: Utility effects without valid targets are USELESS
                    if (!effectHasValidTargets(card, i)) {
                        score -= 80;
                        reason += ` [No valid targets for effect]`;
                    }

                    // PENALTY: Draw effects that would cause discard
                    if (drawWouldCauseDiscard(card)) {
                        score -= 30;
                        reason += ` [Draw would cause discard]`;
                    }

                    // Disruption value - only valuable if opponent has targets
                    const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                    if (hasDisruption && opponentHasTargets) {
                        // Disruption is valuable mid-game when opponent has built up
                        if (isMidGame && state.player.laneValues[i] >= 5) {
                            score += 35;
                            reason += ` [Disruption with targets]`;
                        } else if (state.player.laneValues[i] >= 8) {
                            score += 50;
                            reason += ` [Disruption near compile]`;
                        }
                    } else if (hasDisruption && !opponentHasTargets) {
                        // Disruption without targets is pointless
                        score -= 40;
                        reason += ` [Disruption but no targets]`;
                    }

                    // FOCUS LANE STRATEGY: VERY strong bonus for focus lane, heavy penalty for others
                    // BUT: Disabled in control hunting mode (including critical endgame)
                    if (focusLaneIndex !== -1 && !effectiveControlHuntingMode) {
                        if (i === focusLaneIndex) {
                            score += 150; // VERY strong bonus for focus lane
                            reason += ` [FOCUS LANE]`;
                        } else {
                            score -= 100; // Heavy penalty for non-focus lanes
                            reason += ` [Not focus lane]`;
                        }
                    }

                    // =========================================================================
                    // CONTROL HUNTING: Prioritize plays that give us lane leads
                    // Control = leading in 2+ lanes. ANY lane counts!
                    // These bonuses/penalties MUST override normal scoring!
                    // CRITICAL ENDGAME: Even stronger bonuses when both have 2 compiles!
                    // =========================================================================
                    if (effectiveControlHuntingMode) {
                        const currentlyLeading = state.opponent.laneValues[i] > state.player.laneValues[i];
                        const wouldLeadAfter = resultingValue > state.player.laneValues[i];
                        const currentlyTied = state.opponent.laneValues[i] === state.player.laneValues[i];

                        // CRITICAL MULTIPLIER: When opponent has 2 compiles, control is LIFE OR DEATH
                        const criticalMultiplier = opponentNearWin ? 1.5 : 1.0;

                        // CRITICAL: If we already lead this lane, heavily penalize playing more here!
                        // We need to build in OTHER lanes to get control!
                        if (currentlyLeading) {
                            score -= 200 * criticalMultiplier; // HEAVY penalty - don't waste cards in lanes we already lead!
                            reason += opponentNearWin ? ` [CRITICAL: ALREADY LEADING - FOCUS ELSEWHERE!]` : ` [ALREADY LEADING - DON'T WASTE!]`;
                        }
                        // HUGE BONUS: This play would give us lead in a lane we don't currently lead
                        else if (!currentlyLeading && wouldLeadAfter) {
                            if (lanesWeAreLead === 1) {
                                // This would give us 2 leads = CONTROL!
                                score += 500 * criticalMultiplier; // MASSIVE bonus - this wins us control!
                                reason += opponentNearWin ? ` [CRITICAL: CONTROL CAPTURE WINS GAME!]` : ` [CONTROL CAPTURE! 1->2 leads]`;
                            } else if (lanesWeAreLead === 0) {
                                // First lead - very valuable
                                score += 300 * criticalMultiplier;
                                reason += opponentNearWin ? ` [CRITICAL: First lead toward control!]` : ` [First lead! 0->1 leads]`;
                            } else {
                                // Already have control, but more leads is still good
                                score += 100;
                                reason += ` [Extra lead]`;
                            }
                        }
                        // Bonus for breaking ties - this is often how we get control!
                        else if (currentlyTied && wouldLeadAfter) {
                            if (lanesWeAreLead === 1) {
                                score += 450 * criticalMultiplier; // Breaking tie gives us control!
                                reason += opponentNearWin ? ` [CRITICAL: BREAK TIE FOR CONTROL!]` : ` [BREAK TIE FOR CONTROL!]`;
                            } else {
                                score += 250 * criticalMultiplier;
                                reason += ` [Break tie]`;
                            }
                        }
                        // BUILD UP: If we have 1 lead but can't immediately get 2nd, BUILD in non-leading lanes
                        else if (!currentlyLeading && !wouldLeadAfter && lanesWeAreLead === 1) {
                            const gapToLead = state.player.laneValues[i] - resultingValue;
                            if (gapToLead <= 3) {
                                score += 200 * criticalMultiplier; // Close to getting lead!
                                reason += opponentNearWin ? ` [CRITICAL: BUILD toward control, gap=${gapToLead}]` : ` [BUILD toward 2nd lead, gap=${gapToLead}]`;
                            } else if (gapToLead <= 6) {
                                score += 150 * criticalMultiplier;
                                reason += ` [BUILD toward 2nd lead, gap=${gapToLead}]`;
                            } else {
                                score += 100 * criticalMultiplier;
                                reason += ` [BUILD toward 2nd lead, gap=${gapToLead}]`;
                            }
                        }
                    }
                }

                // =========================================================================
                // CONTEXTUAL EFFECT EVALUATION: Score card effects based on game state
                // Human thinking: "What does my card do? Are there good targets?"
                // =========================================================================
                const effectContextScore = evaluateEffectInContext(card as PlayedCard, state, i, analysis);
                if (effectContextScore !== 0) {
                    score += effectContextScore;
                    reason += ` [Effect: ${effectContextScore >= 0 ? '+' : ''}${effectContextScore}]`;
                }

                possibleMoves.push({
                    move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true },
                    score: addNoise(score),
                    reason
                });
            }

            // FACE-DOWN PLAY - ONLY in specific scenarios!
            // Face-down = value 2 (or 4 with Darkness-2). Face-up = full value.
            // Playing face-down wastes card value. ONLY do it when:
            // 1. Face-down completes a COMPILE (lane 8+ -> 10+)
            // 2. Face-down BLOCKS opponent compile
            // 3. Card has value 0-1 (hiding loses nothing)
            // 4. No face-up option available
            if (playCheckFaceDown.allowed) {
                const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]);
                const resultingValue = state.opponent.laneValues[i] + valueToAdd;
                const currentLaneValue = state.opponent.laneValues[i];

                // Calculate value LOST by playing face-down instead of face-up
                const valueLost = card.value - valueToAdd; // e.g., 5 - 2 = 3 lost

                // BASE: Massive penalty proportional to value lost
                let score = -200 - (valueLost * 30); // Value 5 face-down: -200 - 90 = -290
                let reason = `Play ${card.protocol}-${card.value} face-down in lane ${i} (loses ${valueLost} value)`;

                // EXCEPTION 1: Face-down COMPLETES A COMPILE - this is GOOD!
                if (!state.opponent.compiled[i] && resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                    score = 300;
                    reason = `Play ${card.protocol}-${card.value} face-down COMPILES lane ${i}: ${currentLaneValue} -> ${resultingValue}`;
                }
                // EXCEPTION 2: Face-down BLOCKS opponent compile
                else if (canPlayerCompileThisLane && resultingValue >= state.player.laneValues[i]) {
                    score = 150;
                    reason = `Play ${card.protocol}-${card.value} face-down BLOCKS compile in lane ${i}`;
                }
                // EXCEPTION 3: Lane is at 8+ (close to compile) - face-down to finish is OK
                else if (!state.opponent.compiled[i] && currentLaneValue >= 8 && resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                    score = 250;
                    reason = `Play ${card.protocol}-${card.value} face-down finishes compile: ${currentLaneValue} -> ${resultingValue}`;
                }
                // NO EXCEPTION for low value cards (0-1)!
                // These often have the STRONGEST effects (draw, flip, delete, shift)
                // Playing face-down WASTES the effect - that's terrible!
                // Face-up 0-value + strong effect >>> face-down 2-value + no effect

                // EXCEPTION 4: No face-up option available
                else if (!canPlayFaceUp) {
                    score = -100; // Less penalty - we have no choice
                    reason = `Play ${card.protocol}-${card.value} face-down (no face-up option)`;
                }
                // WASTE: Player would compile and our card goes to trash
                else if (canPlayerCompileThisLane && resultingValue < state.player.laneValues[i]) {
                    score = -500;
                    reason += ` [WASTE: Goes to trash when player compiles!]`;
                }
                // All other cases: Keep the massive penalty - face-down is BAD

                possibleMoves.push({
                    move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false },
                    score: addNoise(score),
                    reason
                });
            }

            // =========================================================================
            // PLAY ON OPPONENT'S SIDE - for cards with "allow_play_on_opponent_side"
            // This is SMART when the card has harmful self-effects (flip own, delete own)
            // Playing on opponent's side makes "your cards in this stack" effects fizzle!
            // =========================================================================
            if (hasPlayOnOpponentSideRule(state, card as PlayedCard)) {
                // Check if playing on player's (opponent from AI view) lane is allowed
                const playerLaneCompiled = state.player.compiled[i];
                if (!playerLaneCompiled) {
                    // Evaluate: Does this card have harmful self-effects?
                    const hasHarmfulSelfEffect = hasFlipOwnCardEffect(card as PlayedCard) ||
                                                  hasDeleteOwnCardInStackEffect(card as PlayedCard);

                    let score = 0;
                    let reason = `Play ${card.protocol}-${card.value} on OPPONENT's lane ${i}`;

                    if (hasHarmfulSelfEffect) {
                        // SMART: Playing on opponent's side avoids harmful effect!
                        // The effect targets "your cards in this stack" - there are none on opponent's side
                        score = card.value * 8; // Value contribution (slightly less than normal face-up)
                        score += 50; // Bonus for avoiding harmful effect
                        reason += ` [SMART: Avoids harmful self-effect!]`;
                    } else {
                        // No harmful effect - playing on opponent's side just gives them value
                        // This is usually BAD unless we're trying to disrupt somehow
                        score = -100 - card.value * 10; // Heavy penalty
                        reason += ` [Gives opponent value - usually bad]`;
                    }

                    possibleMoves.push({
                        move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true, targetOwner: 'player' } as any,
                        score: addNoise(score),
                        reason
                    });
                }
            }
        }
    }

    // Evaluate filling hand - ONLY draw when absolutely necessary
    // 1. Hand is empty (must draw)
    // 2. Emergency: Player can compile and we have control + player has 1+ compiled (can block with swap)
    if (state.opponent.hand.length === 0) {
        // Must draw - no cards at all
        possibleMoves.push({ move: { type: 'fillHand' }, score: 500, reason: "Must refill - no cards" });
    } else {
        // Check for emergency block scenario:
        // - Player can compile a lane
        // - We have control
        // - Player already has at least 1 compiled lane (swap is valuable)
        const playerCanCompile = state.player.laneValues.some((val, idx) =>
            val >= 10 && val > state.opponent.laneValues[idx] && !state.player.compiled[idx]
        );
        const weHaveControl = state.controlCardHolder === 'opponent';
        const playerHasCompiledLane = state.player.compiled.some(c => c);

        if (playerCanCompile && weHaveControl && playerHasCompiledLane) {
            // Emergency draw to trigger control swap and block compile
            possibleMoves.push({ move: { type: 'fillHand' }, score: 200, reason: "Emergency draw to block compile with control swap" });
        }

        // CRITICAL ENDGAME: If opponent has 2 compiles and can compile next, consider refresh
        // This buys time to build control in subsequent turns
        if (opponentNearWin && playerCanCompile && !weHaveControl) {
            // Opponent can win next if they compile - we need to either:
            // 1. Block their compile
            // 2. Take control before they compile
            // If our hand can't achieve either, refresh might help
            const bestMoveScore = possibleMoves.length > 0 ?
                Math.max(...possibleMoves.map(m => m.score)) : -1000;

            // Only refresh if our best play is mediocre
            if (bestMoveScore < 100) {
                possibleMoves.push({
                    move: { type: 'fillHand' },
                    score: 50,
                    reason: "CRITICAL: Refresh to find better options vs opponent win threat"
                });
            }
        }
        // Otherwise: Don't draw, play the cards we have
    }

    if (possibleMoves.length === 0) {
        return { type: 'fillHand' };
    }

    possibleMoves.sort((a, b) => b.score - a.score);

    // SAFETY CHECK: Validate the chosen move is actually legal
    // This prevents returning face-up plays that shouldn't be allowed
    const validateMove = (move: AIAction): boolean => {
        if (move.type === 'playCard' && move.isFaceUp) {
            const card = state.opponent.hand.find(c => c.id === move.cardId);
            if (!card) return false;
            const check = canPlayCard(state, 'opponent', move.laneIndex, true, card.protocol);
            if (!check.allowed) {
                console.warn(`[AI Safety] Rejecting invalid face-up play: ${card.protocol}-${card.value} in lane ${move.laneIndex} - ${check.reason}`);
                return false;
            }
        }
        return true;
    };

    // 5% chance to pick second-best move for slight unpredictability
    // EXCEPTION: Never apply randomness to blocking moves - blocking is too critical!
    const bestMoveIsBlocking = possibleMoves[0]?.reason?.includes('Blocks compile') ||
                               possibleMoves[0]?.reason?.includes('BLOCK COMPILE');
    if (!bestMoveIsBlocking && shouldMakeMistake() && possibleMoves.length > 1 && possibleMoves[1].score > 0) {
        if (validateMove(possibleMoves[1].move)) {
            return possibleMoves[1].move;
        }
    }

    // Find the best valid move
    for (const scored of possibleMoves) {
        if (validateMove(scored.move)) {
            return scored.move;
        }
    }

    // All moves invalid, fallback to fillHand
    console.warn('[AI Safety] No valid moves found, falling back to fillHand');
    return { type: 'fillHand' };
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    // NEW: Get strategic analysis for all handlers
    const analysis = analyzeGameState(state);

    switch (action.type) {
        case 'prompt_use_control_mechanic': {
            const playerCompiledCount = state.player.compiled.filter(c => c).length;

            // Get the compiling lane index if this is during a compile
            const compilingLaneIndex = state.compilableLanes.length > 0 ? state.compilableLanes[0] : null;

            // =========================================================================
            // CRITICAL STRATEGY: Use control to prevent player from winning!
            // If player has compiled lanes AND a threatening uncompiled lane (10+),
            // we can swap their protocols to make them recompile instead of winning.
            // =========================================================================

            // Find player's threatening lane (uncompiled with 10+ and leading)
            let playerThreateningLane = -1;
            for (let i = 0; i < 3; i++) {
                if (!state.player.compiled[i] &&
                    state.player.laneValues[i] >= 10 &&
                    state.player.laneValues[i] > state.opponent.laneValues[i]) {
                    playerThreateningLane = i;
                    break;
                }
            }

            // Find player's compiled lanes
            const playerCompiledLanes = state.player.compiled
                .map((c, i) => c ? i : -1)
                .filter(i => i !== -1);

            // PRIORITY 1: Can we force a recompile instead of a winning compile?
            // Player has 10+ in uncompiled lane AND has compiled lanes to swap with
            if (playerThreateningLane !== -1 && playerCompiledLanes.length > 0) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }

            // If player has no compiled lanes, control swap is less valuable
            // But still check if it can help us
            if (playerCompiledCount === 0) {
                // Only use control if we can benefit from own rearrange
                if (canBenefitFromOwnRearrange(state, compilingLaneIndex) && !shouldMakeMistake()) {
                    return { type: 'resolveControlMechanicPrompt', choice: 'opponent' };
                }
                return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
            }

            // PRIORITY 2: Try to disrupt player if it actually hurts them
            // Pass compilingLaneIndex so that compiling lanes are treated as value 0
            if (canBenefitFromPlayerRearrange(state, compilingLaneIndex)) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }

            // PRIORITY 3: Rearrange own protocols ONLY if it actually helps
            if (canBenefitFromOwnRearrange(state, compilingLaneIndex) && !shouldMakeMistake()) {
                return { type: 'resolveControlMechanicPrompt', choice: 'opponent' };
            }

            // No beneficial rearrange found - skip to avoid wasting the control action
            return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
        }

        case 'discard': {
            // Discard weakest cards - ALWAYS use action.count (no variable logic here)
            const sortedHand = [...state.opponent.hand].sort((a, b) => {
                const aHasDisruption = DISRUPTION_KEYWORDS.some(kw => a.keywords[kw]);
                const bHasDisruption = DISRUPTION_KEYWORDS.some(kw => b.keywords[kw]);

                if (aHasDisruption && !bHasDisruption) return 1;
                if (!aHasDisruption && bHasDisruption) return -1;

                return getCardPower(a) - getCardPower(b);
            });
            return { type: 'discardCards', cardIds: sortedHand.slice(0, action.count).map(c => c.id) };
        }

        // CRITICAL: Handle discard_completed - this triggers the followUp effect (e.g., Fire-3 flip after discard)
        case 'discard_completed': {
            // The followUp effect will be executed automatically by the resolver
            // We just need to acknowledge the completion
            return { type: 'skip' };
        }

        case 'select_opponent_card_to_flip': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerUncovered = getUncovered('player');
            if (playerUncovered.length === 0) return { type: 'skip' };

            // Flip high-value face-up cards or reveal face-down
            const scored = playerUncovered.map(c => ({
                cardId: c.id,
                score: c.isFaceUp ? c.value + 5 : 3
            }));

            scored.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: scored[0].cardId };
        }

        // LEGACY REMOVED: select_card_to_delete_for_anarchy_2 - now uses generic select_cards_to_delete

        case 'select_cards_to_delete': {
            const disallowedIds = action.disallowedIds || [];
            const allowedIds = (action as any).allowedIds as string[] | undefined; // For valueSource/calculation filters (highest_value, lowest_value)
            const targetFilter = ((action as any).targetFilter ?? {}) as TargetFilter;
            const actorChooses = 'actorChooses' in action ? action.actorChooses : 'effect_owner';
            const sourceCardId = action.sourceCardId;
            const positionFilter = targetFilter?.position || 'uncovered';


            // CRITICAL FIX: If allowedIds is provided, use ONLY those cards (Luck-4 fix)
            if (allowedIds && allowedIds.length > 0) {
                const findCardById = (cardId: string): { card: PlayedCard; owner: Player; isUncovered: boolean } | null => {
                    for (const playerKey of ['player', 'opponent'] as const) {
                        for (const lane of state[playerKey].lanes) {
                            for (let i = 0; i < lane.length; i++) {
                                if (lane[i].id === cardId) {
                                    return { card: lane[i], owner: playerKey, isUncovered: i === lane.length - 1 };
                                }
                            }
                        }
                    }
                    return null;
                };
                const validAllowedCards = allowedIds
                    .map(id => ({ id, info: findCardById(id) }))
                    .filter(({ info }) => info !== null)
                    .filter(({ info }) => {
                        if (positionFilter === 'any') return true;
                        if (positionFilter === 'uncovered') return info!.isUncovered;
                        if (positionFilter === 'covered') return !info!.isUncovered;
                        return true;
                    })
                    .filter(({ id }) => !disallowedIds.includes(id));
                if (validAllowedCards.length > 0) {
                    const opponentCards = validAllowedCards.filter(({ info }) => info!.owner === 'player');
                    if (opponentCards.length > 0) {
                        opponentCards.sort((a, b) => b.info!.card.value - a.info!.card.value);
                        return { type: 'deleteCard', cardId: opponentCards[0].id };
                    }
                    const ownCards = validAllowedCards.filter(({ info }) => info!.owner === 'opponent');
                    if (ownCards.length > 0) {
                        ownCards.sort((a, b) => a.info!.card.value - b.info!.card.value);
                        return { type: 'deleteCard', cardId: ownCards[0].id };
                    }
                }
                return { type: 'skip' };
            }


            // FLEXIBLE: Check if AI must select its OWN cards (actorChooses: 'card_owner' + targetFilter.owner: 'opponent')
            // This handles custom effects like "Your opponent deletes 1 of their face-down cards"
            if (actorChooses === 'card_owner' && targetFilter?.owner === 'opponent') {
                // AI must select its OWN cards matching the filter
                const ownValidCards: PlayedCard[] = [];
                state.opponent.lanes.forEach((lane) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1]; // Only uncovered
                        if (matchesTargetFilter(topCard, true, targetFilter, sourceCardId)) {
                            // NEW: Also check allowedIds if present (for calculation filters)
                            if (allowedIds && !allowedIds.includes(topCard.id)) return;
                            ownValidCards.push(topCard);
                        }
                    }
                });

                if (ownValidCards.length > 0) {
                    // Delete lowest value card (minimize loss)
                    ownValidCards.sort((a, b) => a.value - b.value);
                    return { type: 'deleteCard', cardId: ownValidCards[0].id };
                }
                return { type: 'skip' };
            }

            // Standard behavior: Respect targetFilter.owner
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null)
                .filter(c => matchesTargetFilter(c, true, targetFilter, sourceCardId))
                .filter(c => !allowedIds || allowedIds.includes(c.id)); // NEW: Filter by allowedIds if present

            // CRITICAL: owner filter is relative to cardOwner (action.actor)
            // 'own' = cards belonging to cardOwner (AI = opponent)
            // 'opponent' = cards belonging to the opponent OF cardOwner (AI's opponent = player)
            const ownerFilter = targetFilter?.owner;

            if (ownerFilter === 'own') {
                // Delete own cards only (AI = opponent)
                const ownCards = getUncovered('opponent').filter(c => !disallowedIds.includes(c.id));
                if (ownCards.length > 0) {
                    // Delete lowest value card (minimize loss) - but if allowedIds is set, just pick from those
                    const weakest = ownCards.sort((a, b) => a.value - b.value)[0];
                    return { type: 'deleteCard', cardId: weakest.id };
                }
            } else if (ownerFilter === 'opponent') {
                // Delete opponent's cards only (AI's opponent = player)
                const playerCards = getUncovered('player').filter(c => !disallowedIds.includes(c.id));
                if (playerCards.length > 0) {
                    // NEW: Use effectEvaluator for intelligent target selection
                    const deleteTargets = evaluateDeleteTargets(state, analysis, { owner: 'opponent' }, sourceCardId);
                    const validIds = new Set(playerCards.map(c => c.id));
                    const filteredTargets = deleteTargets.filter(t => validIds.has(t.targetId));

                    if (filteredTargets.length > 0) {
                        return { type: 'deleteCard', cardId: filteredTargets[0].targetId };
                    }
                    // Fallback
                    return { type: 'deleteCard', cardId: playerCards[0].id };
                }
            } else {
                // No filter: Target player's high-value cards first
                const playerCards = getUncovered('player').filter(c => !disallowedIds.includes(c.id));
                if (playerCards.length > 0) {
                    // NEW: Use effectEvaluator for intelligent target selection
                    const deleteTargets = evaluateDeleteTargets(state, analysis, undefined, sourceCardId);
                    const validIds = new Set(playerCards.map(c => c.id));
                    const filteredTargets = deleteTargets.filter(t => validIds.has(t.targetId));

                    if (filteredTargets.length > 0) {
                        return { type: 'deleteCard', cardId: filteredTargets[0].targetId };
                    }
                    return { type: 'deleteCard', cardId: playerCards[0].id };
                }

                const opponentCards = getUncovered('opponent').filter(c => !disallowedIds.includes(c.id));
                if (opponentCards.length > 0) {
                    const weakest = opponentCards.sort((a, b) => a.value - b.value)[0];
                    return { type: 'deleteCard', cardId: weakest.id };
                }
            }

            return { type: 'skip' };
        }

        case 'select_any_card_to_flip':
        case 'select_any_other_card_to_flip':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_any_card_to_flip_optional': {
            const frost1Active = isFrost1Active(state);
            const targetFilter = action.targetFilter;
            const sourceCardId = action.sourceCardId;
            const positionFilter = targetFilter?.position || 'uncovered';
            const cardOwner = action.actor;
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const scope = (action as any).scope;

            // Build valid targets respecting targetFilter
            const validTargets: { card: PlayedCard; owner: Player }[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                if (targetFilter) {
                    if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                    if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;
                }

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    if (restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;
                    if (scope === 'this_lane' && restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];
                    if (lane.length === 0) continue;

                    for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                        const card = lane[cardIndex];
                        const isTopCard = cardIndex === lane.length - 1;

                        if (targetFilter) {
                            if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;
                        } else {
                            if (!isTopCard) continue;
                        }

                        if (frost1Active && !card.isFaceUp) continue;

                        validTargets.push({ card, owner: playerKey });
                    }
                }
            }

            if (validTargets.length === 0) return { type: 'skip' };

            // NEW: Use effectEvaluator for intelligent target selection
            const flipTargets = evaluateFlipTargets(state, analysis, targetFilter, sourceCardId);

            // Filter to only valid targets
            const validTargetIds = new Set(validTargets.map(t => t.card.id));
            const filteredTargets = flipTargets.filter(t => validTargetIds.has(t.targetId));

            if (filteredTargets.length > 0) {
                return { type: 'flipCard', cardId: filteredTargets[0].targetId };
            }

            // Fallback to first valid target
            return { type: 'flipCard', cardId: validTargets[0].card.id };
        }

        case 'plague_2_opponent_discard': {
            // Discard weakest card
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'discardCards', cardIds: [sortedHand[0].id] };
        }

        // REMOVED: Legacy handlers 'select_cards_from_hand_to_discard_for_fire_4' and
        // 'select_cards_from_hand_to_discard_for_hate_1' - now using generic 'discard' with variableCount

        case 'select_card_from_hand_to_play': {
            // Speed-0 or Darkness-3: Play another card
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            // CRITICAL: Check if the effect FORCES face-down play (e.g., Darkness-3, Smoke-3)
            // effectInterpreter sends 'faceDown', not 'isFaceDown'
            const isForcedFaceDown = (action as any).faceDown === true;

            // NEW: Respect selectableCardIds filter (Clarity-2: only cards with specific value)
            const selectableCardIds = (action as any).selectableCardIds;
            const playableHand = selectableCardIds
                ? state.opponent.hand.filter(c => selectableCardIds.includes(c.id))
                : state.opponent.hand;

            if (playableHand.length === 0) return { type: 'skip' };

            // CRITICAL: Respect forcedLaneIndex for "in this line" effects (Diversity-0)
            const forcedLaneIndex = (action as any).forcedLaneIndex;
            let playableLanes: number[];
            if (forcedLaneIndex !== undefined) {
                // "In this line" - ONLY this lane is valid
                playableLanes = [forcedLaneIndex];
            } else {
                // FIX: Filter out blocked lanes and respect validLanes from Smoke-3
                playableLanes = (action as any).validLanes || [0, 1, 2].filter(i => i !== (action as any).disallowedLaneIndex);
            }
            playableLanes = playableLanes.filter((laneIndex: number) => {
                const opponentLane = state.player.lanes[laneIndex];
                const topCard = opponentLane.length > 0 ? opponentLane[opponentLane.length - 1] : null;

                // Check for Plague-0 block
                return !(topCard && topCard.isFaceUp && topCard.protocol === 'Plague' && topCard.value === 0);
            });

            if (playableLanes.length === 0) return { type: 'skip' };

            const scoredPlays: { cardId: string; laneIndex: number; isFaceUp: boolean; score: number }[] = [];

            for (const card of playableHand) {
                for (const laneIndex of playableLanes) {
                    // If forced face-down (Darkness-3), ONLY consider face-down plays
                    if (!isForcedFaceDown) {
                        const aiHasSpirit1 = state.opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

                        // Check if the card being played has ignore_protocol_matching card_property (generic check)
                        const thisCardIgnoresMatching = (card as any).customEffects?.bottomEffects?.some(
                            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
                        ) || (card as any).customEffects?.topEffects?.some(
                            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
                        ) || (card as any).customEffects?.middleEffects?.some(
                            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
                        );

                        // Check for Anarchy-1 on ANY player's field (affects both players)
                        const anyPlayerHasAnarchy1 = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                            .some(c => c.isFaceUp && c.protocol === 'Anarchy' && c.value === 1);

                        // Check Unity-1 same-protocol face-up play rule
                        const hasSameProtocolFaceUpRule = canPlayFaceUpDueToSameProtocolRule(state, 'opponent', laneIndex, card.protocol);

                        let canPlayFaceUp: boolean;
                        if (anyPlayerHasAnarchy1) {
                            // Anarchy-1 active: INVERTED rule - can only play if protocol does NOT match
                            const doesNotMatch = card.protocol !== state.opponent.protocols[laneIndex] && card.protocol !== state.player.protocols[laneIndex];
                            canPlayFaceUp = doesNotMatch;
                        } else {
                            // Normal rule - or THIS CARD ignores protocol matching (cards with ignore_protocol_matching)
                            // OR if Unity-1 same-protocol face-up rule allows it
                            canPlayFaceUp = card.protocol === state.opponent.protocols[laneIndex]
                                || card.protocol === state.player.protocols[laneIndex]
                                || aiHasSpirit1
                                || thisCardIgnoresMatching
                                || hasSameProtocolFaceUpRule;
                        }

                        if (canPlayFaceUp) {
                            const valueToAdd = card.value;
                            const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                            let score = getCardPower(card) + valueToAdd * 2;

                            if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                                score += 100;
                            }

                            // PRIORITY: Block player's compilation attempt (face-up is even better - get effect too!)
                            const playerValue = state.player.laneValues[laneIndex];
                            const playerCompiled = state.player.compiled[laneIndex];
                            const aiCompiled = state.opponent.compiled[laneIndex];
                            const currentAiValue = state.opponent.laneValues[laneIndex];

                            if (!playerCompiled && !aiCompiled && playerValue >= 10 && playerValue > currentAiValue && resultingValue >= playerValue) {
                                score += 160; // Higher than face-down (150) because we also get the effect
                            }

                            scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: true, score });
                        }
                    }

                    // Face-down - check Metal-2 block
                    const opponentLane = state.player.lanes[laneIndex];
                    const isBlockedByMetal2 = opponentLane.some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);

                    if (!isBlockedByMetal2) {
                        const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[laneIndex]);
                        const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                        let score = valueToAdd * 2;

                        if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                            score += 80;
                        }

                        // PRIORITY: Block player's compilation attempt
                        // Player can compile if: value >= 10 AND value > AI value AND lane not compiled
                        const playerValue = state.player.laneValues[laneIndex];
                        const playerCompiled = state.player.compiled[laneIndex];
                        const aiCompiled = state.opponent.compiled[laneIndex];
                        const currentAiValue = state.opponent.laneValues[laneIndex];

                        if (!playerCompiled && !aiCompiled && playerValue >= 10 && playerValue > currentAiValue && resultingValue >= playerValue) {
                            score += 150; // High priority to block compilation
                        }

                        scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: false, score });
                    }
                }
            }

            if (scoredPlays.length === 0) return { type: 'skip' };

            scoredPlays.sort((a, b) => b.score - a.score);
            const best = scoredPlays[0];
            return { type: 'playCard', cardId: best.cardId, laneIndex: best.laneIndex, isFaceUp: best.isFaceUp };
        }

        case 'select_card_from_hand_to_give': {
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'giveCard', cardId: sortedHand[0].id };
        }

        case 'select_card_from_hand_to_reveal': {
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(b) - getCardPower(a));
            return { type: 'revealCard', cardId: sortedHand[0].id };
        }

        // LEGACY REMOVED: select_lane_for_death_2 - now uses generic select_lane_for_delete

        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            // Return card - use targetFilter for full flexibility
            // CRITICAL: Default to uncovered only - return effects target uncovered cards unless specified otherwise
            const rawTargetFilter = ((action as any).targetFilter || {}) as TargetFilter;
            const targetFilter: TargetFilter = {
                position: 'uncovered', // Default: only uncovered cards can be returned
                ...rawTargetFilter
            };
            const targetOwner = (action as any).targetOwner || targetFilter.owner;
            const sourceCardId = action.sourceCardId;
            const positionFilter = targetFilter?.position || 'uncovered';
            const cardOwner = action.actor;

            // Collect valid targets based on filter
            const validTargets: { card: PlayedCard; owner: Player }[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                // Owner filter (relative to cardOwner)
                if (targetOwner === 'own' && playerKey !== cardOwner) continue;
                if (targetOwner === 'opponent' && playerKey === cardOwner) continue;

                for (const lane of state[playerKey].lanes) {
                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];
                        const isTopCard = i === lane.length - 1;

                        // Use centralized filter matching
                        if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;

                        validTargets.push({ card, owner: playerKey });
                    }
                }
            }

            if (validTargets.length === 0) return { type: 'skip' };

            // NEW: Use effectEvaluator for intelligent target selection
            const returnTargets = evaluateReturnTargets(state, analysis, targetFilter, sourceCardId);
            const validIds = new Set(validTargets.map(t => t.card.id));
            const filteredTargets = returnTargets.filter(t => validIds.has(t.targetId));

            if (filteredTargets.length > 0) {
                return { type: 'returnCard', cardId: filteredTargets[0].targetId };
            }

            // Fallback: Return player's high-threat cards, or own low-value cards
            const playerTargets = validTargets.filter(t => t.owner === 'player');
            const ownTargets = validTargets.filter(t => t.owner === 'opponent');

            if (playerTargets.length > 0) {
                playerTargets.sort((a, b) => getCardThreat(b.card, 'player', state) - getCardThreat(a.card, 'player', state));
                return { type: 'returnCard', cardId: playerTargets[0].card.id };
            }

            if (ownTargets.length > 0) {
                ownTargets.sort((a, b) => a.card.value - b.card.value);
                return { type: 'returnCard', cardId: ownTargets[0].card.id };
            }

            return { type: 'returnCard', cardId: validTargets[0].card.id };
        }

        // LEGACY REMOVED: select_lane_for_life_3_play - now uses generic select_lane_for_play
        case 'select_lane_for_play': {
            // FIX: Filter out blocked lanes and respect validLanes from Smoke-3
            let playableLanes = (action as any).validLanes || [0, 1, 2];
            playableLanes = playableLanes.filter((i: number) => !('disallowedLaneIndex' in action) || i !== action.disallowedLaneIndex);
            // Life-3: "in another line" - excludeCurrentLane restricts to other lanes
            if ((action as any).excludeCurrentLane && (action as any).currentLaneIndex !== undefined) {
                playableLanes = playableLanes.filter((i: number) => i !== (action as any).currentLaneIndex);
            }

            // FIX: Determine which board to check based on actor
            // When AI plays to their own board (Life-3 oncover), check opponent.lanes
            // When AI plays to player's board (attacking), check player.lanes
            const actor = (action as any).actor || 'opponent';
            const targetBoard = actor === 'opponent' ? state.opponent : state.player;

            playableLanes = playableLanes.filter((laneIndex: number) => {
                const targetLane = targetBoard.lanes[laneIndex];
                const topCard = targetLane.length > 0 ? targetLane[targetLane.length - 1] : null;

                // Check for Plague-0 block
                const isBlockedByPlague0 = topCard && topCard.isFaceUp &&
                    topCard.protocol === 'Plague' && topCard.value === 0;

                // Check for Metal-2 block (only if playing face-down)
                const isBlockedByMetal2 = ('isFaceDown' in action && action.isFaceDown) &&
                    targetLane.some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);

                return !isBlockedByPlague0 && !isBlockedByMetal2;
            });

            if (playableLanes.length === 0) return { type: 'skip' };

            // PRIORITY: Check if player is about to compile and we can block it
            // Player can compile if: value >= 10 AND value > AI value AND not yet compiled
            // Face-down card adds value 2, so we can block if AI value + 2 >= player value
            const blockableLanes = playableLanes.filter((laneIndex: number) => {
                const playerValue = state.player.laneValues[laneIndex];
                const aiValue = state.opponent.laneValues[laneIndex];
                const playerCompiled = state.player.compiled[laneIndex];
                const aiCompiled = state.opponent.compiled[laneIndex];

                // Player can compile this lane
                const playerCanCompile = !playerCompiled && playerValue >= 10 && playerValue > aiValue;
                // AI can block by playing face-down (value 2)
                const aiCanBlock = aiValue + 2 >= playerValue;

                return playerCanCompile && aiCanBlock && !aiCompiled;
            });

            if (blockableLanes.length > 0) {
                // Sort by how close player is to compiling (higher value = more urgent to block)
                blockableLanes.sort((a: number, b: number) =>
                    state.player.laneValues[b] - state.player.laneValues[a]
                );
                return { type: 'selectLane', laneIndex: blockableLanes[0] };
            }

            // Normal logic: play in weakest lane
            const scoredLanes = playableLanes.map(laneIndex => {
                const lead = state.opponent.laneValues[laneIndex] - state.player.laneValues[laneIndex];
                return { laneIndex, score: -lead }; // Play in weakest lane
            });
            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'prompt_rearrange_protocols': {
            return handleControlRearrange(state, action);
        }

        case 'prompt_swap_protocols': {
            // Spirit-4: Swap own protocols (target = 'opponent' = AI's own)
            // Anarchy-3: Swap opponent's protocols (target = 'player')
            const { target } = action;
            const targetProtocols = state[target].protocols;
            const targetHand = state[target].hand;
            const targetCompiled = state[target].compiled;
            const targetLaneValues = state[target].laneValues;

            const possibleSwaps: [number, number][] = [[0, 1], [0, 2], [1, 2]];
            let bestSwap: [number, number] = [0, 1];
            let bestScore = -Infinity;

            for (const swap of possibleSwaps) {
                const [i, j] = swap;
                const newProtocols = [...targetProtocols];
                [newProtocols[i], newProtocols[j]] = [newProtocols[j], newProtocols[i]];
                let score = 0;

                const compiledI = targetCompiled[i];
                const compiledJ = targetCompiled[j];
                const valueI = targetLaneValues[i];
                const valueJ = targetLaneValues[j];

                // Evaluate based on whose protocols we're swapping
                if (target === 'opponent') {
                    // Spirit-4: We're swapping our own protocols

                    // STRATEGIC PRIORITY: Move high values to uncompiled lanes, low values to compiled
                    // Compiled lanes are "done" - we don't need more value there
                    // Uncompiled lanes need high values to reach 10 and win
                    if (compiledI && !compiledJ) {
                        // Lane i compiled, lane j not - we want HIGH value in lane j
                        // Swapping moves value from lane i to j conceptually (protocols swap)
                        // If lane i has more value than j, swapping is BAD (we'd lose value in uncompiled lane)
                        // If lane j has more value than i, swapping is GOOD (more value stays in uncompiled)
                        // Actually: swap exchanges protocols, not values. Values stay in their lanes.
                        // But by swapping protocols, we affect FUTURE plays.
                        // Key insight: We want to be able to play cards in uncompiled lanes
                        // So bonus if lane j (uncompiled) has lower value and needs help
                        if (valueJ < valueI) {
                            score += 30; // Swap to focus on weak uncompiled lane
                        }
                    } else if (compiledJ && !compiledI) {
                        // Lane j compiled, lane i not - mirror logic
                        if (valueI < valueJ) {
                            score += 30;
                        }
                    } else if (!compiledI && !compiledJ) {
                        // Neither compiled - prefer swap if it helps the weaker lane
                        // Slight preference for keeping options open
                    }

                    // Secondary: Hand playability
                    for (const card of targetHand) {
                        const couldPlayBeforeI = card.protocol === targetProtocols[i];
                        const couldPlayBeforeJ = card.protocol === targetProtocols[j];
                        const canPlayNowI = card.protocol === newProtocols[i];
                        const canPlayNowJ = card.protocol === newProtocols[j];

                        // IMPROVED: Weight playability by whether the lane is compiled
                        // Playing in uncompiled lanes is MORE valuable
                        const weightI = compiledI ? 0.5 : 1.5;
                        const weightJ = compiledJ ? 0.5 : 1.5;

                        if (canPlayNowI && !couldPlayBeforeI) score += getCardPower(card) * weightI;
                        if (canPlayNowJ && !couldPlayBeforeJ) score += getCardPower(card) * weightJ;
                        if (!canPlayNowI && couldPlayBeforeI) score -= getCardPower(card) * weightI;
                        if (!canPlayNowJ && couldPlayBeforeJ) score -= getCardPower(card) * weightJ;
                    }
                } else {
                    // Anarchy-3: We're swapping opponent's protocols - minimize their advantage

                    // STRATEGIC: Move their high-value uncompiled lanes to compiled positions
                    // This "wastes" their advantage since compiled lanes are already won
                    if (compiledI && !compiledJ) {
                        // Lane i compiled (done), lane j has potential
                        // If j has HIGH value, swapping would keep that high value useful to them
                        // We want their HIGH values in COMPILED lanes (wasted)
                        // So if j > i, we'd be moving high value j INTO the uncompiled slot - BAD for us
                        // If i > j, we'd be moving lower value into uncompiled - GOOD for us (less threat)
                        if (valueI > valueJ) {
                            score += 25; // Their strong position moves to compiled (wasted)
                        }
                    } else if (compiledJ && !compiledI) {
                        if (valueJ > valueI) {
                            score += 25;
                        }
                    }

                    // Secondary: Disrupt their hand playability
                    for (const card of targetHand) {
                        const couldPlayBeforeI = card.protocol === targetProtocols[i];
                        const couldPlayBeforeJ = card.protocol === targetProtocols[j];
                        const canPlayNowI = card.protocol === newProtocols[i];
                        const canPlayNowJ = card.protocol === newProtocols[j];

                        // Weight by compiled status - disrupting uncompiled lane plays hurts them more
                        const weightI = compiledI ? 0.5 : 1.5;
                        const weightJ = compiledJ ? 0.5 : 1.5;

                        // Inverted logic: we WANT to make their cards less playable
                        if (canPlayNowI && !couldPlayBeforeI) score -= getCardPower(card) * weightI;
                        if (canPlayNowJ && !couldPlayBeforeJ) score -= getCardPower(card) * weightJ;
                        if (!canPlayNowI && couldPlayBeforeI) score += getCardPower(card) * weightI;
                        if (!canPlayNowJ && couldPlayBeforeJ) score += getCardPower(card) * weightJ;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestSwap = swap;
                }
            }
            return { type: 'resolveSwapProtocols', indices: bestSwap };
        }

        // Simple lane selections
        case 'select_lane_for_shift': {
            // NEW: Respect validLanes restriction (Courage-3: opponent_highest_value_lane)
            let possibleLanes = (action as any).validLanes || [0, 1, 2];
            possibleLanes = possibleLanes.filter((i: number) =>
                !('disallowedLaneIndex' in action) || i !== action.disallowedLaneIndex
            ).filter((i: number) =>
                !('originalLaneIndex' in action) || i !== action.originalLaneIndex
            );

            // CRITICAL: Check if this is Gravity-1 shift (must shift TO or FROM Gravity lane)
            if ('sourceCardId' in action) {
                const sourceCard = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].find(c => c.id === action.sourceCardId);
                if (sourceCard && sourceCard.protocol === 'Gravity' && sourceCard.value === 1) {
                    // Find which lane has the Gravity-1 card
                    let gravityLaneIndex: number | null = null;
                    for (let i = 0; i < 3; i++) {
                        const allLanes = [...state.player.lanes[i], ...state.opponent.lanes[i]];
                        if (allLanes.some(c => c.id === action.sourceCardId)) {
                            gravityLaneIndex = i;
                            break;
                        }
                    }

                    if (gravityLaneIndex !== null && 'originalLaneIndex' in action) {
                        if (action.originalLaneIndex === gravityLaneIndex) {
                            // Shifting FROM Gravity lane - already filtered correctly
                        } else {
                            // Shifting TO Gravity lane - MUST go to Gravity lane only
                            possibleLanes = [gravityLaneIndex];
                        }
                    }
                }

                // CRITICAL: Check if this is Anarchy-1 shift (must shift to NON-matching protocol lane)
                if (sourceCard && sourceCard.protocol === 'Anarchy' && sourceCard.value === 1) {
                    // Get the card being shifted
                    const cardToShiftId = 'cardToShiftId' in action ? action.cardToShiftId : null;
                    if (cardToShiftId) {
                        const cardToShift = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].find(c => c.id === cardToShiftId);
                        if (cardToShift) {
                            // Filter out lanes where the card's protocol matches
                            possibleLanes = possibleLanes.filter(laneIndex => {
                                const playerProtocol = state.player.protocols[laneIndex];
                                const opponentProtocol = state.opponent.protocols[laneIndex];
                                const cardProtocol = cardToShift.protocol;
                                return cardProtocol !== playerProtocol && cardProtocol !== opponentProtocol;
                            });
                        }
                    }
                }
            }

            if (possibleLanes.length > 0) {
                // SMART SHIFT: Choose lane strategically based on whose card is being shifted
                // Get the card being shifted to determine owner
                const cardToShiftId = 'cardToShiftId' in action ? action.cardToShiftId : null;
                let cardOwner: Player | null = null;
                let cardValue = 0;

                if (cardToShiftId) {
                    for (const playerKey of ['player', 'opponent'] as const) {
                        for (const lane of state[playerKey].lanes) {
                            const card = lane.find(c => c.id === cardToShiftId);
                            if (card) {
                                cardOwner = playerKey;
                                cardValue = card.isFaceUp ? card.value : 2;
                                break;
                            }
                        }
                        if (cardOwner) break;
                    }
                }

                // Score each lane
                const lanePriorities = possibleLanes.map(laneIdx => {
                    let score = 0;
                    const playerValue = state.player.laneValues[laneIdx];
                    const opponentValue = state.opponent.laneValues[laneIdx];
                    const playerCompiled = state.player.compiled[laneIdx];
                    const opponentCompiled = state.opponent.compiled[laneIdx];

                    if (cardOwner === 'player') {
                        // Shifting PLAYER's card (enemy card) - we want to HURT them
                        // BEST: Shift to lane where player already compiled (wastes their value)
                        if (playerCompiled) {
                            score += 100; // Excellent - their compiled lane, value is wasted there
                        }
                        // GOOD: Shift to lane where we (opponent) are ahead
                        else if (opponentValue > playerValue) {
                            score += 50; // We're winning this lane, their card won't help much
                        }
                        // AVOID: Shift to lane where player needs value to compile
                        else if (playerValue >= 6 && playerValue < 10 && !playerCompiled) {
                            score -= 50; // Don't help them reach compile!
                        }
                    } else if (cardOwner === 'opponent') {
                        // Shifting our own card - we want to HELP ourselves
                        // BEST: Shift to uncompiled lane where we need more value
                        if (!opponentCompiled && opponentValue < 10) {
                            // Closer to compile = better destination
                            if (opponentValue + cardValue >= 10) {
                                score += 100; // This could complete a compile!
                            } else if (opponentValue >= 6) {
                                score += 60; // Near compile, good destination
                            } else {
                                score += 30; // Building value
                            }
                        }
                        // AVOID: Our already compiled lanes (wasted)
                        else if (opponentCompiled) {
                            score -= 50;
                        }
                    }

                    return { laneIdx, score };
                });

                // Sort by score descending and pick best
                lanePriorities.sort((a, b) => b.score - a.score);

                // Add some randomness - 5% chance to pick suboptimally
                if (shouldMakeMistake() && lanePriorities.length > 1) {
                    const randomIdx = Math.floor(Math.random() * lanePriorities.length);
                    return { type: 'selectLane', laneIndex: lanePriorities[randomIdx].laneIdx };
                }

                return { type: 'selectLane', laneIndex: lanePriorities[0].laneIdx };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }
        // LEGACY REMOVED: select_lane_to_shift_cards_for_light_3 - now uses generic select_lane_for_shift_all
        // LEGACY REMOVED: select_lane_for_metal_3_delete - now uses generic select_lane_for_delete

        case 'select_lane_for_delete_all': {
            // Generic handler for delete all in lane (custom protocols)
            // SMART: Choose lane where deleting hurts opponent more than us
            const validLanes = 'validLanes' in action ? action.validLanes : [0, 1, 2];
            if (validLanes.length === 0) return { type: 'skip' };

            let bestLane = validLanes[0];
            let bestNetGain = -Infinity;

            for (const laneIdx of validLanes) {
                const ourLaneValue = state.opponent.laneValues[laneIdx];
                const theirLaneValue = state.player.laneValues[laneIdx];
                // Net gain = what opponent loses - what we lose
                const netGain = theirLaneValue - ourLaneValue;
                if (netGain > bestNetGain) {
                    bestNetGain = netGain;
                    bestLane = laneIdx;
                }
            }
            return { type: 'selectLane', laneIndex: bestLane };
        }

        // =========================================================================
        // SWAP STACKS (Mirror-2)
        // =========================================================================
        case 'select_lanes_for_swap_stacks': {
            // Normal AI: Strategic selection based on lane values
            const validLanes = action.validLanes;
            const selectedFirstLane = (action as any).selectedFirstLane;

            if (validLanes.length === 0) return { type: 'skip' };

            if (selectedFirstLane === undefined) {
                // STEP 1: Select lane with LOWEST value to potentially improve
                const scoredLanes = validLanes.map((laneIdx: number) => {
                    const laneValue = state.opponent.laneValues[laneIdx];
                    return { laneIdx, score: laneValue };
                });
                // Pick lane with lowest value (most to gain from swap)
                scoredLanes.sort((a, b) => a.score - b.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIdx };
            } else {
                // STEP 2: Select lane with HIGHEST value to swap with first lane
                const scoredLanes = validLanes.map((laneIdx: number) => {
                    const laneValue = state.opponent.laneValues[laneIdx];
                    return { laneIdx, score: laneValue };
                });
                // Pick lane with highest value (most benefit to swap)
                scoredLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIdx };
            }
        }

        // =========================================================================
        // COPY OPPONENT MIDDLE (Mirror-1)
        // =========================================================================
        case 'select_card_for_copy_middle': {
            // Normal AI: Pick best target based on effect value
            const validTargets = (action as any).validTargetIds || [];
            if (validTargets.length === 0) return { type: 'skip' };

            // Score each target by perceived value of its middle effect
            // For simplicity, prefer cards with draw/flip effects over others
            const scoredTargets = validTargets.map((cardId: string) => {
                let score = 0;
                // Find the card
                for (const p of ['player', 'opponent'] as Player[]) {
                    for (const lane of state[p].lanes) {
                        const card = lane.find(c => c.id === cardId);
                        if (card) {
                            const customCard = card as any;
                            const middleEffects = customCard.customEffects?.middleEffects || [];
                            for (const effect of middleEffects) {
                                const action = effect.params?.action;
                                // Prefer beneficial effects
                                if (action === 'draw') score += 5;
                                if (action === 'flip') score += 3;
                                if (action === 'delete') score += 4;
                                if (action === 'shift') score += 2;
                                if (action === 'discard') score -= 2;  // Discard self is bad
                            }
                        }
                    }
                }
                return { cardId, score };
            });

            scoredTargets.sort((a, b) => b.score - a.score);
            return { type: 'selectCard', cardId: scoredTargets[0].cardId };
        }

        case 'select_lane_for_return': {
            // Generic lane selection for return effects (e.g., "Return all cards with value X in 1 line")
            // CRITICAL: Calculate actual VALUE loss, not just card count!
            const targetFilter = (action as any).targetFilter || {};
            const cardOwner = action.actor; // AI = opponent

            // Extract value filter from targetFilter (valueEquals or valueRange)
            const valueEquals = targetFilter.valueEquals;
            const valueRange = targetFilter.valueRange;

            // Find lanes with matching cards and score them by NET VALUE CHANGE
            const scoredLanes: { laneIndex: number; score: number; reason: string }[] = [];
            for (let i = 0; i < 3; i++) {
                let playerValueLost = 0;
                let ownValueLost = 0;
                const faceDownBoost = getLaneFaceDownValueBoost(state, i);

                for (const p of ['player', 'opponent'] as Player[]) {
                    // Check owner filter (relative to cardOwner)
                    if (targetFilter.owner === 'own' && p !== cardOwner) continue;
                    if (targetFilter.owner === 'opponent' && p === cardOwner) continue;

                    const lane = state[p].lanes[i];
                    for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                        const card = lane[cardIdx];
                        const isUncovered = cardIdx === lane.length - 1;

                        // Check position filter
                        if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                        if (targetFilter.position === 'covered' && isUncovered) continue;

                        // Calculate card's effective value
                        const cardValue = card.isFaceUp ? card.value : (2 + faceDownBoost);

                        // Check value filters
                        if (valueEquals !== undefined && cardValue !== valueEquals) continue;
                        if (valueRange) {
                            if (cardValue < valueRange.min || cardValue > valueRange.max) continue;
                        }

                        // Track VALUE lost, not just card count!
                        if (p === 'player') {
                            playerValueLost += cardValue;
                        } else {
                            ownValueLost += cardValue;
                        }
                    }
                }

                // Score = player's loss - our loss (higher = better for us)
                // We WANT player to lose value, we DON'T want to lose value
                const netBenefit = playerValueLost - ownValueLost;
                const reason = `Lane ${i}: Player loses ${playerValueLost}, we lose ${ownValueLost}, net=${netBenefit}`;

                scoredLanes.push({ laneIndex: i, score: netBenefit, reason });
            }

            // Sort by score (highest = best for AI)
            scoredLanes.sort((a, b) => b.score - a.score);

            // Log decision
            for (const sl of scoredLanes) {
            }

            // Pick best lane (or least bad if all negative)
            if (scoredLanes.length > 0) {
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        // REMOVED: Legacy prompts (prompt_death_1_effect, prompt_give_card_for_love_1, prompt_fire_3_discard,
        // prompt_shift_for_speed_3, prompt_shift_for_spirit_3, prompt_return_for_psychic_4, prompt_spirit_1_start)
        // All now use custom protocol system with generic prompt_optional_* handlers
        // Generic optional effect prompt for custom protocols
        case 'prompt_optional_effect': {
            // Intelligent decision based on the effect type and context
            const { effectDef } = action as any;
            const effectAction = effectDef?.params?.action;
            const targetFilter = effectDef?.params?.targetFilter;

            // For 'give' actions (Love-1 End): ALWAYS skip
            // Giving a card to opponent is terrible - never do it
            if (effectAction === 'give') {
                return { type: 'resolveOptionalEffectPrompt', accept: false };
            }

            // For 'flip' actions: check if there's a beneficial flip target
            if (effectAction === 'flip') {
                // Look for beneficial flip targets
                let hasBeneficialTarget = false;
                const positionFilter = targetFilter?.position || 'uncovered';

                for (const player of ['player', 'opponent'] as const) {
                    // Check owner filter (relative to AI = 'opponent')
                    if (targetFilter?.owner === 'own' && player !== 'opponent') continue;
                    if (targetFilter?.owner === 'opponent' && player === 'opponent') continue;

                    for (let laneIdx = 0; laneIdx < state[player].lanes.length; laneIdx++) {
                        const lane = state[player].lanes[laneIdx];
                        if (lane.length === 0) continue;

                        // CRITICAL FIX: Check ALL cards in lane based on position filter
                        for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                            const card = lane[cardIdx];
                            const isUncovered = cardIdx === lane.length - 1;
                            const isCovered = !isUncovered;

                            // Check position filter
                            if (positionFilter === 'uncovered' && !isUncovered) continue;
                            if (positionFilter === 'covered' && !isCovered) continue;
                            // 'any' allows both

                            // Check faceState filter
                            if (targetFilter?.faceState === 'face_up' && !card.isFaceUp) continue;
                            if (targetFilter?.faceState === 'face_down' && card.isFaceUp) continue;

                            // Calculate value change from flipping
                            const currentValue = card.isFaceUp ? card.value : 2; // face-down = 2
                            const flippedValue = card.isFaceUp ? 2 : card.value; // face-up shows real value

                            if (player === 'player') {
                                // Flip PLAYER cards if it HURTS them (reduces their value)
                                if (card.isFaceUp && currentValue > flippedValue) {
                                    hasBeneficialTarget = true;
                                    break;
                                }
                            } else {
                                // Flip OWN cards - check if it increases our lane value
                                const laneValue = state.opponent.laneValues[laneIdx];
                                const valueGain = flippedValue - currentValue;

                                // SMART: Flip face-up to face-down if it GAINS value (e.g., 0 -> 2)
                                if (card.isFaceUp && valueGain > 0) {
                                    hasBeneficialTarget = true;
                                    break;
                                }
                                // SMART: Flip face-down to face-up if real value > 2
                                if (!card.isFaceUp && card.value > 2) {
                                    hasBeneficialTarget = true;
                                    break;
                                }
                                // CRITICAL: Check if flipping would enable COMPILE!
                                if (valueGain > 0 && laneValue + valueGain >= 10 && !state.opponent.compiled[laneIdx]) {
                                    hasBeneficialTarget = true;
                                    break;
                                }
                            }
                        }
                        if (hasBeneficialTarget) break;
                    }
                    if (hasBeneficialTarget) break;
                }

                // Only accept if there's a beneficial target
                return { type: 'resolveOptionalEffectPrompt', accept: hasBeneficialTarget };
            }

            // For most other optional effects (shift, delete, draw, etc.): usually beneficial
            // Use shouldMakeMistake() for some randomness
            return { type: 'resolveOptionalEffectPrompt', accept: !shouldMakeMistake() };
        }

        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            // SMART: Collect all valid targets, score by value, prefer opponent (player) cards
            const scoredTargets: { cardId: string; score: number }[] = [];

            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;

                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    const card = playerLane[playerLane.length - 1];
                    const effectiveValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
                    // High score = good target (opponent card + high value)
                    scoredTargets.push({ cardId: card.id, score: effectiveValue + 100 }); // +100 bonus for opponent
                }

                const opponentLane = state.opponent.lanes[i];
                if (opponentLane.length > 0) {
                    const card = opponentLane[opponentLane.length - 1];
                    const effectiveValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
                    // Low score = bad target (our card)
                    scoredTargets.push({ cardId: card.id, score: -effectiveValue }); // Negative = prefer low value own cards
                }
            }

            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_delete': {
            const disallowedIds = ('disallowedIds' in action && Array.isArray(action.disallowedIds)) ? action.disallowedIds : [];
            // SMART: Prioritize opponent's (player's) face-down cards
            // Deleting opponent's hidden card = good (remove threat)
            // Deleting our hidden card = bad (lose potential value)
            const getUncoveredFaceDownCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null && !c.isFaceUp);

            const playerFaceDown = getUncoveredFaceDownCards('player')
                .filter(c => !disallowedIds.includes(c.id));
            if (playerFaceDown.length > 0) {
                // Prefer opponent's face-down in lanes where they're close to compiling
                const scored = playerFaceDown.map(c => {
                    const laneIdx = state.player.lanes.findIndex(lane =>
                        lane.some(card => card.id === c.id));
                    const laneValue = state.player.laneValues[laneIdx] || 0;
                    return { cardId: c.id, score: laneValue }; // Higher lane value = more dangerous
                });
                scored.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scored[0].cardId };
            }

            // Only delete our own face-down if we must
            const ownFaceDown = getUncoveredFaceDownCards('opponent')
                .filter(c => !disallowedIds.includes(c.id));
            if (ownFaceDown.length > 0) {
                // Pick lowest actual value (we know it since it's our card)
                ownFaceDown.sort((a, b) => a.value - b.value);
                return { type: 'deleteCard', cardId: ownFaceDown[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_low_value_card_to_delete': {
            // SMART: Prioritize opponent's (player's) low value cards
            // Even low value cards contribute to their lane - remove them!
            const scoredTargets: { cardId: string; score: number }[] = [];

            for (const p of ['player', 'opponent'] as Player[]) {
                for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                    const lane = state[p].lanes[laneIdx];
                    if (lane.length > 0) {
                        const card = lane[lane.length - 1];
                        if (card.isFaceUp && (card.value === 0 || card.value === 1)) {
                            const isOpponentCard = p === 'player';
                            // Score: opponent cards get bonus, higher lane value = more impact
                            const laneValue = state[p].laneValues[laneIdx];
                            const score = isOpponentCard ? 100 + laneValue : -laneValue;
                            scoredTargets.push({ cardId: card.id, score });
                        }
                    }
                }
            }

            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        // REMOVED: select_own_highest_card_to_delete_for_hate_2 - Hate-2 now uses generic select_cards_to_delete with calculation: highest_value

        case 'select_opponent_face_up_card_to_flip': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const opponentUncoveredFaceUp = getUncovered('player').filter(c => c.isFaceUp);

            if (opponentUncoveredFaceUp.length > 0) {
                // Easy AI: Pick the highest value one to flip down.
                opponentUncoveredFaceUp.sort((a, b) => b.value - a.value);
                return { type: 'flipCard', cardId: opponentUncoveredFaceUp[0].id };
            }

            // If no valid targets, which shouldn't happen if the action was generated correctly, skip.
            return { type: 'skip' };
        }

        // REMOVED: select_face_down_card_to_reveal_for_light_2 - Light-2 now uses select_board_card_to_reveal_custom

        // REMOVED: select_any_other_card_to_flip_for_water_0 - Water-0 now uses generic select_card_to_flip
        // REMOVED: select_card_to_flip_for_light_0 - Light-0 now uses generic select_card_to_flip
        case 'select_covered_card_in_line_to_flip_optional': {
            const isOptional = 'optional' in action && action.optional;
            const cannotTargetSelfTypes: ActionRequired['type'][] = ['select_any_other_card_to_flip', 'select_any_other_card_to_flip_for_water_0'];
            const canTargetSelf = !cannotTargetSelfTypes.includes(action.type);
            const requiresFaceDown = false; // None of these specific cases require face-down only

            // Special case for Darkness-2: "flip 1 covered card in this line."
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const aiLane = state.opponent.lanes[laneIndex];
                const playerLane = state.player.lanes[laneIndex];

                // Get covered cards (not the top card)
                const aiCovered = aiLane.filter((c, i, arr) => i < arr.length - 1);
                const playerCovered = playerLane.filter((c, i, arr) => i < arr.length - 1);

                // Calculate current lane value for AI
                const currentAiLaneValue = state.opponent.laneValues[laneIndex];
                const aiNotCompiled = !state.opponent.compiled[laneIndex];

                // PRIORITY 1: Check if flipping own covered card could lead to compile (value >= 10)
                // Check BOTH face-up AND face-down covered cards!
                if (aiNotCompiled) {
                    let bestCompileFlip: { card: PlayedCard; newValue: number; gain: number } | null = null;
                    let bestGainFlip: { card: PlayedCard; gain: number; newValue: number } | null = null;

                    for (const card of aiCovered) {
                        let currentValue: number;
                        let flippedValue: number;

                        if (card.isFaceUp) {
                            // Face-up -> Face-down: current = card.value, flipped = 2
                            currentValue = card.value;
                            flippedValue = 2;
                        } else {
                            // Face-down -> Face-up: current = effective face-down value, flipped = card.value
                            currentValue = getEffectiveCardValue(card, aiLane, state, laneIndex, 'opponent');
                            flippedValue = card.value;
                        }

                        const gain = flippedValue - currentValue;
                        const potentialValue = currentAiLaneValue + gain;

                        // Check if this enables compile
                        if (gain > 0 && potentialValue >= 10) {
                            if (!bestCompileFlip || potentialValue > bestCompileFlip.newValue) {
                                bestCompileFlip = { card, newValue: potentialValue, gain };
                            }
                        }

                        // Track best value gain (only if gain > 0)
                        if (gain > 0 && (!bestGainFlip || gain > bestGainFlip.gain)) {
                            bestGainFlip = { card, gain, newValue: potentialValue };
                        }
                    }

                    // If we can compile, do it!
                    if (bestCompileFlip) {
                        return { type: 'flipCard', cardId: bestCompileFlip.card.id };
                    }

                    // If we can gain value and get closer to compile, do it
                    if (bestGainFlip && bestGainFlip.gain > 0) {
                        return { type: 'flipCard', cardId: bestGainFlip.card.id };
                    }
                }

                // Also check even if compiled - we might still want to gain value for control
                if (state.opponent.compiled[laneIndex]) {
                    let bestGainFlip: { card: PlayedCard; gain: number } | null = null;

                    for (const card of aiCovered) {
                        const currentValue = card.isFaceUp ? card.value : getEffectiveCardValue(card, aiLane, state, laneIndex, 'opponent');
                        const flippedValue = card.isFaceUp ? 2 : card.value;
                        const gain = flippedValue - currentValue;

                        if (gain > 0 && (!bestGainFlip || gain > bestGainFlip.gain)) {
                            bestGainFlip = { card, gain };
                        }
                    }

                    if (bestGainFlip) {
                        return { type: 'flipCard', cardId: bestGainFlip.card.id };
                    }
                }

                // PRIORITY 2: Flip player's face-up covered card to reduce their value
                const playerFaceUpCovered = playerCovered.filter(c => c.isFaceUp);
                if (playerFaceUpCovered.length > 0) {
                    // Pick highest value to maximize damage
                    playerFaceUpCovered.sort((a, b) => b.value - a.value);
                    return { type: 'flipCard', cardId: playerFaceUpCovered[0].id };
                }

                // PRIORITY 3: Flip own face-down covered card (only if we gain value)
                // Must compare face-up value vs current face-down value (which may be 4 due to Darkness-2)
                const aiFaceDownCoveredWithGain = aiCovered
                    .filter(c => !c.isFaceUp)
                    .map(c => ({
                        card: c,
                        gain: c.value - getEffectiveCardValue(c, aiLane, state, laneIndex, 'opponent')
                    }))
                    .filter(x => x.gain > 0)
                    .sort((a, b) => b.gain - a.gain);

                if (aiFaceDownCoveredWithGain.length > 0) {
                    return { type: 'flipCard', cardId: aiFaceDownCoveredWithGain[0].card.id };
                }

                // PRIORITY 4: Flip player's face-down covered card (reveals info, no value change)
                const playerFaceDownCovered = playerCovered.filter(c => !c.isFaceUp);
                if (playerFaceDownCovered.length > 0) {
                    return { type: 'flipCard', cardId: playerFaceDownCovered[0].id };
                }

                // No good targets - skip optional effect
                return { type: 'skip' };
            }

            // FIX: Only target uncovered cards for standard flip effects.
            const getUncovered = (player: Player): PlayedCard[] => {
                return state[player].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null);
            };

            const allUncoveredPlayer = getUncovered('player');
            const allUncoveredOpponent = getUncovered('opponent');

            // Priority 1: Flip PLAYER's (opponent's) highest-value face-up card to weaken them.
            if (!requiresFaceDown) {
                const opponentFaceUp = allUncoveredPlayer.filter(c => c.isFaceUp).sort((a,b) => b.value - a.value);
                if (opponentFaceUp.length > 0) return { type: 'flipCard', cardId: opponentFaceUp[0].id };
            }

            // Priority 2: Flip OWN face-down card to face-up to get points on the board (strengthens us).
            const ownFaceDown = allUncoveredOpponent.filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) return { type: 'flipCard', cardId: ownFaceDown[0].id };

            // Priority 3: Flip PLAYER's face-down card to see it.
            const opponentFaceDown = allUncoveredPlayer.filter(c => !c.isFaceUp);
            if (opponentFaceDown.length > 0) return { type: 'flipCard', cardId: opponentFaceDown[0].id };

            // Priority 4: Flip OWN face-up card (BAD move - only if compiled or mandatory).
            if (!requiresFaceDown) {
                const ownFaceUp = allUncoveredOpponent.filter(c => {
                    if (!c.isFaceUp) return false;
                    if (!canTargetSelf && c.id === action.sourceCardId) return false;
                    return true;
                });

                // Only flip own face-up if it's in a compiled lane (minimal damage)
                const compiledOwnFaceUp = ownFaceUp.filter(c => {
                    const laneIndex = state.opponent.lanes.findIndex(lane =>
                        lane.length > 0 && lane[lane.length - 1].id === c.id
                    );
                    return laneIndex !== -1 && state.opponent.compiled[laneIndex];
                });

                if (compiledOwnFaceUp.length > 0) {
                    if (!isOptional) return { type: 'flipCard', cardId: compiledOwnFaceUp[0].id };
                }

                // Last resort: flip any own face-up card if mandatory
                if (ownFaceUp.length > 0 && !isOptional) {
                    return { type: 'flipCard', cardId: ownFaceUp[0].id };
                }
            }

            // If we reach here, no valid targets were found or it was an optional bad move.
            return { type: 'skip' };
        }

        case 'shift_flipped_card_optional': {
            // Darkness-1, Spirit-3: Shift the flipped card to another lane
            const cardId = (action as any).cardId;
            const isOptional = (action as any).optional;
            const cardInfo = findCardOnBoard(state, cardId);
            if (!cardInfo) {
                return { type: 'skip' };
            }

            const shiftingCard = cardInfo.card;
            const cardOwner = cardInfo.owner;
            const cardValue = shiftingCard.isFaceUp ? shiftingCard.value : 2;

            // Use laneIndex from findCardOnBoard if available
            let originalLaneIndex = cardInfo.laneIndex ?? -1;
            if (originalLaneIndex === -1) {
                const ownerState = state[cardOwner];
                for (let i = 0; i < ownerState.lanes.length; i++) {
                    if (ownerState.lanes[i].some(c => c.id === cardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
            }

            if (originalLaneIndex === -1) return { type: 'skip' };

            const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
            if (possibleLanes.length === 0) return { type: 'skip' };

            // STRATEGIC: Evaluate whether shifting is beneficial
            const aiState = state.opponent;
            const playerState = state.player;
            const currentLaneValue = aiState.laneValues[originalLaneIndex];
            const currentLaneCompiled = aiState.compiled[originalLaneIndex];
            const playerCurrentLaneValue = playerState.laneValues[originalLaneIndex];

            // Calculate value AFTER removing this card from current lane
            const valueAfterLeaving = currentLaneValue - cardValue;

            // Score each possible destination
            let bestLane = -1;
            let bestScore = -Infinity;
            const stayScore = 0; // Baseline: staying is neutral

            for (const targetLane of possibleLanes) {
                const targetLaneValue = aiState.laneValues[targetLane];
                const targetLaneCompiled = aiState.compiled[targetLane];
                const playerTargetValue = playerState.laneValues[targetLane];
                const valueAfterArriving = targetLaneValue + cardValue;

                let score = 0;

                // CRITICAL: Don't shift away from a lane that's close to compiling!
                // If current lane is >=8 and not compiled, we're close to 10 - DON'T LEAVE
                if (!currentLaneCompiled && currentLaneValue >= 8 && currentLaneValue > playerCurrentLaneValue) {
                    score -= 100; // Heavy penalty for leaving a near-compilable lane
                }

                // Bonus for moving TO a lane that becomes compilable (>=10 and beating opponent)
                if (!targetLaneCompiled && valueAfterArriving >= 10 && valueAfterArriving > playerTargetValue) {
                    score += 80;
                }

                // Bonus for moving to uncompiled lanes that need help
                if (!targetLaneCompiled && targetLaneValue < currentLaneValue) {
                    // Only if we're not sabotaging our current strong position
                    if (currentLaneCompiled || currentLaneValue < 6) {
                        score += 20;
                    }
                }

                // Penalty for moving to already-compiled lanes (wasted value)
                if (targetLaneCompiled) {
                    score -= 30;
                }

                // Bonus if target lane is contested and we'd take the lead
                if (!targetLaneCompiled && targetLaneValue <= playerTargetValue && valueAfterArriving > playerTargetValue) {
                    score += 25;
                }

                // Penalty if leaving makes us lose a contested lane
                if (!currentLaneCompiled && currentLaneValue > playerCurrentLaneValue && valueAfterLeaving <= playerCurrentLaneValue) {
                    score -= 40;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestLane = targetLane;
                }
            }

            // If optional and no good move, skip
            if (isOptional && bestScore < stayScore) {
                return { type: 'skip' };
            }

            // If we found a lane (even if score is bad, we might be forced)
            if (bestLane !== -1) {
                return { type: 'selectLane', laneIndex: bestLane };
            }

            // Fallback: skip if optional, otherwise pick first available
            if (isOptional) {
                return { type: 'skip' };
            }
            return { type: 'selectLane', laneIndex: possibleLanes[0] };
        }

        case 'select_lane_to_shift_revealed_card_for_light_2':
        case 'select_lane_to_shift_revealed_card': {
            // Light-2: Shift the revealed card to another lane
            const revealedCardId = (action as any).revealedCardId;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'selectLane', laneIndex: 0 };

            // Find the lane index of the card
            let cardLaneIndex = -1;
            for (let i = 0; i < state[cardInfo.owner].lanes.length; i++) {
                if (state[cardInfo.owner].lanes[i].some(c => c.id === revealedCardId)) {
                    cardLaneIndex = i;
                    break;
                }
            }

            // Pick lane to shift to (not the same lane)
            const possibleLanes = [0, 1, 2].filter(l => l !== cardLaneIndex);
            if (possibleLanes.length > 0) {
                // Normal AI: pick strategic lane based on card owner
                if (cardInfo.owner === 'opponent') {
                    // AI's card - shift to lane where it helps us most
                    possibleLanes.sort((a, b) => {
                        const aValue = state.opponent.laneValues[a];
                        const bValue = state.opponent.laneValues[b];
                        // Prefer lanes closer to compile (but not compiled)
                        if (!state.opponent.compiled[a] && state.opponent.compiled[b]) return -1;
                        if (state.opponent.compiled[a] && !state.opponent.compiled[b]) return 1;
                        return bValue - aValue; // Higher value = better
                    });
                } else {
                    // Player's card - shift to disrupt them (lowest value lane)
                    possibleLanes.sort((a, b) => state.player.laneValues[a] - state.player.laneValues[b]);
                }
                return { type: 'selectLane', laneIndex: possibleLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_opponent_face_down_card_to_shift': { // Speed-4
            // SMART: Pick opponent's face-down card from their strongest lane
            // Shifting it away disrupts their best lane
            const scoredTargets: { cardId: string; laneValue: number }[] = [];
            for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                const lane = state.player.lanes[laneIdx];
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        const laneValue = state.player.laneValues[laneIdx];
                        scoredTargets.push({ cardId: topCard.id, laneValue });
                    }
                }
            }

            if (scoredTargets.length > 0) {
                // Pick from highest value lane (most disruptive)
                scoredTargets.sort((a, b) => b.laneValue - a.laneValue);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }

            return { type: 'skip' };
        }

        // REMOVED: select_own_card_to_shift_for_speed_3 - Speed-3 now uses generic select_card_to_shift

        case 'select_opponent_covered_card_to_shift': {
            // SMART: Pick highest value covered card from opponent's strongest lane
            const scoredTargets: { cardId: string; score: number }[] = [];
            for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                const lane = state.player.lanes[laneIdx];
                const laneValue = state.player.laneValues[laneIdx];
                // Covered cards are all except the last one
                for (let i = 0; i < lane.length - 1; i++) {
                    const card = lane[i];
                    const cardValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
                    // Higher card value + higher lane value = more disruption
                    scoredTargets.push({ cardId: card.id, score: cardValue + laneValue });
                }
            }
            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        case 'select_own_covered_card_to_shift': {
            // SMART: Pick own covered card that could help us compile elsewhere
            // Prefer high-value cards from weak lanes that could strengthen other lanes
            const scoredTargets: { cardId: string; score: number }[] = [];
            for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                const lane = state.opponent.lanes[laneIdx];
                const laneValue = state.opponent.laneValues[laneIdx];
                // Covered cards are all except the last one
                for (let i = 0; i < lane.length - 1; i++) {
                    const card = lane[i];
                    const cardValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
                    // High-value cards in low-value lanes are good candidates
                    // They could help another lane compile
                    const score = cardValue - laneValue * 0.5; // Prefer cards from weaker lanes
                    scoredTargets.push({ cardId: card.id, score });
                }
            }
            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_flip': {
            // Generic flip handler for custom protocols
            // Uses targetFilter from action to determine valid targets
            const targetFilter = ((action as any).targetFilter || {}) as TargetFilter;
            // CRITICAL: Check restrictedLaneIndex, currentLaneIndex AND laneIndex
            // Mirror-3: sameLaneAsFirst sets restrictedLaneIndex directly
            const restrictedLaneIndex = (action as any).restrictedLaneIndex ?? (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const scope = (action as any).scope;
            const cardOwner = action.actor; // Who owns the source card (whose "opponent" we target)
            const sourceCardId = action.sourceCardId;
            const positionFilter = targetFilter?.position || 'uncovered';
            const validTargets: { card: PlayedCard; owner: Player; laneIndex: number }[] = [];

            // Log for debugging
            if (restrictedLaneIndex !== undefined || scope === 'this_lane') {
            }

            for (const playerKey of ['player', 'opponent'] as const) {
                // CRITICAL: owner filter is relative to cardOwner, NOT hardcoded to 'opponent'
                // 'own' = cards belonging to cardOwner
                // 'opponent' = cards belonging to the opponent OF cardOwner
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    // CRITICAL: If lane is restricted (this_lane scope), only check that lane!
                    if (restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;
                    if (scope === 'this_lane' && restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];

                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];

                        // CRITICAL: Exclude committed card (card being played that triggered on_cover)
                        if (isCardCommitted(state, card.id)) continue;

                        // CRITICAL: Use central helper for uncovered calculation
                        const isTopCard = isCardAtIndexUncovered(state, lane, i);

                        // Use centralized filter matching (includes valueRange, valueEquals, etc.)
                        if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;

                        // Additional position check for 'covered_in_this_line'
                        if ((targetFilter as any).position === 'covered_in_this_line' && isTopCard) continue;

                        // NEW: Check valueMinGreaterThanHandSize - target must have value > hand size
                        if (targetFilter.valueMinGreaterThanHandSize) {
                            const handSize = state[cardOwner].hand.length;
                            if (card.value <= handSize) continue;
                        }

                        // NEW: Check valueLessThanUniqueProtocolsOnField - target must have value < unique protocols
                        // Diversity-4: "Flip 1 card with a value less than the number of different protocols on cards in the field"
                        if (targetFilter.valueLessThanUniqueProtocolsOnField) {
                            const threshold = countUniqueProtocolsOnField(state);
                            if (card.value >= threshold) continue;
                        }

                        validTargets.push({ card, owner: playerKey, laneIndex: laneIdx });
                    }
                }
            }

            if (validTargets.length === 0) return { type: 'skip' };

            // Normal AI: Score targets strategically
            const scored = validTargets.map(({ card, owner, laneIndex }) => {
                let score = 0;
                const laneValue = state[owner].laneValues[laneIndex];
                const isCompiled = state[owner].compiled[laneIndex];

                // Calculate actual value change from flipping
                const currentValue = card.isFaceUp ? card.value : 2; // face-down = 2
                const flippedValue = card.isFaceUp ? 2 : card.value; // face-up shows real value
                const valueChange = flippedValue - currentValue;

                if (owner === 'player') {
                    // Flipping PLAYER's cards - we want to HURT them
                    if (card.isFaceUp) {
                        // Face-up -> Face-down: Good if they LOSE value (high value card)
                        // valueChange is negative for high value cards (e.g., 5 -> 2 = -3)
                        score = -valueChange * 15; // Higher score when valueChange is more negative
                        score += getCardThreat(card, 'player', state);
                    } else {
                        // Face-down -> Face-up: Risky, might help them
                        // Only good if their card has value 0 or 1 (we'd increase their value!)
                        if (card.value <= 1) {
                            score = 20; // Good - their face-down 2 becomes face-up 0/1
                        } else {
                            score = -30; // Bad - helps them gain value
                        }
                    }
                } else {
                    // Flipping OWN cards - we want to HELP ourselves
                    if (card.isFaceUp) {
                        // Face-up -> Face-down: GOOD if we GAIN value!
                        // e.g., face-up 0 -> face-down 2 = +2 value! GREAT!
                        // e.g., face-up 5 -> face-down 2 = -3 value. BAD!
                        if (valueChange > 0) {
                            // We GAIN value by flipping to face-down!
                            score = valueChange * 20 + 50;
                            // BONUS: Check if this enables compile
                            if (!isCompiled && laneValue + valueChange >= 10) {
                                score += 200; // Huge bonus for enabling compile!
                            }
                        } else {
                            // We LOSE value - bad choice
                            score = valueChange * 15 - 30;
                        }
                    } else {
                        // Face-down -> Face-up: GOOD if we gain value (card.value > 2)
                        if (valueChange > 0) {
                            score = valueChange * 20 + 40;
                            // BONUS: Check if this enables compile
                            if (!isCompiled && laneValue + valueChange >= 10) {
                                score += 200;
                            }
                        } else {
                            // card.value <= 2, no gain or loss
                            score = -10;
                        }
                    }
                }

                return { card, score };
            });

            scored.sort((a, b) => b.score - a.score);

            // 5% chance to make suboptimal choice
            if (shouldMakeMistake() && scored.length > 1) {
                const randomIdx = Math.floor(Math.random() * scored.length);
                return { type: 'flipCard', cardId: scored[randomIdx].card.id };
            }

            return { type: 'flipCard', cardId: scored[0].card.id };
        }

        case 'select_card_to_shift': {
            // SMART: Generic shift for custom protocols
            const targetFilter = ((action as any).targetFilter || {}) as TargetFilter;
            const scope = (action as any).scope;
            const destinationRestriction = (action as any).destinationRestriction;
            const targetLaneIndex = (action as any).targetLaneIndex; // Fixed destination (Gravity-4, etc.)
            const restrictedLaneIndex = scope === 'this_lane'
                ? ((action as any).sourceLaneIndex ?? (action as any).currentLaneIndex ?? (action as any).laneIndex)
                : undefined;
            const cardOwner = action.actor;
            const sourceCardId = action.sourceCardId;
            const scoredTargets: { cardId: string; score: number }[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    // Scope restriction (Fear-3: only this lane)
                    if (restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;

                    // CRITICAL: For 'to_this_lane' (Gravity-4), card must be FROM ANOTHER lane
                    // Cannot shift a card from the destination lane to itself
                    if (destinationRestriction?.type === 'to_this_lane' && targetLaneIndex !== undefined) {
                        if (laneIdx === targetLaneIndex) continue; // Skip cards in destination lane
                    }

                    const lane = state[playerKey].lanes[laneIdx];
                    const laneValue = state[playerKey].laneValues[laneIdx];

                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];
                        const isTopCard = i === lane.length - 1;

                        if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;

                        const cardValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
                        const isOpponentCard = playerKey === 'player'; // AI is 'opponent'

                        // Score: For opponent cards, higher value in stronger lane = better target
                        // For own cards, high value in weak lane = good to redistribute
                        let score: number;
                        if (isOpponentCard) {
                            score = cardValue + laneValue; // Disrupt opponent's strong lanes
                        } else {
                            score = cardValue - laneValue * 0.5; // Move high cards from weak lanes
                        }
                        scoredTargets.push({ cardId: card.id, score });
                    }
                }
            }

            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'shiftCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        // Custom Protocol: Board card reveal (similar to Light-2)
        case 'select_board_card_to_reveal_custom': {
            // Find face-down uncovered cards, prefer opponent's
            const validTargets: { card: PlayedCard; owner: Player }[] = [];
            for (const playerKey of ['player', 'opponent'] as const) {
                for (const lane of state[playerKey].lanes) {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (!topCard.isFaceUp) {
                            validTargets.push({ card: topCard, owner: playerKey });
                        }
                    }
                }
            }
            if (validTargets.length > 0) {
                // Normal AI: prefer opponent's face-down cards
                const opponentTargets = validTargets.filter(t => t.owner === 'player');
                if (opponentTargets.length > 0) {
                    return { type: 'deleteCard', cardId: opponentTargets[0].card.id };
                }
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'prompt_shift_or_flip_board_card_custom': {
            // Smart AI: Evaluate flip vs shift strategically
            const { revealedCardId } = action as any;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'resolveRevealBoardCardPrompt', choice: 'skip' };

            const card = cardInfo.card;
            const isOurCard = cardInfo.owner === 'opponent';  // AI is 'opponent'

            // Calculate flip value change
            const currentValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
            const flippedValue = card.isFaceUp ? Math.min(card.value, 2) : card.value;
            const flipValueChange = flippedValue - currentValue;

            // Score flip option
            let flipScore = 0;
            if (isOurCard) {
                // Our card: positive change is good (face-down to face-up gains value)
                flipScore = flipValueChange * 20;
            } else {
                // Opponent card: negative change is good (reduce their value)
                flipScore = -flipValueChange * 20;
            }

            // Score shift option - evaluate best/worst lane outcomes
            let shiftScore = -50;  // Default: shifting is risky
            const cardValue = card.isFaceUp ? card.value : Math.min(card.value, 2);

            if (isOurCard) {
                // Shifting our card: find lane where it helps us most
                for (let i = 0; i < 3; i++) {
                    const ourLane = state.opponent.laneValues[i];
                    const theirLane = state.player.laneValues[i];
                    const newValue = ourLane + cardValue;
                    if (newValue >= 10 && newValue > theirLane) {
                        shiftScore = Math.max(shiftScore, 100);  // Compile opportunity!
                    } else if (newValue > theirLane) {
                        shiftScore = Math.max(shiftScore, 20);  // Lane lead
                    }
                }
            } else {
                // Shifting opponent card: find lane where it hurts them least
                for (let i = 0; i < 3; i++) {
                    const theirLane = state.player.laneValues[i];
                    const newTheirValue = theirLane + cardValue;
                    if (newTheirValue >= 10) {
                        // BAD: This would let them compile!
                        shiftScore = Math.min(shiftScore, -100);
                    }
                }
            }

            // Choose better option
            if (flipScore >= shiftScore) {
                return { type: 'resolveRevealBoardCardPrompt', choice: 'flip' };
            } else {
                return { type: 'resolveRevealBoardCardPrompt', choice: 'shift' };
            }
        }

        case 'select_lane_to_shift_revealed_board_card_custom': {
            // Smart AI: pick lane strategically based on card owner
            const shiftCardId = (action as any).cardToShiftId;
            const cardInfo = findCardOnBoard(state, shiftCardId);
            if (!cardInfo) return { type: 'selectLane', laneIndex: 0 };

            const card = cardInfo.card;
            const cardValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
            const isOurCard = cardInfo.owner === 'opponent';

            let bestLane = 0;
            let bestScore = -1000;

            for (let i = 0; i < 3; i++) {
                let score = 0;
                if (isOurCard) {
                    // Our card: maximize our advantage
                    const newOurValue = state.opponent.laneValues[i] + cardValue;
                    const theirValue = state.player.laneValues[i];
                    if (newOurValue >= 10 && newOurValue > theirValue) {
                        score = 200;  // Compile!
                    } else {
                        score = newOurValue - theirValue;
                    }
                } else {
                    // Opponent card: minimize their gain, avoid helping them compile
                    const newTheirValue = state.player.laneValues[i] + cardValue;
                    const ourValue = state.opponent.laneValues[i];
                    if (newTheirValue >= 10 && newTheirValue > ourValue) {
                        score = -200;  // They would compile - AVOID!
                    } else {
                        score = ourValue - newTheirValue;  // Prefer lanes where we lead
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestLane = i;
                }
            }

            return { type: 'selectLane', laneIndex: bestLane };
        }

        case 'gravity_2_shift_after_flip': {
            // Gravity-2: Shift the flipped card to target lane
            const { targetLaneIndex } = action as any;
            return { type: 'selectLane', laneIndex: targetLaneIndex };
        }

        // GENERIC: Handle all flip_self variations (Water-0, Psychic-4, Speed-3, custom protocols)
        case 'flip_self':
        case 'flip_self_for_water_0':
        case 'flip_self_for_psychic_4':
        case 'speed_3_self_flip_after_shift': {
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        case 'anarchy_0_conditional_draw': {
            // Anarchy-0: This is automatic, no AI decision needed
            return { type: 'skip' };
        }

        case 'select_any_opponent_card_to_shift': {
            // SMART: Pick highest value opponent card from their strongest lane
            const scoredTargets: { cardId: string; score: number }[] = [];
            for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                const lane = state.player.lanes[laneIdx];
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    const cardValue = topCard.isFaceUp ? topCard.value : Math.min(topCard.value, 2);
                    const laneValue = state.player.laneValues[laneIdx];
                    // Higher value card in stronger lane = more disruptive to shift
                    scoredTargets.push({ cardId: topCard.id, score: cardValue + laneValue });
                }
            }
            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        case 'select_own_other_card_to_shift': {
            // SMART: Pick own card that could benefit from repositioning
            // Prefer high-value cards in weak lanes
            const scoredTargets: { cardId: string; score: number }[] = [];
            for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                const lane = state.opponent.lanes[laneIdx];
                const laneValue = state.opponent.laneValues[laneIdx];
                for (const card of lane) {
                    if (card.id === action.sourceCardId) continue;
                    const cardValue = card.isFaceUp ? card.value : Math.min(card.value, 2);
                    // High-value cards in weak lanes are good candidates to move
                    scoredTargets.push({ cardId: card.id, score: cardValue - laneValue * 0.5 });
                }
            }
            if (scoredTargets.length > 0) {
                scoredTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scoredTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        case 'select_own_face_up_covered_card_to_flip':
            // Easy AI doesn't bother with this complex optional move.
            return { type: 'skip' };

        // REMOVED: prompt_shift_or_flip_for_light_2 - Light-2 now uses prompt_shift_or_flip_board_card_custom

        case 'plague_4_opponent_delete': {
            // Plague-4: Opponent (AI) must delete their OWN uncovered face-down card
            // IMPORTANT: Only UNCOVERED (top) cards can be deleted, not covered ones!
            const ownFaceDownUncovered: PlayedCard[] = [];
            state.opponent.lanes.forEach((lane) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1]; // UNCOVERED card
                    if (!topCard.isFaceUp) {
                        ownFaceDownUncovered.push(topCard);
                    }
                }
            });

            if (ownFaceDownUncovered.length > 0) {
                // Delete lowest value face-down UNCOVERED card (minimize loss)
                ownFaceDownUncovered.sort((a, b) => a.value - b.value);
                return { type: 'deleteCard', cardId: ownFaceDownUncovered[0].id };
            }
            return { type: 'skip' };
        }

        // flip_self_for_water_0 is handled by the generic flip_self case above

        case 'reveal_opponent_hand':
        case 'plague_2_player_discard':
        case 'delete_self': {
            // These actions don't require AI decisions - handled automatically
            return { type: 'skip' };
        }

        // ========== TIME PROTOCOL - Trash selection handlers ==========

        // Time-0: Select a card from trash to play
        case 'select_card_from_trash_to_play': {
            const trashCards = state.opponent.discard;
            if (trashCards.length === 0) {
                return { type: 'skip' };
            }

            // Normal AI: Pick highest value card from trash that would help compile
            const sortedTrash = [...trashCards]
                .map((card, index) => {
                    let score = card.value * 10; // Base score from value

                    // Bonus for cards that could help compile
                    for (let i = 0; i < 3; i++) {
                        if (state.opponent.compiled[i]) continue;
                        const valueAfter = state.opponent.laneValues[i] + card.value;
                        if (valueAfter >= 10 && valueAfter > state.player.laneValues[i]) {
                            score += 100; // Can compile with this card
                        }
                    }

                    // Bonus for cards with useful effects
                    if (card.keywords?.flip) score += 5;
                    if (card.keywords?.draw) score += 3;
                    if (card.keywords?.delete) score += 5;

                    return { card, index, score };
                })
                .sort((a, b) => b.score - a.score);

            return { type: 'selectTrashCard', cardIndex: sortedTrash[0].index };
        }

        // Time-3: Select a card from trash to reveal (then play face-down)
        case 'select_card_from_trash_to_reveal': {
            const trashCards = state.opponent.discard;
            if (trashCards.length === 0) {
                return { type: 'skip' };
            }

            // Normal AI: Prefer high-value cards for face-down play (more points)
            const sortedTrash = [...trashCards]
                .map((card, index) => ({ card, index, value: card.value }))
                .sort((a, b) => b.value - a.value);

            return { type: 'selectTrashCard', cardIndex: sortedTrash[0].index };
        }

        // ========== ADDITIONAL HANDLERS FOR CUSTOM PROTOCOLS ==========

        case 'select_lane_for_delete': {
            // Generic lane selection for delete effects
            // CRITICAL: Calculate NET benefit (player loss - own loss) based on valueFilter
            const validLanes = (action as any).validLanes || [0, 1, 2];
            const valueFilter = (action as any).valueFilter; // e.g., { min: 0, max: 2 } for Death-2

            const scoredLanes = validLanes.map((i: number) => {
                let playerLoss = 0;
                let ownLoss = 0;

                // Count player's cards that would be deleted
                for (const card of state.player.lanes[i]) {
                    const cardValue = card.isFaceUp ? card.value : 2; // Estimate face-down as 2
                    // Check if card matches value filter (if specified)
                    if (valueFilter) {
                        if (card.isFaceUp) {
                            if (card.value >= valueFilter.min && card.value <= valueFilter.max) {
                                playerLoss += cardValue + 1; // +1 bonus for removing a card
                            }
                        } else {
                            // Face-down: estimate 50% chance of matching
                            playerLoss += (cardValue + 1) * 0.5;
                        }
                    } else {
                        playerLoss += cardValue + 1;
                    }
                }

                // Count AI's own cards that would be deleted
                for (const card of state.opponent.lanes[i]) {
                    const cardValue = card.isFaceUp ? card.value : 2;
                    if (valueFilter) {
                        if (card.isFaceUp) {
                            if (card.value >= valueFilter.min && card.value <= valueFilter.max) {
                                ownLoss += cardValue + 3; // +3 penalty for losing own card
                            }
                        } else {
                            ownLoss += (cardValue + 3) * 0.5;
                        }
                    } else {
                        ownLoss += cardValue + 3;
                    }
                }

                // NET score: positive means good for AI, negative means bad
                return { laneIndex: i, score: playerLoss - ownLoss };
            });

            scoredLanes.sort((a: any, b: any) => b.score - a.score);

            // Only select lane if it has positive net benefit, otherwise skip
            if (scoredLanes[0].score > 0) {
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }

            // All lanes would hurt AI more than player - this shouldn't happen if validLanes is correct
            // But just in case, pick the least bad option
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_lane_for_shift_all': {
            // Light-3 uses validDestinationLanes, not validLanes
            const validLanes = (action as any).validDestinationLanes || (action as any).validLanes || [0, 1, 2];
            const sourceLane = (action as any).sourceLaneIndex;
            // Filter out the source lane (can't shift to same lane)
            const filteredLanes = validLanes.filter((i: number) => i !== sourceLane);

            if (filteredLanes.length > 0) {
                // Normal AI: Score lanes to pick best destination
                const scoredLanes = filteredLanes.map((laneIndex: number) => {
                    let score = 0;
                    // Prefer lanes where we already have cards (building up)
                    score += state.opponent.lanes[laneIndex].length * 2;
                    // Prefer lanes closer to compile
                    score += state.opponent.laneValues[laneIndex];
                    // Avoid lanes where player is close to compile
                    if (state.player.laneValues[laneIndex] >= 8) {
                        score -= 5;
                    }
                    return { laneIndex, score };
                });
                scoredLanes.sort((a: any, b: any) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
            // Fallback
            if (validLanes.length > 0) {
                return { type: 'selectLane', laneIndex: validLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'prompt_optional_draw': {
            // SMART: Optional draw - usually accept, but consider hand size
            // Drawing is almost always beneficial, but decline if hand is very full
            const handSize = state.opponent.hand.length;
            if (handSize >= 6) {
                // Hand is very full - decline to avoid potential issues
                return { type: 'resolveOptionalEffectPrompt', accept: false };
            }
            return { type: 'resolveOptionalEffectPrompt', accept: true };
        }

        case 'prompt_optional_discard_custom': {
            // Optional discard - Normal AI accepts if hand is full
            return { type: 'resolveOptionalEffectPrompt', accept: state.opponent.hand.length > 4 };
        }

        // Clarity-4: "You may shuffle your trash into your deck"
        // Smarter strategy: Shuffle if we have valuable cards in trash (3+ value)
        case 'prompt_optional_shuffle_trash': {
            const trashCount = (action as any).trashCount || 0;
            // Always shuffle if we have cards in trash - getting more options is good
            return { type: 'resolvePrompt', accept: trashCount > 0 };
        }

        // Clarity-2/3: "Draw 1 card with a value of X revealed this way."
        // Smarter strategy: Pick randomly from selectable cards (they're all same value anyway)
        case 'select_card_from_revealed_deck': {
            const selectableCardIds = (action as any).selectableCardIds || [];
            if (selectableCardIds.length > 0) {
                // Pick a random one since they all have the same value
                const randomIndex = Math.floor(Math.random() * selectableCardIds.length);
                return { type: 'selectRevealedDeckCard', cardId: selectableCardIds[randomIndex] };
            }
            // No valid selection - skip
            return { type: 'resolvePrompt', accept: false };
        }

        // Unity-4: "Reveal deck, draw all Unity cards, shuffle"
        // Auto-confirm - all matching cards are drawn automatically
        case 'reveal_deck_draw_protocol': {
            return { type: 'confirmRevealDeckDrawProtocol' };
        }

        case 'custom_choice': {
            // Custom protocol choice between two options
            // Normal AI: prefer options that benefit it
            const { options } = action as any;
            if (!options || options.length !== 2) {
                return { type: 'resolveCustomChoice', optionIndex: 0 };
            }

            // Simple heuristic: prefer draw, avoid discard
            const scoreOption = (option: any): number => {
                let score = 0;
                const actionType = option.action?.toLowerCase() || '';
                if (actionType.includes('draw')) score += 30;
                if (actionType.includes('discard')) score -= 20;
                if (actionType.includes('delete') && option.targetFilter?.owner === 'opponent') score += 40;
                if (actionType.includes('delete') && option.targetFilter?.owner === 'own') score -= 30;
                return score;
            };

            const score0 = scoreOption(options[0]);
            const score1 = scoreOption(options[1]);
            return { type: 'resolveCustomChoice', optionIndex: score0 >= score1 ? 0 : 1 };
        }

        // =========================================================================
        // SELECT PHASE EFFECT - Choose which Start/End effect to execute first
        // =========================================================================
        case 'select_phase_effect': {
            const phaseAction = action as {
                type: 'select_phase_effect';
                phase: 'Start' | 'End';
                availableEffects: Array<{ cardId: string; cardName: string; box: 'top' | 'bottom'; effectDescription: string }>;
            };

            if (phaseAction.availableEffects.length === 0) {
                return { type: 'skip' };
            }

            // Normal AI: Score each effect and pick the best one
            // For now, prioritize effects based on action type:
            // 1. Draw effects (card advantage)
            // 2. Delete effects (remove opponent cards)
            // 3. Shift effects (positioning)
            // 4. Flip effects
            // 5. Other

            const scoredEffects = phaseAction.availableEffects.map(effect => {
                let score = 0;
                const desc = effect.effectDescription.toLowerCase();

                if (desc.includes('draw')) score += 100;
                else if (desc.includes('delete')) score += 80;
                else if (desc.includes('shift')) score += 60;
                else if (desc.includes('flip')) score += 40;
                else score += 20;

                // Add some randomness (5% chance to pick suboptimally - reduced from 20%)
                if (Math.random() < 0.05) {
                    score = Math.random() * 50;
                }

                return { effect, score };
            });

            // Sort by score descending
            scoredEffects.sort((a, b) => b.score - a.score);

            const selectedEffect = scoredEffects[0].effect;

            return { type: 'flipCard', cardId: selectedEffect.cardId };
        }

        // =========================================================================
        // STATE NUMBER - Choose a number (0-5) for Luck-0 effect
        // =========================================================================
        case 'state_number': {
            // Normal AI: Pick a number based on likelihood of matching drawn cards
            // Look at the values of cards in our hand and deck to pick most common value
            const valueCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

            // Count values in hand
            state.opponent.hand.forEach(card => {
                if (card.value >= 0 && card.value <= 5) {
                    valueCounts[card.value]++;
                }
            });

            // Count values in deck (approximation - deck cards are unknown but AI knows its own protocols)
            // Weight towards middle values (2, 3) since they're most common statistically
            valueCounts[2] += 2;
            valueCounts[3] += 2;

            // Find the value with highest count
            let bestValue = 0;
            let bestCount = valueCounts[0];
            for (let i = 1; i <= 5; i++) {
                if (valueCounts[i] > bestCount) {
                    bestCount = valueCounts[i];
                    bestValue = i;
                }
            }

            // 5% chance to pick randomly for unpredictability (reduced from 20%)
            if (Math.random() < 0.05) {
                bestValue = Math.floor(Math.random() * 6);
            }

            return { type: 'stateNumber', number: bestValue };
        }

        // =========================================================================
        // STATE PROTOCOL - Choose a protocol from opponent's cards (Luck-3)
        // =========================================================================
        case 'state_protocol': {
            const protocolAction = action as any;
            const availableProtocols = protocolAction.availableProtocols || [];

            if (availableProtocols.length === 0) {
                return { type: 'skip' };
            }

            // Normal AI: Pick the protocol most likely to be in opponent's deck
            // Prioritize opponent's assigned protocols
            const opponentProtocols = state.player.protocols; // Player is the opponent from AI's perspective

            // Score each protocol - higher score for opponent's assigned protocols
            const scoredProtocols = availableProtocols.map((protocol: string) => {
                let score = 0;

                // Major bonus if it's one of opponent's assigned protocols
                if (opponentProtocols.includes(protocol)) {
                    score += 50;
                }

                // Add some randomness
                score += Math.random() * 20;

                return { protocol, score };
            });

            // Sort by score descending
            scoredProtocols.sort((a: any, b: any) => b.score - a.score);

            return { type: 'stateProtocol', protocol: scoredProtocols[0].protocol };
        }

        // =========================================================================
        // SELECT FROM DRAWN TO REVEAL - Choose which drawn card to reveal
        // =========================================================================
        case 'select_from_drawn_to_reveal': {
            const revealAction = action as any;
            const eligibleCardIds = revealAction.eligibleCardIds || [];

            if (eligibleCardIds.length === 0) {
                return { type: 'skip' };
            }

            // Normal AI: Pick the card that would be most valuable to play
            // Find the cards in hand and score them
            const hand = state.opponent.hand;
            const scoredCards = eligibleCardIds.map((cardId: string) => {
                const card = hand.find((c: any) => c.id === cardId);
                if (!card) return { cardId, score: 0 };

                let score = card.value; // Base score is the card value

                // Bonus for cards matching AI's protocols (easier to play)
                if (state.opponent.protocols.includes(card.protocol)) {
                    score += 10;
                }

                return { cardId, score };
            });

            // Sort by score descending
            scoredCards.sort((a: any, b: any) => b.score - a.score);

            return { type: 'selectFromDrawnToReveal', cardId: scoredCards[0].cardId };
        }

        // =========================================================================
        // CONFIRM DECK DISCARD - Acknowledge discarded card from top of deck
        // =========================================================================
        case 'confirm_deck_discard': {
            // AI just confirms/acknowledges the discarded card info
            return { type: 'confirmDeckDiscard' };
        }

        // =========================================================================
        // CONFIRM DECK PLAY PREVIEW - Acknowledge card from deck before playing
        // =========================================================================
        case 'confirm_deck_play_preview': {
            // AI just confirms and proceeds to lane selection
            return { type: 'confirmDeckPlayPreview' };
        }

        // Fallback for other actions - use simple random/first selection
        default: {
            // Generic handlers for unimplemented actions
            if ('optional' in action && action.optional) return { type: 'skip' };

            // If it's a card selection, try to find any valid card
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0 && (action.type.includes('select_') || action.type.includes('shift'))) {
                return { type: 'deleteCard', cardId: allCards[0].id };
            }

            return { type: 'skip' };
        }
    }
};

export const normalAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        // Compile highest value lane
        const bestLane = state.compilableLanes.reduce((best, lane) => {
            return state.opponent.laneValues[lane] > state.opponent.laneValues[best] ? lane : best;
        });
        return { type: 'compile', laneIndex: bestLane };
    }

    if (state.phase === 'action') {
        return getBestMove(state);
    }

    return { type: 'fillHand' };
};
