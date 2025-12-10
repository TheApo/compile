/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EASY AI - Focused on winning, but only looks at own board
 * - Always tries to compile as fast as possible
 * - Prioritizes lanes closest to 10
 * - Doesn't consider opponent's strategy
 * - Makes simple decisions for effect choices
 *
 * FULLY GENERIC: Uses only targetFilter, scope, destinationRestriction from ActionRequired
 * NO card-specific handlers - all effects handled through parameters
 */

import { GameState, ActionRequired, AIAction, Player, PlayedCard, TargetFilter, EffectScope, DestinationRestriction } from '../../types';
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
    getLaneFaceDownValueBoost
} from './aiEffectUtils';

// =============================================================================
// GENERIC HELPER FUNCTIONS
// =============================================================================

/**
 * Get valid targets based on targetFilter, scope, and context
 * This is the CORE function that makes all handlers generic
 */
function getValidTargets(
    state: GameState,
    actor: Player,
    targetFilter?: TargetFilter,
    scope?: EffectScope,
    sourceCardId?: string,
    currentLaneIndex?: number
): PlayedCard[] {
    const validTargets: PlayedCard[] = [];
    const filter = targetFilter || {};
    // CRITICAL: Default position to 'uncovered' if not specified
    const position = filter.position || 'uncovered';

    for (const playerKey of ['player', 'opponent'] as const) {
        // Owner filter
        if (filter.owner === 'own' && playerKey !== actor) continue;
        if (filter.owner === 'opponent' && playerKey === actor) continue;

        for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
            // Scope filter
            if (scope?.type === 'this_lane' && scope.laneIndex !== undefined && laneIdx !== scope.laneIndex) continue;
            if (scope?.type === 'other_lanes' && scope.laneIndex !== undefined && laneIdx === scope.laneIndex) continue;
            if (currentLaneIndex !== undefined && scope?.type === 'this_lane' && laneIdx !== currentLaneIndex) continue;

            const lane = state[playerKey].lanes[laneIdx];
            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const card = lane[cardIdx];
                const isUncovered = cardIdx === lane.length - 1;

                // Position filter (default: uncovered)
                if (position === 'uncovered' && !isUncovered) continue;
                if (position === 'covered' && isUncovered) continue;
                // position === 'any' allows both covered and uncovered

                // Face state filter
                if (filter.faceState === 'face_up' && !card.isFaceUp) continue;
                if (filter.faceState === 'face_down' && card.isFaceUp) continue;

                // Value range filter
                if (filter.valueRange) {
                    const cardValue = card.isFaceUp ? card.value : 2;
                    if (cardValue < filter.valueRange.min || cardValue > filter.valueRange.max) continue;
                }

                // Value equals filter
                if (filter.valueEquals !== undefined) {
                    const cardValue = card.isFaceUp ? card.value : 2;
                    if (cardValue !== filter.valueEquals) continue;
                }

                // Exclude self
                if (filter.excludeSelf && sourceCardId && card.id === sourceCardId) continue;

                validTargets.push(card);
            }
        }
    }

    // Apply calculation filter (highest/lowest)
    if (filter.calculation === 'highest_value' && validTargets.length > 0) {
        validTargets.sort((a, b) => {
            const aVal = a.isFaceUp ? a.value : 2;
            const bVal = b.isFaceUp ? b.value : 2;
            return bVal - aVal;
        });
        return [validTargets[0]];
    }
    if (filter.calculation === 'lowest_value' && validTargets.length > 0) {
        validTargets.sort((a, b) => {
            const aVal = a.isFaceUp ? a.value : 2;
            const bVal = b.isFaceUp ? b.value : 2;
            return aVal - bVal;
        });
        return [validTargets[0]];
    }

    return validTargets;
}

/**
 * Check if a card belongs to the player
 */
function isPlayerCard(state: GameState, cardId: string): boolean {
    return state.player.lanes.some(lane => lane.some(c => c.id === cardId));
}

/**
 * Get card value (handles face-down)
 */
function getCardValue(card: PlayedCard, state: GameState, laneIndex?: number): number {
    if (card.isFaceUp) return card.value;
    const boost = laneIndex !== undefined ? getLaneFaceDownValueBoost(state, laneIndex) : 0;
    return 2 + boost;
}

// =============================================================================
// CARD SELECTION LOGIC
// =============================================================================

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

    const canPlayCardFaceUpInLane = (card: PlayedCard, laneIndex: number): boolean => {
        if (mustPlayFaceDown) return false;
        if (!canPlayInLane(laneIndex, true, card.protocol)) return false;

        if (requireNonMatching) {
            return card.protocol !== opponent.protocols[laneIndex] && card.protocol !== player.protocols[laneIndex];
        }
        const protocolMatches = card.protocol === opponent.protocols[laneIndex] || card.protocol === player.protocols[laneIndex];
        return protocolMatches || canPlayAnyProtocol;
    };

    const getEffectiveValue = (card: PlayedCard, isFaceUp: boolean, laneIndex: number): number => {
        if (isFaceUp) return card.value;
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

    const wouldSuicide = (card: PlayedCard): boolean => {
        if (hasDeleteSelfOnCoverEffect(card)) {
            for (let i = 0; i < 3; i++) {
                if (!opponent.compiled[i] && opponent.laneValues[i] + card.value >= 10) {
                    return false;
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

    type ScoredPlay = { cardId: string; laneIndex: number; isFaceUp: boolean; score: number };
    const scoredPlays: ScoredPlay[] = [];

    // Count total cards on board (for early game detection)
    const totalCardsOnBoard = player.lanes.flat().length + opponent.lanes.flat().length;
    const isEarlyGame = totalCardsOnBoard <= 3;

    // Check if opponent (player) has any targets for disruption effects
    const playerHasCards = player.lanes.flat().length > 0;

    // Helper: Check if a card's effect has valid targets
    const effectHasValidTargets = (card: PlayedCard, laneIndex: number): boolean => {
        // Cards with flip/delete/shift/return effects need targets
        const needsTargets = card.keywords['flip'] || card.keywords['delete'] ||
                            card.keywords['shift'] || card.keywords['return'];
        if (!needsTargets) return true;

        // Check if there are any other cards on board
        const otherCardsExist = playerHasCards ||
            opponent.lanes.some((lane, idx) => idx !== laneIndex && lane.length > 0) ||
            (opponent.lanes[laneIndex].length > 0);

        return otherCardsExist;
    };

    for (const card of playableHand) {
        for (let laneIndex = 0; laneIndex < 3; laneIndex++) {
            if (opponent.compiled[laneIndex]) continue;

            const currentValue = opponent.laneValues[laneIndex];
            const playerValue = player.laneValues[laneIndex];

            if (canPlayCardFaceUpInLane(card, laneIndex) && !wouldSuicide(card)) {
                const valueAfter = currentValue + card.value;
                let score = 0;

                if (valueAfter >= 10 && valueAfter > playerValue) {
                    score = 1000 + valueAfter;
                } else if (valueAfter < 10) {
                    // PRIMARY GOAL: Build lane value toward compile
                    // Higher value cards contribute more
                    score = 100 + valueAfter + (card.value * 5);
                } else {
                    score = 50 + card.value;
                }

                // PENALTY: Low-value cards (0-2) in early game without targets
                if (isEarlyGame && card.value <= 2) {
                    if (!effectHasValidTargets(card, laneIndex)) {
                        score -= 200; // Heavy penalty - effect is useless
                    } else {
                        score -= 50; // Still not great, low value
                    }
                }

                // PENALTY: Draw effect that would cause discard (hand >= 5)
                if (card.keywords['draw'] && opponent.hand.length >= 5) {
                    score -= 30;
                }

                scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: true, score });
            }

            if (canPlayInLane(laneIndex, false, card.protocol)) {
                const faceDownValue = getEffectiveValue(card, false, laneIndex);
                const valueAfter = currentValue + faceDownValue;
                let score = 0;

                if (valueAfter >= 10 && valueAfter > playerValue) {
                    score = 900 + valueAfter;
                } else if (valueAfter < 10) {
                    score = 80 + valueAfter;
                } else {
                    score = 30 + faceDownValue;
                }

                scoredPlays.push({ cardId: card.id, laneIndex, isFaceUp: false, score });
            }
        }
    }

    if (scoredPlays.length === 0) return null;

    scoredPlays.sort((a, b) => b.score - a.score);

    for (const play of scoredPlays) {
        if (play.isFaceUp) {
            const card = opponent.hand.find(c => c.id === play.cardId);
            if (!card) continue;
            const check = canPlayCard(state, 'opponent', play.laneIndex, true, card.protocol);
            if (!check.allowed) continue;
        }
        return { cardId: play.cardId, laneIndex: play.laneIndex, isFaceUp: play.isFaceUp };
    }

    return null;
};

// =============================================================================
// GENERIC ACTION HANDLERS
// =============================================================================

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    switch (action.type) {
        // =========================================================================
        // CONTROL MECHANIC
        // =========================================================================
        case 'prompt_use_control_mechanic': {
            const { player } = state;
            const playerHasCompiled = player.compiled.some(c => c);
            const uncompiledLaneCount = player.compiled.filter(c => !c).length;

            if (playerHasCompiled && uncompiledLaneCount > 0) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            }
            return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
        }

        // =========================================================================
        // DISCARD - GENERIC (uses count, variableCount, upTo from params)
        // =========================================================================
        case 'discard': {
            const sortedHand = [...state.opponent.hand].sort((a, b) => a.value - b.value);
            const count = action.variableCount
                ? Math.min(3, sortedHand.length)  // Variable: discard up to 3
                : action.count;
            const cardsToDiscard = sortedHand.slice(0, count).map(c => c.id);
            return { type: 'discardCards', cardIds: cardsToDiscard };
        }

        // =========================================================================
        // SELECT CARDS TO DELETE - GENERIC (uses targetFilter, scope, count)
        // =========================================================================
        case 'select_cards_to_delete': {
            // CRITICAL: Check BOTH currentLaneIndex AND laneIndex (executors may use either!)
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const allowedIds = (action as any).allowedIds as string[] | undefined; // NEW: Server-set allowed IDs (for calculation filters)
            let validTargets = getValidTargets(
                state,
                action.actor,
                action.targetFilter,
                action.scope,
                action.sourceCardId,
                restrictedLaneIndex
            );

            // NEW: If server specified allowedIds, use those instead (handles calculation filters like highest_value)
            if (allowedIds) {
                validTargets = validTargets.filter(c => allowedIds.includes(c.id));
            }

            // Filter out disallowed IDs
            const disallowedIds = action.disallowedIds || [];
            const filteredTargets = validTargets.filter(c => !disallowedIds.includes(c.id));

            if (filteredTargets.length === 0) return { type: 'skip' };

            // Strategy: Prefer deleting player's high-value cards, own low-value cards
            const playerCards = filteredTargets.filter(c => isPlayerCard(state, c.id));
            const ownCards = filteredTargets.filter(c => !isPlayerCard(state, c.id));

            if (playerCards.length > 0) {
                // Delete highest value player card
                playerCards.sort((a, b) => getCardValue(b, state) - getCardValue(a, state));
                return { type: 'deleteCard', cardId: playerCards[0].id };
            }

            if (ownCards.length > 0) {
                // Delete lowest value own card
                ownCards.sort((a, b) => getCardValue(a, state) - getCardValue(b, state));
                return { type: 'deleteCard', cardId: ownCards[0].id };
            }

            return { type: 'deleteCard', cardId: filteredTargets[0].id };
        }

        // =========================================================================
        // SELECT CARD TO FLIP - GENERIC (uses targetFilter, scope, optional)
        // =========================================================================
        case 'select_card_to_flip':
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional': {
            const frost1Active = isFrost1Active(state);
            // CRITICAL: Check BOTH currentLaneIndex AND laneIndex (flipExecutor uses laneIndex!)
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const validTargets = getValidTargets(
                state,
                action.actor,
                action.targetFilter,
                action.scope,
                action.sourceCardId,
                restrictedLaneIndex
            );

            if (validTargets.length === 0) {
                return action.optional ? { type: 'skip' } : { type: 'skip' };
            }

            const playerCards = validTargets.filter(c => isPlayerCard(state, c.id));
            const ownCards = validTargets.filter(c => !isPlayerCard(state, c.id));

            // Priority 1: Flip player's face-up cards (highest value first - hurts them)
            const playerFaceUp = playerCards.filter(c => c.isFaceUp).sort((a, b) => b.value - a.value);
            if (playerFaceUp.length > 0) return { type: 'flipCard', cardId: playerFaceUp[0].id };

            // Priority 2: Flip player's face-down cards (reveals info)
            if (!frost1Active) {
                const playerFaceDown = playerCards.filter(c => !c.isFaceUp);
                if (playerFaceDown.length > 0) return { type: 'flipCard', cardId: playerFaceDown[0].id };
            }

            // Priority 3: Flip own face-down cards (gains points)
            if (!frost1Active) {
                const ownFaceDown = ownCards.filter(c => !c.isFaceUp);
                if (ownFaceDown.length > 0) return { type: 'flipCard', cardId: ownFaceDown[0].id };
            }

            // Last resort: Flip own face-up card (only if mandatory)
            if (!action.optional) {
                const ownFaceUp = ownCards.filter(c => c.isFaceUp).sort((a, b) => a.value - b.value);
                if (ownFaceUp.length > 0) return { type: 'flipCard', cardId: ownFaceUp[0].id };
            }

            return { type: 'skip' };
        }

        // =========================================================================
        // SELECT CARD TO SHIFT - GENERIC (uses targetFilter, destinationRestriction)
        // =========================================================================
        case 'select_card_to_shift': {
            // CRITICAL: Only restrict lane if scope is explicitly 'this_lane'
            const scope = (action as any).scope;
            const restrictedLaneIndex = scope === 'this_lane'
                ? ((action as any).sourceLaneIndex ?? (action as any).currentLaneIndex ?? (action as any).laneIndex)
                : undefined;
            const validTargets = getValidTargets(
                state,
                action.actor,
                action.targetFilter,
                scope,
                action.sourceCardId,
                restrictedLaneIndex
            );

            if (validTargets.length === 0) {
                return action.optional ? { type: 'skip' } : { type: 'skip' };
            }

            // Prefer shifting player's cards
            const playerCards = validTargets.filter(c => isPlayerCard(state, c.id));
            if (playerCards.length > 0) {
                return { type: 'shiftCard', cardId: playerCards[0].id };
            }

            return { type: 'shiftCard', cardId: validTargets[0].id };
        }

        // =========================================================================
        // SELECT CARD TO RETURN - GENERIC (uses targetFilter)
        // =========================================================================
        case 'select_card_to_return': {
            // CRITICAL: Check BOTH currentLaneIndex AND laneIndex (executors may use either!)
            const restrictedLaneIndex = (action as any).currentLaneIndex ?? (action as any).laneIndex;
            const validTargets = getValidTargets(
                state,
                action.actor,
                action.targetFilter,
                action.scope,
                action.sourceCardId,
                restrictedLaneIndex
            );

            if (validTargets.length === 0) {
                return action.optional ? { type: 'skip' } : { type: 'skip' };
            }

            // Prefer returning player's highest value cards
            const playerCards = validTargets.filter(c => isPlayerCard(state, c.id));
            if (playerCards.length > 0) {
                playerCards.sort((a, b) => getCardValue(b, state) - getCardValue(a, state));
                return { type: 'returnCard', cardId: playerCards[0].id };
            }

            // Return own lowest value card if necessary
            const ownCards = validTargets.filter(c => !isPlayerCard(state, c.id));
            if (ownCards.length > 0) {
                ownCards.sort((a, b) => getCardValue(a, state) - getCardValue(b, state));
                return { type: 'returnCard', cardId: ownCards[0].id };
            }

            return { type: 'returnCard', cardId: validTargets[0].id };
        }

        // =========================================================================
        // LANE SELECTION - GENERIC
        // =========================================================================
        case 'select_lane_for_shift': {
            // NEW: Respect validLanes restriction (Courage-3: opponent_highest_value_lane)
            let possibleLanes = (action as any).validLanes || [0, 1, 2];
            possibleLanes = possibleLanes.filter((l: number) => l !== action.originalLaneIndex);

            // Apply destination restriction
            if (action.destinationRestriction) {
                const restriction = action.destinationRestriction;
                const sourceLane = action.originalLaneIndex;

                if (restriction.type === 'to_this_lane' && restriction.laneIndex !== undefined) {
                    possibleLanes = possibleLanes.filter(l => l === restriction.laneIndex);
                } else if (restriction.type === 'to_another_lane') {
                    possibleLanes = possibleLanes.filter(l => l !== sourceLane);
                } else if (restriction.type === 'to_or_from_this_lane' && restriction.laneIndex !== undefined) {
                    const targetLane = typeof restriction.laneIndex === 'number' ? restriction.laneIndex : sourceLane;
                    if (sourceLane !== targetLane) {
                        possibleLanes = [targetLane];
                    }
                } else if (restriction.type === 'non_matching_protocol') {
                    const cardToShift = findCardOnBoard(state, action.cardToShiftId);
                    if (cardToShift) {
                        possibleLanes = possibleLanes.filter(l => {
                            const playerProtocol = state.player.protocols[l];
                            const opponentProtocol = state.opponent.protocols[l];
                            return cardToShift.card.protocol !== playerProtocol && cardToShift.card.protocol !== opponentProtocol;
                        });
                    }
                }
            }

            if (possibleLanes.length > 0) {
                return { type: 'selectLane', laneIndex: possibleLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_shift_all': {
            let validLanes = action.validLanes || [0, 1, 2];
            validLanes = validLanes.filter(l => l !== action.sourceLaneIndex);
            if (validLanes.length > 0) {
                return { type: 'selectLane', laneIndex: validLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_delete': {
            // NEW: Respect validLanes restriction (Courage-1: opponent_higher_value)
            let validLanes = (action as any).validLanes || [0, 1, 2];
            validLanes = validLanes.filter((l: number) => {
                if (action.excludeSourceLane && l === action.laneIndex) return false;
                return true;
            });

            // Score each lane by NET benefit (player cards deleted - own cards deleted)
            const scoredLanes = validLanes.map(i => {
                let playerLoss = 0;
                let ownLoss = 0;
                const deleteFilter = action.deleteFilter;

                for (const card of state.player.lanes[i]) {
                    if (deleteFilter?.valueRange && card.isFaceUp) {
                        if (card.value >= deleteFilter.valueRange.min && card.value <= deleteFilter.valueRange.max) {
                            playerLoss += 1;
                        }
                    } else if (!deleteFilter?.valueRange) {
                        playerLoss += 1;
                    }
                }

                for (const card of state.opponent.lanes[i]) {
                    if (deleteFilter?.valueRange && card.isFaceUp) {
                        if (card.value >= deleteFilter.valueRange.min && card.value <= deleteFilter.valueRange.max) {
                            ownLoss += 2;
                        }
                    } else if (!deleteFilter?.valueRange) {
                        ownLoss += 2;
                    }
                }

                return { laneIndex: i, score: playerLoss - ownLoss };
            });

            scoredLanes.sort((a, b) => b.score - a.score);
            return { type: 'selectLane', laneIndex: scoredLanes[0]?.laneIndex ?? 0 };
        }

        case 'select_lane_for_delete_all': {
            if (action.validLanes.length > 0) {
                return { type: 'selectLane', laneIndex: action.validLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_play': {
            let possibleLanes = action.validLanes || [0, 1, 2];
            if (action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }

            possibleLanes = possibleLanes.filter(l => {
                const result = canPlayCard(state, 'opponent', l, !action.isFaceDown, '');
                return result.allowed;
            });

            if (possibleLanes.length > 0) {
                const scoredLanes = possibleLanes
                    .filter(l => !state.opponent.compiled[l])
                    .map(l => ({ lane: l, value: state.opponent.laneValues[l] }))
                    .sort((a, b) => b.value - a.value);

                return { type: 'selectLane', laneIndex: scoredLanes[0]?.lane ?? possibleLanes[0] };
            }
            return { type: 'skip' };
        }

        case 'select_lane_for_return': {
            // Score each lane by benefit
            const scoredLanes = [0, 1, 2].map(i => {
                const returnFilter = action.returnFilter;
                let playerLoss = 0;
                let ownLoss = 0;

                for (const card of state.player.lanes[i]) {
                    const cardValue = card.isFaceUp ? card.value : 2;
                    if (returnFilter?.valueEquals !== undefined && cardValue !== returnFilter.valueEquals) continue;
                    playerLoss += cardValue;
                }

                for (const card of state.opponent.lanes[i]) {
                    const cardValue = card.isFaceUp ? card.value : 2;
                    if (returnFilter?.valueEquals !== undefined && cardValue !== returnFilter.valueEquals) continue;
                    ownLoss += cardValue;
                }

                return { laneIndex: i, score: playerLoss - ownLoss, hasTargets: playerLoss > 0 || ownLoss > 0 };
            });

            const validLanes = scoredLanes.filter(l => l.hasTargets);
            validLanes.sort((a, b) => b.score - a.score);

            return { type: 'selectLane', laneIndex: validLanes[0]?.laneIndex ?? 0 };
        }

        // =========================================================================
        // PROMPTS - GENERIC
        // =========================================================================
        case 'prompt_optional_effect': {
            // For 'give' actions (Love-1 End): ALWAYS skip
            // Giving a card to opponent is terrible - never do it
            const effectAction = (action as any).effectDef?.params?.action;
            if (effectAction === 'give') {
                return { type: 'resolveOptionalEffectPrompt', accept: false };
            }
            return { type: 'resolveOptionalEffectPrompt', accept: true };
        }

        case 'prompt_optional_discard_custom':
            return { type: 'resolveOptionalDiscardCustomPrompt', accept: false };

        // Clarity-4: "You may shuffle your trash into your deck"
        // Simple strategy: Always shuffle if there are cards in trash
        case 'prompt_optional_shuffle_trash': {
            const trashCount = (action as any).trashCount || 0;
            return { type: 'resolvePrompt', accept: trashCount > 0 };
        }

        // Clarity-2/3: "Draw 1 card with a value of X revealed this way."
        // Simple strategy: Pick the first selectable card
        case 'select_card_from_revealed_deck': {
            const selectableCardIds = (action as any).selectableCardIds || [];
            if (selectableCardIds.length > 0) {
                return { type: 'selectRevealedDeckCard', cardId: selectableCardIds[0] };
            }
            // No valid selection - skip
            return { type: 'resolvePrompt', accept: false };
        }

        case 'custom_choice':
            return { type: 'resolveCustomChoice', optionIndex: 0 };

        // =========================================================================
        // FLIP SELF - GENERIC (no card-specific naming)
        // =========================================================================
        case 'flip_self': {
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        // =========================================================================
        // PROTOCOL MANIPULATION
        // =========================================================================
        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);

        case 'prompt_swap_protocols':
            return { type: 'resolveSwapProtocols', indices: [0, 1] };

        // =========================================================================
        // HAND CARD SELECTION
        // =========================================================================
        case 'select_card_from_hand_to_play': {
            // NEW: Respect selectableCardIds filter (Clarity-2: only cards with specific value)
            const selectableCardIds = (action as any).selectableCardIds;
            const playableHand = selectableCardIds
                ? state.opponent.hand.filter(c => selectableCardIds.includes(c.id))
                : state.opponent.hand;

            if (playableHand.length > 0) {
                const cardToPlay = playableHand[0];
                // NEW: Smoke-3 - use validLanes if provided, otherwise all lanes except disallowed
                let playableLanes = (action as any).validLanes || [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);

                playableLanes = playableLanes.filter((l: number) => {
                    const result = canPlayCard(state, 'opponent', l, !action.isFaceDown, cardToPlay.protocol);
                    return result.allowed;
                });

                if (playableLanes.length > 0) {
                    const scoredLanes = playableLanes
                        .filter((l: number) => !state.opponent.compiled[l])
                        .map((l: number) => ({ lane: l, value: state.opponent.laneValues[l] }))
                        .sort((a: { lane: number, value: number }, b: { lane: number, value: number }) => b.value - a.value);

                    return { type: 'playCard', cardId: cardToPlay.id, laneIndex: scoredLanes[0]?.lane ?? playableLanes[0], isFaceUp: false };
                }
            }
            return { type: 'skip' };
        }

        case 'select_card_from_hand_to_give':
            if (state.opponent.hand.length > 0) {
                const sorted = [...state.opponent.hand].sort((a, b) => a.value - b.value);
                return { type: 'giveCard', cardId: sorted[0].id };
            }
            return { type: 'skip' };

        case 'select_card_from_hand_to_reveal':
            if (state.opponent.hand.length > 0) {
                return { type: 'revealCard', cardId: state.opponent.hand[0].id };
            }
            return { type: 'skip' };

        // =========================================================================
        // REVEAL ACTIONS
        // =========================================================================
        case 'reveal_opponent_hand':
            return { type: 'skip' };

        case 'select_board_card_to_reveal': {
            const validTargets = getValidTargets(
                state,
                action.actor,
                action.targetFilter || { faceState: 'face_down', position: 'uncovered' },
                undefined,
                action.sourceCardId
            );

            if (validTargets.length > 0) {
                return { type: 'revealCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'prompt_shift_or_flip_revealed_card': {
            const cardInfo = findCardOnBoard(state, action.revealedCardId);
            if (!cardInfo) return { type: 'resolvePrompt', accept: false };

            // If it's player's card, flip it to hurt them
            if (cardInfo.owner === 'player') {
                return { type: 'resolvePrompt', accept: true };
            }
            return { type: 'resolvePrompt', accept: false };
        }

        case 'select_lane_to_shift_revealed_card': {
            const cardInfo = findCardOnBoard(state, action.revealedCardId);
            if (!cardInfo) return { type: 'selectLane', laneIndex: 0 };

            // Find the lane index of the card
            let cardLaneIndex = -1;
            for (let i = 0; i < state[cardInfo.owner].lanes.length; i++) {
                if (state[cardInfo.owner].lanes[i].some(c => c.id === action.revealedCardId)) {
                    cardLaneIndex = i;
                    break;
                }
            }

            const possibleLanes = [0, 1, 2].filter(l => l !== cardLaneIndex);
            if (possibleLanes.length > 0) {
                return { type: 'selectLane', laneIndex: possibleLanes[0] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        // =========================================================================
        // LEGACY ACTION TYPES (from effectInterpreter - to be migrated)
        // =========================================================================
        case 'shift_flipped_card_optional': {
            // Spirit-3: After refresh draw, optionally shift the flipped card
            const cardId = (action as any).cardId;
            const cardInfo = findCardOnBoard(state, cardId);
            if (!cardInfo) {
                return { type: 'skip' };
            }

            // Find current lane
            let currentLaneIndex = cardInfo.laneIndex ?? -1;
            if (currentLaneIndex === -1) {
                for (let i = 0; i < state[cardInfo.owner].lanes.length; i++) {
                    if (state[cardInfo.owner].lanes[i].some(c => c.id === cardId)) {
                        currentLaneIndex = i;
                        break;
                    }
                }
            }

            // Find possible lanes (not the current one)
            const possibleLanes = [0, 1, 2].filter(l => l !== currentLaneIndex);

            if (possibleLanes.length === 0) {
                return { type: 'skip' };
            }

            // Pick first available lane
            return { type: 'selectLane', laneIndex: possibleLanes[0] };
        }

        // =========================================================================
        // SELECT PHASE EFFECT - Choose which Start/End effect to execute first
        // =========================================================================
        case 'select_phase_effect': {
            const phaseAction = action as {
                type: 'select_phase_effect';
                availableEffects: Array<{ cardId: string; cardName: string; box: 'top' | 'bottom'; effectDescription: string }>;
            };

            if (phaseAction.availableEffects.length === 0) {
                return { type: 'skip' };
            }

            // Easy AI: Just pick the first available effect
            const selectedEffect = phaseAction.availableEffects[0];

            return { type: 'flipCard', cardId: selectedEffect.cardId };
        }
    }

    // Fallback for any unhandled cases
    return { type: 'skip' };
};

// =============================================================================
// MAIN AI ENTRY POINT
// =============================================================================

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

        if (state.opponent.hand.length <= 1) {
            return { type: 'fillHand' };
        }

        for (const card of state.opponent.hand) {
            for (let i = 0; i < 3; i++) {
                if (state.opponent.compiled[i]) continue;
                const check = canPlayCard(state, 'opponent', i, false, card.protocol);
                if (check.allowed) {
                    return { type: 'playCard', cardId: card.id, laneIndex: i, isFaceUp: false };
                }
            }
        }

        return { type: 'fillHand' };
    }

    return { type: 'fillHand' };
};
