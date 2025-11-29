/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EASY AI - Focused on winning, but only looks at own board
 * - Always tries to compile as fast as possible
 * - Prioritizes lanes closest to 10
 * - Doesn't consider opponent's strategy
 * - Makes simple decisions for effect choices
 */

import { GameState, ActionRequired, AIAction, Player, PlayedCard } from '../../types';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { handleControlRearrange } from './controlMechanicLogic';
import { isFrost1Active } from '../game/passiveRuleChecker';
import {
    canPlayCard,
    hasAnyProtocolPlayRule,
    hasRequireNonMatchingProtocolRule,
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

/**
 * Easy AI's card selection logic - focused on winning fast
 * Priority:
 * 1. Can we compile this turn? -> Play to reach 10+
 * 2. Get closest to compile -> Play in lane closest to 10
 * 3. Build value -> Play highest value card face-up if possible
 */
const getBestCardToPlay = (state: GameState): { cardId: string, laneIndex: number, isFaceUp: boolean } | null => {
    const { opponent, player } = state;
    if (opponent.hand.length === 0) return null;

    const canPlayInLane = (laneIndex: number, isFaceUp: boolean, cardProtocol: string): boolean => {
        const result = canPlayCard(state, 'opponent', laneIndex, isFaceUp, cardProtocol);
        return result.allowed;
    };

    const mustPlayFaceDown = hasRequireFaceDownPlayRule(state, 'opponent');
    const canPlayAnyProtocol = hasAnyProtocolPlayRule(state, 'opponent');
    const requireNonMatching = hasRequireNonMatchingProtocolRule(state);

    // Helper: Can this card be played face-up in this lane?
    const canPlayCardFaceUpInLane = (card: PlayedCard, laneIndex: number): boolean => {
        if (mustPlayFaceDown) return false;
        if (!canPlayInLane(laneIndex, true, card.protocol)) return false;

        if (requireNonMatching) {
            return card.protocol !== opponent.protocols[laneIndex] && card.protocol !== player.protocols[laneIndex];
        }
        const protocolMatches = card.protocol === opponent.protocols[laneIndex] || card.protocol === player.protocols[laneIndex];
        return protocolMatches || canPlayAnyProtocol;
    };

    // Helper: Get effective value of a card when played
    const getEffectiveValue = (card: PlayedCard, isFaceUp: boolean, laneIndex: number): number => {
        if (isFaceUp) return card.value;
        // Face-down base value is 2, but check for lane boosts
        const boost = getLaneFaceDownValueBoost(state, laneIndex);
        return 2 + boost;
    };

    // Filter out unplayable cards
    const playableHand = opponent.hand.filter(card => {
        if (hasReturnOwnCardEffect(card)) {
            const cardsOnBoard = opponent.lanes.flat();
            const hasOtherProtocolCards = cardsOnBoard.some(c => c.protocol !== card.protocol);
            return hasOtherProtocolCards;
        }
        return true;
    });

    if (playableHand.length === 0) return null;

    // Check if card would delete itself when played face-up
    const wouldSuicide = (card: PlayedCard): boolean => {
        if (hasDeleteSelfOnCoverEffect(card)) {
            // Only suicide if it won't reach compile
            for (let i = 0; i < 3; i++) {
                if (!opponent.compiled[i] && opponent.laneValues[i] + card.value >= 10) {
                    return false; // Can compile, not suicide
                }
            }
            return true;
        }
        if (hasDeleteHighestOwnCardEffect(card)) {
            let maxOtherValue = 0;
            for (let i = 0; i < 3; i++) {
                const lane = opponent.lanes[i];
                if (lane.length > 0) {
                    const uncovered = lane[lane.length - 1];
                    const val = uncovered.isFaceUp ? uncovered.value : 2;
                    if (val > maxOtherValue) maxOtherValue = val;
                }
            }
            return card.value >= maxOtherValue;
        }
        return false;
    };

    // Score all possible plays
    type ScoredPlay = { cardId: string; laneIndex: number; isFaceUp: boolean; score: number };
    const scoredPlays: ScoredPlay[] = [];

    for (const card of playableHand) {
        for (let laneIndex = 0; laneIndex < 3; laneIndex++) {
            // Skip compiled lanes
            if (opponent.compiled[laneIndex]) continue;

            const currentValue = opponent.laneValues[laneIndex];
            const playerValue = player.laneValues[laneIndex];

            // Try face-up play
            if (canPlayCardFaceUpInLane(card, laneIndex) && !wouldSuicide(card)) {
                const valueAfter = currentValue + card.value;
                let score = 0;

                // PRIORITY 1: Can compile this lane?
                if (valueAfter >= 10 && valueAfter > playerValue) {
                    score = 1000 + valueAfter; // Highest priority
                }
                // PRIORITY 2: Getting closer to 10
                else if (valueAfter < 10) {
                    score = 100 + valueAfter; // Closer to 10 = better
                }
                // Still good value even if can't beat player
                else {
                    score = 50 + card.value;
                }

                scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: true, score });
            }

            // Try face-down play
            if (canPlayInLane(laneIndex, false, card.protocol)) {
                const faceDownValue = getEffectiveValue(card, false, laneIndex);
                const valueAfter = currentValue + faceDownValue;
                let score = 0;

                // PRIORITY 1: Can compile this lane?
                if (valueAfter >= 10 && valueAfter > playerValue) {
                    score = 900 + valueAfter; // High priority but slightly less than face-up compile
                }
                // PRIORITY 2: Getting closer to 10
                else if (valueAfter < 10) {
                    score = 80 + valueAfter;
                }
                // Fallback
                else {
                    score = 30 + faceDownValue;
                }

                scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: false, score });
            }
        }
    }

    if (scoredPlays.length === 0) return null;

    // Sort by score descending and pick best
    scoredPlays.sort((a, b) => b.score - a.score);

    // SAFETY CHECK: Validate the chosen play is actually legal
    for (const play of scoredPlays) {
        if (play.isFaceUp) {
            const card = opponent.hand.find(c => c.id === play.cardId);
            if (!card) continue;
            const check = canPlayCard(state, 'opponent', play.laneIndex, true, card.protocol);
            if (!check.allowed) {
                console.warn(`[Easy AI Safety] Rejecting invalid face-up play: ${card.protocol}-${card.value} in lane ${play.laneIndex} - ${check.reason}`);
                continue;
            }
        }
        return { cardId: play.cardId, laneIndex: play.laneIndex, isFaceUp: play.isFaceUp };
    }

    return null;
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    switch (action.type) {
        case 'prompt_use_control_mechanic': {
            const { player } = state;
            const playerHasCompiled = player.compiled.some(c => c);
            const uncompiledLaneCount = player.compiled.filter(c => !c).length;

            // Easy AI: If player has compiled lanes, try to disrupt
            if (playerHasCompiled && uncompiledLaneCount > 0) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }
            return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
        }

        case 'discard': {
            // Discard lowest value cards - ALWAYS use action.count
            const sortedHand = [...state.opponent.hand].sort((a, b) => a.value - b.value);
            const cardsToDiscard = sortedHand.slice(0, action.count).map(c => c.id);
            return { type: 'discardCards', cardIds: cardsToDiscard };
        }

        case 'select_opponent_card_to_flip': {
            const playerUncovered = state.player.lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            if (playerUncovered.length === 0) return { type: 'skip' };

            // Flip highest value face-up card to reduce opponent's score
            const faceUpTargets = playerUncovered.filter(c => c.isFaceUp).sort((a, b) => b.value - a.value);
            if (faceUpTargets.length > 0) {
                return { type: 'flipCard', cardId: faceUpTargets[0].id };
            }

            // Otherwise flip a face-down card
            return { type: 'flipCard', cardId: playerUncovered[0].id };
        }

        // LEGACY REMOVED: select_card_to_delete_for_anarchy_2 - now uses generic select_cards_to_delete

        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete': {
            const disallowedIds = ('disallowedIds' in action && action.disallowedIds) ? action.disallowedIds : [];
            const targetFilter = 'targetFilter' in action ? action.targetFilter as { owner?: string; faceState?: string; position?: string } : undefined;
            const actorChooses = 'actorChooses' in action ? action.actorChooses : 'effect_owner';

            // If AI must select its OWN cards
            if (actorChooses === 'card_owner' && targetFilter?.owner === 'opponent') {
                const ownValidCards: PlayedCard[] = [];
                state.opponent.lanes.forEach((lane) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (targetFilter?.faceState === 'face_down' && topCard.isFaceUp) return;
                        if (targetFilter?.faceState === 'face_up' && !topCard.isFaceUp) return;
                        ownValidCards.push(topCard);
                    }
                });

                if (ownValidCards.length > 0) {
                    // Delete lowest value to minimize loss
                    ownValidCards.sort((a, b) => {
                        const aVal = a.isFaceUp ? a.value : 2;
                        const bVal = b.isFaceUp ? b.value : 2;
                        return aVal - bVal;
                    });
                    return { type: 'deleteCard', cardId: ownValidCards[0].id };
                }
                return { type: 'skip' };
            }

            const getUncoveredCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null)
                .filter(c => {
                    if (targetFilter?.faceState === 'face_down' && c.isFaceUp) return false;
                    if (targetFilter?.faceState === 'face_up' && !c.isFaceUp) return false;
                    return true;
                });

            const ownerFilter = targetFilter?.owner;

            if (ownerFilter === 'own') {
                const ownCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
                if (ownCards.length > 0) {
                    // Delete lowest value
                    ownCards.sort((a, b) => (a.isFaceUp ? a.value : 2) - (b.isFaceUp ? b.value : 2));
                    return { type: 'deleteCard', cardId: ownCards[0].id };
                }
            } else if (ownerFilter === 'opponent') {
                const playerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
                if (playerCards.length > 0) {
                    // Delete highest value to hurt opponent most
                    playerCards.sort((a, b) => (b.isFaceUp ? b.value : 2) - (a.isFaceUp ? a.value : 2));
                    return { type: 'deleteCard', cardId: playerCards[0].id };
                }
            } else {
                // No filter: Prefer player cards
                const playerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
                if (playerCards.length > 0) {
                    playerCards.sort((a, b) => (b.isFaceUp ? b.value : 2) - (a.isFaceUp ? a.value : 2));
                    return { type: 'deleteCard', cardId: playerCards[0].id };
                }

                const ownCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
                if (ownCards.length > 0) {
                    ownCards.sort((a, b) => (a.isFaceUp ? a.value : 2) - (b.isFaceUp ? b.value : 2));
                    return { type: 'deleteCard', cardId: ownCards[0].id };
                }
            }
            return { type: 'skip' };
        }

        case 'plague_4_opponent_delete': {
            const ownFaceDownUncovered: PlayedCard[] = [];
            state.opponent.lanes.forEach((lane) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        ownFaceDownUncovered.push(topCard);
                    }
                }
            });

            if (ownFaceDownUncovered.length > 0) {
                return { type: 'deleteCard', cardId: ownFaceDownUncovered[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            const validTargets: PlayedCard[] = [];

            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;
                // Prefer player cards
                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    validTargets.push(playerLane[playerLane.length - 1]);
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

        case 'select_low_value_card_to_delete': {
            const uncoveredCards: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (const lane of state[p].lanes) {
                    if (lane.length > 0) {
                        uncoveredCards.push(lane[lane.length - 1]);
                    }
                }
            }
            // Prefer player's low-value cards
            const playerTargets = uncoveredCards.filter(c =>
                c.isFaceUp && (c.value === 0 || c.value === 1) &&
                state.player.lanes.some(lane => lane.some(lc => lc.id === c.id))
            );
            if (playerTargets.length > 0) {
                return { type: 'deleteCard', cardId: playerTargets[0].id };
            }

            const anyTargets = uncoveredCards.filter(c => c.isFaceUp && (c.value === 0 || c.value === 1));
            if (anyTargets.length > 0) {
                return { type: 'deleteCard', cardId: anyTargets[0].id };
            }
            return { type: 'skip' };
        }

        // LEGACY REMOVED: select_own_highest_card_to_delete_for_hate_2 - now uses generic select_cards_to_delete with calculation: highest_value
        // LEGACY REMOVED: select_opponent_highest_card_to_delete_for_hate_2 - now uses generic select_cards_to_delete with calculation: highest_value

        case 'select_own_face_up_covered_card_to_flip':
            return { type: 'skip' };

        // LEGACY REMOVED: select_face_down_card_to_reveal_for_light_2 - now uses generic reveal effect

        case 'select_opponent_face_up_card_to_flip': {
            const playerUncoveredFaceUp = state.player.lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null && c.isFaceUp);

            if (playerUncoveredFaceUp.length > 0) {
                // Flip highest value
                playerUncoveredFaceUp.sort((a, b) => b.value - a.value);
                return { type: 'flipCard', cardId: playerUncoveredFaceUp[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_any_other_card_to_flip':
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional':
        // LEGACY REMOVED: select_card_to_flip_for_fire_3 - now uses generic select_card_to_flip
        case 'select_card_to_flip_for_light_0':
        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_any_face_down_card_to_flip_optional':
        // LEGACY REMOVED: select_covered_card_to_flip_for_chaos_0 - now uses generic select_card_to_flip with each_lane scope
        case 'select_covered_card_in_line_to_flip_optional': {
            const frost1Active = isFrost1Active(state);
            const isOptional = 'optional' in action && action.optional;
            const sourceCardId = 'sourceCardId' in action ? action.sourceCardId : null;
            const requiresFaceDown = action.type === 'select_any_face_down_card_to_flip_optional';

            // Special case for covered card flips in a specific line
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const playerCovered = state.player.lanes[laneIndex].filter((_, i, arr) => i < arr.length - 1);
                if (playerCovered.length > 0) return { type: 'flipCard', cardId: playerCovered[0].id };
                const opponentCovered = state.opponent.lanes[laneIndex].filter((_, i, arr) => i < arr.length - 1);
                if (opponentCovered.length > 0) return { type: 'flipCard', cardId: opponentCovered[0].id };
                return { type: 'skip' };
            }

            const getUncovered = (player: Player): PlayedCard[] => {
                return state[player].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null)
                    .filter(c => !sourceCardId || c.id !== sourceCardId);
            };

            const playerUncovered = getUncovered('player');
            const ownUncovered = getUncovered('opponent');

            // Priority 1: Flip player's highest face-up card (hurts them)
            if (!requiresFaceDown) {
                const playerFaceUp = playerUncovered.filter(c => c.isFaceUp).sort((a, b) => b.value - a.value);
                if (playerFaceUp.length > 0) return { type: 'flipCard', cardId: playerFaceUp[0].id };
            }

            // Priority 2: Flip player's face-down card (reveals info)
            if (!frost1Active && !requiresFaceDown) {
                const playerFaceDown = playerUncovered.filter(c => !c.isFaceUp);
                if (playerFaceDown.length > 0) return { type: 'flipCard', cardId: playerFaceDown[0].id };
            }

            // Priority 3: Flip own face-down card (gains points)
            if (!frost1Active) {
                const ownFaceDown = ownUncovered.filter(c => !c.isFaceUp);
                if (ownFaceDown.length > 0) return { type: 'flipCard', cardId: ownFaceDown[0].id };
            }

            // Last resort: Flip own face-up card (only if mandatory)
            if (!requiresFaceDown && !isOptional) {
                const ownFaceUp = ownUncovered.filter(c => c.isFaceUp).sort((a, b) => a.value - b.value);
                if (ownFaceUp.length > 0) return { type: 'flipCard', cardId: ownFaceUp[0].id };
            }

            return { type: 'skip' };
        }

        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            const targetOwner = (action as any).targetOwner;
            const validCards: PlayedCard[] = [];

            if (targetOwner === 'own') {
                state.opponent.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
                if (validCards.length > 0) {
                    // Return lowest value
                    validCards.sort((a, b) => (a.isFaceUp ? a.value : 2) - (b.isFaceUp ? b.value : 2));
                    return { type: 'returnCard', cardId: validCards[0].id };
                }
            } else if (targetOwner === 'opponent') {
                state.player.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
                if (validCards.length > 0) {
                    // Return highest value
                    validCards.sort((a, b) => (b.isFaceUp ? b.value : 2) - (a.isFaceUp ? a.value : 2));
                    return { type: 'returnCard', cardId: validCards[0].id };
                }
            } else {
                // Prefer player's cards
                state.player.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
                state.opponent.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
            }

            if (validCards.length > 0) return { type: 'returnCard', cardId: validCards[0].id };
            return { type: 'skip' };
        }

        // LEGACY REMOVED: select_own_card_to_return_for_water_4 - now uses generic select_card_to_return
        // LEGACY REMOVED: select_card_to_shift_for_anarchy_0/1, select_card_to_shift_for_gravity_1 - now uses generic select_card_to_shift
        // LEGACY REMOVED: select_card_to_flip_and_shift_for_gravity_2 - now uses generic handlers
        // LEGACY REMOVED: select_face_down_card_to_shift_for_gravity_4/darkness_4 - now uses generic select_card_to_shift

        case 'shift_flipped_card_optional': {
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
                return { type: 'selectLane', laneIndex: possibleLanes[0] };
            }
            return { type: 'skip' };
        }

        case 'select_lane_for_play': {
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }

            possibleLanes = possibleLanes.filter(laneIndex => {
                const result = canPlayCard(state, 'opponent', laneIndex, !action.isFaceDown, '');
                return result.allowed;
            });

            if (possibleLanes.length > 0) {
                // Pick lane closest to 10 but not over
                const scoredLanes = possibleLanes.map(l => ({
                    lane: l,
                    value: state.opponent.laneValues[l],
                    compiled: state.opponent.compiled[l]
                })).filter(l => !l.compiled);

                scoredLanes.sort((a, b) => b.value - a.value);
                return { type: 'selectLane', laneIndex: scoredLanes[0]?.lane ?? possibleLanes[0] };
            }
            return { type: 'skip' };
        }

        case 'select_lane_for_shift': {
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }
            if ('originalLaneIndex' in action && action.originalLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.originalLaneIndex);
            }

            // Check for special restrictions
            if ('sourceCardId' in action) {
                const sourceCard = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].find(c => c.id === action.sourceCardId);

                if (sourceCard && hasShiftToFromLaneEffect(sourceCard)) {
                    let sourceLaneIndex: number | null = null;
                    for (let i = 0; i < 3; i++) {
                        const allLanes = [...state.player.lanes[i], ...state.opponent.lanes[i]];
                        if (allLanes.some(c => c.id === action.sourceCardId)) {
                            sourceLaneIndex = i;
                            break;
                        }
                    }

                    if (sourceLaneIndex !== null && 'originalLaneIndex' in action) {
                        if (action.originalLaneIndex !== sourceLaneIndex) {
                            possibleLanes = [sourceLaneIndex];
                        }
                    }
                }

                if (sourceCard && hasShiftToNonMatchingProtocolEffect(sourceCard)) {
                    const cardToShiftId = 'cardToShiftId' in action ? action.cardToShiftId : null;
                    if (cardToShiftId) {
                        const cardToShift = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].find(c => c.id === cardToShiftId);
                        if (cardToShift) {
                            possibleLanes = possibleLanes.filter(laneIndex => {
                                const playerProtocol = state.player.protocols[laneIndex];
                                const opponentProtocol = state.opponent.protocols[laneIndex];
                                return cardToShift.protocol !== playerProtocol && cardToShift.protocol !== opponentProtocol;
                            });
                        }
                    }
                }
            }

            if (possibleLanes.length > 0) {
                return { type: 'selectLane', laneIndex: possibleLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        // LEGACY REMOVED: select_lane_for_death_2, select_lane_for_life_3_play, select_lane_to_shift_cards_for_light_3, select_lane_for_metal_3_delete
        // These now use generic select_lane_for_shift, select_lane_for_play, select_lane_for_delete
        // LEGACY REMOVED: select_lane_to_shift_revealed_card_for_light_2 - now uses generic select_lane_for_shift

        case 'select_lane_for_delete_all': {
            const validLanes = 'validLanes' in action ? action.validLanes : [0, 1, 2];
            if (validLanes.length > 0) {
                return { type: 'selectLane', laneIndex: validLanes[0] };
            }
            return { type: 'skip' };
        }

        case 'select_lane_for_return': {
            // GENERIC: Return effect lane selection
            // AI should choose a lane where returning cards HURTS the player more than the AI
            const targetFilter = (action as any).targetFilter || {};
            const valueFilter = (action as any).valueFilter;
            const cardOwner = action.actor;

            const scoreLane = (laneIndex: number): { hasTargets: boolean, score: number } => {
                const faceDownBoost = getLaneFaceDownValueBoost(state, laneIndex);
                let playerLoss = 0;
                let opponentLoss = 0;
                let hasTargets = false;

                for (const p of ['player', 'opponent'] as Player[]) {
                    if (targetFilter.owner === 'own' && p !== cardOwner) continue;
                    if (targetFilter.owner === 'opponent' && p === cardOwner) continue;

                    for (let cardIdx = 0; cardIdx < state[p].lanes[laneIndex].length; cardIdx++) {
                        const card = state[p].lanes[laneIndex][cardIdx];
                        const isUncovered = cardIdx === state[p].lanes[laneIndex].length - 1;

                        if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                        if (targetFilter.position === 'covered' && isUncovered) continue;

                        const cardValue = card.isFaceUp ? card.value : (2 + faceDownBoost);
                        if (valueFilter !== undefined && cardValue !== valueFilter) continue;

                        hasTargets = true;
                        // Add to appropriate loss
                        if (p === 'player') {
                            playerLoss += cardValue;
                        } else {
                            opponentLoss += cardValue;
                        }
                    }
                }

                // Score = player loss - opponent loss (positive = good for AI)
                return { hasTargets, score: playerLoss - opponentLoss };
            };

            const laneScores = [0, 1, 2].map(i => ({ laneIndex: i, ...scoreLane(i) }));
            const validLanes = laneScores.filter(l => l.hasTargets);

            if (validLanes.length > 0) {
                // Sort by score descending (best for AI first)
                validLanes.sort((a, b) => b.score - a.score);
                return { type: 'selectLane', laneIndex: validLanes[0].laneIndex };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        // Prompts - Easy AI usually declines optional effects
        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: true };
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: false };
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: false };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: state.opponent.hand.length > 2 };
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: true };
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: true };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: true };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };
        case 'prompt_optional_effect': return { type: 'resolveOptionalEffectPrompt', accept: true };

        case 'prompt_shift_or_flip_for_light_2': {
            const { revealedCardId } = action;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            // CRITICAL FIX: Must return resolveLight2Prompt, NOT skip!
            // skipAction only works for optional actions, but this prompt isn't marked as optional
            if (!cardInfo) return { type: 'resolveLight2Prompt', choice: 'skip' };

            if (cardInfo.owner === 'opponent') {
                return { type: 'resolveLight2Prompt', choice: 'flip' };
            }
            return { type: 'resolveLight2Prompt', choice: 'skip' };
        }

        case 'plague_2_opponent_discard': {
            if (state.opponent.hand.length > 0) {
                // Discard lowest value
                const sorted = [...state.opponent.hand].sort((a, b) => a.value - b.value);
                return { type: 'resolvePlague2Discard', cardIds: [sorted[0].id] };
            }
            return { type: 'skip' };
        }

        case 'select_cards_from_hand_to_discard_for_fire_4': {
            const maxDiscard = Math.min(3, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };
            const sorted = [...state.opponent.hand].sort((a, b) => a.value - b.value);
            return { type: 'resolveFire4Discard', cardIds: sorted.slice(0, maxDiscard).map(c => c.id) };
        }

        case 'select_cards_from_hand_to_discard_for_hate_1':
            if (state.opponent.hand.length > 0) {
                const sorted = [...state.opponent.hand].sort((a, b) => a.value - b.value);
                return { type: 'resolveHate1Discard', cardIds: sorted.slice(0, action.count).map(c => c.id) };
            }
            return { type: 'skip' };

        case 'select_card_from_hand_to_play': {
            if (state.opponent.hand.length > 0) {
                const cardToPlay = state.opponent.hand[0];
                let playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);

                playableLanes = playableLanes.filter(laneIndex => {
                    const result = canPlayCard(state, 'opponent', laneIndex, !action.isFaceDown, cardToPlay.protocol);
                    return result.allowed;
                });

                if (playableLanes.length > 0) {
                    // Pick best lane (closest to 10)
                    const scoredLanes = playableLanes
                        .filter(l => !state.opponent.compiled[l])
                        .map(l => ({ lane: l, value: state.opponent.laneValues[l] }))
                        .sort((a, b) => b.value - a.value);

                    return { type: 'playCard', cardId: cardToPlay.id, laneIndex: scoredLanes[0]?.lane ?? playableLanes[0], isFaceUp: false };
                }
            }
            return { type: 'skip' };
        }

        case 'select_card_from_hand_to_give':
            if (state.opponent.hand.length > 0) {
                // Give lowest value card
                const sorted = [...state.opponent.hand].sort((a, b) => a.value - b.value);
                return { type: 'giveCard', cardId: sorted[0].id };
            }
            return { type: 'skip' };

        case 'select_card_from_hand_to_reveal':
            if (state.opponent.hand.length > 0) {
                return { type: 'revealCard', cardId: state.opponent.hand[0].id };
            }
            return { type: 'skip' };

        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);

        case 'prompt_swap_protocols': {
            const index1 = 0;
            const index2 = 1;
            return { type: 'resolveSwapProtocols', indices: [index1, index2] };
        }

        case 'select_opponent_face_down_card_to_shift': {
            const validTargets: PlayedCard[] = [];
            for (const lane of state.player.lanes) {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) validTargets.push(topCard);
                }
            }

            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_own_other_card_to_shift': {
            const cardToShift = state.opponent.lanes.flat().find(c => c.id !== action.sourceCardId);
            if (cardToShift) return { type: 'deleteCard', cardId: cardToShift.id };
            return { type: 'skip' };
        }

        case 'select_own_card_to_shift_for_speed_3': {
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) return { type: 'deleteCard', cardId: ownCards[0].id };
            return { type: 'skip' };
        }

        case 'select_opponent_covered_card_to_shift':
        case 'select_own_covered_card_to_shift': {
            const isOwnCards = action.type === 'select_own_covered_card_to_shift';
            const targetState = isOwnCards ? state.opponent : state.player;
            const validTargets: PlayedCard[] = [];

            for (const lane of targetState.lanes) {
                for (let i = 0; i < lane.length - 1; i++) {
                    validTargets.push(lane[i]);
                }
            }

            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_any_opponent_card_to_shift': {
            const validTargets = state.player.lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
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

        case 'plague_2_player_discard':
        case 'reveal_opponent_hand':
        case 'anarchy_0_conditional_draw':
        case 'execute_remaining_custom_effects':
        case 'discard_completed':
        case 'delete_self':
            // These actions don't require AI decisions - handled automatically
            return { type: 'skip' };

        // Generic handlers for custom protocols
        case 'select_card_to_flip': {
            const targetFilter = (action as any).targetFilter || {};
            const currentLaneIndex = (action as any).currentLaneIndex;
            const cardOwner = action.actor;
            const validTargets: PlayedCard[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    if (currentLaneIndex !== undefined && laneIdx !== currentLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];
                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];
                        const isTopCard = i === lane.length - 1;

                        if (targetFilter.position === 'uncovered' && !isTopCard) continue;
                        if (targetFilter.position === 'covered' && isTopCard) continue;
                        if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                        if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;
                        if (targetFilter.excludeSelf && card.id === action.sourceCardId) continue;

                        validTargets.push(card);
                    }
                }
            }

            if (validTargets.length === 0) return { type: 'skip' };

            // Categorize and prioritize
            const playerCards = validTargets.filter(c =>
                state.player.lanes.some(lane => lane.some(lc => lc.id === c.id))
            );

            // Priority: Flip player's face-up cards (highest value first)
            const playerFaceUp = playerCards.filter(c => c.isFaceUp).sort((a, b) => b.value - a.value);
            if (playerFaceUp.length > 0) return { type: 'flipCard', cardId: playerFaceUp[0].id };

            // Then flip own face-down cards
            const ownCards = validTargets.filter(c =>
                state.opponent.lanes.some(lane => lane.some(lc => lc.id === c.id))
            );
            const ownFaceDown = ownCards.filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) return { type: 'flipCard', cardId: ownFaceDown[0].id };

            return { type: 'flipCard', cardId: validTargets[0].id };
        }

        case 'select_card_to_shift': {
            const targetFilter = (action as any).targetFilter || {};
            const currentLaneIndex = (action as any).currentLaneIndex;
            const cardOwner = action.actor;
            const validTargets: PlayedCard[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    if (currentLaneIndex !== undefined && laneIdx !== currentLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];
                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];
                        const isTopCard = i === lane.length - 1;

                        if (targetFilter.position === 'uncovered' && !isTopCard) continue;
                        if (targetFilter.position === 'covered' && isTopCard) continue;
                        if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                        if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;
                        if (targetFilter.excludeSelf && card.id === action.sourceCardId) continue;

                        validTargets.push(card);
                    }
                }
            }

            if (validTargets.length > 0) {
                // Prefer shifting player's cards
                const playerCards = validTargets.filter(c =>
                    state.player.lanes.some(lane => lane.some(lc => lc.id === c.id))
                );
                if (playerCards.length > 0) {
                    return { type: 'deleteCard', cardId: playerCards[0].id };
                }
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_board_card_to_reveal_custom': {
            const validTargets: PlayedCard[] = [];
            for (const playerKey of ['player', 'opponent'] as const) {
                for (const lane of state[playerKey].lanes) {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (!topCard.isFaceUp) validTargets.push(topCard);
                    }
                }
            }
            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'prompt_shift_or_flip_board_card_custom': {
            const { revealedCardId } = action as any;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            // CRITICAL FIX: Must return resolveLight2Prompt, NOT skip!
            if (!cardInfo) return { type: 'resolveLight2Prompt', choice: 'skip' };
            if (cardInfo.owner === 'opponent') {
                return { type: 'resolveLight2Prompt', choice: 'flip' };
            }
            return { type: 'resolveLight2Prompt', choice: 'skip' };
        }

        case 'select_lane_to_shift_revealed_board_card_custom':
        case 'gravity_2_shift_after_flip': {
            const targetLaneIndex = (action as any).targetLaneIndex;
            if (targetLaneIndex !== undefined) {
                return { type: 'selectLane', laneIndex: targetLaneIndex };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_delete': {
            const validLanes = (action as any).validLanes || [0, 1, 2];
            const disallowedLane = (action as any).disallowedLaneIndex;
            const filteredLanes = validLanes.filter((i: number) => i !== disallowedLane);
            const valueFilter = (action as any).valueFilter;

            // Score each lane by NET benefit (player cards deleted - own cards deleted)
            const scoredLanes = filteredLanes.map((i: number) => {
                let playerLoss = 0;
                let ownLoss = 0;

                // Count player's cards that would be deleted
                for (const card of state.player.lanes[i]) {
                    if (valueFilter && card.isFaceUp) {
                        if (card.value >= valueFilter.min && card.value <= valueFilter.max) {
                            playerLoss += 1;
                        }
                    } else if (!valueFilter) {
                        playerLoss += 1;
                    }
                }

                // Count our own cards that would be deleted
                for (const card of state.opponent.lanes[i]) {
                    if (valueFilter && card.isFaceUp) {
                        if (card.value >= valueFilter.min && card.value <= valueFilter.max) {
                            ownLoss += 2; // Penalty for losing own cards
                        }
                    } else if (!valueFilter) {
                        ownLoss += 2;
                    }
                }

                return { laneIndex: i, score: playerLoss - ownLoss };
            });

            // Sort by score (highest first) and pick best lane
            scoredLanes.sort((a, b) => b.score - a.score);

            if (scoredLanes.length > 0) {
                return { type: 'selectLane', laneIndex: scoredLanes[0].laneIndex };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_shift_all': {
            // Light-3 uses validDestinationLanes, not validLanes
            const validLanes = (action as any).validDestinationLanes || (action as any).validLanes || [0, 1, 2];
            const sourceLane = (action as any).sourceLaneIndex;
            // Filter out the source lane (can't shift to same lane)
            const filteredLanes = validLanes.filter((i: number) => i !== sourceLane);
            if (filteredLanes.length > 0) {
                return { type: 'selectLane', laneIndex: filteredLanes[0] };
            }
            // Fallback if no filtered lanes
            if (validLanes.length > 0) {
                return { type: 'selectLane', laneIndex: validLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'prompt_optional_draw':
            return { type: 'resolveOptionalEffectPrompt', accept: true };

        case 'prompt_optional_discard_custom':
            return { type: 'resolveOptionalEffectPrompt', accept: false };

        case 'custom_choice':
            return { type: 'resolveCustomChoice', choiceIndex: 0 };
    }

    return { type: 'skip' };
};


export const easyAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        return { type: 'compile', laneIndex: state.compilableLanes[0] };
    }

    if (state.phase === 'action') {
        const bestPlay = getBestCardToPlay(state);
        if (bestPlay) {
            return { type: 'playCard', ...bestPlay };
        }

        // Only fill hand if we have 0-1 cards, otherwise try to play face-down anywhere
        if (state.opponent.hand.length <= 1) {
            return { type: 'fillHand' };
        }

        // Fallback: Try to play ANY card face-down in ANY non-compiled lane
        for (const card of state.opponent.hand) {
            for (let i = 0; i < 3; i++) {
                if (state.opponent.compiled[i]) continue;
                const check = canPlayCard(state, 'opponent', i, false, card.protocol);
                if (check.allowed) {
                    return { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false };
                }
            }
        }

        // Truly no options - fill hand
        return { type: 'fillHand' };
    }

    return { type: 'fillHand' };
};
