/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player } from "../types";
import { findAllHighestUncoveredCards } from "../logic/game/helpers/actionUtils";
import { isFrost1Active } from "../logic/effects/common/frost1Check";
import { getActivePassiveRules } from "../logic/game/passiveRuleChecker";

/**
 * GENERIC: Check if there's an active shift-blocking rule in a lane.
 * Works for ANY custom protocol with block_shifts_from_and_to_lane rule (e.g., Frost-3, Frost_custom-3, future cards).
 * Top-Box effects are ALWAYS active when card is face-up, even if covered!
 */
const hasFrost3InLane = (gameState: GameState, laneIndex: number): boolean => {
    const rules = getActivePassiveRules(gameState);
    return rules.some(({ rule, laneIndex: ruleLaneIndex }) =>
        rule.type === 'block_shifts_from_and_to_lane' && ruleLaneIndex === laneIndex
    );
};

export const isCardTargetable = (card: PlayedCard, gameState: GameState): boolean => {
    const { actionRequired } = gameState;
    if (!actionRequired) {
        return false;
    }

    // Only the 'actor' specified in the action can perform it.
    // The UI is for the 'player', so if the actor isn't 'player', they can't target anything.
    if ('actor' in actionRequired && actionRequired.actor !== 'player') {
        return false;
    }

    let owner: Player | null = null;
    let laneIndex: number = -1;
    let lane: PlayedCard[] = [];

    for (const p of ['player', 'opponent'] as Player[]) {
        for (let i = 0; i < gameState[p].lanes.length; i++) {
            if (gameState[p].lanes[i].some(c => c.id === card.id)) {
                owner = p;
                laneIndex = i;
                lane = gameState[p].lanes[i];
                break;
            }
        }
        if (owner) break;
    }

    if (!owner) return false;

    // Rule: By default, only uncovered cards are targetable.
    const isUncovered = card.id === lane[lane.length - 1]?.id;

    switch (actionRequired.type) {
        case 'select_opponent_face_up_card_to_flip': {
            // Frost-1: Only face-up cards can be flipped (to face-down) - already face-up so OK
            // This case only targets face-up cards, so Frost-1 doesn't restrict it further
            return owner === 'opponent' && card.isFaceUp && isUncovered;
        }

        case 'select_card_to_flip': {
            // Generic flip for custom protocols (supports scope: 'each_lane' via currentLaneIndex parameter)
            const targetFilter = (actionRequired as any).targetFilter || {};
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const currentLaneIndex = (actionRequired as any).currentLaneIndex;

            // NEW: If currentLaneIndex is set (scope: 'each_lane'), only cards in that lane are targetable
            if (currentLaneIndex !== undefined && laneIndex !== currentLaneIndex) return false;

            // CRITICAL DEFAULT: If position is not specified, default to 'uncovered'
            // This matches the game rules: "flip 1 card" means "flip 1 uncovered card"
            const position = targetFilter.position || 'uncovered';

            // Check position filter (using default 'uncovered' if not specified)
            if (position === 'uncovered' && !isUncovered) return false;
            if (position === 'covered' && cardIndex >= lane.length - 1) return false;

            // Check owner filter
            if (targetFilter.owner === 'own' && owner !== actionRequired.actor) return false;
            if (targetFilter.owner === 'opponent' && owner === actionRequired.actor) return false;

            // Check face state filter
            if (targetFilter.faceState === 'face_up' && !card.isFaceUp) return false;
            if (targetFilter.faceState === 'face_down' && card.isFaceUp) return false;

            // Check excludeSelf
            if (targetFilter.excludeSelf && card.id === actionRequired.sourceCardId) return false;

            return true;
        }

        // Rule: Keywords like "covered" override the default.
        case 'select_own_face_up_covered_card_to_flip': {
            const cardIndex = lane.findIndex(c => c.id === card.id);
            return owner === 'player' && card.isFaceUp && cardIndex < lane.length - 1;
        }
        case 'select_opponent_covered_card_to_shift': { // Darkness-0
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const opponentOfTurnPlayer = gameState.turn === 'player' ? 'opponent' : 'player';
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner === opponentOfTurnPlayer && cardIndex < lane.length - 1;
        }
        case 'select_own_covered_card_to_shift': { // Chaos-2
            const cardIndex = lane.findIndex(c => c.id === card.id);
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner === actionRequired.actor && cardIndex < lane.length - 1;
        }
        case 'select_covered_card_in_line_to_flip_optional': { // Darkness-2
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const isCovered = cardIndex < lane.length - 1;
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            // Card must be in the correct lane, and must be covered (not the last card in its stack).
            return laneIndex === actionRequired.laneIndex && isCovered;
        }
        case 'select_covered_card_to_flip_for_chaos_0': { // Chaos-0
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const isCovered = cardIndex < lane.length - 1;
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            // Card must be in the current lane being processed, and must be covered
            return laneIndex === actionRequired.laneIndex && isCovered;
        }

        // Rule: Keywords like "that card" override the default.
        case 'shift_flipped_card_optional': // Darkness-1 (Part 2)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return card.id === actionRequired.cardId;

        // Default targeting rules apply to the following:
        case 'select_opponent_card_to_flip': { // Darkness-1
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return owner === 'opponent' && isUncovered;
        }
        case 'select_face_down_card_to_shift_for_darkness_4': // Darkness-4
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return !card.isFaceUp && isUncovered;
        case 'select_cards_to_delete': {
            // Check if disallowed
            if (actionRequired.disallowedIds.includes(card.id)) return false;

            // NEW: If allowedIds is set (calculation: highest_value/lowest_value), only these cards are targetable
            const allowedIds = (actionRequired as any).allowedIds;
            if (allowedIds && !allowedIds.includes(card.id)) return false;

            // NEW: If currentLaneIndex is set (scope: 'each_lane'), only cards in that lane are targetable
            const currentLaneIndex = (actionRequired as any).currentLaneIndex;
            if (currentLaneIndex !== undefined && laneIndex !== currentLaneIndex) return false;

            // Check targetFilter if it exists (custom protocols)
            const targetFilter = (actionRequired as any).targetFilter;
            if (targetFilter) {
                const cardIndex = lane.findIndex(c => c.id === card.id);

                // CRITICAL DEFAULT: If position is not specified, default to 'uncovered'
                const position = targetFilter.position || 'uncovered';

                // Check position filter (using default 'uncovered' if not specified)
                if (position === 'uncovered' && !isUncovered) return false;
                if (position === 'covered' && cardIndex >= lane.length - 1) return false;
                // position 'any' allows both covered and uncovered

                // Check face state filter
                if (targetFilter.faceState === 'face_up' && !card.isFaceUp) return false;
                if (targetFilter.faceState === 'face_down' && card.isFaceUp) return false;

                // Check value range filter (Death-4: value 0 or 1)
                if (targetFilter.valueRange) {
                    const { min, max } = targetFilter.valueRange;
                    if (card.value < min || card.value > max) return false;
                }

                // Check owner filter
                if (targetFilter.owner === 'own' && owner !== actionRequired.actor) return false;
                if (targetFilter.owner === 'opponent' && owner === actionRequired.actor) return false;

                // Check protocolMatching (handled in cardResolver, but we can pre-filter here)
                const protocolMatching = (actionRequired as any).protocolMatching;
                if (protocolMatching) {
                    const playerProtocolAtLane = gameState.player.protocols[laneIndex];
                    const opponentProtocolAtLane = gameState.opponent.protocols[laneIndex];
                    const cardProtocol = card.protocol;
                    const hasMatch = cardProtocol === playerProtocolAtLane || cardProtocol === opponentProtocolAtLane;

                    if (protocolMatching === 'must_match' && !hasMatch) return false;
                    if (protocolMatching === 'must_not_match' && hasMatch) return false;
                }

                return true;
            }

            // Default: only uncovered (for standard cards)
            return isUncovered;
        }
        case 'select_card_to_delete_for_death_1':
            return card.id !== actionRequired.sourceCardId && isUncovered;
        case 'select_face_down_card_to_delete':
            return !card.isFaceUp && isUncovered;
        case 'select_low_value_card_to_delete':
            return card.isFaceUp && (card.value === 0 || card.value === 1) && isUncovered;
        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = actionRequired;
            return laneIndex !== disallowedLaneIndex && !lanesSelected.includes(laneIndex) && isUncovered;
        }
        case 'plague_4_opponent_delete': {
            const actor = gameState.turn === 'player' ? 'opponent' : 'player';
            if (actor === 'player') { // Human player needs to act
                return owner === 'player' && !card.isFaceUp && isUncovered;
            }
            return false;
        }
        case 'select_any_other_card_to_flip': {
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return card.id !== actionRequired.sourceCardId && isUncovered;
        }
        case 'select_card_to_return': {
            // Check if owner filter is specified (for custom protocols)
            const targetOwner = (actionRequired as any).targetOwner || 'any';
            const actor = actionRequired.actor;

            // Filter by owner if specified
            if (targetOwner === 'own') {
                return owner === actor && isUncovered;
            } else if (targetOwner === 'opponent') {
                return owner !== actor && isUncovered;
            }
            // Default: any card (own or opponent)
            return isUncovered;
        }
        case 'select_card_to_flip_for_fire_3': {
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return isUncovered;
        }
        case 'select_card_to_shift_for_gravity_1':
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return isUncovered;
        case 'select_card_to_flip_and_shift_for_gravity_2': {
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return isUncovered;
        }
        case 'select_face_down_card_to_shift_for_gravity_4':
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return !card.isFaceUp && laneIndex !== actionRequired.targetLaneIndex && isUncovered;
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional': {
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return isUncovered;
        }
        case 'select_any_face_down_card_to_flip_optional':
            return !card.isFaceUp && isUncovered;
        case 'select_card_to_flip_for_light_0': {
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return isUncovered;
        }
        case 'select_face_down_card_to_reveal_for_light_2':
            return !card.isFaceUp && isUncovered;
        case 'select_any_other_card_to_flip_for_water_0': {
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            return card.id !== actionRequired.sourceCardId && isUncovered;
        }
        case 'select_own_card_to_return_for_water_4':
            return owner === actionRequired.actor && isUncovered;
        case 'select_own_other_card_to_shift': // Speed-3 Middle
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner === actionRequired.actor && card.id !== actionRequired.sourceCardId && isUncovered;
        case 'select_own_card_to_shift_for_speed_3': // Speed-3 End
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner === actionRequired.actor && isUncovered;
        case 'select_opponent_face_down_card_to_shift': // Speed-4
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner !== actionRequired.actor && !card.isFaceUp && isUncovered;
        case 'select_any_opponent_card_to_shift': // Psychic-3
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner !== actionRequired.actor && isUncovered;
        case 'select_opponent_card_to_return':
            return owner === 'opponent' && isUncovered;
        case 'select_own_highest_card_to_delete_for_hate_2': {
            if (!isUncovered) return false;
            const highestCards = findAllHighestUncoveredCards(gameState, actionRequired.actor);
            return highestCards.some(c => c.card.id === card.id);
        }
        case 'select_opponent_highest_card_to_delete_for_hate_2': {
            if (!isUncovered) return false;
            const opponent = actionRequired.actor === 'player' ? 'opponent' : 'player';
            const highestCards = findAllHighestUncoveredCards(gameState, opponent);
            return highestCards.some(c => c.card.id === card.id);
        }
        case 'select_card_to_delete_for_anarchy_2': {
            // Anarchy-2: Can delete ANY card (covered or uncovered) if it's in a lane with matching protocol
            const playerProtocolAtLane = gameState.player.protocols[laneIndex];
            const opponentProtocolAtLane = gameState.opponent.protocols[laneIndex];
            const cardProtocol = card.protocol;

            // Card's protocol must match at least one protocol in its lane
            return cardProtocol === playerProtocolAtLane || cardProtocol === opponentProtocolAtLane;
        }
        case 'select_card_to_shift_for_anarchy_1': {
            // Anarchy-1: Can shift any uncovered card (validation happens in laneResolver)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return isUncovered;
        }
        case 'select_card_to_shift_for_anarchy_0': {
            // Anarchy-0: Can shift any uncovered card (no restrictions)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return isUncovered;
        }
        case 'select_card_to_shift': {
            // Generic shift for custom protocols
            // IMPORTANT: Like Anarchy-1, we allow all cards matching basic filters
            // Destination protocol validation happens in laneResolver (for face-up cards only)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;

            const targetFilter = (actionRequired as any).targetFilter || {};
            const destinationRestriction = (actionRequired as any).destinationRestriction;

            // CRITICAL: For non_matching_protocol restriction, we need to know the card's protocol
            // Face-down cards have unknown protocols → can't validate destination → skip them
            if (destinationRestriction?.type === 'non_matching_protocol' && !card.isFaceUp) {
                return false;
            }

            // Check position filter (covered vs uncovered)
            const cardIndex = lane.findIndex(c => c.id === card.id);
            if (targetFilter.position === 'uncovered' && !isUncovered) return false;
            if (targetFilter.position === 'covered' && cardIndex >= lane.length - 1) return false;

            // Check owner filter if specified (but 'any' allows both players)
            if (targetFilter.owner === 'own' && owner !== actionRequired.actor) return false;
            if (targetFilter.owner === 'opponent' && owner === actionRequired.actor) return false;

            // Check face state filter if specified (but 'any' allows both face-up and face-down)
            if (targetFilter.faceState === 'face_up' && !card.isFaceUp) return false;
            if (targetFilter.faceState === 'face_down' && card.isFaceUp) return false;

            // Check excludeSelf - card shouldn't shift itself
            if (targetFilter.excludeSelf && card.id === actionRequired.sourceCardId) return false;

            return true;
        }

        default:
            return false;
    }
}
