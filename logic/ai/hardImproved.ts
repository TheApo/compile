/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IMPROVED HARD AI with Memory & Strategic Thinking
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { handleControlRearrange, canBenefitFromPlayerRearrange, canBenefitFromOwnRearrange } from './controlMechanicLogic';
import { isFrost1Active } from '../effects/common/frost1Check';

// AI MEMORY: Tracks known information about cards
interface AIMemory {
    knownPlayerCards: Map<string, PlayedCard>; // Cards we've seen (revealed or played face-up)
    knownOwnCards: Map<string, PlayedCard>;    // Our own cards we remember
    suspectedThreats: Set<string>;              // Face-down cards in threatening positions
    lastPlayerLaneValues: number[];             // Track player's progression
    turnsPlayed: number;
}

let aiMemory: AIMemory = {
    knownPlayerCards: new Map(),
    knownOwnCards: new Map(),
    suspectedThreats: new Set(),
    lastPlayerLaneValues: [0, 0, 0],
    turnsPlayed: 0
};

const updateMemory = (state: GameState) => {
    aiMemory.turnsPlayed++;

    // Remember all face-up cards
    state.player.lanes.flat().forEach(card => {
        if (card.isFaceUp) {
            aiMemory.knownPlayerCards.set(card.id, card);
        }
    });

    state.opponent.lanes.flat().forEach(card => {
        if (card.isFaceUp) {
            aiMemory.knownOwnCards.set(card.id, card);
        }
    });

    // Track threats: face-down cards in high-value lanes
    state.player.lanes.forEach((lane, i) => {
        if (state.player.laneValues[i] >= 7) {
            lane.forEach(card => {
                if (!card.isFaceUp) {
                    aiMemory.suspectedThreats.add(card.id);
                }
            });
        }
    });

    // Track player progression
    aiMemory.lastPlayerLaneValues = [...state.player.laneValues];
};

const DISRUPTION_KEYWORDS = ['delete', 'flip', 'shift', 'return', 'discard'];

/**
 * Calculate baseScore based on ACTUAL executable effects in current game state
 */
const calculateEffectBaseScore = (card: PlayedCard, state: GameState): number => {
    let baseScore = 0;

    // COUNT: How many opponent cards can be deleted?
    if (card.keywords['delete']) {
        const opponentCardsOnBoard = state.player.lanes.flat().length;
        const deleteCount = card.middle.match(/Delete (\d+)/)?.[1];
        if (deleteCount) {
            const actualDeletes = Math.min(parseInt(deleteCount), opponentCardsOnBoard);
            baseScore += actualDeletes * 100; // +100 per deletable card
        }
    }

    // COUNT: How many opponent cards can be flipped? (estimate value loss)
    if (card.keywords['flip'] && card.middle.includes('opponent')) {
        const opponentFaceUpCards = state.player.lanes.flat().filter(c => c.isFaceUp);
        if (opponentFaceUpCards.length > 0) {
            // Estimate: Average opponent face-up card is value 3 → flips to 1 → loss of 2
            const flipCount = Math.min(1, opponentFaceUpCards.length); // Most cards flip 1
            baseScore += flipCount * 2 * 50; // (valueBefore - valueAfter) * 50
        }
    }

    // COUNT: How many own cards can be flipped? (estimate value gain)
    if (card.keywords['flip'] && (card.middle.includes('your') || card.middle.includes('1 of YOUR'))) {
        const ownFaceDownCards = state.opponent.lanes.flat().filter(c => !c.isFaceUp);
        if (ownFaceDownCards.length > 0) {
            // Estimate: Average face-down is 0-1 → flips to 2-3 → gain of 2
            const flipCount = Math.min(1, ownFaceDownCards.length);
            baseScore += flipCount * 2 * 50; // (valueAfter - valueBefore) * 50
        }
    }

    // COUNT: Discard self (negative)
    if (card.keywords['discard'] && !card.middle.includes('opponent')) {
        const discardCount = card.middle.match(/Discard (\d+)/)?.[1];
        if (discardCount) {
            baseScore -= parseInt(discardCount) * 30; // -30 per discard
        }
    }

    // COUNT: Discard opponent (positive)
    if (card.keywords['discard'] && card.middle.includes('opponent')) {
        const discardCount = card.middle.match(/(\d+)/)?.[1];
        if (discardCount && state.player.hand.length > 0) {
            const actualDiscards = Math.min(parseInt(discardCount), state.player.hand.length);
            baseScore += actualDiscards * 30; // +30 per opponent discard
        }
    }

    // COUNT: Return (only if cards can be returned)
    if (card.keywords['return']) {
        const returnableCards = state.opponent.lanes.flat().length; // Simplification
        if (returnableCards > 0) {
            baseScore += 20; // +20 if return is possible
        }
    }

    // COUNT: Shift (only if cards can be shifted)
    if (card.keywords['shift']) {
        const shiftableCards = state.player.lanes.flat().length + state.opponent.lanes.flat().length;
        if (shiftableCards > 0) {
            baseScore += 30; // +30 if shift is possible
        }
    }

    // BONUS: Draw cards
    if (card.keywords['draw']) {
        const drawCount = card.middle.match(/Draw (\d+)/)?.[1];
        if (drawCount) {
            baseScore += parseInt(drawCount) * 20; // +20 per draw
        }
    }

    // BONUS: Play extra cards
    if (card.keywords['play']) {
        baseScore += 40; // Playing extra cards is very valuable
    }

    return baseScore;
};

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
        const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
        const baseValue = hasDarkness2 ? 4 : 2;

        // MEMORY: If we saw this card before being flipped, use that knowledge
        if (aiMemory.knownPlayerCards.has(card.id)) {
            const knownCard = aiMemory.knownPlayerCards.get(card.id)!;
            return knownCard.value * 2 + (DISRUPTION_KEYWORDS.some(kw => knownCard.keywords[kw]) ? 8 : 0);
        }

        // If it's in a high-value lane, assume it's threatening
        if (aiMemory.suspectedThreats.has(card.id)) {
            return baseValue + 6;
        }

        return baseValue;
    }

    let threat = card.value * 2.5;

    if (card.top.length > 0) threat += 8;
    if (card.bottom.includes("Start:") || card.bottom.includes("End:")) threat += 10;
    if (card.bottom.includes("covered:")) threat += 6;
    if (DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) threat += 5;

    return threat;
};

/**
 * UNIVERSAL SHIFT SCORING: Score a card for shifting
 * Returns higher score = better to shift this card
 */
const scoreCardForShift = (card: PlayedCard, cardOwner: Player, currentLaneIndex: number, state: GameState): number => {
    const laneValue = state[cardOwner].laneValues[currentLaneIndex];
    const isCompiled = state[cardOwner].compiled[currentLaneIndex];

    // ===== AI'S OWN CARDS =====
    if (cardOwner === 'opponent') {
        if (isCompiled) {
            // FROM compiled lane → HIGHEST priority to move out!
            return 10000;
        }

        // FROM uncompiled lane
        const distanceToCompile = 10 - laneValue;

        if (distanceToCompile <= 0) {
            // Lane is at 10+ but not compiled (opponent might be higher)
            // DON'T shift away - we need to keep this strong!
            return -10000;
        } else if (distanceToCompile <= 3) {
            // Lane at 7-9 → very close to compile, DON'T weaken!
            return -5000;
        } else {
            // Weak lane (0-6) → okay to shift FROM here
            return 1000;
        }
    }

    // ===== OPPONENT'S CARDS (PLAYER) =====
    else {
        if (isCompiled) {
            // FROM compiled lane → useless to shift (already done)
            return 0;
        }

        // FROM uncompiled lane → the STRONGER, the BETTER to disrupt!
        let score = laneValue * 1000; // Higher value = higher priority

        // If they can compile THIS turn, CRITICAL!
        if (laneValue >= 10 && laneValue > state.opponent.laneValues[currentLaneIndex]) {
            score += 100000; // EMERGENCY!
        }

        return score;
    }
};

/**
 * UNIVERSAL LANE SCORING: Score a target lane for shifting TO
 * Returns higher score = better target lane
 */
const scoreLaneForShiftTarget = (cardToShift: PlayedCard, cardOwner: Player, targetLaneIndex: number, state: GameState): number => {
    const targetLaneValue = state[cardOwner].laneValues[targetLaneIndex];
    const isCompiled = state[cardOwner].compiled[targetLaneIndex];
    const cardValue = getEffectiveCardValue(cardToShift, state[cardOwner].lanes[targetLaneIndex]);

    // ===== SHIFTING AI'S OWN CARD =====
    if (cardOwner === 'opponent') {
        if (isCompiled) {
            // TO compiled lane → BAD! Wasted value
            return -10000;
        }

        // TO uncompiled lane → prefer lanes close to compile
        const futureValue = targetLaneValue + cardValue;
        const distanceToCompile = 10 - futureValue;

        if (distanceToCompile <= 0) {
            // Would enable compile → EXCELLENT!
            if (futureValue > state.player.laneValues[targetLaneIndex]) {
                return 50000; // Can compile immediately!
            }
            return 30000; // Close to compile
        } else if (distanceToCompile <= 3) {
            // Would bring us close (7-9) → GOOD
            return 20000;
        } else {
            // Still weak → prefer weakest lanes
            return 10000 - targetLaneValue * 100; // Prefer lower values
        }
    }

    // ===== SHIFTING OPPONENT'S CARD =====
    else {
        if (isCompiled) {
            // TO compiled lane → PERFECT! Waste their value!
            return 100000;
        }

        // TO uncompiled lane → prefer WEAK lanes (spread their value thin)
        const futureValue = targetLaneValue + cardValue;

        if (futureValue >= 10 && futureValue > state.opponent.laneValues[targetLaneIndex]) {
            // Would let them compile → TERRIBLE!
            return -100000;
        }

        // Prefer shifting to WEAKEST uncompiled lanes (spread damage)
        return 50000 - targetLaneValue * 1000; // Lower value = higher score
    }
};

/**
 * Calculate effect power of a card (for flip scoring)
 * Returns higher value = stronger effect
 */
const getEffectPower = (card: PlayedCard): number => {
    let power = 0;

    // Strong disruption keywords
    if (card.keywords['delete']) power += 30;
    if (card.keywords['discard']) power += 20;
    if (card.keywords['return']) power += 15;
    if (card.keywords['shift']) power += 10;

    // Utility keywords
    if (card.keywords['draw']) power += 8;
    if (card.keywords['play']) power += 25; // Very strong
    if (card.keywords['prevent']) power += 12;
    if (card.keywords['flip']) power += 10;

    // Special powerful cards (based on protocol-value combinations)
    if (card.protocol === 'Hate' && card.value === 1) power += 40; // Delete 2 cards!
    if (card.protocol === 'Death' && card.value === 3) power += 35; // Delete face-down
    if (card.protocol === 'Fire' && card.value === 4) power += 30; // Discard 4
    if (card.protocol === 'Psychic' && card.value === 0) power += 25; // Draw + opponent discards + reveal

    return power;
};

/**
 * UNIVERSAL FLIP SCORING: Score a card for flipping
 * Returns higher score = better to flip this card
 * Uses Memory system to know face-down cards!
 */
const scoreCardForFlip = (card: PlayedCard, cardOwner: Player, laneIndex: number, state: GameState): number => {
    const laneValue = state[cardOwner].laneValues[laneIndex];
    const isCompiled = state[cardOwner].compiled[laneIndex];

    // ===== OPPONENT'S CARDS (PLAYER) - DISRUPT! =====
    if (cardOwner === 'player') {

        if (card.isFaceUp) {
            // Face-Up → Face-Down: Consider BOTH the value change AND effect deactivation

            // CRITICAL: How much does opponent GAIN from this flip?
            // card.value → 2 means opponent gains (2 - card.value)
            // Lower values (0, 1) are BAD to flip (opponent gains more!)
            // Higher values (5, 6) are GOOD to flip (opponent loses value!)
            const valueDelta = 2 - card.value; // Positive = opponent gains, Negative = opponent loses

            // Base score: Prefer flipping HIGH value cards (opponent loses value)
            // Value 0: delta=+2 → score=-200 (VERY BAD!)
            // Value 1: delta=+1 → score=-100 (BAD!)
            // Value 2: delta=0 → score=0 (neutral)
            // Value 6: delta=-4 → score=+400 (GREAT!)
            let score = -valueDelta * 100;

            // Bonus for deactivating strong effects
            const effectPower = getEffectPower(card);
            score += effectPower * 10;

            // Extra bonus if lane is strong (weaken their compile attempt)
            if (laneValue >= 8) {
                score += 200;
            }

            return score;
        } else {
            // Face-Down → Face-Up: RISKY! But sometimes better than flipping own valuable cards

            // Check Memory: Do we know this card?
            if (aiMemory.knownPlayerCards.has(card.id)) {
                const knownCard = aiMemory.knownPlayerCards.get(card.id)!;

                // LOW values (0-1): DON'T flip! They become 2
                if (knownCard.value <= 1) {
                    return -800; // Very bad - strengthens opponent
                }

                // HIGH values (4-6): Risky but at least we know
                const effectPower = getEffectPower(knownCard);

                if (knownCard.value >= 4 || effectPower > 30) {
                    return -400; // Risky but known
                } else {
                    return -300; // Mediocre card
                }
            } else {
                // UNKNOWN card: Risky but NOT worse than losing own value!
                // Expected value: 50% chance low (0-1), 50% chance high (2-6)
                // Risk it if alternative is flipping own valuable cards
                return -600; // Risky but acceptable if no better option
            }
        }
    }

    // ===== AI'S OWN CARDS (OPPONENT) - OPTIMIZE! =====
    else {

        if (card.isFaceUp) {
            // Face-Up → Face-Down: Usually BAD! (lose value + effects)

            // Only good for very weak cards (0-1) that already triggered
            if (card.value <= 1) {
                const hasOnPlayEffect = card.keywords && (card.keywords['play'] || card.keywords['uncover']);
                if (!hasOnPlayEffect) {
                    return 50; // Okay to flip down weak card with no effects
                }
            }

            return -1000; // Generally bad

        } else {
            // Face-Down → Face-Up: GOOD! (activate effects + add value)

            // We KNOW our own cards (AI remembers what it played)
            let knownCard: PlayedCard | undefined;

            if (aiMemory.knownOwnCards.has(card.id)) {
                knownCard = aiMemory.knownOwnCards.get(card.id);
            }

            // If unknown (shouldn't happen), assume average
            const cardValue = knownCard?.value ?? card.value;
            const effectPower = knownCard ? getEffectPower(knownCard) : 10;

            // Base score: higher value = better
            let score = cardValue * 100;

            // Bonus for strong effects
            score += effectPower * 5;

            // Lane context bonus
            if (!isCompiled) {
                const futureValue = laneValue - 2 + cardValue; // -2 for current face-down, +cardValue for face-up

                // Would enable compile?
                if (futureValue >= 10 && futureValue > state.player.laneValues[laneIndex]) {
                    score += 500; // HUGE bonus! Can compile!
                } else if (futureValue >= 7) {
                    score += 200; // Close to compile
                }
            }

            // DON'T flip very low values (0-1) unless lane context is good
            if (cardValue <= 1 && score < 300) {
                score = 10; // Low priority
            }

            return score;
        }
    }
};

type ScoredMove = {
    move: AIAction;
    score: number;
    reason: string;
};

const evaluateStrategicPosition = (state: GameState): {
    shouldDisrupt: boolean;
    shouldRush: boolean;
    needsDefense: boolean;
    criticalLane: number;
    oneAwayFromWin: boolean;
    closestToWin: number;
    canWinByOutlasting: boolean;
    outLastLane: number;
} => {
    const opponentCompiledCount = state.opponent.compiled.filter(c => c).length;
    const playerCompiledCount = state.player.compiled.filter(c => c).length;

    const oneAwayFromWin = opponentCompiledCount === 2;
    const shouldRush = opponentCompiledCount >= 2 || (opponentCompiledCount === 1 && playerCompiledCount === 0);

    const playerThreats = state.player.laneValues.map((v, i) => ({
        lane: i,
        value: v,
        canCompile: v >= 10 && v > state.opponent.laneValues[i] && !state.player.compiled[i]
    }));

    const immediateCompileThreat = playerThreats.some(t => t.canCompile);
    const highThreat = playerThreats.some(t => t.value >= 8 && !t.canCompile);

    const needsDefense = immediateCompileThreat || (highThreat && state.opponent.hand.length < 3);
    const shouldDisrupt = state.player.laneValues.some(v => v >= 6) && state.opponent.hand.some(c => DISRUPTION_KEYWORDS.some(kw => c.keywords[kw]));

    const criticalLane = playerThreats.reduce((max, t) => t.value > playerThreats[max].value ? t.lane : max, 0);

    // Find the uncompiled lane closest to winning (highest value vs player)
    let closestToWin = -1;
    let bestLead = -999;
    for (let i = 0; i < 3; i++) {
        if (!state.opponent.compiled[i]) {
            const lead = state.opponent.laneValues[i] - state.player.laneValues[i];
            if (lead > bestLead || (lead === bestLead && state.opponent.laneValues[i] >= 10)) {
                bestLead = lead;
                closestToWin = i;
            }
        }
    }

    // CRITICAL NEW STRATEGY: Can we win by outlasting the player?
    // If player has 0-1 cards and we have the lead (or close) in a lane, we can just keep playing there to win!
    let canWinByOutlasting = false;
    let outLastLane = -1;
    if (state.player.hand.length <= 1 && state.opponent.hand.length >= 2) {
        // Player is low on cards, we have resources - find our best lane
        for (let i = 0; i < 3; i++) {
            if (state.opponent.compiled[i]) continue; // Skip compiled lanes
            const lead = state.opponent.laneValues[i] - state.player.laneValues[i];
            // We're ahead OR close behind - we can win by just playing more!
            if (lead >= -2) { // Even if we're 2 behind, with multiple cards we can overtake
                canWinByOutlasting = true;
                outLastLane = i;
                break;
            }
        }
    }

    return { shouldDisrupt, shouldRush, needsDefense, criticalLane, oneAwayFromWin, closestToWin, canWinByOutlasting, outLastLane };
};

const getBestMove = (state: GameState): AIAction => {
    updateMemory(state);

    const possibleMoves: ScoredMove[] = [];

    const strategy = evaluateStrategicPosition(state);

    const isLaneBlockedByPlague0 = (laneIndex: number): boolean => {
        const playerLane = state.player.lanes[laneIndex];
        if (playerLane.length === 0) return false;
        const topCard = playerLane[playerLane.length - 1];
        return topCard.isFaceUp && topCard.protocol === 'Plague' && topCard.value === 0;
    };

    const playerHasPsychic1 = state.player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);

    // NEW: Control becomes important ONLY when player has 2 compiled protocols
    const playerCompiledCount = state.player.compiled.filter(c => c).length;
    const controlIsImportant = state.useControlMechanic && playerCompiledCount >= 2;

    // NEW: Diversification needed when AI has 1+ compiled AND player has control
    const aiCompiledCount = state.opponent.compiled.filter(c => c).length;
    const playerHasControl = state.useControlMechanic && state.controlCardHolder === 'player';
    const needsDiversification = aiCompiledCount >= 1 && playerHasControl;

    // NEW: Calculate protocol concentration for synergy bonus
    const getProtocolConcentration = (laneIndex: number, protocol: string): number => {
        // Count how many cards of this protocol are already in the lane
        return state.opponent.lanes[laneIndex].filter(c => c.protocol === protocol).length;
    };

    // NEW: Calculate diversification bonus - reward spreading across lanes when player has control
    const getDiversificationBonus = (laneIndex: number): number => {
        if (!needsDiversification) return 0;

        // Find the lane with highest value (excluding compiled lanes)
        let highestUncompiledValue = 0;
        let highestLaneIndex = -1;
        state.opponent.lanes.forEach((lane, i) => {
            if (!state.opponent.compiled[i]) {
                const value = state.opponent.laneValues[i];
                if (value > highestUncompiledValue) {
                    highestUncompiledValue = value;
                    highestLaneIndex = i;
                }
            }
        });

        // If this is the WEAKEST uncompiled lane, give bonus (diversify away from strongest)
        const currentLaneValue = state.opponent.laneValues[laneIndex];
        const isWeakerLane = currentLaneValue < highestUncompiledValue;

        if (isWeakerLane && !state.opponent.compiled[laneIndex]) {
            // Bonus inversely proportional to lane value (weaker lanes = higher bonus)
            const valueDifference = highestUncompiledValue - currentLaneValue;
            return 500 + (valueDifference * 50); // More bonus for bigger difference
        }

        return 0;
    };

    // NEW: Check if a lane is undefendable (player can compile next turn, no card can block)
    const isLaneUndefendable = (laneIndex: number): boolean => {
        const playerLaneValue = state.player.laneValues[laneIndex];
        const aiLaneValue = state.opponent.laneValues[laneIndex];
        const playerCompiled = state.player.compiled[laneIndex];

        // Only check if player can compile next turn
        if (playerLaneValue < 10 || playerCompiled || playerLaneValue <= aiLaneValue) {
            return false; // Not a threat or already compiled
        }

        // Check if ANY card in hand can defend (reach >= player value)
        const aiHasSpirit1 = state.opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

        // Check for Chaos-3: Must be uncovered (last in lane) AND face-up
        const aiHasChaos3 = state.opponent.lanes.some((lane) => {
            if (lane.length === 0) return false;
            const uncoveredCard = lane[lane.length - 1];
            return uncoveredCard.isFaceUp && uncoveredCard.protocol === 'Chaos' && uncoveredCard.value === 3;
        });

        const aiProtocol = state.opponent.protocols[laneIndex];
        const playerProtocol = state.player.protocols[laneIndex];

        for (const card of state.opponent.hand) {
            // Can play face-up?
            const matchesProtocol = card.protocol === aiProtocol || card.protocol === playerProtocol || aiHasSpirit1 || aiHasChaos3;
            const faceUpValue = matchesProtocol && !playerHasPsychic1 ? card.value : 0;

            // Can play face-down (always possible unless Metal-2)
            const playerHasMetalTwo = state.player.lanes[laneIndex].some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);
            const faceDownValue = playerHasMetalTwo ? 0 : getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[laneIndex]);

            // Best possible value
            const bestValue = Math.max(faceUpValue, faceDownValue);
            const resultingValue = aiLaneValue + bestValue;

            // Can we block?
            if (resultingValue >= playerLaneValue) {
                return false; // Can defend!
            }
        }

        return true; // No card can defend - lane is lost
    };

    // Evaluate all possible card plays
    for (const card of state.opponent.hand) {
        // Skip 0-value cards as first move (they often need other cards in play to be useful)
        const totalCardsOnBoard = state.opponent.lanes.flat().length + state.player.lanes.flat().length;
        if (card.value === 0 && totalCardsOnBoard === 0) continue;

        for (let i = 0; i < 3; i++) {
            if (isLaneBlockedByPlague0(i)) continue;

            // CRITICAL: Water-4 MUST return 1 card (not optional!)
            // Only play face-up if we have OTHER uncovered cards we want to return.
            // Otherwise it returns itself = wasted turn!
            if (card.protocol === 'Water' && card.value === 4) {
                // Count uncovered cards in OTHER lanes (NOT the lane we're about to play in!)
                let hasOtherUncoveredCards = false;
                for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                    if (laneIdx !== i && state.opponent.lanes[laneIdx].length > 0) {
                        hasOtherUncoveredCards = true;
                        break;
                    }
                }
                // If no other uncovered cards exist, Water-4 would return itself = skip face-up play
                if (!hasOtherUncoveredCards) continue;
            }
            if (state.opponent.compiled[i]) {
                // STRATEGIC: Consider playing in compiled lanes for Control or disruption
                if (!state.useControlMechanic) continue;
                if (state.opponent.laneValues[i] >= state.player.laneValues[i]) continue; // Already winning
            }

            // CRITICAL: Metal-6 deletes itself when covered or flipped!
            // Only play it if it will be the LAST card before compiling (lane reaches 10+).
            if (card.protocol === 'Metal' && card.value === 6) {
                const currentLaneValue = state.opponent.laneValues[i];
                const valueAfterPlaying = currentLaneValue + 6;

                // Only play Metal-6 if:
                // 1. It will bring the lane to 10+ (ready to compile)
                // 2. OR the lane already has 10+ and AI just needs more value to win
                const willReachCompileThreshold = valueAfterPlaying >= 10;

                if (!willReachCompileThreshold) {
                    // DON'T play Metal-6 if it won't reach compile threshold
                    // (it will just get covered and deleted later)
                    continue;
                }

                // Additional safety: If player has high value in this lane, Metal-6 might not be enough
                const playerValue = state.player.laneValues[i];
                if (valueAfterPlaying <= playerValue) {
                    // Playing Metal-6 won't even win the lane, so skip it
                    continue;
                }
            }

            // CRITICAL: Hate-2 deletes own highest value uncovered, then opponent's highest!
            // If Hate-2 would delete ITSELF, the effect stops and opponent loses NOTHING = suicide!
            const isHate2 = card.protocol === 'Hate' && card.value === 2;
            let hate2WouldSuicideFaceUp = false;
            let hate2WouldSuicideFaceDown = false;

            if (isHate2) {
                // Helper: Check if Hate-2 would be the highest uncovered after playing
                const wouldSuicide = (isFaceUp: boolean): boolean => {
                    // Simulate all uncovered cards after playing Hate-2
                    const simulatedHate2 = { ...card, isFaceUp };
                    const allUncoveredAfterPlay = state.opponent.lanes
                        .map((lane, laneIdx) => {
                            if (laneIdx === i) {
                                // This lane will have Hate-2 on top
                                const newLane = [...lane, simulatedHate2];
                                return { card: simulatedHate2, laneContext: newLane };
                            } else if (lane.length > 0) {
                                return { card: lane[lane.length - 1], laneContext: lane };
                            }
                            return null;
                        })
                        .filter((item): item is { card: PlayedCard; laneContext: PlayedCard[] } => item !== null);

                    if (allUncoveredAfterPlay.length === 0) return false;

                    // Find highest value uncovered card
                    const highestUncovered = allUncoveredAfterPlay.reduce((highest, current) => {
                        const highestValue = getEffectiveCardValue(highest.card, highest.laneContext);
                        const currentValue = getEffectiveCardValue(current.card, current.laneContext);
                        return currentValue > highestValue ? current : highest;
                    });

                    // Is Hate-2 the highest? (Check by protocol AND value AND face state)
                    return highestUncovered.card.protocol === 'Hate' &&
                           highestUncovered.card.value === 2 &&
                           highestUncovered.card.isFaceUp === isFaceUp;
                };

                hate2WouldSuicideFaceUp = wouldSuicide(true);
                hate2WouldSuicideFaceDown = wouldSuicide(false);
            }

            const canPlayerCompileThisLane = state.player.laneValues[i] >= 10 && state.player.laneValues[i] > state.opponent.laneValues[i] && !state.player.compiled[i];

            // CRITICAL: Player has 10+ but we're ahead/tied - they can compile NEXT turn if we don't keep ahead!
            const playerNearCompile = state.player.laneValues[i] >= 10 && !state.player.compiled[i];
            const weAreCloseOrBehind = state.opponent.laneValues[i] <= state.player.laneValues[i] + 2; // Within 2 points
            const mustStayAhead = playerNearCompile && weAreCloseOrBehind;

            const baseScore = calculateEffectBaseScore(card, state);

            // FACE-UP PLAY
            // RULE: Can play face-up ONLY if card protocol matches:
            // 1. Own protocol in this lane (state.opponent.protocols[i]), OR
            // 2. Opposing player's protocol in this lane (state.player.protocols[i]), OR
            // 3. AI has Spirit-1 face-up (allows playing any protocol face-up)
            // BLOCKER: Player has Psychic-1 (blocks all face-up plays)
            // SPECIAL: Anarchy-1 INVERTS the rule (can only play if protocol does NOT match)
            // Compiled status has NOTHING to do with face-up play rules!
            const matchesOwnProtocol = card.protocol === state.opponent.protocols[i];
            const matchesOpposingProtocol = card.protocol === state.player.protocols[i];
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
                const doesNotMatch = !matchesOwnProtocol && !matchesOpposingProtocol;
                canPlayFaceUp = doesNotMatch && !playerHasPsychic1;
            } else {
                // Normal rule
                canPlayFaceUp = (matchesOwnProtocol || matchesOpposingProtocol || aiHasSpirit1 || aiHasChaos3) && !playerHasPsychic1;
            }

            if (canPlayFaceUp) {
                // Skip Hate-2 face-up if it would suicide
                if (isHate2 && hate2WouldSuicideFaceUp) {
                    // Don't evaluate face-up play - it's suicide!
                } else {
                    let score = 0;
                    let reason = `Play ${card.protocol}-${card.value} face-up in lane ${i}.`;
                    const valueToAdd = card.value;
                    const resultingValue = state.opponent.laneValues[i] + valueToAdd;

                // === PRIORITY 1: CRITICAL DEFENSE (only when absolutely necessary) ===
                if (canPlayerCompileThisLane) {
                    // Player can compile THIS turn - must block!
                    // Base score first
                    score = valueToAdd * 1000 + baseScore * 10;

                    if (resultingValue >= state.player.laneValues[i]) {
                        score += 10000; // Additive bonus - higher value cards still preferred
                        reason += ` [BLOCKS IMMEDIATE COMPILE]`;
                    } else {
                        score -= 5; // Can't block - slightly negative but not prohibitive
                        reason += ` [FAILS TO BLOCK]`;
                    }
                }
                // === PRIORITY 2: WIN THE GAME (if one away) ===
                else if (strategy.oneAwayFromWin && i === strategy.closestToWin) {
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                        score = 20000; // HIGHEST - win the game!
                        reason += ` [GAME-WINNING COMPILE!!!]`;
                    } else {
                        score = 5000 + resultingValue * 50; // Build toward win
                        reason += ` [Building winning lane]`;
                    }
                }
                // === PRIORITY 3: OUTLAST WIN (player has no cards) ===
                else if (strategy.canWinByOutlasting && i === strategy.outLastLane) {
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                        score = 18000; // Almost highest - guaranteed win
                        reason += ` [OUTLAST WIN]`;
                    } else {
                        score = 8000 + resultingValue * 30;
                        reason += ` [OUTLAST: Building]`;
                    }
                }
                // === PRIORITY 4: BUILD OWN PROTOCOLS (MAIN STRATEGY!) ===
                else {
                    // Base score: Card value DOMINATES effect power
                    score = valueToAdd * 1000 + baseScore * 10;

                    // BONUS 1: Compile this protocol!
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 3000; // Additive bonus - higher value cards still win
                        reason += ` [COMPILES PROTOCOL!]`;
                    }
                    // BONUS 2: Tied or behind but above 10 - KEEP FIGHTING (only if we can catch up or have delete)
                    else if (resultingValue >= 10 && state.player.laneValues[i] >= 10 && !state.opponent.compiled[i]
                             && (resultingValue >= state.player.laneValues[i] || card.keywords['delete'])) {
                        // Both players are above 10 - continue playing to win the standoff!
                        const deficit = state.player.laneValues[i] - resultingValue;
                        score += 2500 - (deficit * 50); // High priority, decreases slightly if behind
                        reason += ` [FIGHTING STANDOFF: ${resultingValue} vs ${state.player.laneValues[i]}]`;
                    }
                    // BONUS 3: Moderate progress (5-7)
                    else if (resultingValue >= 5 && !state.opponent.compiled[i]) {
                        score += 1000 + (resultingValue * 50);
                        reason += ` [Building: ${resultingValue}/10]`;
                    }
                    // PENALTY: Weak lane (<5)
                    else if (resultingValue < 5 && !state.opponent.compiled[i]) {
                        score += 200 + (resultingValue * 20);
                        reason += ` [Weak lane: ${resultingValue}/10]`;
                    }

                    // BONUS 4: Protocol Synergy (same protocol already in lane)
                    const protocolConcentration = getProtocolConcentration(i, card.protocol);
                    if (protocolConcentration > 0) {
                        const synergyBonus = protocolConcentration * 800; // 800 per card of same protocol!
                        score += synergyBonus;
                        reason += ` [SYNERGY: ${protocolConcentration + 1}x ${card.protocol}]`;
                    }

                    // BONUS 5: Value Concentration (prefer strong lanes over spreading)
                    // BUT: Diversification bonus if player has control and can block us
                    const currentLaneValue = state.opponent.laneValues[i];
                    const diversificationBonus = getDiversificationBonus(i);

                    if (diversificationBonus > 0) {
                        // Player has control - DIVERSIFY!
                        score += diversificationBonus;
                        reason += ` [DIVERSIFY: +${diversificationBonus}]`;
                    } else {
                        // Normal concentration bonus
                        if (currentLaneValue >= 6) {
                            score += 600; // Prefer adding to strong lanes
                            reason += ` [Concentration]`;
                        } else if (currentLaneValue >= 3) {
                            score += 200;
                        }
                    }

                    // BONUS 6: Disruption effects (if player is threatening)
                    const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                    if (hasDisruption) {
                        if (strategy.shouldDisrupt) {
                            score += 400;
                            reason += ` [Disruption]`;
                        }
                        // Extra bonus if disrupting in player's strong lane
                        if (state.player.laneValues[i] >= 7) {
                            score += 200;
                            reason += ` [vs threat]`;
                        }
                    }

                    // BONUS 7: Control (ONLY if player has 2 compiled)
                    if (controlIsImportant && state.opponent.compiled[i]) {
                        const leadDiff = resultingValue - state.player.laneValues[i];
                        if (leadDiff > 0) {
                            score += 1500 + leadDiff * 100; // Important for control
                            reason += ` [CONTROL: lead +${leadDiff}]`;
                        }
                    }

                    // BONUS 8: Card advantage effects
                    if (card.keywords['play'] || card.keywords['draw']) {
                        score += 300;
                        reason += ` [Card+]`;
                    }

                    // PENALTY: Playing in compiled lane (unless for control)
                    if (state.opponent.compiled[i] && !controlIsImportant) {
                        score -= 3; // Slightly negative - not optimal but acceptable
                        reason += ` [WASTED in compiled]`;
                    }

                    // PENALTY: Weak defense (if player can compile next turn)
                    if (mustStayAhead && resultingValue <= state.player.laneValues[i]) {
                        score -= 1; // Slightly negative - falling behind is suboptimal but not terrible
                        reason += ` [DANGER: Falls behind]`;
                    }

                    // PENALTY: Lane is undefendable - player can compile, no card can stop it
                    if (isLaneUndefendable(i)) {
                        score -= 4000; // Don't waste cards in lost lanes
                        reason += ` [UNDEFENDABLE LANE]`;
                    }
                }

                    possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true }, score, reason });
                }
            }

            // FACE-DOWN PLAY
            const playerHasMetalTwo = state.player.lanes[i].some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);
            if (!playerHasMetalTwo) {
                // Skip Hate-2 face-down if it would suicide
                if (isHate2 && hate2WouldSuicideFaceDown) {
                    // Don't evaluate face-down play - it's suicide!
                } else {
                    const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]);
                    const resultingValue = state.opponent.laneValues[i] + valueToAdd;
                    let score = 0;
                    let reason = `Play ${card.protocol}-${card.value} face-down in lane ${i}.`;

                // === PRIORITY 1: CRITICAL DEFENSE ===
                if (canPlayerCompileThisLane) {
                    if (resultingValue > state.player.laneValues[i]) {
                        score = 9000; // Slightly lower than face-up defense
                        reason += ` [BLOCKS COMPILE]`;
                    } else {
                        score = -4000;
                        reason += ` [FAILS TO BLOCK]`;
                    }
                }
                // === PRIORITY 2-3: WIN CONDITIONS ===
                else if (strategy.oneAwayFromWin && i === strategy.closestToWin) {
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                        score = 17000; // Lower than face-up (no effects)
                        reason += ` [GAME-WIN]`;
                    } else {
                        score = 4500 + resultingValue * 40;
                        reason += ` [Building win]`;
                    }
                }
                else if (strategy.canWinByOutlasting && i === strategy.outLastLane) {
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                        score = 16000;
                        reason += ` [OUTLAST WIN]`;
                    } else {
                        score = 7000 + resultingValue * 25;
                        reason += ` [OUTLAST]`;
                    }
                }
                // === PRIORITY 4: BUILD PROTOCOLS (but less valuable than face-up) ===
                else {
                    // Base score: only value (no effect power)
                    score = valueToAdd * 50; // Half of face-up

                    // BONUS 1: Compile this protocol!
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 6000; // Lower than face-up (8000)
                        reason += ` [COMPILES]`;
                    }
                    // BONUS 2: Tied or behind but above 10 - KEEP FIGHTING (only if we can catch up or have delete)
                    else if (resultingValue >= 10 && state.player.laneValues[i] >= 10 && !state.opponent.compiled[i]
                             && (resultingValue >= state.player.laneValues[i] || card.keywords['delete'])) {
                        // Both players are above 10 - continue playing to win the standoff!
                        const deficit = state.player.laneValues[i] - resultingValue;
                        score += 5000 - (deficit * 100); // Very high priority, decreases if behind
                        reason += ` [STANDOFF: ${resultingValue} vs ${state.player.laneValues[i]}]`;
                    }
                    // BONUS 3: Very close to compile
                    else if (resultingValue >= 8 && !state.opponent.compiled[i]) {
                        score += 2000 - ((10 - resultingValue) * 300);
                        reason += ` [Close: ${resultingValue}/10]`;
                    }
                    // BONUS 4: Building
                    else if (resultingValue >= 5 && !state.opponent.compiled[i]) {
                        score += 600 + (resultingValue * 30);
                        reason += ` [Building: ${resultingValue}/10]`;
                    }
                    else if (!state.opponent.compiled[i]) {
                        score += 100 + (resultingValue * 15);
                        reason += ` [Weak: ${resultingValue}/10]`;
                    }

                    // BONUS 4: Protocol Synergy (same protocol)
                    const protocolConcentration = getProtocolConcentration(i, card.protocol);
                    if (protocolConcentration > 0) {
                        score += protocolConcentration * 400; // Half of face-up bonus
                        reason += ` [SYNERGY: ${protocolConcentration + 1}x]`;
                    }

                    // BONUS 5: Concentration / Diversification
                    const currentLaneValue = state.opponent.laneValues[i];
                    const diversificationBonus = getDiversificationBonus(i);

                    if (diversificationBonus > 0) {
                        // Player has control - DIVERSIFY!
                        score += diversificationBonus / 2; // Half of face-up bonus
                        reason += ` [DIVERSIFY]`;
                    } else {
                        // Normal concentration
                        if (currentLaneValue >= 6) {
                            score += 300;
                            reason += ` [Conc]`;
                        }
                    }

                    // PENALTY: Save powerful effects for face-up play
                    if (calculateEffectBaseScore(card, state) >= 150 && !strategy.oneAwayFromWin) {
                        score -= 800; // Strong penalty - waste of good effect
                        reason += ` [Wasting effect]`;
                    }

                    // PENALTY: Compiled lane
                    if (state.opponent.compiled[i] && !controlIsImportant) {
                        score -= 2500;
                        reason += ` [WASTED]`;
                    }

                    // PENALTY: Weak defense
                    if (mustStayAhead && resultingValue <= state.player.laneValues[i]) {
                        score -= 1500;
                        reason += ` [DANGER]`;
                    }

                    // PENALTY: Lane is undefendable - player can compile, no card can stop it
                    if (isLaneUndefendable(i)) {
                        score -= 4000; // Don't waste cards in lost lanes
                        reason += ` [UNDEFENDABLE LANE]`;
                    }
                }

                    possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false }, score, reason });
                }
            }
        }
    }

    // Evaluate Filling Hand - NEW SIMPLE LOGIC
    if (state.opponent.hand.length < 5) {
        let fillHandScore = -5000; // Default: NEVER
        let fillHandReason = "Refresh hand";

        // RULE 1: Hand empty - MUST draw
        if (state.opponent.hand.length === 0) {
            fillHandScore = 1000;
            fillHandReason = "Refresh hand (EMPTY - must draw!)";
        }
        // RULE 2: Only 1 card AND can't play it meaningfully
        else if (state.opponent.hand.length === 1) {
            const card = state.opponent.hand[0];

            // Check if this card can be played somewhere useful
            let canPlayUsefully = false;
            for (let i = 0; i < 3; i++) {
                if (isLaneBlockedByPlague0(i)) continue;

                // Can we compile with this card?
                const faceUpValue = state.opponent.laneValues[i] + card.value;
                const faceDownValue = state.opponent.laneValues[i] + getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]);

                if ((faceUpValue >= 10 || faceDownValue >= 10) && !state.opponent.compiled[i]) {
                    canPlayUsefully = true;
                    break;
                }

                // Or at least build toward compile (5+)?
                if (faceUpValue >= 5 || faceDownValue >= 5) {
                    canPlayUsefully = true;
                    break;
                }
            }

            if (!canPlayUsefully) {
                fillHandScore = 500;
                fillHandReason = "Refresh hand (1 card - not useful)";
            }
        }
        // RULE 3: Control + Player threatening to compile another lane
        else {
            const hasControl = state.useControlMechanic && state.controlCardHolder === 'opponent';
            const playerCompiledCount = state.player.compiled.filter(c => c).length;

            if (hasControl && playerCompiledCount >= 1) {
                // Check if player can compile an UNCOMPILED lane this/next turn
                const playerCanCompileAnother = state.player.laneValues.some((v, i) =>
                    !state.player.compiled[i] && v >= 10 && v > state.opponent.laneValues[i]
                );

                if (playerCanCompileAnother) {
                    fillHandScore = 2000;
                    fillHandReason = `Refresh hand (CONTROL - stop player's next compile!)`;
                }
            }
        }

        // OVERRIDE: Never refresh if we're one away from winning and can win NOW
        if (strategy.oneAwayFromWin) {
            const hasPlayableCard = state.opponent.hand.some(c => {
                const laneIndex = strategy.closestToWin;
                if (laneIndex === -1) return false;
                const faceUpValue = state.opponent.laneValues[laneIndex] + c.value;
                const faceDownValue = state.opponent.laneValues[laneIndex] + getEffectiveCardValue({ ...c, isFaceUp: false }, state.opponent.lanes[laneIndex]);
                return (faceUpValue >= 10 || faceDownValue >= 10);
            });

            if (hasPlayableCard) {
                fillHandScore = -5000;
                fillHandReason = "Refresh hand (CAN WIN - DON'T REFRESH!)";
            }
        }

        possibleMoves.push({ move: { type: 'fillHand' }, score: fillHandScore, reason: fillHandReason });
    }

    if (possibleMoves.length === 0) {
        return { type: 'fillHand' };
    }

    possibleMoves.sort((a, b) => b.score - a.score);

    // Log top 3 moves for debugging (optional)
    // console.log('[AI Hard] Top moves:', possibleMoves.slice(0, 3).map(m => `${m.reason} (${m.score})`));

    return possibleMoves[0].move;
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    updateMemory(state);

    switch (action.type) {
        case 'prompt_use_control_mechanic': {
            // CRITICAL FIX: Check if rearrange would ACTUALLY be beneficial BEFORE deciding
            // Use the same logic as handleControlRearrange to avoid pretending to rearrange

            // Priority 1: Try to disrupt player if it would actually hurt them
            if (canBenefitFromPlayerRearrange(state)) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }

            // Priority 2: Rearrange own protocols ONLY if it brings us closer to victory
            if (canBenefitFromOwnRearrange(state)) {
                return { type: 'resolveControlMechanicPrompt', choice: 'opponent' };
            }

            // No beneficial rearrange found - skip to avoid wasting the control action
            return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
        }

        case 'discard': {
            // IMPROVED: Keep disruption cards, discard redundant high-value cards
            const sortedHand = [...state.opponent.hand].sort((a, b) => {
                const aHasDisruption = DISRUPTION_KEYWORDS.some(kw => a.keywords[kw]);
                const bHasDisruption = DISRUPTION_KEYWORDS.some(kw => b.keywords[kw]);

                if (aHasDisruption && !bHasDisruption) return 1; // Keep a
                if (!aHasDisruption && bHasDisruption) return -1; // Keep b

                // Among non-disruption or both-disruption, keep lower power
                return calculateEffectBaseScore(a, state) - calculateEffectBaseScore(b, state);
            });
            return { type: 'discardCards', cardIds: sortedHand.slice(0, action.count).map(c => c.id) };
        }

        case 'select_opponent_card_to_flip': {
            // Darkness-1: Flip opponent's cards (uncovered only)
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                    targets.push({ card: topCard, laneIndex, score });
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_card_to_delete_for_anarchy_2': {
            // Anarchy-2: "Delete a covered or uncovered FACE-UP card in a line with a matching protocol"
            // CRITICAL: Only FACE-UP cards can be selected (covered or uncovered)
            // Card's protocol must match the lane protocol

            // Helper to check if card's protocol matches the lane protocol
            const hasMatchingProtocol = (card: PlayedCard, owner: Player, laneIndex: number): boolean => {
                const laneProtocol = state[owner].protocols[laneIndex];
                return card.protocol === laneProtocol;
            };

            const targets: { card: PlayedCard; owner: Player; laneIndex: number; score: number }[] = [];

            // Evaluate ALL FACE-UP player cards with matching protocol (covered and uncovered)
            state.player.lanes.forEach((lane, laneIndex) => {
                lane.forEach((card, cardIndexInLane) => {
                    // CRITICAL: Only face-up cards with matching protocol
                    if (!card.isFaceUp || !hasMatchingProtocol(card, 'player', laneIndex)) return;

                    // Score based on card threat, lane value, and whether it's covered
                    const isUncovered = cardIndexInLane === lane.length - 1;
                    const baseThreat = getCardThreat(card, 'player', state);
                    const laneValue = state.player.laneValues[laneIndex];
                    const isCompileThreat = laneValue >= 10 && laneValue > state.opponent.laneValues[laneIndex];

                    // Bonus for deleting uncovered cards (removes value immediately)
                    // Covered cards are less valuable to delete but still disrupt
                    let score = baseThreat + laneValue * 0.5 + (isCompileThreat ? 100 : 0);
                    if (isUncovered) score += 50; // Prefer uncovered for immediate impact

                    targets.push({ card, owner: 'player', laneIndex, score });
                });
            });

            // Also consider own FACE-UP cards with matching protocol (fallback)
            state.opponent.lanes.forEach((lane, laneIndex) => {
                lane.forEach((card, cardIndexInLane) => {
                    // CRITICAL: Only face-up cards with matching protocol
                    if (!card.isFaceUp || !hasMatchingProtocol(card, 'opponent', laneIndex)) return;

                    const isUncovered = cardIndexInLane === lane.length - 1;
                    const baseThreat = getCardThreat(card, 'opponent', state);
                    // Penalty for deleting own cards (negative score)
                    let score = -baseThreat - 50;
                    if (!isUncovered) score -= 20; // Extra penalty for deleting covered cards

                    targets.push({ card, owner: 'opponent', laneIndex, score });
                });
            });

            if (targets.length === 0) return { type: 'skip' };

            // Pick highest score (cardResolver will validate matching protocol requirement)
            targets.sort((a, b) => b.score - a.score);
            return { type: 'deleteCard', cardId: targets[0].card.id };
        }

        case 'select_cards_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = action.type === 'select_cards_to_delete' ? (action.disallowedIds || []) : [action.sourceCardId];
            const targetFilter = 'targetFilter' in action ? action.targetFilter : undefined;
            const actorChooses = 'actorChooses' in action ? action.actorChooses : 'effect_owner';

            // FLEXIBLE: Check if AI must select its OWN cards (actorChooses: 'card_owner' + targetFilter.owner: 'opponent')
            // This handles custom effects like "Your opponent deletes 1 of their face-down cards"
            if (actorChooses === 'card_owner' && targetFilter?.owner === 'opponent') {
                // AI must select its OWN cards matching the filter
                const ownValidCards: { card: PlayedCard; laneIndex: number }[] = [];
                state.opponent.lanes.forEach((lane, laneIndex) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1]; // Only uncovered
                        // Check faceState filter
                        if (targetFilter.faceState === 'face_down' && topCard.isFaceUp) return;
                        if (targetFilter.faceState === 'face_up' && !topCard.isFaceUp) return;
                        ownValidCards.push({ card: topCard, laneIndex });
                    }
                });

                if (ownValidCards.length > 0) {
                    // Strategic: Delete from non-compiled lanes first, prefer lowest value
                    const scored = ownValidCards.map(({ card, laneIndex }) => {
                        const isCompiled = state.opponent.compiled[laneIndex];
                        const compiledPenalty = isCompiled ? 1000 : 0; // Huge penalty to avoid compiled lanes
                        return {
                            cardId: card.id,
                            score: card.value + compiledPenalty // Lower is better
                        };
                    });
                    scored.sort((a, b) => a.score - b.score);
                    return { type: 'deleteCard', cardId: scored[0].cardId };
                }
                return { type: 'skip' };
            }

            // Standard behavior: Target player's high-value cards
            const getUncovered = (p: Player) => state[p].lanes
                .map((lane, laneIndex) => lane.length > 0 ? { card: lane[lane.length - 1], laneIndex } : null)
                .filter((c): c is { card: PlayedCard, laneIndex: number } => c !== null);

            // STRATEGIC: Prioritize NON-COMPILED lanes, but allow compiled as fallback with penalty
            const playerCards = getUncovered('player')
                .filter(({ card }) => !disallowedIds.includes(card.id));

            if (playerCards.length > 0) {
                // Prioritize: 1) Non-compiled lanes (huge bonus), 2) High threat, 3) High lane value, 4) Compile blockers
                const scored = playerCards.map(({ card, laneIndex }) => {
                    const laneValue = state.player.laneValues[laneIndex];
                    const isCompileThreat = laneValue >= 10 && laneValue > state.opponent.laneValues[laneIndex];
                    const isCompiled = state.player.compiled[laneIndex];
                    const compiledPenalty = isCompiled ? -1000 : 0; // Massive penalty for compiled lanes

                    return {
                        cardId: card.id,
                        score: getCardThreat(card, 'player', state) * 2 + laneValue + (isCompileThreat ? 100 : 0) + compiledPenalty
                    };
                });

                scored.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: scored[0].cardId };
            }

            const opponentCards = getUncovered('opponent').filter(({ card }) => !disallowedIds.includes(card.id));
            if (opponentCards.length > 0) {
                const worstCard = opponentCards.sort((a, b) => getCardThreat(a.card, 'opponent', state) - getCardThreat(b.card, 'opponent', state))[0];
                return { type: 'deleteCard', cardId: worstCard.card.id };
            }

            return { type: 'skip' };
        }

        case 'select_any_card_to_flip':
        case 'select_any_other_card_to_flip': {
            // Love-4, Plague-3, etc: Flip any uncovered card
            const frost1Active = isFrost1Active(state);
            const targets: { card: PlayedCard; laneIndex: number; owner: Player; score: number }[] = [];
            const sourceCardId = action.type === 'select_any_other_card_to_flip' ? action.sourceCardId : null;

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    // If Frost-1 is active, skip face-down cards
                    if (frost1Active && !topCard.isFaceUp) return;
                    if (topCard.id !== sourceCardId) {
                        const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, owner: 'player', score });
                    }
                }
            });

            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    // If Frost-1 is active, skip face-down cards
                    if (frost1Active && !topCard.isFaceUp) return;
                    if (topCard.id !== sourceCardId) {
                        const score = scoreCardForFlip(topCard, 'opponent', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, owner: 'opponent', score });
                    }
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_any_face_down_card_to_flip_optional': {
            // Life-2: May flip 1 face-down card (only uncovered face-down cards!)
            const targets: { card: PlayedCard; laneIndex: number; owner: Player; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) { // Only face-down
                        const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, owner: 'player', score });
                    }
                }
            });

            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) { // Only face-down
                        const score = scoreCardForFlip(topCard, 'opponent', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, owner: 'opponent', score });
                    }
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_any_card_to_flip_optional': {
            // Spirit-2: May flip any uncovered card (face-up or face-down)
            const targets: { card: PlayedCard; laneIndex: number; owner: Player; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                    targets.push({ card: topCard, laneIndex, owner: 'player', score });
                }
            });

            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    const score = scoreCardForFlip(topCard, 'opponent', laneIndex, state);
                    targets.push({ card: topCard, laneIndex, owner: 'opponent', score });
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_own_face_up_covered_card_to_flip': {
            // Apathy-4: May flip own face-up COVERED cards
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            state.opponent.lanes.forEach((lane, laneIndex) => {
                for (let i = 0; i < lane.length - 1; i++) { // Only covered cards
                    const card = lane[i];
                    if (card.isFaceUp) {
                        const score = scoreCardForFlip(card, 'opponent', laneIndex, state);
                        targets.push({ card, laneIndex, score });
                    }
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            // Only flip if it's actually beneficial (positive score)
            if (targets[0].score > 0) {
                return { type: 'flipCard', cardId: targets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_reveal_for_light_2': {
            // Light-2: Reveal (flip up) face-down UNCOVERED card, then may shift or flip it
            // Only uncovered face-down cards
            const targets: { card: PlayedCard; laneIndex: number; owner: Player; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1]; // UNCOVERED only
                    if (!topCard.isFaceUp) {
                        const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, owner: 'player', score });
                    }
                }
            });

            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1]; // UNCOVERED only
                    if (!topCard.isFaceUp) {
                        const score = scoreCardForFlip(topCard, 'opponent', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, owner: 'opponent', score });
                    }
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id }; // FIX: flipCard not deleteCard!
        }

        case 'select_opponent_face_up_card_to_flip': {
            // Apathy-3: Flip opponent's face-up cards only
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (topCard.isFaceUp) {
                        const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                        targets.push({ card: topCard, laneIndex, score });
                    }
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_card_to_flip_for_fire_3':
        case 'select_card_to_flip_for_light_0':
        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_covered_card_to_flip_for_chaos_0':
        case 'select_covered_card_in_line_to_flip_optional': {
            const targets: { card: PlayedCard; laneIndex: number; owner: Player; score: number }[] = [];

            if (action.type === 'select_covered_card_to_flip_for_chaos_0') {
                // Chaos-0: Only covered cards in a specific lane
                const { laneIndex } = action;
                state.player.lanes[laneIndex].forEach((c, i, arr) => {
                    if (i < arr.length - 1) { // Covered card
                        const score = scoreCardForFlip(c, 'player', laneIndex, state);
                        targets.push({ card: c, laneIndex, owner: 'player', score });
                    }
                });
                state.opponent.lanes[laneIndex].forEach((c, i, arr) => {
                    if (i < arr.length - 1) { // Covered card
                        const score = scoreCardForFlip(c, 'opponent', laneIndex, state);
                        targets.push({ card: c, laneIndex, owner: 'opponent', score });
                    }
                });
            } else if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                // Darkness-2: Only covered cards in a specific lane
                const { laneIndex } = action;
                state.player.lanes[laneIndex].forEach((c, i, arr) => {
                    if (i < arr.length - 1) { // Covered card
                        const score = scoreCardForFlip(c, 'player', laneIndex, state);
                        targets.push({ card: c, laneIndex, owner: 'player', score });
                    }
                });
                state.opponent.lanes[laneIndex].forEach((c, i, arr) => {
                    if (i < arr.length - 1) { // Covered card
                        const score = scoreCardForFlip(c, 'opponent', laneIndex, state);
                        targets.push({ card: c, laneIndex, owner: 'opponent', score });
                    }
                });
            } else {
                // General case: All uncovered cards (or all except source for Water-0)
                const sourceCardId = action.type === 'select_any_other_card_to_flip_for_water_0' ? action.sourceCardId : null;

                state.player.lanes.forEach((lane, laneIndex) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (topCard.id !== sourceCardId) {
                            const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                            targets.push({ card: topCard, laneIndex, owner: 'player', score });
                        }
                    }
                });

                state.opponent.lanes.forEach((lane, laneIndex) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (topCard.id !== sourceCardId) {
                            const score = scoreCardForFlip(topCard, 'opponent', laneIndex, state);
                            targets.push({ card: topCard, laneIndex, owner: 'opponent', score });
                        }
                    }
                });
            }

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            const playerTargets: { card: PlayedCard, laneIndex: number, isCompiled: boolean }[] = [];
            const opponentTargets: { card: PlayedCard, laneIndex: number }[] = [];
            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;

                // STRATEGIC: Collect all player cards but prioritize non-compiled lanes
                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    playerTargets.push({
                        card: playerLane[playerLane.length - 1],
                        laneIndex: i,
                        isCompiled: state.player.compiled[i]
                    });
                }

                const opponentLane = state.opponent.lanes[i];
                if (opponentLane.length > 0) opponentTargets.push({ card: opponentLane[opponentLane.length - 1], laneIndex: i });
            }

            if (playerTargets.length > 0) {
                // Sort by: 1) Non-compiled (huge bonus), 2) Threat
                playerTargets.sort((a, b) => {
                    const compiledPenaltyA = a.isCompiled ? -1000 : 0; // Massive penalty for compiled
                    const compiledPenaltyB = b.isCompiled ? -1000 : 0;
                    const scoreA = getCardThreat(a.card, 'player', state) + compiledPenaltyA;
                    const scoreB = getCardThreat(b.card, 'player', state) + compiledPenaltyB;
                    return scoreB - scoreA;
                });
                return { type: 'deleteCard', cardId: playerTargets[0].card.id };
            }

            // Fallback: If no player cards available, delete from opponent's weakest card
            if (opponentTargets.length > 0) {
                opponentTargets.sort((a, b) => getCardThreat(a.card, 'opponent', state) - getCardThreat(b.card, 'opponent', state));
                return { type: 'deleteCard', cardId: opponentTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'select_low_value_card_to_delete': {
            const uncoveredCards: { card: PlayedCard, owner: Player, laneIndex: number }[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (let laneIndex = 0; laneIndex < 3; laneIndex++) {
                    const lane = state[p].lanes[laneIndex];
                    if (lane.length > 0) {
                        uncoveredCards.push({ card: lane[lane.length - 1], owner: p, laneIndex });
                    }
                }
            }

            // STRATEGIC: Prioritize NON-COMPILED lanes, but allow compiled as fallback
            const validTargets = uncoveredCards.filter(({ card }) => card.isFaceUp && (card.value === 0 || card.value === 1));

            if (validTargets.length > 0) {
                validTargets.sort((a, b) => {
                    const aIsPlayer = a.owner === 'player';
                    const bIsPlayer = b.owner === 'player';

                    // First priority: Player cards over opponent cards
                    if (aIsPlayer && !bIsPlayer) return -1;
                    if (!aIsPlayer && bIsPlayer) return 1;

                    // Second priority: Non-compiled lanes
                    if (aIsPlayer && bIsPlayer) {
                        const aCompiled = state.player.compiled[a.laneIndex];
                        const bCompiled = state.player.compiled[b.laneIndex];
                        if (!aCompiled && bCompiled) return -1; // a is non-compiled, prefer it
                        if (aCompiled && !bCompiled) return 1;  // b is non-compiled, prefer it
                    }

                    // Third priority: Threat
                    return getCardThreat(b.card, b.owner, state) - getCardThreat(a.card, a.owner, state);
                });
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'select_own_highest_card_to_delete_for_hate_2': {
            const actor = action.actor;
            const uncoveredCards: Array<{ card: PlayedCard; laneIndex: number; value: number }> = [];

            state[actor].lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const uncovered = lane[lane.length - 1];
                    const value = uncovered.isFaceUp ? uncovered.value : 2;
                    uncoveredCards.push({ card: uncovered, laneIndex, value });
                }
            });

            if (uncoveredCards.length === 0) return { type: 'skip' };

            const maxValue = Math.max(...uncoveredCards.map(c => c.value));
            const highestCards = uncoveredCards.filter(c => c.value === maxValue);

            // Hard AI Strategy: If multiple ties, pick the least valuable lane
            // (e.g., lowest current lane value, or already compiled lane)
            highestCards.sort((a, b) => {
                const aLaneValue = state[actor].laneValues[a.laneIndex];
                const bLaneValue = state[actor].laneValues[b.laneIndex];
                const aCompiled = state[actor].compiled[a.laneIndex];
                const bCompiled = state[actor].compiled[b.laneIndex];

                // Prefer compiled lanes (less valuable to keep cards there)
                if (aCompiled && !bCompiled) return -1;
                if (!aCompiled && bCompiled) return 1;

                // Prefer lower lane value (less impact to delete from)
                return aLaneValue - bLaneValue;
            });

            return { type: 'deleteCard', cardId: highestCards[0].card.id };
        }

        case 'select_opponent_highest_card_to_delete_for_hate_2': {
            const actor = action.actor;
            const opponent = actor === 'player' ? 'opponent' : 'player';
            const uncoveredCards: Array<{ card: PlayedCard; laneIndex: number; value: number }> = [];

            state[opponent].lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const uncovered = lane[lane.length - 1];
                    const value = uncovered.isFaceUp ? uncovered.value : 2;
                    uncoveredCards.push({ card: uncovered, laneIndex, value });
                }
            });

            if (uncoveredCards.length === 0) return { type: 'skip' };

            const maxValue = Math.max(...uncoveredCards.map(c => c.value));
            const highestCards = uncoveredCards.filter(c => c.value === maxValue);

            // Hard AI Strategy: If multiple ties, pick the MOST valuable lane
            // (e.g., highest current lane value, or non-compiled lane - maximum damage)
            highestCards.sort((a, b) => {
                const aLaneValue = state[opponent].laneValues[a.laneIndex];
                const bLaneValue = state[opponent].laneValues[b.laneIndex];
                const aCompiled = state[opponent].compiled[a.laneIndex];
                const bCompiled = state[opponent].compiled[b.laneIndex];

                // Prefer non-compiled lanes (more valuable to opponent)
                if (!aCompiled && bCompiled) return -1;
                if (aCompiled && !bCompiled) return 1;

                // Prefer higher lane value (maximum damage)
                return bLaneValue - aLaneValue;
            });

            return { type: 'deleteCard', cardId: highestCards[0].card.id };
        }

        case 'select_own_card_to_return_for_water_4': {
            const ownCardsWithContext: { card: PlayedCard, lane: PlayedCard[] }[] = [];
            state.opponent.lanes.forEach(lane => {
                // Only consider uncovered cards (last card in lane)
                if (lane.length > 0) {
                    const uncoveredCard = lane[lane.length - 1];
                    ownCardsWithContext.push({ card: uncoveredCard, lane });
                }
            });
            if (ownCardsWithContext.length > 0) {
                const scoredCards = ownCardsWithContext.map(({ card, lane }) => {
                    const effectiveValue = getEffectiveCardValue(card, lane);
                    let score = -effectiveValue;
                    const hasGoodEffect = card.keywords.delete || card.keywords.play || card.keywords.draw || card.keywords.flip || card.keywords.return;
                    if (hasGoodEffect && card.id !== action.sourceCardId) score += 8;
                    return { card, score };
                });
                scoredCards.sort((a, b) => b.score - a.score);
                return { type: 'returnCard', cardId: scoredCards[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'gravity_2_shift_after_flip':
        case 'shift_flipped_card_optional': {
            const cardId = action.type === 'gravity_2_shift_after_flip' ? action.cardToShiftId : action.cardId;
            const cardInfo = findCardOnBoard(state, cardId);
            if (!cardInfo || cardInfo.owner !== 'player') return { type: 'skip' };
            const { card: cardToShift } = cardInfo;
            let originalLaneIndex = -1;
            for (let i = 0; i < state.player.lanes.length; i++) {
                if (state.player.lanes[i].some(c => c.id === cardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }
            if (originalLaneIndex === -1) return { type: 'skip' };
            const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
            if (possibleLanes.length === 0) return { type: 'skip' };
            const scoredLanes = possibleLanes.map(laneIndex => {
                const valueToAdd = getEffectiveCardValue(cardToShift, state.player.lanes[laneIndex]);
                const futurePlayerLaneValue = state.player.laneValues[laneIndex] + valueToAdd;
                const futurePlayerLead = futurePlayerLaneValue - state.opponent.laneValues[laneIndex];
                let score = -futurePlayerLead;

                // CRITICAL: Check if target lane is compiled
                const isCompiled = state.player.compiled[laneIndex];

                // BAD: Shifting would allow player to compile/recompile (>= 10 and winning)
                if (futurePlayerLaneValue >= 10 && futurePlayerLaneValue > state.opponent.laneValues[laneIndex]) {
                    score -= 1000; // MASSIVE PENALTY - Player can compile!
                }
                // GOOD: Compiled lane + NOT enabling compile = PERFECT!
                else if (isCompiled) {
                    score += 800; // HUGE BONUS - Value becomes useless in compiled lane!
                }

                return { laneIndex, score };
            });
            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_lane_for_shift': {
            // After selecting WHICH card to shift, now select WHERE to shift it
            const { cardToShiftId, cardOwner, originalLaneIndex, sourceCardId } = action;
            const cardToShift = findCardOnBoard(state, cardToShiftId)?.card;
            if (!cardToShift) return { type: 'skip' };

            // CRITICAL: Check if this is Gravity-1 shift (must shift TO or FROM Gravity lane)
            const sourceCard = findCardOnBoard(state, sourceCardId)?.card;
            let gravityLaneIndex: number | null = null;
            if (sourceCard && sourceCard.protocol === 'Gravity' && sourceCard.value === 1) {
                // Find which lane has the Gravity-1 card
                for (let i = 0; i < 3; i++) {
                    const allLanes = [...state.player.lanes[i], ...state.opponent.lanes[i]];
                    if (allLanes.some(c => c.id === sourceCardId)) {
                        gravityLaneIndex = i;
                        break;
                    }
                }
            }

            let possibleLanes = [0, 1, 2].filter(i => i !== originalLaneIndex);

            // If Gravity-1: Only allow shifts TO or FROM the Gravity lane
            if (gravityLaneIndex !== null) {
                if (originalLaneIndex === gravityLaneIndex) {
                    // Shifting FROM Gravity lane - can go to any other lane
                    possibleLanes = possibleLanes; // Already filtered
                } else {
                    // Shifting TO Gravity lane - MUST go to Gravity lane only
                    possibleLanes = [gravityLaneIndex];
                }
            }

            // CRITICAL: Check if this is Anarchy-1 shift (must shift to NON-matching protocol lane)
            if (sourceCard && sourceCard.protocol === 'Anarchy' && sourceCard.value === 1) {
                // Filter out lanes where the card's protocol matches either protocol in the lane
                possibleLanes = possibleLanes.filter(laneIndex => {
                    const playerProtocol = state.player.protocols[laneIndex];
                    const opponentProtocol = state.opponent.protocols[laneIndex];
                    const cardProtocol = cardToShift.protocol;
                    // Keep lane ONLY if card protocol does NOT match either protocol
                    return cardProtocol !== playerProtocol && cardProtocol !== opponentProtocol;
                });
            }

            // Use universal scoring function
            const scoredLanes = possibleLanes.map(laneIndex => ({
                laneIndex,
                score: scoreLaneForShiftTarget(cardToShift, cardOwner, laneIndex, state)
            }));

            scoredLanes.sort((a, b) => b.score - a.score); // Highest score wins
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_own_card_to_shift_for_speed_3': {
            // Speed-3: Shift 1 of YOUR cards (AI's own cards), then flip Speed-3 itself
            // Card loses value (3→2), so ONLY shift if:
            // 1. Source lane is COMPILED (wasted value anyway) → shift to best uncompiled
            // 2. Target lane can COMPILE with +2 (strategic win)

            const candidates: { card: PlayedCard; sourceLaneIndex: number; bestScore: number }[] = [];

            state.opponent.lanes.forEach((lane, sourceLaneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];

                const sourceIsCompiled = state.opponent.compiled[sourceLaneIndex];
                let bestScore = -Infinity;

                // Check all possible target lanes for this card
                for (let targetLaneIndex = 0; targetLaneIndex < 3; targetLaneIndex++) {
                    if (targetLaneIndex === sourceLaneIndex) continue;

                    const targetLaneValue = state.opponent.laneValues[targetLaneIndex];
                    const targetIsCompiled = state.opponent.compiled[targetLaneIndex];

                    if (targetIsCompiled) continue; // Don't shift TO compiled lanes

                    // Calculate future value after shift (card becomes 2 when flipped)
                    const futureTargetValue = targetLaneValue + 2;
                    const playerTargetValue = state.player.laneValues[targetLaneIndex];

                    let score = 0;

                    // Strategy 1: Source is COMPILED → good to move out
                    if (sourceIsCompiled) {
                        score += 10000;
                        // Prefer targets that are close to compiling
                        if (futureTargetValue >= 10 && futureTargetValue > playerTargetValue) {
                            score += 50000; // Can compile!
                        } else if (futureTargetValue >= 8) {
                            score += 5000; // Close to compile
                        }
                    }
                    // Strategy 2: Source is NOT compiled, but target can COMPILE
                    else if (futureTargetValue >= 10 && futureTargetValue > playerTargetValue) {
                        score += 50000; // Worth losing 1 value to compile another lane!
                    }
                    // Otherwise: Bad move - loses value for no reason
                    else {
                        score = -10000;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                    }
                }

                candidates.push({ card: topCard, sourceLaneIndex, bestScore });
            });

            if (candidates.length === 0) {
                return { type: 'skip' };
            }

            candidates.sort((a, b) => b.bestScore - a.bestScore);

            // Only shift if it makes strategic sense (positive score)
            if (candidates[0].bestScore > 0) {
                return { type: 'shiftCard', cardId: candidates[0].card.id };
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
                const playerHandSizeModifier = 5 - state.player.hand.length;
                const score = (playerTargets * (12 + playerHandSizeModifier)) - (opponentTargets * 6);
                return { laneIndex: i, score };
            });
            // Always pick the lane with the highest score (even if negative, pick least bad option)
            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);

        case 'prompt_swap_protocols': {
            // Spirit-4: Swap own protocols (target = 'opponent')
            // Anarchy-3: Swap opponent's protocols (target = 'player')
            const { target } = action;
            const targetProtocols = state[target].protocols;
            const targetHand = state[target].hand;

            const possibleSwaps: [number, number][] = [[0, 1], [0, 2], [1, 2]];
            let bestSwap: [number, number] = [0, 1];
            let bestScore = -Infinity;

            for (const swap of possibleSwaps) {
                const [i, j] = swap;
                const newProtocols = [...targetProtocols];
                [newProtocols[i], newProtocols[j]] = [newProtocols[j], newProtocols[i]];
                let score = 0;

                // Evaluate based on whose protocols we're swapping
                if (target === 'opponent') {
                    // Spirit-4: We're swapping our own protocols - maximize playability
                    for (const card of targetHand) {
                        const couldPlayBeforeI = card.protocol === targetProtocols[i];
                        const couldPlayBeforeJ = card.protocol === targetProtocols[j];
                        const canPlayNowI = card.protocol === newProtocols[i];
                        const canPlayNowJ = card.protocol === newProtocols[j];
                        if (canPlayNowI && !couldPlayBeforeI) score += calculateEffectBaseScore(card, state);
                        if (canPlayNowJ && !couldPlayBeforeJ) score += calculateEffectBaseScore(card, state);
                        if (!canPlayNowI && couldPlayBeforeI) score -= calculateEffectBaseScore(card, state);
                        if (!canPlayNowJ && couldPlayBeforeJ) score -= calculateEffectBaseScore(card, state);
                    }
                } else {
                    // Anarchy-3: We're swapping opponent's protocols - minimize their playability
                    for (const card of targetHand) {
                        const couldPlayBeforeI = card.protocol === targetProtocols[i];
                        const couldPlayBeforeJ = card.protocol === targetProtocols[j];
                        const canPlayNowI = card.protocol === newProtocols[i];
                        const canPlayNowJ = card.protocol === newProtocols[j];
                        // Inverted logic: we WANT to make their cards less playable
                        if (canPlayNowI && !couldPlayBeforeI) score -= calculateEffectBaseScore(card, state);
                        if (canPlayNowJ && !couldPlayBeforeJ) score -= calculateEffectBaseScore(card, state);
                        if (!canPlayNowI && couldPlayBeforeI) score += calculateEffectBaseScore(card, state);
                        if (!canPlayNowJ && couldPlayBeforeJ) score += calculateEffectBaseScore(card, state);
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestSwap = swap;
                }
            }
            return { type: 'resolveSwapProtocols', indices: bestSwap };
        }

        case 'select_card_to_shift_for_anarchy_0': {
            // Anarchy-0: "Shift 1 card" - NO restrictions, any card can be shifted anywhere
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            // Evaluate ALL cards (own + opponent) and pick the best to shift
            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                const score = scoreCardForShift(topCard, 'opponent', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                const score = scoreCardForShift(topCard, 'player', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            if (targets.length === 0) return { type: 'skip' };

            // Pick highest score
            targets.sort((a, b) => b.score - a.score);
            return { type: 'shiftCard', cardId: targets[0].card.id };
        }

        case 'select_card_to_shift_for_anarchy_1': {
            // Anarchy-1: "Shift 1 other card to a line without a matching protocol"
            // RESTRICTION: Cannot shift the Anarchy-1 card itself, and must shift to non-matching lane
            const { sourceCardId } = action;
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            // Evaluate ALL OTHER cards (own + opponent) excluding the Anarchy-1 card itself
            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                if (topCard.id === sourceCardId) return; // Skip Anarchy-1 itself
                const score = scoreCardForShift(topCard, 'opponent', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                if (topCard.id === sourceCardId) return; // Skip Anarchy-1 itself
                const score = scoreCardForShift(topCard, 'player', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            if (targets.length === 0) return { type: 'skip' };

            // Pick highest score (laneResolver will validate non-matching protocol requirement)
            targets.sort((a, b) => b.score - a.score);
            return { type: 'shiftCard', cardId: targets[0].card.id };
        }

        case 'select_card_to_shift_for_gravity_1': {
            // Gravity-1: "Shift 1 card either to or from this line"
            // RESTRICTION: The shift must involve the Gravity-1's lane (either as source OR destination)
            const { sourceLaneIndex } = action;

            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            // Evaluate ALL cards (own + opponent) and pick the best to shift
            // The laneResolver will validate that the shift involves sourceLaneIndex
            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                const score = scoreCardForShift(topCard, 'opponent', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                const score = scoreCardForShift(topCard, 'player', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            if (targets.length === 0) return { type: 'skip' };

            // Pick highest score
            targets.sort((a, b) => b.score - a.score);
            return { type: 'shiftCard', cardId: targets[0].card.id };
        }

        case 'select_card_to_flip_and_shift_for_gravity_2': {
            // Gravity-2: Flip any uncovered card, then shift it to target lane
            // Use scoreCardForFlip to choose which card to flip (and thus shift)
            const targets: { card: PlayedCard; laneIndex: number; owner: Player; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    const score = scoreCardForFlip(topCard, 'player', laneIndex, state);
                    targets.push({ card: topCard, laneIndex, owner: 'player', score });
                }
            });

            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    const score = scoreCardForFlip(topCard, 'opponent', laneIndex, state);
                    targets.push({ card: topCard, laneIndex, owner: 'opponent', score });
                }
            });

            if (targets.length === 0) return { type: 'skip' };
            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].card.id };
        }

        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex } = action;
            // Gravity-4 shifts a face-down card FROM any other lane TO targetLaneIndex (where Gravity-4 is)
            // Strategy differs based on whose card we're shifting:
            // - PLAYER cards: Take from lanes where player is winning/strong → weakens player
            // - OWN cards: Only if no player cards available, take from where we're already strong → consolidate strength

            let bestTarget: PlayedCard | null = null;
            let bestScore = -Infinity;

            // Priority 1: Shift PLAYER's face-down cards (weakens them, strengthens us)
            for (let i = 0; i < 3; i++) {
                if (i === targetLaneIndex) continue;

                const faceDownCards = state.player.lanes[i].filter(c => !c.isFaceUp);
                if (faceDownCards.length === 0) continue;

                // Only top card is targetable (uncovered)
                const topCard = state.player.lanes[i][state.player.lanes[i].length - 1];
                if (topCard.isFaceUp) continue;

                const playerValue = state.player.laneValues[i];
                const opponentValue = state.opponent.laneValues[i];
                const playerLead = playerValue - opponentValue;

                // Calculate face-down value
                const hasDarkness2InLane = state.player.lanes[i].some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
                const faceDownValue = hasDarkness2InLane ? 4 : 2;

                // Score: Prefer taking from lanes where:
                // 1. Player is ahead (high playerLead)
                // 2. Player is close to compile (playerValue >= 8)
                // 3. Higher value face-down cards
                let score = faceDownValue * 5;

                if (playerLead > 0) {
                    score += playerLead * 10; // Heavily prioritize lanes where player is winning
                }

                if (playerValue >= 8) {
                    score += 50; // Block potential compile
                }

                // Special: If player could compile this lane, this is CRITICAL
                if (playerValue >= 10 && playerValue > opponentValue && !state.player.compiled[i]) {
                    score += 200;
                }

                // CRITICAL: Check if SOURCE lane (i) is compiled
                const isSourceCompiled = state.player.compiled[i];

                // CRITICAL: Player card shifts TO player's targetLaneIndex (same side!)
                const futurePlayerValue = state.player.laneValues[targetLaneIndex] + faceDownValue;
                const targetOpponentValue = state.opponent.laneValues[targetLaneIndex];

                // BAD: Shifting TO target would allow player to compile/recompile there
                if (futurePlayerValue >= 10 && futurePlayerValue > targetOpponentValue && !state.player.compiled[targetLaneIndex]) {
                    score -= 500; // HUGE PENALTY - Player can compile at destination!
                }
                // GOOD: Destination is compiled, so value becomes useless there!
                else if (state.player.compiled[targetLaneIndex]) {
                    score += 400; // HUGE BONUS - Destination is compiled, value is wasted!
                }
                // ALSO GOOD: Source is compiled
                else if (isSourceCompiled) {
                    score += 300; // BONUS - Removing from compiled lane!
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = topCard;
                }
            }

            if (bestTarget) return { type: 'deleteCard', cardId: bestTarget.id };

            // Priority 2: Shift OWN face-down cards (only if no player cards available)
            // Strategy: Take from lanes where we're already dominant (least harm)
            for (let i = 0; i < 3; i++) {
                if (i === targetLaneIndex) continue;

                const topCard = state.opponent.lanes[i][state.opponent.lanes[i].length - 1];
                if (!topCard || topCard.isFaceUp) continue;

                const opponentValue = state.opponent.laneValues[i];
                const playerValue = state.player.laneValues[i];
                const opponentLead = opponentValue - playerValue;

                // Calculate face-down value
                const hasDarkness2InLane = state.opponent.lanes[i].some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
                const faceDownValue = hasDarkness2InLane ? 4 : 2;

                // Score: Prefer taking from lanes where:
                // 1. We're already far ahead (high opponentLead) - least damage
                // 2. We've already compiled (no harm done)
                let score = 0;

                if (state.opponent.compiled[i]) {
                    score += 100; // Already compiled, can safely take from here
                }

                if (opponentLead > 3) {
                    score += opponentLead * 5; // Safe to take from dominant lanes
                }

                // Consider if target lane benefits
                const targetValue = state.opponent.laneValues[targetLaneIndex];
                const targetPlayerValue = state.player.laneValues[targetLaneIndex];
                if (targetValue + faceDownValue >= 10 && targetValue + faceDownValue > targetPlayerValue && !state.opponent.compiled[targetLaneIndex]) {
                    score += 150; // Strong incentive if it helps us compile
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = topCard;
                }
            }

            if (bestTarget) return { type: 'deleteCard', cardId: bestTarget.id };
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_shift_for_darkness_4': {
            // Darkness-4: Shift 1 face-down card (any player)
            // Strategy: Prioritize shifting PLAYER cards from strong lanes, or OWN cards from already-compiled lanes
            const potentialTargets: { cardId: string; score: number; owner: Player }[] = [];

            // PLAYER CARDS: Take from strong lanes (weakens them)
            state.player.lanes.forEach((lane, i) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        const playerValue = state.player.laneValues[i];
                        const opponentValue = state.opponent.laneValues[i];
                        const playerLead = playerValue - opponentValue;

                        // Calculate face-down value
                        const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
                        const faceDownValue = hasDarkness2 ? 4 : 2;

                        // Higher score = better to shift
                        let score = faceDownValue * 3;

                        // CRITICAL: Check if SOURCE lane is compiled
                        const isCompiled = state.player.compiled[i];

                        if (playerLead > 0) {
                            score += playerLead * 8; // Prioritize lanes where player is winning
                        }

                        // Critical: If player could compile, this is HIGH priority
                        if (playerValue >= 10 && playerValue > opponentValue && !state.player.compiled[i]) {
                            score += 150;
                        } else if (playerValue >= 8) {
                            score += 40; // Near compile
                        }

                        // CRITICAL: If source is compiled, HUGE BONUS (value is useless there!)
                        if (isCompiled) {
                            score += 300;
                        }

                        potentialTargets.push({ cardId: topCard.id, score, owner: 'player' });
                    }
                }
            });

            // OWN CARDS: Only shift from already-compiled lanes or lanes we're far ahead in
            state.opponent.lanes.forEach((lane, i) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        const opponentValue = state.opponent.laneValues[i];
                        const playerValue = state.player.laneValues[i];
                        const opponentLead = opponentValue - playerValue;

                        let score = 0;

                        // Only consider shifting if:
                        // 1. Already compiled (safe to move)
                        if (state.opponent.compiled[i]) {
                            score = 50;
                        }
                        // 2. Far ahead (opponentLead > 5)
                        else if (opponentLead > 5) {
                            score = 25 + opponentLead * 2;
                        }
                        // Otherwise, very low priority (don't weaken our position)

                        potentialTargets.push({ cardId: topCard.id, score, owner: 'opponent' });
                    }
                }
            });

            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: potentialTargets[0].cardId };
            }
            return { type: 'skip' };
        }

        case 'select_opponent_face_down_card_to_shift': {
            // Shift OPPONENT's face-down card (disrupt them)
            // Rule: ONLY face-down cards from opponent
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                if (!topCard.isFaceUp) {
                    // Use universal shift logic for opponent cards
                    const score = scoreCardForShift(topCard, 'player', laneIndex, state);
                    targets.push({ card: topCard, laneIndex, score });
                }
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'shiftCard', cardId: targets[0].card.id }; // FIX: shiftCard not deleteCard!
        }

        case 'select_any_opponent_card_to_shift': {
            // Shift ANY opponent card (face-up or face-down, disrupt them)
            // Use universal shift logic
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                const score = scoreCardForShift(topCard, 'player', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'shiftCard', cardId: targets[0].card.id }; // FIX: shiftCard not deleteCard!
        }

        case 'select_card_from_hand_to_play': {
            // Speed-0 or Darkness-3: Play another card from hand
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            const playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);
            if (playableLanes.length === 0) return { type: 'skip' };

            // CRITICAL: Check if the effect FORCES face-down play (e.g., Darkness-3)
            const isForcedFaceDown = action.isFaceDown === true;

            // Score each possible play strategically
            const scoredPlays: { cardId: string; laneIndex: number; isFaceUp: boolean; score: number }[] = [];

            for (const card of state.opponent.hand) {
                for (const laneIndex of playableLanes) {
                    // If forced face-down (Darkness-3), ONLY consider face-down plays
                    if (!isForcedFaceDown) {
                        // Check if AI has Spirit-1 or Chaos-3 (allows playing any protocol face-up)
                        const aiHasSpirit1 = state.opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

                        // Check for Chaos-3: Must be uncovered (last in lane) AND face-up
                        const aiHasChaos3 = state.opponent.lanes.some((lane) => {
                            if (lane.length === 0) return false;
                            const uncoveredCard = lane[lane.length - 1];
                            return uncoveredCard.isFaceUp && uncoveredCard.protocol === 'Chaos' && uncoveredCard.value === 3;
                        });

                        const canPlayFaceUp = card.protocol === state.opponent.protocols[laneIndex] || card.protocol === state.player.protocols[laneIndex] || aiHasSpirit1 || aiHasChaos3;

                        if (canPlayFaceUp) {
                            const valueToAdd = card.value;
                            const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                            let score = calculateEffectBaseScore(card, state) + valueToAdd * 2;

                            if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                                score += 500; // Compile setup
                            }

                            scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: true, score });
                        }
                    }

                    // Face-down play (always considered, and ONLY option if forced)
                    const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[laneIndex]);
                    const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                    let score = valueToAdd * 2;

                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                        score += 400;
                    }

                    scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: false, score });
                }
            }

            if (scoredPlays.length === 0) return { type: 'skip' };

            scoredPlays.sort((a, b) => b.score - a.score);
            const best = scoredPlays[0];
            return { type: 'playCard', cardId: best.cardId, laneIndex: best.laneIndex, isFaceUp: best.isFaceUp };
        }

        case 'select_card_from_hand_to_give': {
            // Love-1: Give weakest card
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => calculateEffectBaseScore(a, state) - calculateEffectBaseScore(b, state));
            return { type: 'giveCard', cardId: sortedHand[0].id };
        }

        case 'select_card_from_hand_to_reveal': {
            // Psychic-1: Reveal strongest card for psychological effect
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => calculateEffectBaseScore(b, state) - calculateEffectBaseScore(a, state));
            return { type: 'revealCard', cardId: sortedHand[0].id };
        }

        case 'plague_2_opponent_discard': {
            // Plague-2: Opponent forces us to discard 1 card
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            // Discard weakest card (lowest power)
            const sortedHand = [...state.opponent.hand].sort((a, b) => calculateEffectBaseScore(a, state) - calculateEffectBaseScore(b, state));
            return { type: 'resolvePlague2Discard', cardIds: [sortedHand[0].id] };
        }

        case 'select_cards_from_hand_to_discard_for_fire_4': {
            // Fire-4: Discard up to 3 to draw that many +1
            const maxDiscard = Math.min(3, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            // Discard weakest cards to draw better ones
            const sortedHand = [...state.opponent.hand].sort((a, b) => calculateEffectBaseScore(a, state) - calculateEffectBaseScore(b, state));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'resolveFire4Discard', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_cards_from_hand_to_discard_for_hate_1': {
            // Hate-1: Must discard specified number of cards
            const maxDiscard = Math.min(action.count, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            // Discard weakest cards (keep disruption and high power)
            const sortedHand = [...state.opponent.hand].sort((a, b) => calculateEffectBaseScore(a, state) - calculateEffectBaseScore(b, state));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'resolveHate1Discard', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_lane_for_death_2': {
            // Death-2: Delete all value 1-2 cards in a lane
            const scoredLanes = [0, 1, 2].map(laneIndex => {
                let playerCardsDeleted = 0;
                let opponentCardsDeleted = 0;

                state.player.lanes[laneIndex].forEach(c => {
                    if (c.isFaceUp && (c.value === 1 || c.value === 2)) playerCardsDeleted++;
                });
                state.opponent.lanes[laneIndex].forEach(c => {
                    if (c.isFaceUp && (c.value === 1 || c.value === 2)) opponentCardsDeleted++;
                });

                // Prioritize lanes with more player cards to delete
                const score = playerCardsDeleted * 10 - opponentCardsDeleted * 5;
                return { laneIndex, score };
            });

            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_card_to_return': {
            // Fire-2 or other return effects: Return card (only uncovered cards are valid)
            const validPlayerCards: PlayedCard[] = [];
            state.player.lanes.forEach(lane => {
                if (lane.length > 0) {
                    // Only the top card (uncovered) is targetable
                    validPlayerCards.push(lane[lane.length - 1]);
                }
            });

            if (validPlayerCards.length > 0) {
                validPlayerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'returnCard', cardId: validPlayerCards[0].id };
            }

            // Fallback: Return own uncovered card
            const validOwnCards: PlayedCard[] = [];
            state.opponent.lanes.forEach(lane => {
                if (lane.length > 0) {
                    validOwnCards.push(lane[lane.length - 1]);
                }
            });

            if (validOwnCards.length > 0) {
                validOwnCards.sort((a, b) => getCardThreat(a, 'opponent', state) - getCardThreat(b, 'opponent', state));
                return { type: 'returnCard', cardId: validOwnCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_opponent_card_to_return': {
            // Psychic-4: Return player's card (only uncovered cards are valid)
            const validCards: PlayedCard[] = [];
            state.player.lanes.forEach(lane => {
                if (lane.length > 0) {
                    // Only the top card (uncovered) is targetable
                    validCards.push(lane[lane.length - 1]);
                }
            });

            if (validCards.length > 0) {
                validCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'returnCard', cardId: validCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_lane_for_play': {
            // Life-0 or other: Choose lane for a specific card to play
            const { cardInHandId, disallowedLaneIndex } = action;
            const card = state.opponent.hand.find(c => c.id === cardInHandId);
            if (!card) return { type: 'skip' };

            const playableLanes = [0, 1, 2].filter(i => i !== disallowedLaneIndex);
            const scoredLanes = playableLanes.map(laneIndex => {
                const valueToAdd = action.isFaceDown
                    ? getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[laneIndex])
                    : card.value;
                const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                let score = resultingValue - state.player.laneValues[laneIndex];
                if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                    score += 200;
                }
                return { laneIndex, score };
            });

            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_lane_for_life_3_play': {
            // Life-3: Top deck play - choose best lane
            const playableLanes = [0, 1, 2];
            const scoredLanes = playableLanes.map(laneIndex => {
                const lead = state.opponent.laneValues[laneIndex] - state.player.laneValues[laneIndex];
                return { laneIndex, score: lead };
            });
            scoredLanes.sort((a, b) => a.score - b.score); // Weakest lane
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_face_down_card_to_delete': {
            // Death-3: Delete face-down UNCOVERED card only (top card of lane)
            // STRATEGIC: Prioritize player's face-down cards in NON-COMPILED, high-value lanes
            const targets: { cardId: string; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1]; // Only uncovered card
                    if (!topCard.isFaceUp) {
                        const laneValue = state.player.laneValues[laneIndex];
                        const isCompiled = state.player.compiled[laneIndex];
                        const compiledPenalty = isCompiled ? -1000 : 0; // Huge penalty for compiled lanes
                        targets.push({ cardId: topCard.id, score: laneValue + 10 + compiledPenalty });
                    }
                }
            });

            if (targets.length > 0) {
                targets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: targets[0].cardId };
            }

            // Fallback: own face-down uncovered cards
            state.opponent.lanes.forEach((lane) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) targets.push({ cardId: topCard.id, score: -5 });
                }
            });

            if (targets.length > 0) {
                targets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: targets[0].cardId };
            }

            return { type: 'skip' };
        }

        case 'select_own_other_card_to_shift': {
            // Speed-3 mid-game: Shift own card (not the source)
            // Use universal shift logic
            const targets: { card: PlayedCard; laneIndex: number; score: number }[] = [];

            state.opponent.lanes.forEach((lane, laneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];
                if (topCard.id === action.sourceCardId) return; // Exclude source card

                const score = scoreCardForShift(topCard, 'opponent', laneIndex, state);
                targets.push({ card: topCard, laneIndex, score });
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'shiftCard', cardId: targets[0].card.id }; // FIX: shiftCard not deleteCard!
        }

        case 'select_lane_to_shift_cards_for_light_3': {
            // Light-3: Shift all face-down cards from sourceLaneIndex to a target lane
            // Source lane is already determined by the effect, AI chooses target
            const sourceLaneIndex = action.sourceLaneIndex;
            const actor = action.actor;

            // Available target lanes (exclude source lane)
            const targetLanes = [0, 1, 2].filter(i => i !== sourceLaneIndex);

            if (targetLanes.length === 0) return { type: 'skip' };

            // Score each target lane
            const scores = targetLanes.map(targetIndex => {
                let score = 0;

                // Prefer shifting to weaker lanes to build them up
                const targetValue = state[actor].laneValues[targetIndex];
                score += (10 - targetValue) * 10; // Higher score for weaker lanes

                // Prefer uncompiled lanes
                if (!state[actor].compiled[targetIndex]) {
                    score += 100;
                }

                return { laneIndex: targetIndex, score };
            });

            scores.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scores[0].laneIndex };
        }

        case 'select_lane_to_shift_revealed_card_for_light_2': {
            // Light-2: Select a lane to shift the revealed card to
            const revealedCardId = action.revealedCardId;

            // Find the card and its current lane
            let cardOwner: 'player' | 'opponent' | null = null;
            let originalLaneIndex: number | null = null;

            for (let i = 0; i < 3; i++) {
                if (state.opponent.lanes[i].some(c => c.id === revealedCardId)) {
                    cardOwner = 'opponent';
                    originalLaneIndex = i;
                    break;
                }
                if (state.player.lanes[i].some(c => c.id === revealedCardId)) {
                    cardOwner = 'player';
                    originalLaneIndex = i;
                    break;
                }
            }

            // Select a different lane
            let possibleLanes = [0, 1, 2];
            if (originalLaneIndex !== null) {
                possibleLanes = possibleLanes.filter(l => l !== originalLaneIndex);
            }

            if (possibleLanes.length > 0) {
                // Choose lane with fewest cards (strategic choice)
                const targetLanes = cardOwner === 'opponent' ? state.opponent.lanes : state.player.lanes;
                possibleLanes.sort((a, b) => targetLanes[a].length - targetLanes[b].length);
                return { type: 'selectLane', laneIndex: possibleLanes[0] };
            }

            return { type: 'skip' };
        }

        case 'select_lane_for_metal_3_delete': {
            // Metal-3: Delete highest value card from a lane
            const scoredLanes = [0, 1, 2].map(laneIndex => {
                const playerCards = state.player.lanes[laneIndex];
                const maxValue = Math.max(...playerCards.map(c => c.isFaceUp ? c.value : 2), 0);
                return { laneIndex, score: maxValue };
            });

            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }
        case 'select_lane_for_delete_all': {
            // Generic handler for delete all in lane (custom protocols)
            // Strategic: Pick lane where opponent has most value
            const validLanes = 'validLanes' in action ? action.validLanes : [0, 1, 2];
            if (validLanes.length > 0) {
                const scoredLanes = validLanes.map((laneIndex: number) => {
                    const playerCards = state.player.lanes[laneIndex];
                    const playerValue = playerCards.reduce((sum, c) => sum + (c.isFaceUp ? c.value : 2), 0);
                    return { laneIndex, score: playerValue };
                });
                scoredLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
            return { type: 'skip' };
        }

        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: true };
        case 'prompt_give_card_for_love_1':
            // Love-1: Give 1 card to opponent, draw 2
            // SKIP: Giving cards to opponent is bad even with +1 net card advantage
            // - Opponent gets more options
            // - Might give away good cards
            // - Better to keep card quality high
            return { type: 'resolveLove1Prompt', accept: false };
        case 'plague_4_player_flip_optional': {
            // Plague-4: May flip the card face-up
            // Strategic: Flip if the card has good ongoing effects or we want it revealed
            if (action.sourceCardId) {
                const cardInfo = findCardOnBoard(state, action.sourceCardId);
                if (cardInfo && !cardInfo.card.isFaceUp) {
                    // If card is face-down, flip it to activate its abilities
                    const card = cardInfo.card;
                    const hasGoodUncoverEffect = card.keywords.flip || card.keywords.shift || card.keywords.draw;
                    if (hasGoodUncoverEffect) {
                        return { type: 'resolvePlague4Flip', accept: true };
                    }
                }
            }
            return { type: 'resolvePlague4Flip', accept: false };
        }
        case 'prompt_fire_3_discard': {
            // Fire-3 End: Discard 1 to flip 1
            // Only accept if we have cards to discard AND flipping would be beneficial
            if (state.opponent.hand.length <= 1) return { type: 'resolveFire3Prompt', accept: false };

            // Evaluate all potential flip targets
            const getUncovered = (p: Player): PlayedCard[] => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const allUncoveredPlayer = getUncovered('player');
            const allUncoveredOpponent = getUncovered('opponent');

            let bestScore = -999;

            // Check player's own cards
            allUncoveredPlayer.forEach(c => {
                if (c.isFaceUp) {
                    // Flip face-up to face-down - good! Removes threat
                    const threat = getCardThreat(c, 'player', state);
                    const score = threat + 10; // Positive score for hiding threats
                    if (score > bestScore) bestScore = score;
                }
            });

            // Check opponent's cards
            allUncoveredOpponent.forEach(c => {
                if (!c.isFaceUp) {
                    // Flipping opponent face-down to face-up
                    // BAD if it increases their value significantly
                    const currentValue = getCardThreat(c, 'opponent', state);
                    const potentialValue = getCardThreat({ ...c, isFaceUp: true }, 'opponent', state);
                    const valueGain = potentialValue - currentValue;

                    // NEGATIVE score if flipping increases opponent value
                    // Only consider if it actually helps us (reduces their threat)
                    const score = -valueGain; // Negative gain = positive score
                    if (score > bestScore) bestScore = score;
                } else {
                    // Flipping opponent face-up to face-down
                    // GOOD! Reduces their value
                    const threat = getCardThreat(c, 'opponent', state);
                    const score = threat + 10;
                    if (score > bestScore) bestScore = score;
                }
            });

            // Only accept if best score is positive (beneficial)
            return { type: 'resolveFire3Prompt', accept: bestScore > 5 };
        }
        case 'prompt_shift_for_speed_3': {
            // Speed-3 End: Shift 1 of your cards from other protocols
            // CRITICAL: Use the SAME logic as select_own_card_to_shift_for_speed_3
            // to determine if shifting is strategically beneficial!

            const candidates: { card: PlayedCard; sourceLaneIndex: number; bestScore: number }[] = [];

            state.opponent.lanes.forEach((lane, sourceLaneIndex) => {
                if (lane.length === 0) return;
                const topCard = lane[lane.length - 1];

                const sourceIsCompiled = state.opponent.compiled[sourceLaneIndex];
                let bestScore = -Infinity;

                // Check all possible target lanes for this card
                for (let targetLaneIndex = 0; targetLaneIndex < 3; targetLaneIndex++) {
                    if (targetLaneIndex === sourceLaneIndex) continue;

                    const targetLaneValue = state.opponent.laneValues[targetLaneIndex];
                    const targetIsCompiled = state.opponent.compiled[targetLaneIndex];

                    if (targetIsCompiled) continue; // Don't shift TO compiled lanes

                    // Calculate future value after shift (card becomes 2 when flipped)
                    const futureTargetValue = targetLaneValue + 2;
                    const playerTargetValue = state.player.laneValues[targetLaneIndex];

                    let score = 0;

                    // Strategy 1: Source is COMPILED → good to move out
                    if (sourceIsCompiled) {
                        score += 10000;
                        // Prefer targets that are close to compiling
                        if (futureTargetValue >= 10 && futureTargetValue > playerTargetValue) {
                            score += 50000; // Can compile!
                        } else if (futureTargetValue >= 8) {
                            score += 5000; // Close to compile
                        }
                    }
                    // Strategy 2: Source is NOT compiled, but target can COMPILE
                    else if (futureTargetValue >= 10 && futureTargetValue > playerTargetValue) {
                        score += 50000; // Worth losing 1 value to compile another lane!
                    }
                    // Otherwise: Bad move - loses value for no reason
                    else {
                        score = -10000;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                    }
                }

                candidates.push({ card: topCard, sourceLaneIndex, bestScore });
            });

            if (candidates.length === 0) {
                return { type: 'resolveSpeed3Prompt', accept: false };
            }

            candidates.sort((a, b) => b.bestScore - a.bestScore);

            // Only accept if it makes strategic sense (positive score)
            const shouldAccept = candidates[0].bestScore > 0;
            return { type: 'resolveSpeed3Prompt', accept: shouldAccept };
        }
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: true };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: true };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };

        case 'flip_self_for_water_0': {
            // Water-0: Flip self after playing
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        case 'plague_2_player_discard': {
            // Player is forced to discard - AI doesn't need to do anything
            return { type: 'skip' };
        }

        case 'plague_4_opponent_delete': {
            // Plague-4: Opponent must delete their own UNCOVERED face-down card
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

        case 'reveal_opponent_hand': {
            // This action doesn't require a response from the AI
            return { type: 'skip' };
        }

        case 'prompt_shift_or_flip_for_light_2': {
            const { revealedCardId } = action;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'skip' };
            const { card, owner } = cardInfo;
            let flipScore = 0;
            if (owner === 'opponent') {
                flipScore = calculateEffectBaseScore(card, state) + card.value;
            } else {
                flipScore = -getCardThreat(card, 'player', state);
            }
            let shiftScore = 0;
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
                        if (owner === 'opponent') {
                            const newLead = (state.opponent.laneValues[targetLane] + getEffectiveCardValue(card, [])) - state.player.laneValues[targetLane];
                            const oldLead = state.opponent.laneValues[originalLaneIndex] - state.player.laneValues[originalLaneIndex];
                            currentLaneScore = newLead - oldLead;
                        } else {
                            const newPlayerLead = (state.player.laneValues[targetLane] + getEffectiveCardValue(card, [])) - state.opponent.laneValues[targetLane];
                            const oldPlayerLead = state.player.laneValues[originalLaneIndex] - state.opponent.laneValues[originalLaneIndex];
                            currentLaneScore = oldPlayerLead - newPlayerLead;
                        }
                        if (currentLaneScore > bestLaneScore) {
                            bestLaneScore = currentLaneScore;
                        }
                    }
                    shiftScore = bestLaneScore;
                }
            }
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
                validTargets.sort((a, b) => {
                    const aCompiled = state.player.compiled[a.laneIndex];
                    const bCompiled = state.player.compiled[b.laneIndex];

                    // CRITICAL: Prioritize compiled lanes (value is useless there!)
                    if (aCompiled && !bCompiled) return -1;
                    if (!aCompiled && bCompiled) return 1;

                    // Second: Higher lane value (more disruption)
                    const laneValueA = state.player.laneValues[a.laneIndex];
                    const laneValueB = state.player.laneValues[b.laneIndex];
                    if (laneValueA !== laneValueB) return laneValueB - laneValueA;

                    // Third: Higher threat cards
                    return getCardThreat(b.card, 'player', state) - getCardThreat(a.card, 'player', state);
                });
                return { type: 'shiftCard', cardId: validTargets[0].card.id }; // FIX: shiftCard not deleteCard!
            }
            return { type: 'skip' };
        }

        case 'select_own_covered_card_to_shift': {
            const validTargets: { card: PlayedCard; laneIndex: number }[] = [];
            for (let i = 0; i < state.opponent.lanes.length; i++) {
                const lane = state.opponent.lanes[i];
                for (let j = 0; j < lane.length - 1; j++) {
                    validTargets.push({ card: lane[j], laneIndex: i });
                }
            }
            if (validTargets.length > 0) {
                // Strategy: Shift cards from weak/unimportant lanes to stronger lanes
                validTargets.sort((a, b) => {
                    const aCompiled = state.opponent.compiled[a.laneIndex];
                    const bCompiled = state.opponent.compiled[b.laneIndex];

                    // Deprioritize compiled lanes (can't improve them further)
                    if (aCompiled && !bCompiled) return 1;
                    if (!aCompiled && bCompiled) return -1;

                    // Shift from lanes with lower value (less important)
                    const laneValueA = state.opponent.laneValues[a.laneIndex];
                    const laneValueB = state.opponent.laneValues[b.laneIndex];
                    if (laneValueA !== laneValueB) return laneValueA - laneValueB;

                    // Lower threat cards are better to move
                    return getCardThreat(a.card, 'opponent', state) - getCardThreat(b.card, 'opponent', state);
                });
                return { type: 'shiftCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        default:
            return { type: 'skip' };
    }
};

export const hardAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        // Compile lane with best strategic value
        const bestLane = state.compilableLanes.reduce((best, lane) => {
            const leadBest = state.opponent.laneValues[best] - state.player.laneValues[best];
            const leadCurrent = state.opponent.laneValues[lane] - state.player.laneValues[lane];
            const opponentCount = state.opponent.compiled.filter(c => c).length;

            // Prioritize first compile, then highest lead
            if (opponentCount === 0) return leadCurrent > leadBest ? lane : best;
            return leadCurrent > leadBest ? lane : best;
        });
        return { type: 'compile', laneIndex: bestLane };
    }

    if (state.phase === 'action') {
        return getBestMove(state);
    }

    return { type: 'fillHand' };
};
