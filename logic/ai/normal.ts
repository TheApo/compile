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
import { handleControlRearrange } from './controlMechanicLogic';

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

const getBestMove = (state: GameState): AIAction => {
    const possibleMoves: ScoredMove[] = [];

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

        for (let i = 0; i < 3; i++) {
            if (isLaneBlockedByPlague0(i)) continue;
            if (state.opponent.compiled[i]) continue; // Don't play in compiled lanes

            // CRITICAL: Metal-6 deletes itself when covered or flipped!
            // Only play it if it will be the LAST card before compiling (lane reaches 10+).
            if (card.protocol === 'Metal' && card.value === 6) {
                const currentLaneValue = state.opponent.laneValues[i];
                const valueAfterPlaying = currentLaneValue + 6;

                // Only play Metal-6 if it will bring the lane to 10+ (ready to compile)
                if (valueAfterPlaying < 10) {
                    continue; // Don't play Metal-6 if it won't reach compile threshold
                }

                // Additional check: Make sure we can actually win the lane with it
                const playerValue = state.player.laneValues[i];
                if (valueAfterPlaying <= playerValue) {
                    continue; // Playing Metal-6 won't win the lane
                }
            }

            const canPlayerCompileThisLane = state.player.laneValues[i] >= 10
                && state.player.laneValues[i] > state.opponent.laneValues[i]
                && !state.player.compiled[i];
            const baseScore = getCardPower(card);

            // FACE-UP PLAY
            const aiHasSpirit1 = state.opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);
            const canPlayFaceUp = (card.protocol === state.opponent.protocols[i] || card.protocol === state.player.protocols[i] || aiHasSpirit1) && !playerHasPsychic1;
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
                    score += baseScore;
                    score += valueToAdd * 1.5;

                    // Setup own compile
                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 120;
                        reason += ` [Compile setup]`;
                    } else if (resultingValue >= 8 && !state.opponent.compiled[i]) {
                        score += 40;
                        reason += ` [Near compile]`;
                    }

                    // Disruption value
                    const hasDisruption = DISRUPTION_KEYWORDS.some(kw => card.keywords[kw]);
                    if (hasDisruption && state.player.laneValues[i] >= 6) {
                        score += 30;
                        reason += ` [Disruption]`;
                    }
                }

                possibleMoves.push({
                    move: { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: true },
                    score: addNoise(score),
                    reason
                });
            }

            // FACE-DOWN PLAY
            const playerHasMetalTwo = state.player.lanes[i].some(c => c.isFaceUp && c.protocol === 'Metal' && c.value === 2);
            if (!playerHasMetalTwo) {
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
                    score += valueToAdd * 2;

                    if (resultingValue >= 10 && resultingValue > state.player.laneValues[i] && !state.opponent.compiled[i]) {
                        score += 110;
                        reason += ` [Compile setup]`;
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

    // Evaluate filling hand
    if (state.opponent.hand.length < 5) {
        let fillHandScore = 8;
        const avgHandPower = state.opponent.hand.reduce((sum, c) => sum + getCardPower(c), 0) / (state.opponent.hand.length || 1);

        if (state.opponent.hand.length === 0) {
            fillHandScore = 500; // Must draw
        } else if (avgHandPower < 12) {
            fillHandScore = 35; // Weak hand
        }

        possibleMoves.push({ move: { type: 'fillHand' }, score: addNoise(fillHandScore), reason: "Refill hand" });
    }

    if (possibleMoves.length === 0) {
        return { type: 'fillHand' };
    }

    possibleMoves.sort((a, b) => b.score - a.score);

    // 20% chance to pick second-best move for human-like play
    if (shouldMakeMistake() && possibleMoves.length > 1 && possibleMoves[1].score > 0) {
        return possibleMoves[1].move;
    }

    return possibleMoves[0].move;
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    switch (action.type) {
        case 'prompt_use_control_mechanic': {
            // Rearrange player protocols if they have compiled lanes
            const opponentCompiledCount = state.opponent.compiled.filter(c => c).length;
            const playerCompiledCount = state.player.compiled.filter(c => c).length;

            if (playerCompiledCount > 0 && state.player.compiled.filter(c => !c).length > 0) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }

            // Maybe rearrange own if beneficial
            const canBenefit = state.opponent.hand.some(card => {
                const currentPlayable = state.opponent.protocols.filter((p, i) =>
                    !state.opponent.compiled[i] && p === card.protocol
                ).length;
                return currentPlayable === 0 && state.opponent.protocols.includes(card.protocol);
            });

            if (canBenefit && opponentCompiledCount < 2 && !shouldMakeMistake()) {
                return { type: 'resolveControlMechanicPrompt', choice: 'opponent' };
            }

            return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
        }

        case 'discard': {
            // Discard weakest cards
            const sortedHand = [...state.opponent.hand].sort((a, b) => {
                const aHasDisruption = DISRUPTION_KEYWORDS.some(kw => a.keywords[kw]);
                const bHasDisruption = DISRUPTION_KEYWORDS.some(kw => b.keywords[kw]);

                if (aHasDisruption && !bHasDisruption) return 1;
                if (!aHasDisruption && bHasDisruption) return -1;

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

            // Flip high-value face-up cards or reveal face-down
            const scored = playerUncovered.map(c => ({
                cardId: c.id,
                score: c.isFaceUp ? c.value + 5 : 3
            }));

            scored.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: scored[0].cardId };
        }

        case 'select_cards_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = action.type === 'select_cards_to_delete' ? action.disallowedIds : [action.sourceCardId];
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            // Target player's high-value cards
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

            return { type: 'skip' };
        }

        case 'select_any_card_to_flip':
        case 'select_any_other_card_to_flip':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_any_card_to_flip_optional': {
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
                } else {
                    // Face-down: only flip if we're curious (low score)
                    targets.push({ cardId: c.id, score: 3 });
                }
            });

            // Own face-down cards (flip to activate)
            opponentUncovered.forEach(c => {
                if (!c.isFaceUp) {
                    targets.push({ cardId: c.id, score: c.value + 8 });
                }
            });

            if (targets.length === 0) return { type: 'skip' };

            targets.sort((a, b) => b.score - a.score);
            return { type: 'flipCard', cardId: targets[0].cardId };
        }

        case 'plague_2_opponent_discard': {
            // Discard weakest card
            if (state.opponent.hand.length === 0) return { type: 'skip' };
            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            return { type: 'resolvePlague2Discard', cardIds: [sortedHand[0].id] };
        }

        case 'select_cards_from_hand_to_discard_for_fire_4': {
            // Fire-4: Discard up to 3 weak cards
            const maxDiscard = Math.min(3, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'resolveFire4Discard', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_cards_from_hand_to_discard_for_hate_1': {
            // Hate-1: Discard specified number of cards
            const maxDiscard = Math.min(action.count, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };

            const sortedHand = [...state.opponent.hand].sort((a, b) => getCardPower(a) - getCardPower(b));
            const toDiscard = sortedHand.slice(0, maxDiscard);
            return { type: 'resolveHate1Discard', cardIds: toDiscard.map(c => c.id) };
        }

        case 'select_card_from_hand_to_play': {
            // Speed-0 or Darkness-3: Play another card
            if (state.opponent.hand.length === 0) return { type: 'skip' };

            // CRITICAL: Check if the effect FORCES face-down play (e.g., Darkness-3)
            const isForcedFaceDown = action.isFaceDown === true;

            // FIX: Filter out blocked lanes
            let playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);
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
                        const canPlayFaceUp = card.protocol === state.opponent.protocols[laneIndex]
                            || card.protocol === state.player.protocols[laneIndex]
                            || aiHasSpirit1;

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

        case 'select_lane_for_death_2': {
            const scoredLanes = [0, 1, 2].map(laneIndex => {
                let playerCount = 0;
                let opponentCount = 0;

                state.player.lanes[laneIndex].forEach(c => {
                    if (c.isFaceUp && (c.value === 1 || c.value === 2)) playerCount++;
                });
                state.opponent.lanes[laneIndex].forEach(c => {
                    if (c.isFaceUp && (c.value === 1 || c.value === 2)) opponentCount++;
                });

                return { laneIndex, score: playerCount * 10 - opponentCount * 5 };
            });

            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
        }

        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            const playerCards = state.player.lanes.flat();
            if (playerCards.length > 0) {
                playerCards.sort((a, b) => getCardThreat(b, 'player', state) - getCardThreat(a, 'player', state));
                return { type: 'returnCard', cardId: playerCards[0].id };
            }
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                ownCards.sort((a, b) => a.value - b.value);
                return { type: 'returnCard', cardId: ownCards[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_lane_for_play':
        case 'select_lane_for_life_3_play': {
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

        // Simple lane selections
        case 'select_lane_for_shift':
        case 'select_lane_for_water_3':
        case 'select_lane_to_shift_cards_for_light_3': {
            const possibleLanes = [0, 1, 2].filter(i =>
                !('disallowedLaneIndex' in action) || i !== action.disallowedLaneIndex
            ).filter(i =>
                !('originalLaneIndex' in action) || i !== action.originalLaneIndex
            );

            if (possibleLanes.length > 0) {
                // Pick random lane (human-like)
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }
        case 'select_lane_for_metal_3_delete': {
            // FIX: Metal-3 can only delete lanes with 8 or more cards
            const possibleLanes = [0, 1, 2].filter(i =>
                !('disallowedLaneIndex' in action) || i !== action.disallowedLaneIndex
            ).filter(i =>
                !('originalLaneIndex' in action) || i !== action.originalLaneIndex
            ).filter(i => {
                const totalCards = state.player.lanes[i].length + state.opponent.lanes[i].length;
                return totalCards >= 8;
            });

            if (possibleLanes.length > 0) {
                // Pick random lane (human-like)
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            // If no valid lanes, skip
            return { type: 'skip' };
        }

        // Prompts
        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: !shouldMakeMistake() };
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: false };
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: false };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: state.opponent.hand.length > 2 };
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: !shouldMakeMistake() };
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: !shouldMakeMistake() };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: true };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };

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

        case 'select_face_down_card_to_reveal_for_light_2': {
            const getUncovered = (player: Player): PlayedCard[] => {
                return state[player].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null);
            };
            const allUncoveredPlayer = getUncovered('player');
            const allUncoveredOpponent = getUncovered('opponent');

            const opponentFaceDown = allUncoveredPlayer.filter(c => !c.isFaceUp);
            if (opponentFaceDown.length > 0) {
                // Easy AI: just pick the first one it finds.
                return { type: 'deleteCard', cardId: opponentFaceDown[0].id };
            }
            const ownFaceDown = allUncoveredOpponent.filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) {
                return { type: 'deleteCard', cardId: ownFaceDown[0].id };
            }
            return { type: 'skip' }; // Should not happen if effect generation is correct.
        }

        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_card_to_flip_for_fire_3':
        case 'select_card_to_flip_for_light_0':
        case 'select_covered_card_in_line_to_flip_optional': {
            const isOptional = 'optional' in action && action.optional;
            const cannotTargetSelfTypes: ActionRequired['type'][] = ['select_any_other_card_to_flip', 'select_any_other_card_to_flip_for_water_0'];
            const canTargetSelf = !cannotTargetSelfTypes.includes(action.type);
            const requiresFaceDown = false; // None of these specific cases require face-down only

            // Special case for Darkness-2: "flip 1 covered card in this line."
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const playerCovered = state.player.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (playerCovered.length > 0) return { type: 'flipCard', cardId: playerCovered[0].id };
                const opponentCovered = state.opponent.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (opponentCovered.length > 0) return { type: 'flipCard', cardId: opponentCovered[0].id };
                return { type: 'skip' }; // No covered cards to flip.
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

        case 'select_own_card_to_return_for_water_4': {
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                // Easy AI: Pick a random card to return.
                const randomCard = ownCards[Math.floor(Math.random() * ownCards.length)];
                return { type: 'returnCard', cardId: randomCard.id };
            }
            // This shouldn't happen if the action was generated correctly, but as a fallback:
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }

        case 'select_card_to_shift_for_gravity_1': {
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const playerCards = getUncovered('player');
            if (playerCards.length > 0) {
                const randomCard = playerCards[Math.floor(Math.random() * playerCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }

            const opponentCards = getUncovered('opponent');
            if (opponentCards.length > 0) {
                const randomCard = opponentCards[Math.floor(Math.random() * opponentCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

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
            // Easy AI: just find any valid lane and shift it. If not, skip.
            const cardInfo = findCardOnBoard(state, action.cardId);
            if (!cardInfo) return { type: 'skip' };

            let originalLaneIndex = -1;
            const ownerState = state[cardInfo.owner];
            for (let i = 0; i < ownerState.lanes.length; i++) {
                if (ownerState.lanes[i].some(c => c.id === action.cardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }

            if (originalLaneIndex === -1) return { type: 'skip' };

            const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }

            return { type: 'skip' };
        }

        case 'select_lane_to_shift_revealed_card_for_light_2': {
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }
            if ('originalLaneIndex' in action && action.originalLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.originalLaneIndex);
            }
            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }

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

        case 'select_own_card_to_shift_for_speed_3': {
            const ownCards = state.opponent.lanes.flat();
            // This action is mandatory and is only dispatched if the AI has at least one card.
            // Easy AI just picks the first card it finds.
            return { type: 'deleteCard', cardId: ownCards[0].id };
        }

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

        case 'prompt_shift_or_flip_for_light_2': {
            const { revealedCardId } = action;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'skip' };

            // Easy AI: flip its own cards, skip player's cards.
            if (cardInfo.owner === 'opponent') {
                return { type: 'resolveLight2Prompt', choice: 'flip' };
            }
            return { type: 'resolveLight2Prompt', choice: 'skip' };
        }

        case 'plague_4_opponent_delete': {
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

        case 'flip_self_for_water_0': {
            // Water-0: Flip self after playing
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        case 'reveal_opponent_hand': {
            // This action doesn't require a response from the AI, just acknowledgment
            return { type: 'skip' };
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
