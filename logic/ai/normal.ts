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
    getLaneFaceDownValueBoost
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
    // Position filter
    if (targetFilter.position === 'uncovered' && !isTopCard) return false;
    if (targetFilter.position === 'covered' && isTopCard) return false;

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

            // GENERIC: Check if card has "return own card" effect (like Water-4)
            // Only play face-up if we have OTHER uncovered cards we want to return.
            if (hasReturnOwnCardEffect(card as PlayedCard)) {
                let hasOtherUncoveredCards = false;
                for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                    if (laneIdx !== i && state.opponent.lanes[laneIdx].length > 0) {
                        hasOtherUncoveredCards = true;
                        break;
                    }
                }
                if (!hasOtherUncoveredCards) continue;
            }

            // GENERIC: Check if card has "delete self on cover" effect (like Metal-6)
            // Only play if it will reach compile threshold
            if (hasDeleteSelfOnCoverEffect(card as PlayedCard)) {
                const currentLaneValue = state.opponent.laneValues[i];
                const valueAfterPlaying = currentLaneValue + card.value;
                if (valueAfterPlaying < 10) continue;
                const playerValue = state.player.laneValues[i];
                if (valueAfterPlaying <= playerValue) continue;
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
            let canPlayFaceUp = playCheckFaceUp.allowed && !playerHasRequireFaceDownRule && !deleteHighestWouldSuicide;

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

                    // Setup own compile
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 120;
                        reason += ` [Compile setup]`;
                    } else if (resultingValue >= 8 && !state.opponent.compiled[i]) {
                        score += 40;
                        reason += ` [Near compile]`;
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
                }

                possibleMoves.push({
                    move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true },
                    score: addNoise(score),
                    reason
                });
            }

            // FACE-DOWN PLAY - use generic canPlayCard result
            if (playCheckFaceDown.allowed) {
                const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]);
                const resultingValue = state.opponent.laneValues[i] + valueToAdd;
                let score = 0;
                let reason = `Play ${card.protocol}-${card.value} face-down in lane ${i}`;

                if (canPlayerCompileThisLane) {
                    if (resultingValue > state.player.laneValues[i]) {
                        score = 170 + resultingValue * 5;
                        reason += ` [Blocks compile]`;
                    } else {
                        score = -140;
                        reason += ` [Fails to block]`;
                    }
                } else {
                    // Face-down value (usually 2) - decent but face-up high values are better
                    score += valueToAdd * 8;

                    // GENERIC: Bonus for cards with "delete highest own card" effect played face-down
                    // They still trigger their effect when uncovered later
                    if (hasDeleteHighestOwnCardEffect(card as PlayedCard)) {
                        score += 25;
                        reason += ` [Delete effect bonus]`;
                    }

                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 110;
                        reason += ` [Compile setup]`;
                    }

                    // Face-down is good for high-value cards we can't play face-up
                    // (saves them for later flip)
                    if (card.value >= 4 && !playCheckFaceUp.allowed) {
                        score += 20;
                        reason += ` [Saving high value]`;
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

    // Evaluate filling hand - only draw when hand is very low (0-1 cards)
    if (state.opponent.hand.length <= 1) {
        let fillHandScore = 8;

        if (state.opponent.hand.length === 0) {
            fillHandScore = 500; // Must draw - no cards
        } else {
            // 1 card left - prefer drawing but not as urgently
            fillHandScore = 80;
        }

        possibleMoves.push({ move: { type: 'fillHand' }, score: addNoise(fillHandScore), reason: "Refill hand" });
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
            // CRITICAL FIX: Check if rearrange would ACTUALLY be beneficial BEFORE deciding
            // Get the compiling lane index if this is during a compile
            const compilingLaneIndex = state.compilableLanes.length > 0 ? state.compilableLanes[0] : null;

            // Priority 1: Try to disrupt player if it actually hurts them
            // Pass compilingLaneIndex so that compiling lanes are treated as value 0
            if (canBenefitFromPlayerRearrange(state, compilingLaneIndex)) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }

            // Priority 2: Rearrange own protocols ONLY if it actually helps
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
            const targetFilter = ('targetFilter' in action ? action.targetFilter : {}) as TargetFilter;
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
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerUncovered = getUncovered('player');
            const opponentUncovered = getUncovered('opponent');

            const targets: { cardId: string; score: number }[] = [];

            // Player face-up cards (flip to face-down)
            playerUncovered.forEach(c => {
                if (c.isFaceUp) {
                    targets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) + 10 });
                } else if (!frost1Active) {
                    // Face-down: only flip if we're curious (low score) and Frost-1 is NOT active
                    targets.push({ cardId: c.id, score: 3 });
                }
            });

            // Own face-down cards (flip to activate) - Only if Frost-1 is NOT active
            if (!frost1Active) {
                opponentUncovered.forEach(c => {
                    if (!c.isFaceUp) {
                        targets.push({ cardId: c.id, score: c.value + 8 });
                    }
                });
            }

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].cardId };
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

            // CRITICAL: Check if the effect FORCES face-down play (e.g., Darkness-3)
            // effectInterpreter sends 'faceDown', not 'isFaceDown'
            const isForcedFaceDown = (action as any).faceDown === true;
            console.log('[AI select_card_from_hand_to_play] faceDown:', (action as any).faceDown, 'isForcedFaceDown:', isForcedFaceDown);

            // FIX: Filter out blocked lanes
            let playableLanes = [0, 1, 2].filter(i => i !== (action as any).disallowedLaneIndex);
            playableLanes = playableLanes.filter(laneIndex => {
                const opponentLane = state.player.lanes[laneIndex];
                const topCard = opponentLane.length > 0 ? opponentLane[opponentLane.length - 1] : null;

                // Check for Plague-0 block
                return !(topCard && topCard.isFaceUp && topCard.protocol === 'Plague' && topCard.value === 0);
            });

            if (playableLanes.length === 0) return { type: 'skip' };

            const scoredPlays: { cardId: string; laneIndex: number; isFaceUp: boolean; score: number }[] = [];

            for (const card of state.opponent.hand) {
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
            // FIX: Filter out blocked lanes
            let playableLanes = [0, 1, 2].filter(i => !('disallowedLaneIndex' in action) || i !== action.disallowedLaneIndex);
            playableLanes = playableLanes.filter(laneIndex => {
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

                        if (canPlayNowI && !couldPlayBeforeI) score += getCardPower(card);
                        if (canPlayNowJ && !couldPlayBeforeJ) score += getCardPower(card);
                        if (!canPlayNowI && couldPlayBeforeI) score -= getCardPower(card);
                        if (!canPlayNowJ && couldPlayBeforeJ) score -= getCardPower(card);
                    }
                } else {
                    // Anarchy-3: We're swapping opponent's protocols - minimize their playability
                    for (const card of targetHand) {
                        const couldPlayBeforeI = card.protocol === targetProtocols[i];
                        const couldPlayBeforeJ = card.protocol === targetProtocols[j];
                        const canPlayNowI = card.protocol === newProtocols[i];
                        const canPlayNowJ = card.protocol === newProtocols[j];

                        // Inverted logic: we WANT to make their cards less playable
                        if (canPlayNowI && !couldPlayBeforeI) score -= getCardPower(card);
                        if (canPlayNowJ && !couldPlayBeforeJ) score -= getCardPower(card);
                        if (!canPlayNowI && couldPlayBeforeI) score += getCardPower(card);
                        if (!canPlayNowJ && couldPlayBeforeJ) score += getCardPower(card);
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
                // Pick random lane (human-like)
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
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
            const targetFilter = (action as any).targetFilter || {};
            const valueFilter = (action as any).valueFilter;

            // Find lanes with matching cards and score them
            const scoredLanes: { laneIndex: number; score: number }[] = [];
            for (let i = 0; i < 3; i++) {
                let playerCardsReturned = 0;
                let ownCardsReturned = 0;
                const faceDownBoost = getLaneFaceDownValueBoost(state, i);
                const cardOwner = action.actor; // AI = opponent

                for (const p of ['player', 'opponent'] as Player[]) {
                    // Check owner filter
                    if (targetFilter.owner === 'own' && p !== cardOwner) continue;
                    if (targetFilter.owner === 'opponent' && p === cardOwner) continue;

                    const lane = state[p].lanes[i];
                    for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                        const card = lane[cardIdx];
                        const isUncovered = cardIdx === lane.length - 1;

                        // Check position filter
                        if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                        if (targetFilter.position === 'covered' && isUncovered) continue;

                        // Check value filter
                        if (valueFilter !== undefined) {
                            const cardValue = card.isFaceUp ? card.value : (2 + faceDownBoost);
                            if (cardValue !== valueFilter) continue;
                        }

                        if (p === 'player') playerCardsReturned++;
                        else ownCardsReturned++;
                    }
                }

                if (playerCardsReturned > 0 || ownCardsReturned > 0) {
                    // Score: prefer returning player's cards, avoid returning own
                    const score = playerCardsReturned * 10 - ownCardsReturned * 5;
                    scoredLanes.push({ laneIndex: i, score });
                }
            }

            if (scoredLanes.length > 0) {
                scoredLanes.sort((a, b) => b.score - a.score);
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
            const { effectDef, sourceCardId } = action as any;
            const effectAction = effectDef?.params?.action;

            // For 'give' actions (Love-1 End): ALWAYS skip
            // Giving a card to opponent is terrible - never do it
            if (effectAction === 'give') {
                return { type: 'resolveOptionalEffectPrompt', accept: false };
            }

            // For 'flip' actions on own cards: check if flipping improves or maintains value
            if (effectAction === 'flip' && sourceCardId) {
                const cardInfo = findCardOnBoard(state, sourceCardId);
                if (cardInfo && cardInfo.owner === 'opponent') {
                    const laneIndex = state.opponent.lanes.findIndex(lane =>
                        lane.some(c => c.id === sourceCardId)
                    );
                    if (laneIndex !== -1) {
                        const lane = state.opponent.lanes[laneIndex];
                        const faceUpValue = cardInfo.card.value;
                        const faceDownValue = getEffectiveCardValue(cardInfo.card, lane, state, laneIndex, 'opponent');

                        // Only flip if it strictly improves lane value
                        // Don't flip just to reveal information when values are equal
                        if (faceUpValue <= faceDownValue) {
                            return { type: 'resolveOptionalEffectPrompt', accept: false };
                        }
                    }
                }
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

                // PRIORITY 1: Check if flipping own face-down covered card could lead to compile (value >= 10)
                // IMPORTANT: Face-down card value depends on passive effects (e.g., Darkness-2 makes them worth 4)
                // Use getEffectiveCardValue to get the CURRENT face-down value, then compare with face-up value
                if (aiNotCompiled) {
                    let bestCompileFlip: { card: PlayedCard; newValue: number } | null = null;
                    let bestGainFlip: { card: PlayedCard; gain: number; newValue: number } | null = null;

                    for (const card of aiCovered) {
                        if (!card.isFaceUp) {
                            // Get current face-down value (accounts for Darkness-2, custom protocols, etc.)
                            const currentFaceDownValue = getEffectiveCardValue(card, aiLane, state, laneIndex, 'opponent');
                            // Face-up value is always the card's actual value
                            const faceUpValue = card.value;
                            // Gain from flipping = faceUpValue - currentFaceDownValue
                            const gain = faceUpValue - currentFaceDownValue;
                            const potentialValue = currentAiLaneValue + gain;

                            // Check if this enables compile
                            if (potentialValue >= 10) {
                                if (!bestCompileFlip || potentialValue > bestCompileFlip.newValue) {
                                    bestCompileFlip = { card, newValue: potentialValue };
                                }
                            }

                            // Track best value gain (only if gain > 0)
                            if (gain > 0 && (!bestGainFlip || gain > bestGainFlip.gain)) {
                                bestGainFlip = { card, gain, newValue: potentialValue };
                            }
                        }
                    }

                    // If we can compile, do it!
                    if (bestCompileFlip) {
                        return { type: 'flipCard', cardId: bestCompileFlip.card.id };
                    }

                    // If we can gain significant value (2+) and get close to compile (7+), do it
                    if (bestGainFlip && bestGainFlip.gain >= 2 && bestGainFlip.newValue >= 7) {
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
            console.log('[AI shift_flipped_card_optional] cardId:', cardId);
            const cardInfo = findCardOnBoard(state, cardId);
            if (!cardInfo) {
                console.log('[AI shift_flipped_card_optional] Card not found, skipping');
                return { type: 'skip' };
            }

            // Use laneIndex from findCardOnBoard if available
            let originalLaneIndex = cardInfo.laneIndex ?? -1;
            if (originalLaneIndex === -1) {
                const ownerState = state[cardInfo.owner];
                for (let i = 0; i < ownerState.lanes.length; i++) {
                    if (ownerState.lanes[i].some(c => c.id === cardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }
            }

            console.log('[AI shift_flipped_card_optional] originalLaneIndex:', originalLaneIndex);
            if (originalLaneIndex === -1) return { type: 'skip' };

            const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
            console.log('[AI shift_flipped_card_optional] possibleLanes:', possibleLanes);
            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                console.log('[AI shift_flipped_card_optional] Selected lane:', randomLane);
                return { type: 'selectLane', laneIndex: randomLane };
            }

            return { type: 'skip' };
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
            const currentLaneIndex = (action as any).currentLaneIndex; // Optional: restricts to specific lane
            const cardOwner = action.actor; // Who owns the source card (whose "opponent" we target)
            const sourceCardId = action.sourceCardId;
            const validTargets: { card: PlayedCard; owner: Player; laneIndex: number }[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                // CRITICAL: owner filter is relative to cardOwner, NOT hardcoded to 'opponent'
                // 'own' = cards belonging to cardOwner
                // 'opponent' = cards belonging to the opponent OF cardOwner
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    // If currentLaneIndex is set, only check that lane
                    if (currentLaneIndex !== undefined && laneIdx !== currentLaneIndex) continue;

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

                if (owner === 'player') {
                    // Flipping opponent's cards
                    if (card.isFaceUp) {
                        // Face-up -> Face-down: Good if high value
                        score = card.value * 10 + getCardThreat(card, 'player', state);
                    } else {
                        // Face-down -> Face-up: Risky, might help them
                        score = -20 + Math.random() * 10;
                    }
                } else {
                    // Flipping own cards
                    if (card.isFaceUp) {
                        // Face-up -> Face-down: Bad, lose value
                        score = -card.value * 10 - 50;
                    } else {
                        // Face-down -> Face-up: Good, gain value + effects
                        score = card.value * 8 + 30;
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
            const currentLaneIndex = (action as any).currentLaneIndex; // Optional: restricts to specific lane
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
                    // If currentLaneIndex is set, only check that lane
                    if (currentLaneIndex !== undefined && laneIdx !== currentLaneIndex) continue;

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
