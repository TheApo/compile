/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player } from "../types";
// REMOVED: findAllHighestUncoveredCards - no longer needed after Hate-2 migration to generic handler
import { isFrost1Active, canFlipSpecificCard } from "../logic/game/passiveRuleChecker";
import { getActivePassiveRules } from "../logic/game/passiveRuleChecker";
import { isCardCommitted as isCardCommittedHelper, isCardAtIndexUncovered } from "../logic/game/helpers/actionUtils";

/**
 * Check if a card is "committed" (being played but not yet landed on board).
 * Per official rules: "the committed card IS NOT a valid selection" during on_cover effects.
 * This prevents selecting a card that's being played while its target card's on_cover effects resolve.
 */
const isCardCommitted = (gameState: GameState, cardId: string): boolean => {
    return isCardCommittedHelper(gameState, cardId);
};

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
    // CRITICAL: Use central helper that considers committed cards for uncovered calculation
    const cardIndex = lane.findIndex(c => c.id === card.id);
    const isUncovered = isCardAtIndexUncovered(gameState, lane, cardIndex);

    // SPECIAL: During lane selection for shift, highlight the card being shifted (red)
    if (actionRequired.type === 'select_lane_for_shift') {
        const cardToShiftId = (actionRequired as any).cardToShiftId;
        if (cardToShiftId && card.id === cardToShiftId) {
            return true; // Highlight the card being shifted
        }
        return false; // Don't highlight other cards during lane selection
    }
    if (actionRequired.type === 'shift_flipped_card_optional') {
        const shiftCardId = (actionRequired as any).cardId;
        if (shiftCardId && card.id === shiftCardId) {
            return true; // Highlight the card being shifted
        }
        return false; // Don't highlight other cards during lane selection
    }

    switch (actionRequired.type) {
        case 'select_opponent_face_up_card_to_flip': {
            // Frost-1: Only face-up cards can be flipped (to face-down) - already face-up so OK
            // This case only targets face-up cards, so Frost-1 doesn't restrict it further
            return owner === 'opponent' && card.isFaceUp && isUncovered;
        }

        case 'select_card_to_flip': {
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            // Per rules: "the committed card IS NOT a valid selection" during on_cover effects
            if (isCardCommitted(gameState, card.id)) return false;

            // Generic flip for custom protocols (supports scope: 'each_lane' via currentLaneIndex parameter)
            const targetFilter = (actionRequired as any).targetFilter || {};
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const currentLaneIndex = (actionRequired as any).currentLaneIndex;
            const scopedLaneIndex = (actionRequired as any).laneIndex; // For scope: 'this_lane'
            const scope = (actionRequired as any).scope;
            const restrictedLaneIndex = (actionRequired as any).restrictedLaneIndex; // Mirror-3: sameLaneAsFirst

            // NEW: If currentLaneIndex is set (scope: 'each_lane'), only cards in that lane are targetable
            if (currentLaneIndex !== undefined && laneIndex !== currentLaneIndex) return false;

            // NEW: If scope is 'this_lane', only cards in the source card's lane are targetable (Darkness-2)
            if (scope === 'this_lane' && scopedLaneIndex !== undefined && laneIndex !== scopedLaneIndex) return false;

            // NEW: Mirror-3 - sameLaneAsFirst: only cards in the restricted lane are targetable
            if (restrictedLaneIndex !== undefined && laneIndex !== restrictedLaneIndex) return false;

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

            // NEW: Check block_flip_this_card passive rule (Ice-4)
            const flipCheck = canFlipSpecificCard(gameState, card.id);
            if (!flipCheck.allowed) return false;

            // NEW: Check valueMinGreaterThanHandSize - target must have value > hand size
            if (targetFilter.valueMinGreaterThanHandSize) {
                const handSize = gameState[actionRequired.actor].hand.length;
                if (card.value <= handSize) return false;
            }

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
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;

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
                // CRITICAL: targetFilter.owner is relative to the SOURCE CARD OWNER, not the actor
                // For Plague-4: "Your opponent deletes 1 of their cards" - the actor (player) deletes their OWN cards
                // actorChooses: 'card_owner' means the opponent of the card owner is the actor
                const actorChooses = (actionRequired as any).actorChooses;
                const sourceCardId = actionRequired.sourceCardId;

                // Find the source card owner
                let sourceCardOwner: Player | null = null;
                for (const p of ['player', 'opponent'] as Player[]) {
                    if (gameState[p].lanes.flat().some(c => c.id === sourceCardId)) {
                        sourceCardOwner = p;
                        break;
                    }
                }

                // Determine whose cards can be targeted based on owner filter
                // 'own' = cards of the source card owner
                // 'opponent' = cards of the opponent of the source card owner
                if (actorChooses === 'card_owner' && sourceCardOwner) {
                    // The actor is the OPPONENT of the card owner, targeting their OWN cards
                    // So 'opponent' (from card owner's perspective) means actor's cards
                    if (targetFilter.owner === 'own' && owner !== sourceCardOwner) return false;
                    if (targetFilter.owner === 'opponent' && owner === sourceCardOwner) return false;
                } else {
                    // Standard case: owner filter is relative to actor
                    if (targetFilter.owner === 'own' && owner !== actionRequired.actor) return false;
                    if (targetFilter.owner === 'opponent' && owner === actionRequired.actor) return false;
                }

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
        // REMOVED: select_card_to_delete_for_death_1 - Death-1 now uses generic select_cards_to_delete
        case 'select_face_down_card_to_delete':
            return !card.isFaceUp && isUncovered;
        case 'select_low_value_card_to_delete':
            return card.isFaceUp && (card.value === 0 || card.value === 1) && isUncovered;
        case 'select_card_from_other_lanes_to_delete': {
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;

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
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;

            // Check if owner filter is specified (for custom protocols)
            const targetOwner = (actionRequired as any).targetOwner || 'any';
            const targetFilter = (actionRequired as any).targetFilter;
            const actor = actionRequired.actor;

            // Check position filter (default: uncovered)
            const position = targetFilter?.position || 'uncovered';
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const isCovered = cardIndex < lane.length - 1;

            if (position === 'uncovered' && !isUncovered) return false;
            if (position === 'covered' && !isCovered) return false;
            // position === 'any' allows both

            // Filter by owner if specified
            if (targetOwner === 'own') {
                return owner === actor;
            } else if (targetOwner === 'opponent') {
                return owner !== actor;
            }
            // Default: any card (own or opponent)
            return true;
        }
        // REMOVED: select_card_to_flip_for_fire_3 - Fire-3 now uses generic select_card_to_flip
        case 'select_card_to_shift_for_gravity_1':
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return isUncovered;
        // REMOVED: select_card_to_flip_and_shift_for_gravity_2 - Gravity-2 now uses generic select_card_to_flip
        case 'select_face_down_card_to_shift_for_gravity_4':
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return !card.isFaceUp && laneIndex !== actionRequired.targetLaneIndex && isUncovered;
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional': {
            // Frost-1: Only face-up cards can be flipped (to face-down)
            const frost1Active = isFrost1Active(gameState);
            if (frost1Active && !card.isFaceUp) return false;
            // NEW: Check block_flip_this_card passive rule (Ice-4)
            const flipCheckAny = canFlipSpecificCard(gameState, card.id);
            if (!flipCheckAny.allowed) return false;
            return isUncovered;
        }
        case 'select_any_face_down_card_to_flip_optional': {
            // NEW: Check block_flip_this_card passive rule (Ice-4)
            const flipCheckFaceDown = canFlipSpecificCard(gameState, card.id);
            if (!flipCheckFaceDown.allowed) return false;
            return !card.isFaceUp && isUncovered;
        }
        // REMOVED: select_card_to_flip_for_light_0 - Light-0 now uses generic select_card_to_flip
        // REMOVED: select_face_down_card_to_reveal_for_light_2 - Light-2 now uses select_board_card_to_reveal_custom
        case 'select_board_card_to_reveal_custom': {
            // Generic board card reveal for custom protocols (Light-2)
            // Uses targetFilter from actionRequired
            const targetFilter = (actionRequired as any).targetFilter;
            if (!targetFilter) return !card.isFaceUp && isUncovered; // Default fallback

            const cardIndex = lane.findIndex(c => c.id === card.id);

            // Check position filter
            const position = targetFilter.position || 'uncovered';
            if (position === 'uncovered' && !isUncovered) return false;
            if (position === 'covered' && cardIndex >= lane.length - 1) return false;

            // Check owner filter
            if (targetFilter.owner === 'own' && owner !== actionRequired.actor) return false;
            if (targetFilter.owner === 'opponent' && owner === actionRequired.actor) return false;

            // Check face state filter
            if (targetFilter.faceState === 'face_up' && !card.isFaceUp) return false;
            if (targetFilter.faceState === 'face_down' && card.isFaceUp) return false;

            return true;
        }
        // REMOVED: select_any_other_card_to_flip_for_water_0 - Water-0 now uses generic select_card_to_flip
        // REMOVED: select_own_card_to_return_for_water_4 - Water-4 now uses generic select_card_to_return
        case 'select_own_other_card_to_shift': // Speed-3 Middle
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return owner === actionRequired.actor && card.id !== actionRequired.sourceCardId && isUncovered;
        // REMOVED: select_own_card_to_shift_for_speed_3 - Speed-3 now uses generic select_card_to_shift
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
        // REMOVED: select_own_highest_card_to_delete_for_hate_2 - Hate-2 now uses generic select_cards_to_delete with calculation: highest_value
        // REMOVED: select_opponent_highest_card_to_delete_for_hate_2 - Hate-2 now uses generic select_cards_to_delete with calculation: highest_value
        // REMOVED: select_card_to_delete_for_anarchy_2 - Anarchy-2 now uses generic select_cards_to_delete with protocolMatching: must_match
        case 'select_card_to_shift_for_anarchy_1': {
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;
            // Anarchy-1: Can shift any uncovered card (validation happens in laneResolver)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return isUncovered;
        }
        case 'select_card_to_shift_for_anarchy_0': {
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;
            // Anarchy-0: Can shift any uncovered card (no restrictions)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;
            return isUncovered;
        }
        case 'select_card_to_shift': {
            // CRITICAL: Exclude committed card (card being played that triggered on_cover)
            if (isCardCommitted(gameState, card.id)) return false;
            // Generic shift for custom protocols
            // IMPORTANT: Like Anarchy-1, we allow all cards matching basic filters
            // Destination protocol validation happens in laneResolver (for face-up cards only)
            // Frost-3 blocks shifts from its lane
            if (hasFrost3InLane(gameState, laneIndex)) return false;

            const targetFilter = (actionRequired as any).targetFilter || {};
            const destinationRestriction = (actionRequired as any).destinationRestriction;
            const scope = (actionRequired as any).scope;
            const sourceLaneIndex = (actionRequired as any).sourceLaneIndex;

            // NEW: scope 'this_lane' - only cards in the source card's lane are targetable (Fear-3)
            if (scope === 'this_lane' && sourceLaneIndex !== undefined && laneIndex !== sourceLaneIndex) {
                return false;
            }

            // CRITICAL: For non_matching_protocol restriction, we need to know the card's protocol
            // Face-down cards have unknown protocols → can't validate destination → skip them
            if (destinationRestriction?.type === 'non_matching_protocol' && !card.isFaceUp) {
                return false;
            }

            // Check position filter (covered vs uncovered)
            // CRITICAL: Default to 'uncovered' if position is not specified (just like other effects)
            const position = targetFilter.position || 'uncovered';
            const cardIndex = lane.findIndex(c => c.id === card.id);
            const isCovered = cardIndex < lane.length - 1;
            if (position === 'uncovered' && !isUncovered) return false;
            if (position === 'covered' && !isCovered) return false;

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

        case 'select_phase_effect': {
            // Phase effect selection: highlight cards that are in the available effects list
            const phaseAction = actionRequired as {
                type: 'select_phase_effect';
                actor: Player;
                availableEffects: Array<{ cardId: string; cardName: string; box: 'top' | 'bottom'; effectDescription: string }>;
            };

            // Only cards in the available effects list are targetable
            return phaseAction.availableEffects.some(effect => effect.cardId === card.id);
        }

        // =========================================================================
        // COPY OPPONENT MIDDLE (Mirror-1)
        // =========================================================================
        case 'select_card_for_copy_middle': {
            // Only cards in the validTargetIds list are targetable
            const validTargetIds = (actionRequired as any).validTargetIds || [];
            return validTargetIds.includes(card.id);
        }

        default:
            return false;
    }
}
