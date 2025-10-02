/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IMPROVED HARD AI with Memory & Strategic Thinking
 */

import { GameState, ActionRequired, AIAction, PlayedCard, Player } from '../../types';
import { getEffectiveCardValue } from '../game/stateManager';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { handleControlRearrange } from './controlMechanicLogic';

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

const getCardPower = (card: PlayedCard): number => {
    let power = 12 - card.value; // Higher value for low-cost cards
    if (DISRUPTION_KEYWORDS.some(kw => card.keywords[kw])) power += 8;
    if (card.keywords['draw']) power += 4;
    if (card.keywords['play']) power += 10; // Very powerful
    if (card.keywords['prevent']) power += 6;
    return power;
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

    return { shouldDisrupt, shouldRush, needsDefense, criticalLane, oneAwayFromWin, closestToWin };
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

    // Evaluate all possible card plays
    for (const card of state.opponent.hand) {
        // Skip Water-4 if no cards on board
        if (card.protocol === 'Water' && card.value === 4 && state.opponent.lanes.flat().length === 0) continue;

        // Skip 0-value cards as first move (they often need other cards in play to be useful)
        const totalCardsOnBoard = state.opponent.lanes.flat().length + state.player.lanes.flat().length;
        if (card.value === 0 && totalCardsOnBoard === 0) continue;

        for (let i = 0; i < 3; i++) {
            if (isLaneBlockedByPlague0(i)) continue;
            if (state.opponent.compiled[i]) {
                // STRATEGIC: Consider playing in compiled lanes for Control or disruption
                if (!state.useControlMechanic) continue;
                if (state.opponent.laneValues[i] >= state.player.laneValues[i]) continue; // Already winning
            }

            if (card.protocol === 'Metal' && card.value === 6 && state.opponent.laneValues[i] < 4) continue;

            const canPlayerCompileThisLane = state.player.laneValues[i] >= 10 && state.player.laneValues[i] > state.opponent.laneValues[i] && !state.player.compiled[i];
            const baseScore = getCardPower(card);

            // FACE-UP PLAY
            // RULE: Can play face-up ONLY if card protocol matches:
            // 1. Own protocol in this lane (state.opponent.protocols[i]), OR
            // 2. Opposing player's protocol in this lane (state.player.protocols[i]), OR
            // 3. AI has Spirit-1 face-up (allows playing any protocol face-up)
            // BLOCKER: Player has Psychic-1 (blocks all face-up plays)
            // Compiled status has NOTHING to do with face-up play rules!
            const matchesOwnProtocol = card.protocol === state.opponent.protocols[i];
            const matchesOpposingProtocol = card.protocol === state.player.protocols[i];
            const aiHasSpirit1 = state.opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);
            const canPlayFaceUp = (matchesOwnProtocol || matchesOpposingProtocol || aiHasSpirit1) && !playerHasPsychic1;

            if (canPlayFaceUp) {
                let score = 0;
                let reason = `Play ${card.protocol}-${card.value} face-up in lane ${i}.`;
                const valueToAdd = card.value;
                const resultingValue = state.opponent.laneValues[i] + valueToAdd;

                // CRITICAL: Block player compile
                if (canPlayerCompileThisLane) {
                    if (resultingValue > state.player.laneValues[i]) {
                        score = 2000 + resultingValue * 10;
                        reason += ` [BLOCKS IMMEDIATE COMPILE THREAT]`;
                    } else {
                        score = -2000;
                        reason += ` [FAILS TO BLOCK - AVOID!]`;
                    }
                } else {
                    score += baseScore * 1.5;
                    score += valueToAdd * 2;

                    // CRITICAL: One away from winning - massively prioritize winning lane
                    if (strategy.oneAwayFromWin && i === strategy.closestToWin) {
                        if (resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                            score += 5000; // HIGHEST PRIORITY - WIN THE GAME!
                            reason += ` [GAME-WINNING COMPILE!!!]`;
                        } else if (resultingValue >= 8) {
                            score += 1500; // Very high - getting close to win
                            reason += ` [CRITICAL: Near game-winning compile]`;
                        } else {
                            score += 500; // Still prioritize this lane
                            reason += ` [Building winning lane]`;
                        }
                    }
                    // STRATEGIC: Setup own compile
                    else if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 800;
                        reason += ` [SETS UP COMPILE WIN]`;
                    } else if (resultingValue >= 8 && !state.opponent.compiled[i]) {
                        score += 200;
                        reason += ` [Near compile]`;
                    }

                    // STRATEGIC: Disruption value
                    const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                    if (hasDisruption) {
                        if (strategy.shouldDisrupt) {
                            score += 150;
                            reason += ` [Disruption needed]`;
                        }
                        if (state.player.laneValues[i] >= 7) {
                            score += 80;
                            reason += ` [Disrupts threat lane]`;
                        }
                        // CRITICAL: When one away from winning, disrupting player's compiled lanes is VERY valuable
                        if (strategy.oneAwayFromWin && state.player.compiled[i]) {
                            score += 600;
                            reason += ` [ONE AWAY: Disrupt player's compiled lane!]`;
                        }
                    }

                    // STRATEGIC: Control setup - prioritize getting control BEFORE player compiles their last protocol
                    if (state.useControlMechanic && state.opponent.compiled[i]) {
                        const leadDiff = resultingValue - state.player.laneValues[i];
                        const playerCompiledCount = state.player.compiled.filter(c => c).length;

                        if (leadDiff > 0) {
                            let controlScore = 100 + leadDiff * 5;

                            // CRITICAL: If player has 1+ compiled protocols, getting control is MUCH more valuable
                            // because we can disrupt them by rearranging when we refresh!
                            if (playerCompiledCount === 2) {
                                // Player is one away from winning! Getting control is ESSENTIAL!
                                controlScore += 800;
                                reason += ` [CRITICAL: Get Control to disrupt player's last protocol!]`;
                            } else if (playerCompiledCount === 1) {
                                // Player has 1 compiled, getting control is very valuable
                                controlScore += 300;
                                reason += ` [Get Control to disrupt player]`;
                            } else {
                                reason += ` [Control setup: +${leadDiff}]`;
                            }

                            score += controlScore;
                        }
                    }

                    // STRATEGIC: Card synergy
                    if (card.keywords['play'] || card.keywords['draw']) {
                        score += 50; // Prioritize card advantage
                        reason += ` [Card advantage]`;
                    }
                }

                possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true }, score, reason });
            }

            // FACE-DOWN PLAY
            const playerHasMetalTwo = state.player.lanes[i].some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);
            if (!playerHasMetalTwo) {
                const valueToAdd = getEffectiveCardValue({ ...card, isFaceUp: false }, state.opponent.lanes[i]);
                const resultingValue = state.opponent.laneValues[i] + valueToAdd;
                let score = 0;
                let reason = `Play ${card.protocol}-${card.value} face-down in lane ${i}.`;

                if (canPlayerCompileThisLane) {
                    if (resultingValue > state.player.laneValues[i]) {
                        score = 1800 + resultingValue * 10;
                        reason += ` [BLOCKS COMPILE]`;
                    } else {
                        score = -1800;
                        reason += ` [FAILS TO BLOCK]`;
                    }
                } else {
                    score += valueToAdd * 3;

                    // CRITICAL: One away from winning - massively prioritize winning lane
                    if (strategy.oneAwayFromWin && i === strategy.closestToWin) {
                        if (resultingValue >= 10 && resultingValue > state.player.laneValues[i]) {
                            score += 4500; // Slightly lower than face-up, but still highest priority
                            reason += ` [GAME-WINNING COMPILE (face-down)!!!]`;
                        } else if (resultingValue >= 8) {
                            score += 1300;
                            reason += ` [CRITICAL: Near game-winning compile]`;
                        } else {
                            score += 400;
                            reason += ` [Building winning lane]`;
                        }
                    }
                    else if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 700;
                        reason += ` [COMPILE SETUP]`;
                    }

                    // STRATEGIC: Save powerful effects for later (unless one away from win)
                    if (getCardPower(card) >= 15 && !strategy.oneAwayFromWin) {
                        score -= 20;
                        reason += ` [Saving effect]`;
                    }
                }

                possibleMoves.push({ move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false }, score, reason });
            }
        }
    }

    // Evaluate Filling Hand
    if (state.opponent.hand.length < 5) {
        let fillHandScore = 5;
        const avgHandPower = state.opponent.hand.reduce((sum, c) => sum + getCardPower(c), 0) / (state.opponent.hand.length || 1);

        if (state.opponent.hand.length === 0) {
            fillHandScore = 1000; // Must draw
        } else if (strategy.oneAwayFromWin) {
            // When one away from winning (without control), ONLY fill hand if we have NO playable cards in the winning lane
            // Otherwise we're wasting a turn that could win the game!
            const hasPlayableCard = state.opponent.hand.some(c => {
                // Can this card be played in the winning lane to reach 10+?
                const laneIndex = strategy.closestToWin;
                if (laneIndex === -1) return false;
                const faceUpValue = state.opponent.laneValues[laneIndex] + c.value;
                const faceDownValue = state.opponent.laneValues[laneIndex] + getEffectiveCardValue({ ...c, isFaceUp: false }, state.opponent.lanes[laneIndex]);
                return (faceUpValue >= 10 || faceDownValue >= 10);
            });
            if (hasPlayableCard) {
                fillHandScore = -5000; // NEVER refresh if we can win!
            } else if (state.opponent.hand.length >= 3) {
                fillHandScore = -1000; // Don't refresh with 3+ cards when close to winning
            } else {
                fillHandScore = 100; // Only if we really need more cards
            }
        } else {
            // CRITICAL STRATEGY: If PLAYER (opponent of AI) is close to winning AND AI has Control Component,
            // refreshing is EXTREMELY valuable because we can rearrange their protocols to disrupt them!
            const playerCompiledCount = state.player.compiled.filter(c => c).length;
            const hasControl = state.useControlMechanic && state.controlCardHolder === 'opponent';

            if (hasControl && playerCompiledCount >= 1) {
                // Player has compiled at least 1 protocol and we have control
                // BUT: Only refresh if player actually has cards on the board to disrupt!
                const playerHasCardsOnBoard = state.player.lanes.flat().length > 0;
                const playerTotalValue = state.player.laneValues.reduce((sum, v) => sum + v, 0);

                // Check if player can compile NEXT turn (immediate threat!)
                const playerCanCompileNextTurn = state.player.laneValues.some((v, i) =>
                    !state.player.compiled[i] && v >= 10 && v > state.opponent.laneValues[i]
                );

                // EXCEPTION: If player can compile next turn, refresh is CRITICAL even with 4+ cards!
                // We need to rearrange NOW to stop the compile threat
                if (playerCanCompileNextTurn && playerHasCardsOnBoard && playerTotalValue > 0) {
                    if (playerCompiledCount === 2) {
                        // CRITICAL: Player can win next turn! Must rearrange NOW!
                        fillHandScore = 2000; // HIGHEST PRIORITY
                    } else {
                        // Player can get 2nd compile next turn, very dangerous
                        fillHandScore = 1200;
                    }
                }
                // Normal case: Only refresh if we have < 4 cards
                else if (playerHasCardsOnBoard && playerTotalValue > 0 && state.opponent.hand.length < 4) {
                    if (playerCompiledCount === 2) {
                        // CRITICAL: Player is one away from winning! Rearranging is ESSENTIAL!
                        fillHandScore = 1500; // VERY HIGH PRIORITY
                    } else {
                        // Player has 1 compiled, still valuable to disrupt
                        fillHandScore = 600;
                    }
                } else if (avgHandPower < 10 && !strategy.needsDefense) {
                    fillHandScore = 50; // Normal weak hand logic
                }
            } else if (avgHandPower < 10 && !strategy.needsDefense) {
                fillHandScore = 50; // Hand is weak and no emergency
            } else if (strategy.needsDefense && !state.opponent.hand.some(c => c.value >= 3)) {
                fillHandScore = 200; // Need high-value cards to defend
            }
        }

        let fillHandReason = "Refresh hand";
        if (strategy.oneAwayFromWin) {
            fillHandReason = "Refresh hand (ONE AWAY FROM WIN - avoid unless necessary!)";
        } else if (state.useControlMechanic && state.controlCardHolder === 'opponent' && state.player.compiled.filter(c => c).length >= 1) {
            fillHandReason = `Refresh hand (HAVE CONTROL - can disrupt player's ${state.player.compiled.filter(c => c).length} compiled protocols!)`;
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
            // STRATEGY: Rearranging PLAYER's protocols is almost always the best choice!
            // It disrupts their strategy by moving compiled protocols to lanes with cards.
            const playerCompiledCount = state.player.compiled.filter(c => c).length;

            // If player has compiled any protocol, ALWAYS try to disrupt them
            if (playerCompiledCount > 0) {
                // Check if player has cards in non-compiled lanes (target for disruption)
                const compiledIndex = state.player.compiled.findIndex(c => c);
                let hasCardsInOtherLanes = false;
                for (let i = 0; i < 3; i++) {
                    if (i !== compiledIndex && state.player.lanes[i].length > 0) {
                        hasCardsInOtherLanes = true;
                        break;
                    }
                }

                if (hasCardsInOtherLanes) {
                    return { type: 'resolveControlMechanicPrompt', choice: 'player' };
                }
            }

            // Only rearrange own protocols if it actually helps with hand playability
            const canBenefitFromOwnRearrange = state.opponent.hand.some(card => {
                const matchingUncompiledLanes = state.opponent.protocols
                    .map((p, i) => !state.opponent.compiled[i] && p === card.protocol ? i : -1)
                    .filter(i => i !== -1);
                // Can't play this card face-up anywhere, but protocol exists
                return matchingUncompiledLanes.length === 0 && state.opponent.protocols.includes(card.protocol);
            });

            if (canBenefitFromOwnRearrange) {
                return { type: 'resolveControlMechanicPrompt', choice: 'opponent' };
            }

            // Otherwise skip - rearranging for no reason wastes the Control
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
                return getCardPower(a) - getCardPower(b);
            });
            return { type: 'discardCards', cardIds: sortedHand.slice(0, action.count).map(c => c.id) };
        }

        case 'select_opponent_card_to_flip': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerUncovered = getUncovered('player');
            if (playerUncovered.length === 0) return { type: 'skip' };

            // IMPROVED: Prioritize flipping threatening face-up cards
            const targets = playerUncovered.map(c => ({
                cardId: c.id,
                score: c.isFaceUp
                    ? getCardThreat(c, 'player', state) + 10
                    : state.player.laneValues[state.player.lanes.findIndex(l => l.some(card => card.id === c.id))] + 5
            }));

            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].cardId };
        }

        case 'select_cards_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = action.type === 'select_cards_to_delete' ? action.disallowedIds : [action.sourceCardId];
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

        // Keep remaining action handlers from original but improved flip logic
        case 'select_any_card_to_flip':
        case 'select_any_other_card_to_flip': {
            // Love-4, Plague-3, etc: Flip any card (face-up or face-down)
            // Strategy: PLAYER cards - flip face-up to face-down (removes threat)
            //          OWN cards - flip face-down to face-up (activates effects, adds value)
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerUncovered = getUncovered('player');
            const opponentUncovered = getUncovered('opponent');

            const targets: { cardId: string; score: number }[] = [];

            // PLAYER CARDS: Prefer flipping face-up to face-down (neutralize threats)
            playerUncovered.forEach(c => {
                const laneIndex = state.player.lanes.findIndex(l => l.some(card => card.id === c.id));
                const laneValue = state.player.laneValues[laneIndex];

                if (c.isFaceUp) {
                    // Flipping face-up to face-down removes threat and value
                    let score = getCardThreat(c, 'player', state) * 2 + c.value * 3;

                    // Extra priority if player is close to compile
                    if (laneValue >= 8) {
                        score += 50;
                    }
                    if (laneValue >= 10 && laneValue > state.opponent.laneValues[laneIndex]) {
                        score += 100; // CRITICAL: Block compile threat
                    }

                    targets.push({ cardId: c.id, score });
                } else {
                    // Flipping face-down to face-up could be bad (activates their effects)
                    // Only consider if we know it's weak
                    const knownThreat = getCardThreat(c, 'player', state);
                    if (knownThreat < 5) {
                        targets.push({ cardId: c.id, score: 3 }); // Low priority
                    }
                }
            });

            // OWN CARDS: Prefer flipping face-down to face-up (activate effects, add value)
            opponentUncovered.forEach(c => {
                const laneIndex = state.opponent.lanes.findIndex(l => l.some(card => card.id === c.id));

                if (!c.isFaceUp) {
                    // Flip our own face-down cards to activate effects and add their full value
                    const threat = aiMemory.knownOwnCards.has(c.id)
                        ? getCardThreat(aiMemory.knownOwnCards.get(c.id)!, 'opponent', state)
                        : c.value;

                    let score = threat * 2 + 20;

                    // Extra priority if it helps us compile
                    const currentValue = state.opponent.laneValues[laneIndex];
                    const faceDownValue = state.opponent.lanes[laneIndex].some(card => card.isFaceUp && card.protocol === 'Darkness' && card.value === 2) ? 4 : 2;
                    const potentialValue = currentValue - faceDownValue + (aiMemory.knownOwnCards.get(c.id)?.value || c.value);

                    if (potentialValue >= 10 && potentialValue > state.player.laneValues[laneIndex]) {
                        score += 80; // Could enable compile
                    }

                    targets.push({ cardId: c.id, score });
                } else {
                    // Our own face-up card - generally DON'T flip to face-down
                    // Only if it's very weak and already triggered its effects
                    const hasOnPlayEffect = c.keywords && (c.keywords['play'] || c.keywords['uncover']);
                    if (!hasOnPlayEffect && c.value <= 1) {
                        targets.push({ cardId: c.id, score: 2 }); // Very low priority
                    }
                }
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].cardId };
        }

        case 'select_any_face_down_card_to_flip_optional': {
            // Life-2: May flip 1 face-down card (only face-down!)
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerUncovered = getUncovered('player');
            const opponentUncovered = getUncovered('opponent');

            const targets: { cardId: string; score: number }[] = [];

            // Only consider face-down cards!
            playerUncovered.forEach(c => {
                if (!c.isFaceUp) {
                    // Check if we know what it is from memory
                    const knownThreat = getCardThreat(c, 'player', state);
                    // If it's known to be dangerous, give it LOW score (avoid flipping)
                    const baseScore = knownThreat > 10 ? -knownThreat : 5;
                    targets.push({ cardId: c.id, score: baseScore });
                }
            });

            opponentUncovered.forEach(c => {
                if (!c.isFaceUp) {
                    // Flip our own face-down cards to activate effects
                    const threat = aiMemory.knownOwnCards.has(c.id)
                        ? getCardThreat(aiMemory.knownOwnCards.get(c.id)!, 'opponent', state)
                        : c.value;
                    targets.push({ cardId: c.id, score: threat + 12 });
                }
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].cardId };
        }

        case 'select_any_card_to_flip_optional': {
            // General optional flip (any card, face-up or face-down)
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerUncovered = getUncovered('player');
            const opponentUncovered = getUncovered('opponent');

            const targets: { cardId: string; score: number }[] = [];

            playerUncovered.forEach(c => {
                if (c.isFaceUp) {
                    // Flipping face-up cards face-down removes their threat - HIGH priority
                    targets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) + 20 });
                } else {
                    // For face-down cards: Check if we know what it is from memory
                    const knownThreat = getCardThreat(c, 'player', state);
                    const baseScore = knownThreat > 10 ? -knownThreat : 5;
                    targets.push({ cardId: c.id, score: baseScore });
                }
            });

            opponentUncovered.forEach(c => {
                if (!c.isFaceUp) {
                    // Flip our own face-down cards to activate effects
                    const threat = aiMemory.knownOwnCards.has(c.id)
                        ? getCardThreat(aiMemory.knownOwnCards.get(c.id)!, 'opponent', state)
                        : c.value;
                    targets.push({ cardId: c.id, score: threat + 12 });
                }
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].cardId };
        }

        case 'select_own_face_up_covered_card_to_flip': {
            const potentialTargets: { card: PlayedCard; score: number }[] = [];
            state.opponent.lanes.forEach(lane => {
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
                if (potentialTargets[0].score > 0) {
                    return { type: 'flipCard', cardId: potentialTargets[0].card.id };
                }
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_reveal_for_light_2': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);
            const targets: { card: PlayedCard; score: number }[] = [];
            getUncovered('player').forEach(c => {
                if (!c.isFaceUp) {
                    const laneIndex = state.player.lanes.findIndex(lane => lane.some(card => card.id === c.id));
                    targets.push({ card: c, score: state.player.laneValues[laneIndex] + 10 });
                }
            });
            getUncovered('opponent').forEach(c => {
                if (!c.isFaceUp) targets.push({ card: c, score: -10 });
            });
            if (targets.length > 0) {
                targets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: targets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'select_opponent_face_up_card_to_flip': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);
            const validTargets = getUncovered('player').filter(c => c.isFaceUp);
            if (validTargets.length > 0) {
                validTargets.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'flipCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_flip_for_fire_3':
        case 'select_card_to_flip_for_light_0':
        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_covered_card_in_line_to_flip_optional': {
            const potentialTargets: { cardId: string; score: number }[] = [];
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const playerCovered = state.player.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                playerCovered.forEach(c => potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) }));
                const opponentCovered = state.opponent.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                opponentCovered.forEach(c => potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'opponent', state) / 2 }));
            } else {
                const getUncovered = (p: Player): PlayedCard[] => state[p].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null);
                const allUncoveredPlayer = getUncovered('player');
                const allUncoveredOpponent = getUncovered('opponent');
                allUncoveredPlayer.forEach(c => {
                    if (c.isFaceUp) {
                        // Flip face-up to face-down - removes threat
                        potentialTargets.push({ cardId: c.id, score: getCardThreat(c, 'player', state) + 10 });
                    } else {
                        // For face-down: use memory to avoid flipping dangerous cards
                        const knownThreat = getCardThreat(c, 'player', state);
                        const baseScore = knownThreat > 10 ? -knownThreat : 5;
                        potentialTargets.push({ cardId: c.id, score: baseScore });
                    }
                });
                allUncoveredOpponent.forEach(c => {
                    if (!c.isFaceUp) {
                        // Flipping opponent face-down to face-up
                        const currentThreat = getCardThreat(c, 'opponent', state);
                        const potentialThreat = getCardThreat({ ...c, isFaceUp: true }, 'opponent', state);
                        const valueGain = potentialThreat - currentThreat;

                        // NEGATIVE score if it increases opponent's value (bad for us!)
                        // POSITIVE score if it decreases opponent's value (good for us!)
                        const score = -valueGain + 3; // Small bonus for revealing unknown cards, but penalize value increases
                        potentialTargets.push({ cardId: c.id, score: score });
                    } else {
                        // Flipping opponent face-up to face-down - GOOD! Reduces their value
                        const threat = getCardThreat(c, 'opponent', state);
                        potentialTargets.push({ cardId: c.id, score: threat + 10 });
                    }
                });
            }
            if (potentialTargets.length === 0) return { type: 'skip' };
            potentialTargets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: potentialTargets[0].cardId };
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

        case 'shift_flipped_card_optional': {
            const cardInfo = findCardOnBoard(state, action.cardId);
            if (!cardInfo || cardInfo.owner !== 'player') return { type: 'skip' };
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
            const scoredLanes = possibleLanes.map(laneIndex => {
                const valueToAdd = getEffectiveCardValue(cardToShift, state.player.lanes[laneIndex]);
                const futurePlayerLaneValue = state.player.laneValues[laneIndex] + valueToAdd;
                const futurePlayerLead = futurePlayerLaneValue - state.opponent.laneValues[laneIndex];
                let score = -futurePlayerLead;
                if (futurePlayerLaneValue >= 10 && futurePlayerLaneValue > state.opponent.laneValues[laneIndex]) {
                    score -= 300;
                }
                return { laneIndex, score };
            });
            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_lane_for_shift': {
            const { cardToShiftId, cardOwner, originalLaneIndex } = action;
            const cardToShift = findCardOnBoard(state, cardToShiftId)?.card;
            if (!cardToShift) return { type: 'skip' };
            const possibleLanes = [0, 1, 2].filter(i => i !== originalLaneIndex);
            if (cardOwner === 'opponent') {
                const scoredLanes = possibleLanes.map(laneIndex => {
                    const valueToAdd = getEffectiveCardValue(cardToShift, state.opponent.lanes[laneIndex]);
                    const futureLaneValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                    const futureLead = futureLaneValue - state.player.laneValues[laneIndex];
                    let score = futureLead;
                    if (futureLaneValue >= 10 && futureLaneValue > state.player.laneValues[laneIndex]) score += 150;
                    return { laneIndex, score };
                });
                scoredLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            } else {
                const scoredLanes = possibleLanes.map(laneIndex => {
                    const valueToAdd = getEffectiveCardValue(cardToShift, state.player.lanes[laneIndex]);
                    const futureLaneValue = state.player.laneValues[laneIndex] + valueToAdd;
                    const futureLead = futureLaneValue - state.opponent.laneValues[laneIndex];
                    return { laneIndex, score: futureLead };
                });
                scoredLanes.sort((a, b) => a.score - b.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
        }

        case 'select_own_card_to_shift_for_speed_3': {
            const ownCards = state.opponent.lanes.flat();
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
                const playerHandSizeModifier = 5 - state.player.hand.length;
                const score = (playerTargets * (12 + playerHandSizeModifier)) - (opponentTargets * 6);
                return { laneIndex: i, score };
            });
            if (scoredLanes.some(l => l.score > 0)) {
                scoredLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);

        case 'prompt_swap_protocols': {
            const possibleSwaps: [number, number][] = [[0, 1], [0, 2], [1, 2]];
            let bestSwap: [number, number] = [0, 1];
            let bestScore = -Infinity;
            for (const swap of possibleSwaps) {
                const [i, j] = swap;
                const newProtocols = [...state.opponent.protocols];
                [newProtocols[i], newProtocols[j]] = [newProtocols[j], newProtocols[i]];
                let score = 0;
                for (const card of state.opponent.hand) {
                    const couldPlayBeforeI = card.protocol === state.opponent.protocols[i];
                    const couldPlayBeforeJ = card.protocol === state.opponent.protocols[j];
                    const canPlayNowI = card.protocol === newProtocols[i];
                    const canPlayNowJ = card.protocol === newProtocols[j];
                    if (canPlayNowI && !couldPlayBeforeI) score += getCardPower(card);
                    if (canPlayNowJ && !couldPlayBeforeJ) score += getCardPower(card);
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
                playerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'deleteCard', cardId: playerCards[0].id };
            }
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                ownCards.sort((a, b) => getCardPower(a) - getCardPower(b));
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
                if (aIsPlayer && a.isFaceUp && (!bIsPlayer || !b.isFaceUp)) return -1;
                if (bIsPlayer && b.isFaceUp && (!aIsPlayer || !a.isFaceUp)) return 1;
                if (aIsPlayer && a.isFaceUp && bIsPlayer && b.isFaceUp) {
                    return getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state);
                }
                const aScore = !aIsPlayer && !a.isFaceUp ? 50 + a.value : 1;
                const bScore = !bIsPlayer && !b.isFaceUp ? 50 + b.value : 1;
                return bScore - aScore;
            });
            return { type: 'deleteCard', cardId: sortedTargets[0].id };
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

                // Also consider: If shifting to targetLaneIndex helps us compile
                const targetValue = state.opponent.laneValues[targetLaneIndex];
                const targetPlayerValue = state.player.laneValues[targetLaneIndex];
                if (targetValue + faceDownValue >= 10 && targetValue + faceDownValue > targetPlayerValue && !state.opponent.compiled[targetLaneIndex]) {
                    score += 100; // We can compile target lane after this shift
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

                        if (playerLead > 0) {
                            score += playerLead * 8; // Prioritize lanes where player is winning
                        }

                        // Critical: If player could compile, this is HIGH priority
                        if (playerValue >= 10 && playerValue > opponentValue && !state.player.compiled[i]) {
                            score += 150;
                        } else if (playerValue >= 8) {
                            score += 40; // Near compile
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
            const validTargets: { card: PlayedCard; laneIndex: number }[] = [];
            state.player.lanes.forEach((lane, index) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) validTargets.push({ card: topCard, laneIndex: index });
                }
            });
            if (validTargets.length > 0) {
                validTargets.sort((a, b) => state.player.laneValues[b.laneIndex] - state.player.laneValues[a.laneIndex]);
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
            }
            return { type: 'skip' };
        }

        case 'select_any_opponent_card_to_shift': {
            const validTargets = state.player.lanes.map(lane => lane.length > 0 ? lane[lane.length - 1] : null).filter((c): c is PlayedCard => c !== null);
            if (validTargets.length > 0) {
                validTargets.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_card_from_hand_to_play': {
            // Speed-0 or Darkness-3: Play another card from hand
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            const playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);
            if (playableLanes.length === 0) return { type: 'skip' };

            // Score each possible play strategically
            const scoredPlays: { cardId: string; laneIndex: number; isFaceUp: boolean; score: number }[] = [];

            for (const card of state.opponent.hand) {
                for (const laneIndex of playableLanes) {
                    // Check if AI has Spirit-1 (allows playing any protocol face-up)
                    const aiHasSpirit1 = state.opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);
                    const canPlayFaceUp = card.protocol === state.opponent.protocols[laneIndex] || card.protocol === state.player.protocols[laneIndex] || aiHasSpirit1;

                    if (canPlayFaceUp) {
                        const valueToAdd = card.value;
                        const resultingValue = state.opponent.laneValues[laneIndex] + valueToAdd;
                        let score = getCardPower(card) + valueToAdd * 2;

                        if (resultingValue >= 10 && resultingValue > state.player.laneValues[laneIndex]) {
                            score += 500; // Compile setup
                        }

                        scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: true, score });
                    }

                    // Face-down play
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
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'giveCard', cardId: sortedHand[0].id };
        }

        case 'select_card_from_hand_to_reveal': {
            // Psychic-1: Reveal strongest card for psychological effect
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(b) - getCardPower(a));
            return { type: 'revealCard', cardId: sortedHand[0].id };
        }

        case 'plague_2_opponent_discard': {
            // Plague-2: Opponent forces us to discard 1 card
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            // Discard weakest card (lowest power)
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'resolvePlague2Discard', cardIds: [sortedHand[0].id] };
        }

        case 'select_cards_from_hand_to_discard_for_fire_4': {
            // Fire-4: Discard up to 3 to draw that many +1
            const maxDiscard = Math.min(3, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            // Discard weakest cards to draw better ones
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'resolveFire4Discard', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_cards_from_hand_to_discard_for_hate_1': {
            // Hate-1: Must discard specified number of cards
            const maxDiscard = Math.min(action.count, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            // Discard weakest cards (keep disruption and high power)
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
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
            // Metal-4 or other return effects: Return player's strongest card
            const playerCards = state.player.lanes.flat();
            if (playerCards.length > 0) {
                playerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'returnCard', cardId: playerCards[0].id };
            }
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                ownCards.sort((a, b) => getCardThreat(a, 'opponent', state) - getCardThreat(b, 'opponent', state));
                return { type: 'returnCard', cardId: ownCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_opponent_card_to_return': {
            // Psychic-4: Return player's card
            const playerCards = state.player.lanes.flat();
            if (playerCards.length > 0) {
                playerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'returnCard', cardId: playerCards[0].id };
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
            // STRATEGIC: Prioritize player's face-down cards in NON-COMPILED, high-value lanes
            const targets: { cardId: string; score: number }[] = [];

            state.player.lanes.forEach((lane, laneIndex) => {
                lane.forEach(c => {
                    if (!c.isFaceUp) {
                        const laneValue = state.player.laneValues[laneIndex];
                        const isCompiled = state.player.compiled[laneIndex];
                        const compiledPenalty = isCompiled ? -1000 : 0; // Huge penalty for compiled lanes
                        targets.push({ cardId: c.id, score: laneValue + 10 + compiledPenalty });
                    }
                });
            });

            if (targets.length > 0) {
                targets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: targets[0].cardId };
            }

            // Fallback: own face-down
            state.opponent.lanes.flat().forEach(c => {
                if (!c.isFaceUp) targets.push({ cardId: c.id, score: -5 });
            });

            if (targets.length > 0) {
                targets.sort((a, b) => b.score - a.score);
                return { type: 'deleteCard', cardId: targets[0].cardId };
            }

            return { type: 'skip' };
        }

        case 'select_own_other_card_to_shift': {
            // Shift own card (not the source)
            const ownCards = state.opponent.lanes.flat().filter(c => c.id !== action.sourceCardId);
            if (ownCards.length > 0) {
                // Shift card that would benefit most from repositioning
                ownCards.sort((a, b) => getCardThreat(b, 'opponent', state) - getCardThreat(a, 'opponent', state));
                return { type: 'deleteCard', cardId: ownCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_lane_to_shift_cards_for_light_3': {
            // Light-3: Shift all face-down from one lane to another
            const sourceLanes = [0, 1, 2].map(laneIndex => {
                const faceDownCount = state.player.lanes[laneIndex].filter(c => !c.isFaceUp).length;
                return { laneIndex, faceDownCount };
            }).filter(l => l.faceDownCount > 0);

            if (sourceLanes.length === 0) return { type: 'skip' };

            // Choose lane with most face-down cards
            sourceLanes.sort((a, b) => b.faceDownCount - a.faceDownCount);
            return { type: 'selectLane', laneIndex: sourceLanes[0].laneIndex };
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

        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: true };
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: true };
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
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: true };
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
            // Plague-4: Opponent must delete their own face-down card
            const ownFaceDown = state.opponent.lanes.flat().filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) {
                // Delete lowest value face-down card
                ownFaceDown.sort((a, b) => a.value - b.value);
                return { type: 'deleteCard', cardId: ownFaceDown[0].id };
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
                flipScore = getCardPower(card) + card.value;
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
                    const laneValueA = state.player.laneValues[a.laneIndex];
                    const laneValueB = state.player.laneValues[b.laneIndex];
                    if (laneValueA !== laneValueB) return laneValueB - laneValueA;
                    return getCardThreat(b.card, 'player', state) - getCardThreat(a.card, 'player', state);
                });
                return { type: 'deleteCard', cardId: validTargets[0].card.id };
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
