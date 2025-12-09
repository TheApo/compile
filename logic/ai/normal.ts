/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NORMAL AI - Plays like a human player
 * - Makes good strategic decisions
 * - No memory of revealed cards
 * - 20% chance to make suboptimal moves for realism
 * - Balanced between Easy and Hard
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { handleControlRearrange, canBenefitFromPlayerRearrange, canBenefitFromOwnRearrange } from './controlMechanicLogic';
import { isFrost1Active } from '../game/passiveRuleChecker';
import {
    canPlayCard,
    hasAnyProtocolPlayRule,
    hasRequireNonMatchingProtocolRule
} from '../game/passiveRuleChecker';
import {
    hasRequireFaceDownPlayRule,
    hasDeleteSelfOnCoverEffect,
    hasReturnOwnCardEffect,
    hasDeleteHighestOwnCardEffect,
    hasShiftToFromLaneEffect,
    hasShiftToNonMatchingProtocolEffect,
    getLaneFaceDownValueBoost,
    getTopCardDeleteSelfValue
} from './aiEffectUtils';

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

// Helper: Sometimes make suboptimal decisions (20% chance)
const shouldMakeMistake = (): boolean => Math.random() < 0.20;

// Helper: Add some randomness to scores for human-like play
const addNoise = (score: number): number => {
    return score + (Math.random() * 10 - 5); // ±5 noise
};

// Type for targetFilter with all possible options
type TargetFilter = {
    owner?: 'own' | 'opponent' | 'any';
    position?: 'uncovered' | 'covered' | 'any';
    faceState?: 'face_up' | 'face_down' | 'any';
    excludeSelf?: boolean;
    valueRange?: { min: number; max: number };
    valueEquals?: number;
    calculation?: 'highest_value' | 'lowest_value';
};

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
    const possibleMoves: ScoredMove[] = [];

    // Use generic passive rule check for "require face down play" rules (like Psychic-1)
    const playerHasRequireFaceDownRule = hasRequireFaceDownPlayRule(state, 'opponent');

    // Count total cards on board (for early game detection)
    const totalCardsOnBoard = state.player.lanes.flat().length + state.opponent.lanes.flat().length;
    const isEarlyGame = totalCardsOnBoard <= 3;
    const isMidGame = totalCardsOnBoard > 3 && totalCardsOnBoard <= 8;

    // Count cards on opponent's (player's) board for disruption targeting
    const playerCardsOnBoard = state.player.lanes.flat().length;
    const opponentHasTargets = playerCardsOnBoard > 0;

    // =========================================================================
    // CONTROL HUNTING STRATEGY: When player has compiled protocols, prioritize getting control!
    // Control allows us to swap opponent's protocols on refresh, preventing their win.
    // =========================================================================
    const playerCompiledCount = state.player.compiled.filter(Boolean).length;
    const weHaveControl = state.controlCardHolder === 'opponent';
    const playerHasControl = state.controlCardHolder === 'player';

    // Count how many lanes we're leading in (for control calculation)
    let lanesWeAreLead = 0;
    let lanesPlayerLeads = 0;
    for (let i = 0; i < 3; i++) {
        if (state.opponent.laneValues[i] > state.player.laneValues[i]) {
            lanesWeAreLead++;
        } else if (state.player.laneValues[i] > state.opponent.laneValues[i]) {
            lanesPlayerLeads++;
        }
    }

    // CONTROL HUNTING MODE: Activate when:
    // 1. Control mechanic is enabled (useControlMechanic is true)
    // 2. Player has 1+ compiled protocols (Control is valuable to block them!)
    // 3. We DON'T have control yet
    // Goal: Get control by leading in 2+ lanes, so we can block their win via protocol swap
    // CRITICAL FIX: Use useControlMechanic, NOT controlCardHolder!
    // controlCardHolder is null when control is neutral (nobody has it), not when disabled!
    const controlMechanicEnabled = state.useControlMechanic === true;
    const controlHuntingMode = controlMechanicEnabled && playerCompiledCount >= 1 && !weHaveControl;
    const controlDefenseMode = weHaveControl && playerCompiledCount >= 1;

    // Check if player is threatening to win (has 10+ in an uncompiled lane)
    let playerThreateningWin = false;
    let playerThreateningLaneIndex = -1;
    for (let i = 0; i < 3; i++) {
        if (!state.player.compiled[i] &&
            state.player.laneValues[i] >= 10 &&
            state.player.laneValues[i] > state.opponent.laneValues[i]) {
            playerThreateningWin = true;
            playerThreateningLaneIndex = i;
            break;
        }
    }

    if (controlHuntingMode) {
        console.log(`[AI Normal] CONTROL HUNTING MODE: Player has ${playerCompiledCount} compiled, we lead ${lanesWeAreLead} lanes, need 2 for control`);
    }
    if (controlDefenseMode && playerThreateningWin) {
        console.log(`[AI Normal] CONTROL DEFENSE MODE: We have control, player threatening win in lane ${playerThreateningLaneIndex}`);
    }

    // =========================================================================
    // LANE FOCUS STRATEGY: When 0 protocols compiled, focus on ONE lane
    // Choose the best lane based on hand cards (which protocol can we play most?)
    // =========================================================================
    const ourCompiledCount = state.opponent.compiled.filter(Boolean).length;
    let focusLaneIndex = -1; // -1 means no focus (play freely)

    // ALWAYS choose a focus lane if we haven't compiled all 3 yet
    // BUT: In control hunting mode, focus lane is less important - we want to lead in 2 lanes
    if (ourCompiledCount < 3 && !controlHuntingMode) {
        // Find the best lane to focus on based on:
        // 1. Current lane value (MOST IMPORTANT - higher = closer to compile)
        // 2. Which protocol do we have cards for in hand?
        // 3. Is the lane blocked by player having 10+?

        const laneScores: { laneIndex: number; score: number; reason: string }[] = [];

        for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
            if (state.opponent.compiled[laneIdx]) continue; // Already compiled

            const ourProtocol = state.opponent.protocols[laneIdx];
            const playerProtocol = state.player.protocols[laneIdx];
            const ourValue = state.opponent.laneValues[laneIdx];
            const playerValue = state.player.laneValues[laneIdx];

            // Count matching cards in hand that we CAN play face-up
            const matchingCards = state.opponent.hand.filter(
                c => c.protocol === ourProtocol || c.protocol === playerProtocol
            );

            // Check if player has 10+ and we CAN'T catch up with our cards
            if (playerValue >= 10 && !state.player.compiled[laneIdx]) {
                // Calculate max value we could add - include face-down option (+2 always possible!)
                const maxFaceUpValue = Math.max(...matchingCards.map(c => c.value), 0);
                const faceDownValue = 2; // Face-down is ALWAYS an option and adds 2!
                const maxCardValue = Math.max(maxFaceUpValue, faceDownValue);
                const ourPotentialMax = ourValue + maxCardValue;

                if (ourPotentialMax <= playerValue) {
                    // We CAN'T block this lane - skip it!
                    continue;
                }
            }

            let score = 0;
            let reason = `Lane ${laneIdx} (${ourProtocol}): value=${ourValue}`;

            // MOST IMPORTANT: Current lane value - closer to 10 = MUCH better!
            // A lane at 6 is WAY better than a lane at 0
            score += ourValue * 15; // Was 5, now 15

            if (ourValue >= 8) {
                score += 100; // Almost there! Huge bonus
                reason += ` [ALMOST COMPILE: ${ourValue}]`;
            } else if (ourValue >= 6) {
                score += 60; // Very close
                reason += ` [Near compile: ${ourValue}]`;
            } else if (ourValue >= 4) {
                score += 30; // Getting there
                reason += ` [Building: ${ourValue}]`;
            }

            // Matching cards bonus (but less important than current value)
            score += matchingCards.length * 10;
            if (matchingCards.length > 0) {
                reason += ` [${matchingCards.length} cards]`;
            }

            // High value cards in hand for this protocol - can finish faster
            const highValueCards = matchingCards.filter(c => c.value >= 4);
            score += highValueCards.length * 20;

            // Penalty if player is ahead
            if (playerValue > ourValue) {
                score -= (playerValue - ourValue) * 5;
            }

            // If we have 0 matching cards but lane has value, we can still play face-down
            // Don't completely skip, but penalize
            if (matchingCards.length === 0) {
                score -= 30;
                reason += ` [No matching cards - face-down only]`;
            }

            laneScores.push({ laneIndex: laneIdx, score, reason });
        }

        // Sort by score and pick the best
        laneScores.sort((a, b) => b.score - a.score);
        if (laneScores.length > 0) {
            focusLaneIndex = laneScores[0].laneIndex;
            console.log(`[AI Normal] Focus lane: ${focusLaneIndex} (compiled: ${ourCompiledCount}) - ${laneScores[0].reason} [score: ${laneScores[0].score}]`);
        }
    }

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
                // Can ANY of our plays overtake them?
                const maxValueWeCanAdd = Math.max(
                    playCheckFaceUp.allowed ? card.value : 0,
                    playCheckFaceDown.allowed ? getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]) : 0
                );

                const ourPotentialValue = state.opponent.laneValues[i] + maxValueWeCanAdd;
                if (ourPotentialValue <= state.player.laneValues[i]) {
                    // We can't block - SKIP this lane entirely for this card
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
                    } else {
                        score = -150; // Bad move
                        reason += ` [Fails to block]`;
                    }
                } else {
                    // PRIMARY GOAL: Build lane value toward compile (10+)
                    // Higher value cards are MUCH better for this
                    score += valueToAdd * 10; // Value is king!

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
                    // BUT: Disabled in control hunting mode
                    if (focusLaneIndex !== -1 && !controlHuntingMode) {
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
                    // =========================================================================
                    if (controlHuntingMode) {
                        const currentlyLeading = state.opponent.laneValues[i] > state.player.laneValues[i];
                        const wouldLeadAfter = resultingValue > state.player.laneValues[i];
                        const currentlyTied = state.opponent.laneValues[i] === state.player.laneValues[i];

                        // CRITICAL: If we already lead this lane, heavily penalize playing more here!
                        // We need to build in OTHER lanes to get control!
                        if (currentlyLeading) {
                            score -= 200; // HEAVY penalty - don't waste cards in lanes we already lead!
                            reason += ` [ALREADY LEADING - DON'T WASTE!]`;
                        }
                        // HUGE BONUS: This play would give us lead in a lane we don't currently lead
                        else if (!currentlyLeading && wouldLeadAfter) {
                            if (lanesWeAreLead === 1) {
                                // This would give us 2 leads = CONTROL!
                                score += 500; // MASSIVE bonus - this wins us control!
                                reason += ` [CONTROL CAPTURE! 1->2 leads]`;
                            } else if (lanesWeAreLead === 0) {
                                // First lead - very valuable
                                score += 300;
                                reason += ` [First lead! 0->1 leads]`;
                            } else {
                                // Already have control, but more leads is still good
                                score += 100;
                                reason += ` [Extra lead]`;
                            }
                        }
                        // Bonus for breaking ties - this is often how we get control!
                        else if (currentlyTied && wouldLeadAfter) {
                            if (lanesWeAreLead === 1) {
                                score += 450; // Breaking tie gives us control!
                                reason += ` [BREAK TIE FOR CONTROL!]`;
                            } else {
                                score += 250;
                                reason += ` [Break tie]`;
                            }
                        }
                        // BUILD UP: If we have 1 lead but can't immediately get 2nd, BUILD in non-leading lanes
                        else if (!currentlyLeading && !wouldLeadAfter && lanesWeAreLead === 1) {
                            const gapToLead = state.player.laneValues[i] - resultingValue;
                            if (gapToLead <= 3) {
                                score += 200; // Close to getting lead!
                                reason += ` [BUILD toward 2nd lead, gap=${gapToLead}]`;
                            } else if (gapToLead <= 6) {
                                score += 150;
                                reason += ` [BUILD toward 2nd lead, gap=${gapToLead}]`;
                            } else {
                                score += 100;
                                reason += ` [BUILD toward 2nd lead, gap=${gapToLead}]`;
                            }
                        }
                    }
                }

                possibleMoves.push({
                    move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true },
                    score: addNoise(score),
                    reason
                });
            }

            // FACE-DOWN PLAY - use generic canPlayCard result
            // IMPORTANT: Face-down only in EMERGENCY situations!
            // - When lane is at 8-9 and needs just a bit more to compile
            // - When we MUST block player compile and can't do face-up
            // - When we have no face-up options at all
            if (playCheckFaceDown.allowed) {
                const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]);
                const resultingValue = state.opponent.laneValues[i] + valueToAdd;
                const currentLaneValue = state.opponent.laneValues[i];
                let score = -100; // BASE PENALTY: Face-down is generally bad
                let reason = `Play ${card.protocol}-${card.value} face-down in lane ${i}`;

                // EMERGENCY 1: Must block player compile
                if (canPlayerCompileThisLane) {
                    if (resultingValue > state.player.laneValues[i]) {
                        score = 150; // OK to block, but face-up blocking is better
                        reason += ` [Blocks compile]`;
                    } else {
                        score = -200; // Can't even block - terrible
                        reason += ` [Fails to block]`;
                    }
                }
                // PRIORITY 2: Face-down would allow us to COMPILE - THIS IS VERY GOOD!
                // Compile requires: 10+ value AND more than opponent (not equal!)
                else if (!state.opponent.compiled[i] && resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                    score = 300; // VERY HIGH - Completing a compile is the most important thing!
                    reason += ` [COMPILE: Face-down finishes at ${currentLaneValue} -> ${resultingValue} beats player ${state.player.laneValues[i]}]`;
                }
                // PRIORITY 3: BLOCK opponent from compiling by reaching equal value or getting ahead
                // If player has 10+ and could compile, we MUST catch up to block them!
                // Equal value = neither can compile = we blocked them!
                else if (!state.opponent.compiled[i] && state.player.laneValues[i] >= 10 && resultingValue >= state.player.laneValues[i]) {
                    score = 250; // Very high - blocking opponent compile is critical!
                    reason += ` [BLOCK COMPILE: Face-down reaches ${resultingValue} vs player ${state.player.laneValues[i]}]`;
                }
                else if (!state.opponent.compiled[i] && state.player.laneValues[i] >= 10 && resultingValue < state.player.laneValues[i]) {
                    // Player has 10+ and we CAN'T catch up - WASTED CARD! Player will still compile!
                    score = -200;
                    reason += ` [WASTED: ${resultingValue} vs player ${state.player.laneValues[i]} - player still compiles!]`;
                }
                // PRIORITY 4: Face-down in FOCUS LANE to build toward compile - this is GOOD!
                // If this is our focus lane and we're building toward 10, face-down is smart
                else if (focusLaneIndex === i && !state.opponent.compiled[i] && currentLaneValue >= 4) {
                    // Building in focus lane - the closer to 10, the better!
                    score = 50 + (currentLaneValue * 10); // 7 -> 120, 8 -> 130, 9 -> 140
                    reason += ` [BUILD FOCUS: ${currentLaneValue} -> ${resultingValue}]`;
                }
                // EMERGENCY: No face-up option available and we have a low-value card (0-1)
                else if (!playCheckFaceUp.allowed && card.value <= 1) {
                    score = -20; // Slightly less bad - we have no choice
                    reason += ` [No face-up option, low value]`;
                }
                // NON-EMERGENCY: Just a regular face-down play - heavily penalized
                else {
                    score = -120; // Very bad - face-up is almost always better
                    reason += ` [Avoid: Face-up is better]`;
                }

                // Focus lane bonus/penalty for cases not already handled above
                // BUT: Disabled in control hunting mode
                if (focusLaneIndex !== -1 && score < 50 && !controlHuntingMode) { // Only apply if not already a good score
                    if (i === focusLaneIndex) {
                        score += 50; // Some bonus for focus lane
                        reason += ` [Focus lane]`;
                    } else {
                        score -= 80; // Heavy penalty for non-focus
                        reason += ` [Not focus lane]`;
                    }
                }

                // =========================================================================
                // CONTROL HUNTING: Face-down plays for lane leads
                // Control = leading in 2+ lanes. ANY lane counts!
                // These bonuses/penalties MUST override normal scoring!
                // =========================================================================
                if (controlHuntingMode) {
                    const currentlyLeading = state.opponent.laneValues[i] > state.player.laneValues[i];
                    const wouldLeadAfter = resultingValue > state.player.laneValues[i];
                    const currentlyTied = state.opponent.laneValues[i] === state.player.laneValues[i];

                    // CRITICAL: If we already lead this lane, heavily penalize!
                    if (currentlyLeading) {
                        score -= 200; // HEAVY penalty - don't waste cards!
                        reason += ` [FD ALREADY LEADING - DON'T WASTE!]`;
                    }
                    // Face-down that gains us a new lead
                    else if (!currentlyLeading && wouldLeadAfter) {
                        if (lanesWeAreLead === 1) {
                            score += 400; // Face-down for control capture!
                            reason += ` [FD CONTROL CAPTURE! 1->2 leads]`;
                        } else if (lanesWeAreLead === 0) {
                            score += 250;
                            reason += ` [FD First lead!]`;
                        }
                    }
                    // Breaking ties with face-down
                    else if (currentlyTied && wouldLeadAfter) {
                        if (lanesWeAreLead === 1) {
                            score += 350; // Breaking tie gives us control!
                            reason += ` [FD BREAK TIE FOR CONTROL!]`;
                        } else {
                            score += 200;
                            reason += ` [FD Break tie]`;
                        }
                    }
                    // BUILD UP: Face-down to build toward 2nd lead
                    else if (!currentlyLeading && !wouldLeadAfter && lanesWeAreLead === 1) {
                        const gapToLead = state.player.laneValues[i] - resultingValue;
                        if (gapToLead <= 3) {
                            score += 150;
                            reason += ` [FD BUILD toward 2nd lead, gap=${gapToLead}]`;
                        } else if (gapToLead <= 6) {
                            score += 100;
                            reason += ` [FD BUILD toward 2nd lead, gap=${gapToLead}]`;
                        }
                    }
                }

                possibleMoves.push({
                    move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false },
                    score: addNoise(score),
                    reason
                });
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

    // 20% chance to pick second-best move for human-like play
    if (shouldMakeMistake() && possibleMoves.length > 1 && possibleMoves[1].score > 0) {
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
                console.log(`[AI Control] BLOCKING WIN: Player threatening in lane ${playerThreateningLane}, swapping with compiled lane`);
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
            const targetFilter = ((action as any).targetFilter ?? {}) as TargetFilter;
            const actorChooses = 'actorChooses' in action ? action.actorChooses : 'effect_owner';
            const sourceCardId = action.sourceCardId;

            // FLEXIBLE: Check if AI must select its OWN cards (actorChooses: 'card_owner' + targetFilter.owner: 'opponent')
            // This handles custom effects like "Your opponent deletes 1 of their face-down cards"
            if (actorChooses === 'card_owner' && targetFilter?.owner === 'opponent') {
                // AI must select its OWN cards matching the filter
                const ownValidCards: PlayedCard[] = [];
                state.opponent.lanes.forEach((lane) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1]; // Only uncovered
                        if (matchesTargetFilter(topCard, true, targetFilter, sourceCardId)) {
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
                .filter(c => matchesTargetFilter(c, true, targetFilter, sourceCardId));

            // CRITICAL: owner filter is relative to cardOwner (action.actor)
            // 'own' = cards belonging to cardOwner (AI = opponent)
            // 'opponent' = cards belonging to the opponent OF cardOwner (AI's opponent = player)
            const ownerFilter = targetFilter?.owner;

            if (ownerFilter === 'own') {
                // Delete own cards only (AI = opponent)
                const ownCards = getUncovered('opponent').filter(c => !disallowedIds.includes(c.id));
                if (ownCards.length > 0) {
                    // Delete lowest value card (minimize loss)
                    const weakest = ownCards.sort((a, b) => a.value - b.value)[0];
                    return { type: 'deleteCard', cardId: weakest.id };
                }
            } else if (ownerFilter === 'opponent') {
                // Delete opponent's cards only (AI's opponent = player)
                const playerCards = getUncovered('player').filter(c => !disallowedIds.includes(c.id));
                if (playerCards.length > 0) {
                    const scored = playerCards.map(c => {
                        const laneIndex = state.player.lanes.findIndex(l => l.some(card => card.id === c.id));
                        const laneValue = state.player.laneValues[laneIndex];
                        const isCompileThreat = laneValue >= 10 && laneValue > state.opponent.laneValues[laneIndex];

                        return {
                            cardId: c.id,
                            score: getCardThreat(c, 'player', state) + laneValue + (isCompileThreat ? 50 : 0)
                        };
                    });

                    scored.sort((a, b) => b.score - a.score);
                    return { type: 'deleteCard', cardId: scored[0].cardId };
                }
            } else {
                // No filter: Target player's high-value cards first
                const playerCards = getUncovered('player').filter(c => !disallowedIds.includes(c.id));
                if (playerCards.length > 0) {
                    const scored = playerCards.map(c => {
                        const laneIndex = state.player.lanes.findIndex(l => l.some(card => card.id === c.id));
                        const laneValue = state.player.laneValues[laneIndex];
                        const isCompileThreat = laneValue >= 10 && laneValue > state.opponent.laneValues[laneIndex];

                        return {
                            cardId: c.id,
                            score: getCardThreat(c, 'player', state) + laneValue + (isCompileThreat ? 50 : 0)
                        };
                    });

                    scored.sort((a, b) => b.score - a.score);
                    return { type: 'deleteCard', cardId: scored[0].cardId };
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
            const cardOwner = action.actor; // The card owner (who is executing this effect)
            // CRITICAL: Check for lane restriction (this_lane scope)
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const scope = (action as any).scope;

            // Build valid targets respecting targetFilter
            const validTargets: { card: PlayedCard; owner: Player }[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                // Owner filter is relative to cardOwner
                if (targetFilter) {
                    if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                    if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;
                }

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    // CRITICAL: If lane is restricted (this_lane scope), only check that lane!
                    if (restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;
                    if (scope === 'this_lane' && restrictedLaneIndex !== undefined && laneIdx !== restrictedLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];
                    if (lane.length === 0) continue;

                    for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                        const card = lane[cardIndex];
                        const isTopCard = cardIndex === lane.length - 1;

                        // Use centralized filter matching if targetFilter exists
                        if (targetFilter) {
                            if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;
                        } else {
                            // Default: only uncovered cards
                            if (!isTopCard) continue;
                        }

                        // Frost-1 restriction: can't flip face-down cards to face-up
                        if (frost1Active && !card.isFaceUp) continue;

                        validTargets.push({ card, owner: playerKey });
                    }
                }
            }

            if (validTargets.length === 0) return { type: 'skip' };

            // Score targets strategically - calculate ACTUAL value change!
            const scored = validTargets.map(({ card, owner }) => {
                let score = 0;

                // Find lane index for this card
                let laneIndex = -1;
                for (let i = 0; i < state[owner].lanes.length; i++) {
                    if (state[owner].lanes[i].some(c => c.id === card.id)) {
                        laneIndex = i;
                        break;
                    }
                }
                const laneValue = laneIndex >= 0 ? state[owner].laneValues[laneIndex] : 0;
                const isCompiled = laneIndex >= 0 ? state[owner].compiled[laneIndex] : false;

                // Calculate actual value change from flipping
                const currentValue = card.isFaceUp ? card.value : 2; // face-down = 2
                const flippedValue = card.isFaceUp ? 2 : card.value; // face-up shows real value
                const valueChange = flippedValue - currentValue;

                if (owner === 'player') {
                    // Flipping PLAYER's cards - we want to HURT them
                    if (card.isFaceUp) {
                        // Face-up -> Face-down: Good if they LOSE value
                        score = -valueChange * 15;
                        score += getCardThreat(card, 'player', state);
                    } else {
                        // Face-down -> Face-up: Only good if card.value <= 1
                        if (card.value <= 1) {
                            score = 20;
                        } else {
                            score = -30;
                        }
                    }
                } else {
                    // Flipping OWN cards - we want to HELP ourselves
                    if (card.isFaceUp) {
                        // Face-up -> Face-down: GOOD if we GAIN value!
                        if (valueChange > 0) {
                            score = valueChange * 20 + 50;
                            // Check if enables compile
                            if (!isCompiled && laneValue + valueChange >= 10) {
                                score += 200;
                                console.log(`[AI Flip] Own ${card.protocol}-${card.value} flip enables COMPILE!`);
                            }
                        } else {
                            score = valueChange * 15 - 30;
                        }
                    } else {
                        // Face-down -> Face-up: GOOD if card.value > 2
                        if (valueChange > 0) {
                            score = valueChange * 20 + 40;
                            if (!isCompiled && laneValue + valueChange >= 10) {
                                score += 200;
                                console.log(`[AI Flip] Own ${card.protocol}-${card.value} flip enables COMPILE!`);
                            }
                        } else {
                            score = -10;
                        }
                    }
                }

                return { cardId: card.id, score };
            });

            scored.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: scored[0].cardId };
        }

        case 'plague_2_opponent_discard': {
            // Discard weakest card
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'discardCards', cardIds: [sortedHand[0].id] };
        }

        case 'select_cards_from_hand_to_discard_for_fire_4': {
            // Fire-4: Discard up to 3 weak cards
            const maxDiscard = Math.min(3, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'discardCards', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_cards_from_hand_to_discard_for_hate_1': {
            // Hate-1: Discard specified number of cards
            const maxDiscard = Math.min((action as any).count || 1, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'discardCards', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_card_from_hand_to_play': {
            // Speed-0 or Darkness-3: Play another card
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            // CRITICAL: Check if the effect FORCES face-down play (e.g., Darkness-3, Smoke-3)
            // effectInterpreter sends 'faceDown', not 'isFaceDown'
            const isForcedFaceDown = (action as any).faceDown === true;
            console.log('[AI select_card_from_hand_to_play] faceDown:', (action as any).faceDown, 'isForcedFaceDown:', isForcedFaceDown);

            // NEW: Respect selectableCardIds filter (Clarity-2: only cards with specific value)
            const selectableCardIds = (action as any).selectableCardIds;
            const playableHand = selectableCardIds
                ? state.opponent.hand.filter(c => selectableCardIds.includes(c.id))
                : state.opponent.hand;

            if (playableHand.length === 0) return { type: 'skip' };

            // FIX: Filter out blocked lanes and respect validLanes from Smoke-3
            let playableLanes = (action as any).validLanes || [0, 1, 2].filter(i => i !== (action as any).disallowedLaneIndex);
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

                        // Check for Chaos-3: Must be uncovered (last in lane) AND face-up
                        const aiHasChaos3 = state.opponent.lanes.some((lane) => {
                            if (lane.length === 0) return false;
                            const uncoveredCard = lane[lane.length - 1];
                            return uncoveredCard.isFaceUp && uncoveredCard.protocol === 'Chaos' && uncoveredCard.value === 3;
                        });

                        // Check for Anarchy-1 on ANY player's field (affects both players)
                        const anyPlayerHasAnarchy1 = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                            .some(c => c.isFaceUp && c.protocol === 'Anarchy' && c.value === 1);

                        let canPlayFaceUp: boolean;
                        if (anyPlayerHasAnarchy1) {
                            // Anarchy-1 active: INVERTED rule - can only play if protocol does NOT match
                            const doesNotMatch = card.protocol !== state.opponent.protocols[laneIndex] && card.protocol !== state.player.protocols[laneIndex];
                            canPlayFaceUp = doesNotMatch;
                        } else {
                            // Normal rule
                            canPlayFaceUp = card.protocol === state.opponent.protocols[laneIndex]
                                || card.protocol === state.player.protocols[laneIndex]
                                || aiHasSpirit1
                                || aiHasChaos3;
                        }

                        if (canPlayFaceUp) {
                            const valueToAdd = card.value;
                            const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                            let score = getCardPower(card) + valueToAdd * 2;

                            if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                                score += 100;
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

            // Strategy: Return player's high-threat cards, or own low-value cards
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
            playableLanes = playableLanes.filter((laneIndex: number) => {
                const opponentLane = state.player.lanes[laneIndex];
                const topCard = opponentLane.length > 0 ? opponentLane[opponentLane.length - 1] : null;

                // Check for Plague-0 block
                const isBlockedByPlague0 = topCard && topCard.isFaceUp &&
                    topCard.protocol === 'Plague' && topCard.value === 0;

                // Check for Metal-2 block (only if playing face-down)
                const isBlockedByMetal2 = ('isFaceDown' in action && action.isFaceDown) &&
                    opponentLane.some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);

                return !isBlockedByPlague0 && !isBlockedByMetal2;
            });

            if (playableLanes.length === 0) return { type: 'skip' };

            const scoredLanes = playableLanes.map(laneIndex => {
                const lead = state.opponent.laneValues[laneIndex] - state.player.laneValues[laneIndex];
                return { laneIndex, score: -lead }; // Play in weakest lane
            });
            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);

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
            let possibleLanes = [0, 1, 2].filter(i =>
                !('disallowedLaneIndex' in action) || i !== action.disallowedLaneIndex
            ).filter(i =>
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

                // Add some randomness - 20% chance to pick suboptimally
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
            const validLanes = 'validLanes' in action ? action.validLanes : [0, 1, 2];
            if (validLanes.length > 0) {
                const randomLane = validLanes[Math.floor(Math.random() * validLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            return { type: 'skip' };
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
            console.log(`[AI select_lane_for_return] Scoring:`);
            for (const sl of scoredLanes) {
                console.log(`  ${sl.reason}`);
            }

            // Pick best lane (or least bad if all negative)
            if (scoredLanes.length > 0) {
                console.log(`[AI select_lane_for_return] Choosing lane ${scoredLanes[0].laneIndex} with score ${scoredLanes[0].score}`);
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
                                    console.log(`[AI Flip Decision] Found beneficial target: flip player's ${card.protocol}-${card.value} (${currentValue} -> ${flippedValue})`);
                                    break;
                                }
                            } else {
                                // Flip OWN cards - check if it increases our lane value
                                const laneValue = state.opponent.laneValues[laneIdx];
                                const valueGain = flippedValue - currentValue;

                                // SMART: Flip face-up to face-down if it GAINS value (e.g., 0 -> 2)
                                if (card.isFaceUp && valueGain > 0) {
                                    hasBeneficialTarget = true;
                                    console.log(`[AI Flip Decision] Found beneficial target: flip own ${card.protocol}-${card.value} face-up->down (+${valueGain} value)`);
                                    break;
                                }
                                // SMART: Flip face-down to face-up if real value > 2
                                if (!card.isFaceUp && card.value > 2) {
                                    hasBeneficialTarget = true;
                                    console.log(`[AI Flip Decision] Found beneficial target: flip own ${card.protocol}-${card.value} face-down->up (+${valueGain} value)`);
                                    break;
                                }
                                // CRITICAL: Check if flipping would enable COMPILE!
                                if (valueGain > 0 && laneValue + valueGain >= 10 && !state.opponent.compiled[laneIdx]) {
                                    hasBeneficialTarget = true;
                                    console.log(`[AI Flip Decision] COMPILE OPPORTUNITY: flip own ${card.protocol}-${card.value} enables compile! (${laneValue} + ${valueGain} = ${laneValue + valueGain})`);
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
            const validTargets: PlayedCard[] = [];
            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;
                // Prefer player cards
                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    validTargets.push(playerLane[playerLane.length - 1]); // target top card
                    continue;
                }
                const opponentLane = state.opponent.lanes[i];
                if (opponentLane.length > 0) {
                    validTargets.push(opponentLane[opponentLane.length - 1]);
                }
            }
            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_delete': {
            const disallowedIds = ('disallowedIds' in action && Array.isArray(action.disallowedIds)) ? action.disallowedIds : [];
            // Prioritize player cards, but otherwise make a simple choice.
            // FIX: Only target uncovered cards.
            const getUncoveredCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const allowedPlayerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
            if (allowedPlayerCards.length > 0) {
                return { type: 'deleteCard', cardId: allowedPlayerCards[0].id };
            }

            const allowedOpponentCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
            if (allowedOpponentCards.length > 0) {
                return { type: 'deleteCard', cardId: allowedOpponentCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_low_value_card_to_delete': {
            const uncoveredCards: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (const lane of state[p].lanes) {
                    if (lane.length > 0) {
                        uncoveredCards.push(lane[lane.length - 1]);
                    }
                }
            }
            const validTargets = uncoveredCards.filter(c => c.isFaceUp && (c.value === 0 || c.value === 1));

            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
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
                                console.log(`[AI Covered Flip] Found compile opportunity: ${card.protocol}-${card.value} (${card.isFaceUp ? 'face-up' : 'face-down'}) gain=${gain}, newValue=${potentialValue}`);
                            }
                        }

                        // Track best value gain (only if gain > 0)
                        if (gain > 0 && (!bestGainFlip || gain > bestGainFlip.gain)) {
                            bestGainFlip = { card, gain, newValue: potentialValue };
                        }
                    }

                    // If we can compile, do it!
                    if (bestCompileFlip) {
                        console.log(`[AI Covered Flip] COMPILE: Flipping ${bestCompileFlip.card.protocol}-${bestCompileFlip.card.value} for +${bestCompileFlip.gain} value -> ${bestCompileFlip.newValue}`);
                        return { type: 'flipCard', cardId: bestCompileFlip.card.id };
                    }

                    // If we can gain value and get closer to compile, do it
                    if (bestGainFlip && bestGainFlip.gain > 0) {
                        console.log(`[AI Covered Flip] VALUE GAIN: Flipping ${bestGainFlip.card.protocol}-${bestGainFlip.card.value} for +${bestGainFlip.gain} value -> ${bestGainFlip.newValue}`);
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

        // REMOVED: select_own_card_to_return_for_water_4 - Water-4 now uses generic select_card_to_return

        case 'select_card_to_shift_for_anarchy_0': {
            // Anarchy-0: "Shift 1 card" - NO restrictions
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'shiftCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_shift_for_anarchy_1': {
            // Anarchy-1: "Shift 1 other card to a line without a matching protocol"
            // RESTRICTION: Cannot shift the Anarchy-1 card itself, and must shift to non-matching lane
            const { sourceCardId } = action;
            const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                .filter(c => c.id !== sourceCardId);

            if (allOtherCards.length > 0) {
                // Normal AI: Pick a random card and let laneResolver validate destination
                const randomCard = allOtherCards[Math.floor(Math.random() * allOtherCards.length)];
                return { type: 'shiftCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_shift_for_gravity_1': {
            // Gravity-1: "Shift 1 card either to or from this line"
            // RESTRICTION: The shift must involve the Gravity-1's lane
            // Normal AI doesn't optimize for this, just picks random (laneResolver validates)
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'shiftCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        // REMOVED: select_card_to_flip_and_shift_for_gravity_2 - Gravity-2 now uses generic select_card_to_flip

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

        case 'select_face_down_card_to_shift_for_darkness_4': {
            const uncoveredFaceDownCards: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (const lane of state[p].lanes) {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (!topCard.isFaceUp) {
                            uncoveredFaceDownCards.push(topCard);
                        }
                    }
                }
            }

            if (uncoveredFaceDownCards.length > 0) {
                const randomCard = uncoveredFaceDownCards[Math.floor(Math.random() * uncoveredFaceDownCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
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

        // LEGACY REMOVED: select_lane_to_shift_revealed_card_for_light_2 - now uses generic select_lane_for_shift

        case 'select_opponent_face_down_card_to_shift': { // Speed-4
            const validTargets: PlayedCard[] = [];
            for (const lane of state.player.lanes) {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        validTargets.push(topCard);
                    }
                }
            }

            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                // Use 'deleteCard' as the action type to trigger resolveActionWithCard
                return { type: 'deleteCard', cardId: randomTarget.id };
            }

            return { type: 'skip' }; // Should not happen if action was generated correctly
        }

        // REMOVED: select_own_card_to_shift_for_speed_3 - Speed-3 now uses generic select_card_to_shift

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

        case 'select_own_covered_card_to_shift': {
            const validTargets: PlayedCard[] = [];
            for (const lane of state.opponent.lanes) {
                // A card is covered if it's not the last one.
                for (let i = 0; i < lane.length - 1; i++) {
                    validTargets.push(lane[i]);
                }
            }
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'deleteCard', cardId: randomTarget.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_flip': {
            // Generic flip handler for custom protocols
            // Uses targetFilter from action to determine valid targets
            const targetFilter = ((action as any).targetFilter || {}) as TargetFilter;
            // CRITICAL: Check BOTH currentLaneIndex AND laneIndex (flipExecutor uses laneIndex!)
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const scope = (action as any).scope;
            const cardOwner = action.actor; // Who owns the source card (whose "opponent" we target)
            const sourceCardId = action.sourceCardId;
            const validTargets: { card: PlayedCard; owner: Player; laneIndex: number }[] = [];

            // Log for debugging
            if (restrictedLaneIndex !== undefined || scope === 'this_lane') {
                console.log(`[AI select_card_to_flip] Lane restriction: ${restrictedLaneIndex}, scope: ${scope}`);
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
                        const isTopCard = i === lane.length - 1;

                        // Use centralized filter matching (includes valueRange, valueEquals, etc.)
                        if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;

                        // Additional position check for 'covered_in_this_line'
                        if ((targetFilter as any).position === 'covered_in_this_line' && isTopCard) continue;

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
                                console.log(`[AI Flip Score] Flip own ${card.protocol}-${card.value} face-up->down ENABLES COMPILE! (${laneValue} + ${valueChange} = ${laneValue + valueChange})`);
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
                                console.log(`[AI Flip Score] Flip own ${card.protocol}-${card.value} face-down->up ENABLES COMPILE! (${laneValue} + ${valueChange} = ${laneValue + valueChange})`);
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

            // 20% chance to make suboptimal choice
            if (shouldMakeMistake() && scored.length > 1) {
                const randomIdx = Math.floor(Math.random() * scored.length);
                return { type: 'flipCard', cardId: scored[randomIdx].card.id };
            }

            return { type: 'flipCard', cardId: scored[0].card.id };
        }

        case 'select_card_to_shift': {
            // Generic shift for custom protocols
            const targetFilter = ((action as any).targetFilter || {}) as TargetFilter;
            // CRITICAL: Check BOTH currentLaneIndex AND laneIndex (executors may use either!)
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const scope = (action as any).scope;
            const cardOwner = action.actor; // Who owns the source card (whose "opponent" we target)
            const sourceCardId = action.sourceCardId;
            const validTargets: PlayedCard[] = [];

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
                        const isTopCard = i === lane.length - 1;

                        // Use centralized filter matching (includes valueRange, valueEquals, etc.)
                        if (!matchesTargetFilter(card, isTopCard, targetFilter, sourceCardId)) continue;

                        validTargets.push(card);
                    }
                }
            }

            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'deleteCard', cardId: randomTarget.id };
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
            // Normal AI: flip own cards to gain value, shift opponent's cards
            const { revealedCardId } = action as any;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'resolveRevealBoardCardPrompt', choice: 'skip' };
            if (cardInfo.owner === 'opponent') {
                // This is OUR card (AI is opponent) - flip to gain value
                return { type: 'resolveRevealBoardCardPrompt', choice: 'flip' };
            }
            // This is player's card - shift to disrupt their lane
            return { type: 'resolveRevealBoardCardPrompt', choice: 'shift' };
        }

        case 'select_lane_to_shift_revealed_board_card_custom': {
            // Normal AI: pick strategic lane
            const possibleLanes = [0, 1, 2];
            // Pick lane with lowest opponent value (weaken their weakest lane further)
            possibleLanes.sort((a, b) => state.player.laneValues[a] - state.player.laneValues[b]);
            return { type: 'selectLane', laneIndex: possibleLanes[0] };
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
            const validTargets = state.player.lanes.map(lane => lane.length > 0 ? lane[lane.length - 1] : null).filter((c): c is PlayedCard => c !== null);
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'deleteCard', cardId: randomTarget.id }; // 'deleteCard' is a proxy for selecting a card
            }
            return { type: 'skip' };
        }

        case 'select_own_other_card_to_shift': {
            const cardToShift = state.opponent.lanes.flat().find(c => c.id !== action.sourceCardId);
            if (cardToShift) return { type: 'deleteCard', cardId: cardToShift.id }; // Typo but fine for easy
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
            // Optional draw effect - Normal AI usually accepts
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

        // Fallback for other actions - use simple random/first selection
        default: {
            console.log('[AI DEFAULT] Unhandled action type:', action.type, 'optional:', (action as any).optional);
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
