/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Delete Effect Executor
 *
 * Handles all delete-related effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext, AnimationRequest } from '../../../types';
import { log } from '../../utils/log';
import { findCardOnBoard, handleUncoverEffect } from '../../game/helpers/actionUtils';
import { getLanesWhereOpponentHasHigherValue, getPlayerLaneValue } from '../../game/stateManager';

/**
 * Execute DELETE effect
 */
export function executeDeleteEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    let count = params.count || 1;

    // Advanced Conditional Checks - skip effect if condition not met
    if (params.advancedConditional?.type === 'empty_hand') {
        if (state[cardOwner].hand.length > 0) {
            console.log(`[Delete Effect] Empty hand check failed: ${state[cardOwner].hand.length} cards in hand. Skipping delete.`);
            return { newState: state };
        }
    }
    if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';
        const ownValue = getPlayerLaneValue(state, cardOwner, laneIndex);
        const oppValue = getPlayerLaneValue(state, opponent, laneIndex);
        if (oppValue <= ownValue) {
            console.log(`[Delete Effect] Opponent higher value check failed: own=${ownValue}, opponent=${oppValue}. Skipping delete.`);
            return { newState: state };
        }
    }

    // Generic useCardFromPreviousEffect support
    // If this effect should operate on the card from the previous effect, use lastCustomEffectTargetCardId
    if (params.useCardFromPreviousEffect && state.lastCustomEffectTargetCardId) {
        const targetCardId = state.lastCustomEffectTargetCardId;
        const targetCardInfo = findCardOnBoard(state, targetCardId);

        if (!targetCardInfo) {
            // Card no longer exists
            let newState = log(state, cardOwner, `Target card from previous effect no longer exists. Delete skipped.`);
            return { newState };
        }

        // Delete the target card directly
        let newState = { ...state };
        const owner = targetCardInfo.owner;
        const targetLaneIndex = newState[owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));

        if (targetLaneIndex !== -1) {
            const lane = [...newState[owner].lanes[targetLaneIndex]];
            const cardIndex = lane.findIndex(c => c.id === targetCardId);

            if (cardIndex !== -1) {
                const wasTopCard = cardIndex === lane.length - 1;
                lane.splice(cardIndex, 1);

                const newLanes = [...newState[owner].lanes];
                newLanes[targetLaneIndex] = lane;

                newState = {
                    ...newState,
                    [owner]: { ...newState[owner], lanes: newLanes }
                };

                const cardName = targetCardInfo.card.isFaceUp
                    ? `${targetCardInfo.card.protocol}-${targetCardInfo.card.value}`
                    : 'that card';
                newState = log(newState, cardOwner, `Deletes ${cardName}.`);

                // Update stats
                const newStats = { ...newState.stats[cardOwner], cardsDeleted: newState.stats[cardOwner].cardsDeleted + 1 };
                newState = { ...newState, stats: { ...newState.stats, [cardOwner]: newStats } };

                // Handle uncover if was top card AND not an on_cover delete
                // (new card will be placed immediately after an on_cover delete)
                const isOnCoverDeletePrev = context.triggerType === 'cover' || context.triggerType === 'on_cover';
                if (wasTopCard && lane.length > 0 && !isOnCoverDeletePrev) {
                    const uncoverResult = handleUncoverEffect(newState, owner, targetLaneIndex);
                    newState = uncoverResult.newState;
                }

                // Animation request
                const animationRequests = [{ type: 'delete' as const, cardId: targetCardId, owner }];
                return { newState, animationRequests };
            }
        }

        return { newState };
    }

    // NEW: Line Filter - Metal-3: "If there are 8 or more cards in this line"
    if (params.scope?.minCardsInLane) {
        const minCards = params.scope.minCardsInLane;
        const playerCardsInLane = state.player.lanes[laneIndex]?.length || 0;
        const opponentCardsInLane = state.opponent.lanes[laneIndex]?.length || 0;
        const cardsInLane = playerCardsInLane + opponentCardsInLane;

        if (cardsInLane < minCards) {
            console.log(`[Delete Effect] Line filter not met: ${cardsInLane} < ${minCards} cards in lane. Skipping delete.`);
            return { newState: state };
        }
        console.log(`[Delete Effect] Line filter met: ${cardsInLane} >= ${minCards} cards in lane.`);
    }

    // NEW: Lane Condition - Courage-1: "Delete in a line where opponent has higher value"
    // Compute valid lanes based on lane condition
    let validLaneIndices: number[] = [0, 1, 2];
    if (params.laneCondition?.type === 'opponent_higher_value') {
        validLaneIndices = getLanesWhereOpponentHasHigherValue(state, cardOwner);

        if (validLaneIndices.length === 0) {
            let newState = log(state, cardOwner, `No lanes where opponent has higher value. Delete effect skipped.`);
            (newState as any)._effectSkippedNoTargets = true;
            return { newState };
        }
        console.log(`[Delete Effect] Opponent higher value lanes: ${validLaneIndices.join(', ')}`);
    }

    // NEW: Determine actor based on actorChooses
    // Plague-4: "Your opponent deletes 1 of their own cards" → actorChooses: 'card_owner'
    const actorChooses = params.actorChooses || 'effect_owner';
    const targetOwner = params.targetFilter?.owner || 'any';

    let actor = cardOwner;
    if (actorChooses === 'card_owner' && targetOwner === 'opponent') {
        // Opponent chooses their own card to delete
        actor = context.opponent;
    }

    // CRITICAL: Check if there are any valid targets before setting actionRequired
    const targetFilter = params.targetFilter || {};
    // CRITICAL DEFAULT: If position is not specified, default to 'uncovered'
    const position = targetFilter.position || 'uncovered';

    const validTargets: string[] = [];
    for (const player of ['player', 'opponent'] as const) {
        for (let laneIdx = 0; laneIdx < state[player].lanes.length; laneIdx++) {
            // CRITICAL: Check scope - filter by lane if scope is 'this_line'
            if (params.scope?.type === 'this_line' && laneIdx !== laneIndex) continue;

            const lane = state[player].lanes[laneIdx];
            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const c = lane[cardIdx];
                const isUncovered = cardIdx === lane.length - 1;

                // Check excludeSelf
                if (params.excludeSelf && c.id === card.id) continue;
                // Check owner - CRITICAL: owner filter is relative to cardOwner, NOT actor
                // "opponent" means opponent of the card owner (effect source)
                if (targetFilter.owner === 'own' && player !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && player === cardOwner) continue;
                // Check position (using default 'uncovered' if not specified)
                if (position === 'uncovered' && !isUncovered) continue;
                if (position === 'covered' && isUncovered) continue;
                // CRITICAL: 'covered_by_context' for on_cover triggers (Hate-4)
                // In on_cover context:
                // - Own lane: ALL cards are "covered" (will be covered by new card)
                // - Opponent lane: ONLY already covered cards (topCard is NOT covered)
                if (position === 'covered_by_context' && context.triggerType === 'cover') {
                    if (player !== context.cardOwner) {
                        // Opponent's lane: only already covered cards
                        if (isUncovered) continue;
                    }
                    // Own lane: all cards valid (will all be covered)
                } else if (position === 'covered_by_context') {
                    // Outside on_cover context, treat as 'covered'
                    if (isUncovered) continue;
                }
                // Check faceState
                if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
                if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;
                // Check valueRange (Death-4: value 0 or 1)
                if (targetFilter.valueRange) {
                    const { min, max } = targetFilter.valueRange;
                    if (c.value < min || c.value > max) continue;
                }
                // Check protocolMatching
                if (params.protocolMatching) {
                    const playerProtocolAtLane = state.player.protocols[laneIdx];
                    const opponentProtocolAtLane = state.opponent.protocols[laneIdx];
                    const cardProtocol = c.protocol;
                    const hasMatch = cardProtocol === playerProtocolAtLane || cardProtocol === opponentProtocolAtLane;
                    if (params.protocolMatching === 'must_match' && !hasMatch) continue;
                    if (params.protocolMatching === 'must_not_match' && hasMatch) continue;
                }

                validTargets.push(c.id);
            }
        }
    }

    // If no valid targets, skip the effect
    if (validTargets.length === 0) {
        let newState = log(state, cardOwner, `No valid cards to delete. Effect skipped.`);
        // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals)
        (newState as any)._effectSkippedNoTargets = true;
        return { newState };
    }

    // NEW: "upTo" mode (Hate-1: "Delete up to 2 cards")
    // Adjust count to available targets
    if (params.upTo) {
        const originalCount = count;
        count = Math.min(count, validTargets.length);
        console.log(`[Delete Effect] upTo mode: requesting ${originalCount}, adjusted to ${count} (available targets: ${validTargets.length})`);
        if (count === 0) {
            let newState = log(state, cardOwner, `No valid targets available. Delete effect skipped.`);
            return { newState };
        }
    }

    // NEW: Filter by calculation (highest_value / lowest_value)
    // This is CRITICAL for Hate-2: "Delete your highest value uncovered card"
    let filteredTargets = validTargets;
    if (targetFilter.calculation === 'highest_value' || targetFilter.calculation === 'lowest_value') {
        // Build a map of cardId -> effectiveValue
        const cardValues = new Map<string, number>();
        for (const cardId of validTargets) {
            const cardInfo = findCardOnBoard(state, cardId);
            if (!cardInfo) continue;

            // Find lane index for this card
            let cardLaneIndex = -1;
            for (let i = 0; i < state[cardInfo.owner].lanes.length; i++) {
                if (state[cardInfo.owner].lanes[i].some(c => c.id === cardId)) {
                    cardLaneIndex = i;
                    break;
                }
            }

            let effectiveValue = cardInfo.card.value;
            // Check for Darkness-2 (face-down cards have value 4)
            if (!cardInfo.card.isFaceUp && cardLaneIndex !== -1) {
                const hasDarkness2 = state[cardInfo.owner].lanes[cardLaneIndex].some(
                    c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2
                );
                effectiveValue = hasDarkness2 ? 4 : 2;
            }

            cardValues.set(cardId, effectiveValue);
        }

        // Find highest or lowest value
        const values = Array.from(cardValues.values());
        const targetValue = targetFilter.calculation === 'highest_value'
            ? Math.max(...values)
            : Math.min(...values);

        // Keep only cards with that value
        filteredTargets = validTargets.filter(id => cardValues.get(id) === targetValue);

        console.log(`[Delete Effect] Filtered by ${targetFilter.calculation}: ${filteredTargets.length} card(s) with value ${targetValue}`);
    }

    // NEW: Auto-execute (Hate-4: automatically delete lowest value card without user selection)
    if (params.autoExecute) {
        console.log(`[Delete Effect] Auto-executing delete for ${filteredTargets.length} card(s)`);

        // Take first N cards from filteredTargets (or all if count >= length)
        const cardsToDelete = filteredTargets.slice(0, count);

        let newState = state;
        const animationRequests: any[] = [];

        for (const cardId of cardsToDelete) {
            const cardInfo = findCardOnBoard(newState, cardId);
            if (!cardInfo) continue;

            const { card: targetCard, owner } = cardInfo;

            // Find lane index
            let targetLaneIndex = -1;
            for (let i = 0; i < newState[owner].lanes.length; i++) {
                if (newState[owner].lanes[i].some(c => c.id === cardId)) {
                    targetLaneIndex = i;
                    break;
                }
            }

            if (targetLaneIndex === -1) continue;

            const lane = newState[owner].lanes[targetLaneIndex];
            const wasTopCard = lane[lane.length - 1].id === cardId;

            const deletedCardName = targetCard.isFaceUp ? `${targetCard.protocol}-${targetCard.value}` : 'a face-down card';
            const deletedOwnerName = owner === 'player' ? "Player's" : "Opponent's";

            newState = log(newState, cardOwner, `Effect triggers, deleting the lowest value covered card (${deletedOwnerName} ${deletedCardName}).`);

            // Remove card from lane
            const laneCopy = [...lane];
            const cardIndex = laneCopy.findIndex(c => c.id === cardId);
            laneCopy.splice(cardIndex, 1);

            const newLanes = [...newState[owner].lanes];
            newLanes[targetLaneIndex] = laneCopy;

            newState = {
                ...newState,
                [owner]: { ...newState[owner], lanes: newLanes },
            };

            // Update stats
            const newStats = { ...newState.stats[cardOwner], cardsDeleted: newState.stats[cardOwner].cardsDeleted + 1 };
            newState = { ...newState, stats: { ...newState.stats, [cardOwner]: newStats } };

            // Add animation request
            animationRequests.push({ type: 'delete', cardId, owner });

            // Handle uncover if was top card AND not an on_cover delete
            // (new card will be placed immediately after an on_cover delete)
            const isOnCoverDeleteAuto = context.triggerType === 'cover' || context.triggerType === 'on_cover';
            if (wasTopCard && laneCopy.length > 0 && !isOnCoverDeleteAuto) {
                const uncoverResult = handleUncoverEffect(newState, owner, targetLaneIndex);
                newState = uncoverResult.newState;
            }
        }

        return { newState, animationRequests };
    }

    // NOTE: Don't log here - the actual delete log will be created in cardResolver.ts when the player selects a card
    let newState = { ...state };

    // NEW: Handle deleteSelf (Life-0 on_cover: "then delete this card")
    // Directly delete the source card without prompting
    if (params.deleteSelf) {
        console.log(`[deleteSelf] Trying to delete card ${card.protocol}-${card.value} (id: ${card.id}), laneIndex from params: ${laneIndex}`);

        // CRITICAL: Use the laneIndex parameter (we already know where the card is)
        // Don't use findCardOnBoard because in on_cover context, the state might be mid-transition
        const owner = cardOwner;
        const lane = state[owner].lanes[laneIndex];
        console.log(`[deleteSelf] owner=${owner}, laneIndex=${laneIndex}, lane.length=${lane?.length}`);

        // CRITICAL: Check if lane exists (card might have been deleted already)
        if (!lane || lane.length === 0) {
            console.log(`[deleteSelf] Lane is ${!lane ? 'null' : 'empty'}! Skipping delete.`);
            newState = log(newState, cardOwner, `Card already deleted. Delete effect skipped.`);
            return { newState };
        }

        // Find the card in the lane
        const cardIndex = lane.findIndex(c => c.id === card.id);
        if (cardIndex === -1) {
            console.log(`[deleteSelf] Card not found in lane ${laneIndex}!`);
            newState = log(newState, cardOwner, `Card already deleted. Delete effect skipped.`);
            return { newState };
        }

        // CRITICAL: Check if card is REALLY the top card in the CURRENT state
        // (not in the original state where the effect started)
        // This handles Life-0: If a card was already placed on top, don't trigger uncover
        const currentLane = state[owner].lanes[laneIndex];
        const wasTopCard = currentLane.length > 0 && currentLane[currentLane.length - 1].id === card.id;
        console.log(`[deleteSelf] Card is ${wasTopCard ? 'TOP' : 'COVERED'} card in CURRENT lane (length=${currentLane.length}), cardIndex=${cardIndex}`);

        // Delete the card immediately
        newState = log(newState, cardOwner, `Deleting ${card.protocol}-${card.value}.`);

        // Remove card from lane (use CURRENT lane, not the old one)
        const laneCopy = [...currentLane];
        const currentCardIndex = laneCopy.findIndex(c => c.id === card.id);
        if (currentCardIndex === -1) {
            console.log(`[deleteSelf] Card no longer in lane! Already deleted or moved.`);
            return { newState };
        }
        console.log(`[deleteSelf] Removing card at index ${currentCardIndex} from lane`);
        laneCopy.splice(currentCardIndex, 1);

        // CRITICAL: Use newState[owner].lanes, not state[owner].lanes!
        const newLanes = [...newState[owner].lanes];
        newLanes[laneIndex] = laneCopy;

        newState = {
            ...newState,
            [owner]: { ...newState[owner], lanes: newLanes },
        };

        // Update stats
        const newStats = { ...newState.stats[cardOwner], cardsDeleted: newState.stats[cardOwner].cardsDeleted + 1 };
        newState = { ...newState, stats: { ...newState.stats, [cardOwner]: newStats } };

        // CRITICAL: Create animation request for delete animation (Death-1)
        const animationRequests: AnimationRequest[] = [{ type: 'delete', cardId: card.id, owner }];

        // Handle uncover ONLY if:
        // 1. Card was the top card
        // 2. There are cards below it
        // 3. NOT an on_cover delete (new card will be placed immediately after)
        // NOTE: triggerType can be 'cover' or 'on_cover' depending on context
        const isOnCoverDelete = context.triggerType === 'cover' || context.triggerType === 'on_cover';
        if (wasTopCard && laneCopy.length > 0 && !isOnCoverDelete) {
            const uncoverResult = handleUncoverEffect(newState, owner, laneIndex);
            newState = uncoverResult.newState;
            if (uncoverResult.animationRequests) {
                animationRequests.push(...uncoverResult.animationRequests);
            }
        }

        return { newState, animationRequests };
    }

    // Handle selectLane (Death-2: "Delete all cards in 1 line with values of 1 or 2")
    // User first selects a lane, then matching cards in that lane are deleted
    // Also used for Courage-1: selectLane with laneCondition (only valid lanes where opponent has higher value)
    if (params.selectLane) {
        newState.actionRequired = {
            type: 'select_lane_for_delete',
            sourceCardId: card.id,
            actor,
            count: params.count,
            targetFilter: params.targetFilter,
            // Only deleteAll if count is explicitly 'all_in_lane' or 'all'
            deleteAll: params.count === 'all_in_lane' || params.count === 'all',
            // Pass validLanes for Courage-1 (lanes where opponent has higher value)
            validLanes: validLaneIndices.length < 3 ? validLaneIndices : undefined,
            laneCondition: params.laneCondition,
        } as any;

        return { newState };
    }

    // NEW: Handle each_lane scope (flexible parameter-based each_lane)
    // Execute the delete once per lane sequentially
    if (params.scope?.type === 'each_lane') {
        // Find lanes with valid targets
        const hasValidTargets = (targetLaneIndex: number): boolean => {
            for (const player of ['player', 'opponent'] as const) {
                const lane = state[player].lanes[targetLaneIndex];
                for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                    const c = lane[cardIdx];
                    const isUncovered = cardIdx === lane.length - 1;

                    // Check excludeSelf
                    if (params.excludeSelf && c.id === card.id) continue;
                    // Check owner
                    if (targetFilter.owner === 'own' && player !== actor) continue;
                    if (targetFilter.owner === 'opponent' && player === actor) continue;
                    // Check position
                    if (position === 'uncovered' && !isUncovered) continue;
                    if (position === 'covered' && isUncovered) continue;
                    // Check faceState
                    if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
                    if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;

                    return true;  // Found at least one valid target
                }
            }
            return false;
        };

        // Find all lanes with valid targets
        const lanesWithTargets = [0, 1, 2].filter(i => hasValidTargets(i));

        if (lanesWithTargets.length === 0) {
            newState = log(newState, cardOwner, "No valid targets to delete in any lane.");
            // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals)
            (newState as any)._effectSkippedNoTargets = true;
            return { newState };
        }

        // Start with first lane, queue remaining lanes
        const firstLane = lanesWithTargets[0];
        const remainingLanes = lanesWithTargets.slice(1);

        // Use existing 'select_cards_to_delete' action with lane parameters (flexible)
        newState.actionRequired = {
            type: 'select_cards_to_delete',
            count,
            sourceCardId: card.id,
            actor,
            currentLaneIndex: firstLane,  // Optional: Restricts selection to this lane
            remainingLanes: remainingLanes,  // Optional: Lanes to process after this one
            disallowedIds: params.excludeSelf ? [card.id] : [],
            targetFilter: params.targetFilter,
            scope: params.scope,
            protocolMatching: params.protocolMatching,
            params: params,  // Store params for continuation
        } as any;

        return { newState };
    }

    // NEW: Handle each_other_line scope (Death-0: "Delete 1 card from each other line")
    // This creates a multi-step delete action that requires selecting one card from each other lane
    if (params.scope?.type === 'each_other_line') {
        const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
        const lanesWithCards = otherLaneIndices.filter(i =>
            state.player.lanes[i].length > 0 || state.opponent.lanes[i].length > 0
        );
        const countToDelete = lanesWithCards.length;

        if (countToDelete === 0) {
            newState = log(newState, cardOwner, `No other lanes have cards. Effect skipped.`);
            return { newState };
        }

        newState.actionRequired = {
            type: 'select_card_from_other_lanes_to_delete',
            sourceCardId: card.id,
            disallowedLaneIndex: laneIndex,
            lanesSelected: [],
            count: countToDelete,
            actor,
            targetFilter: params.targetFilter,
        } as any;

        return { newState };
    }

    // Set actionRequired for player to select cards
    // FLEXIBLE: Pass actorChooses so AI can determine who selects targets
    newState.actionRequired = {
        type: 'select_cards_to_delete',  // CRITICAL: Always use generic type, AI reads targetFilter
        count,
        sourceCardId: card.id,
        actor,
        actorChooses,  // NEW: Pass actorChooses so AI knows if opponent selects their own cards
        disallowedIds: params.excludeSelf ? [card.id] : [],
        allowedIds: filteredTargets.length < validTargets.length ? filteredTargets : undefined, // NEW: Restrict to filtered targets if calculation was applied
        targetFilter: params.targetFilter,      // Pass filter to resolver/UI
        scope: params.scope,                     // Pass scope to resolver/UI
        protocolMatching: params.protocolMatching, // Pass protocol matching rule
    } as any;

    return { newState };
}
