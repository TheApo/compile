/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shift Effect Executor
 *
 * Handles all shift-related effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';
import { findCardOnBoard, internalShiftCard } from '../../game/helpers/actionUtils';
import { getOpponentHighestValueLanes, getPlayerLaneValue } from '../../game/stateManager';

/**
 * Execute SHIFT effect
 */
export function executeShiftEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    let newState = { ...state };

    // Advanced Conditional Checks - skip effect if condition not met
    if (params.advancedConditional?.type === 'empty_hand') {
        if (state[cardOwner].hand.length > 0) {
            console.log(`[Shift Effect] Empty hand check failed: ${state[cardOwner].hand.length} cards in hand. Skipping shift.`);
            return { newState: state };
        }
    }
    if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';
        const ownValue = getPlayerLaneValue(state, cardOwner, laneIndex);
        const oppValue = getPlayerLaneValue(state, opponent, laneIndex);
        if (oppValue <= ownValue) {
            console.log(`[Shift Effect] Opponent higher value check failed: own=${ownValue}, opponent=${oppValue}. Skipping shift.`);
            return { newState: state };
        }
    }

    console.log(`[DEBUG executeShiftEffect] Called for ${card.protocol}-${card.value}`);
    console.log(`[DEBUG executeShiftEffect] params.useCardFromPreviousEffect: ${params.useCardFromPreviousEffect}`);
    console.log(`[DEBUG executeShiftEffect] state.lastCustomEffectTargetCardId: ${state.lastCustomEffectTargetCardId}`);

    // NEW: Generic useCardFromPreviousEffect support
    // If this effect should operate on the card from the previous effect, use lastCustomEffectTargetCardId
    if (params.useCardFromPreviousEffect && state.lastCustomEffectTargetCardId) {
        console.log(`[DEBUG executeShiftEffect] TAKING lastCustomEffectTargetCardId PATH!`);
        const targetCardId = state.lastCustomEffectTargetCardId;
        const targetCardInfo = findCardOnBoard(state, targetCardId);

        if (!targetCardInfo) {
            // Card no longer exists
            let newState = log(state, cardOwner, `Target card from previous effect no longer exists. Shift skipped.`);
            return { newState };
        }

        // Check if there's a fixed destination restriction (e.g., "to another line")
        const destinationRestriction = params.destinationRestriction;
        if (destinationRestriction?.type === 'to_this_lane') {
            // Resolve 'current' laneIndex to actual lane number
            const resolvedTargetLane = destinationRestriction.laneIndex === 'current'
                ? laneIndex
                : destinationRestriction.laneIndex;

            if (resolvedTargetLane === undefined || resolvedTargetLane < 0 || resolvedTargetLane > 2) {
                console.error(`[Shift Effect] Invalid target lane index: ${resolvedTargetLane}`);
                return { newState: state };
            }

            // Execute shift immediately
            console.log(`[Custom Shift with useCardFromPreviousEffect] Executing immediate shift to lane ${resolvedTargetLane}`);
            const shiftResult = internalShiftCard(state, targetCardId, targetCardInfo.owner, resolvedTargetLane, cardOwner);

            return {
                newState: shiftResult.newState,
                animationRequests: shiftResult.animationRequests
            };
        }

        // No fixed destination - let user choose the lane (like Darkness-1)
        // Find which lane the card is in
        let originalLaneIndex = -1;
        for (let i = 0; i < state[targetCardInfo.owner].lanes.length; i++) {
            if (state[targetCardInfo.owner].lanes[i].some(c => c.id === targetCardId)) {
                originalLaneIndex = i;
                break;
            }
        }

        if (originalLaneIndex === -1) {
            return { newState: state };
        }

        newState.actionRequired = {
            type: 'select_lane_for_shift',
            cardToShiftId: targetCardId,
            cardOwner: targetCardInfo.owner,
            originalLaneIndex,
            sourceCardId: card.id,
            actor: cardOwner,
            destinationRestriction: destinationRestriction,
        } as any;
        return { newState };
    }

    // NEW: If using card from previous effect (e.g., "Flip 1 card. Shift THAT card"), use it directly
    // CRITICAL: Only use _selectedCardFromPreviousEffect if this effect explicitly requests it
    // Otherwise, clear it to avoid interference from previous effects
    const selectedCardId = (state as any)._selectedCardFromPreviousEffect;

    // Always clear the stored card ID to prevent stale state from affecting subsequent effects
    if ((newState as any)._selectedCardFromPreviousEffect) {
        delete (newState as any)._selectedCardFromPreviousEffect;
    }

    // Only use the selected card if this effect explicitly uses it (via params.useCardFromPreviousEffect)
    // This block handles effects like Darkness-1: "Flip 1 card. Shift THAT card."
    // where the shift effect has useCardFromPreviousEffect: true
    // Note: The earlier block (line ~1719) handles useCardFromPreviousEffect with lastCustomEffectTargetCardId
    // This block is a fallback using _selectedCardFromPreviousEffect (deprecated pattern)
    if (selectedCardId && params.useCardFromPreviousEffect) {

        // Check if there's a fixed destination restriction (Gravity-2: "to this line")
        const destinationRestriction = params.destinationRestriction;
        if (destinationRestriction?.type === 'to_this_lane') {
            // Resolve 'current' laneIndex to actual lane number
            const resolvedTargetLane = destinationRestriction.laneIndex === 'current'
                ? laneIndex
                : destinationRestriction.laneIndex;

            if (resolvedTargetLane === undefined || resolvedTargetLane < 0 || resolvedTargetLane > 2) {
                console.error(`[Shift Effect] Invalid target lane index: ${resolvedTargetLane}`);
                return { newState };
            }

            // Find which player owns the selected card
            const selectedCardInfo = findCardOnBoard(newState, selectedCardId);
            if (!selectedCardInfo) {
                console.error(`[Shift Effect] Selected card not found: ${selectedCardId}`);
                return { newState };
            }

            // CRITICAL: Execute shift IMMEDIATELY like Original Gravity-2 (no user interaction)
            // Original Gravity-2 shifts immediately when no interrupt, only queues on interrupt
            // Since we're in execute_remaining_custom_effects, no actionRequired is set, so shift immediately
            console.log(`[Custom Shift] Executing immediate shift to lane ${resolvedTargetLane}`);
            const shiftResult = internalShiftCard(newState, selectedCardId, selectedCardInfo.owner, resolvedTargetLane, cardOwner);

            // CRITICAL: Return animation requests for shift animation!
            return {
                newState: shiftResult.newState,
                animationRequests: shiftResult.animationRequests
            };
        }

        // No fixed destination - let user choose the lane (like Darkness-1)
        newState.actionRequired = {
            type: 'shift_flipped_card_optional',
            cardId: selectedCardId,
            sourceCardId: card.id,
            optional: params.optional || false,
            actor: cardOwner,
        } as any;
        return { newState };
    }

    // NEW: shiftSelf parameter - this card shifts itself (Speed-2, Spirit-3, Courage-3)
    // This bypasses all target filtering and directly shifts the source card
    if (params.shiftSelf) {
        console.log('[DEBUG shiftExecutor] shiftSelf path - creating actionRequired');

        // Handle opponent_highest_value_lane destination (Courage-3)
        if (params.destinationRestriction?.type === 'opponent_highest_value_lane') {
            const validLanes = getOpponentHighestValueLanes(state, cardOwner);

            // Check if card is already in one of the opponent's highest value lanes
            if (validLanes.includes(laneIndex)) {
                newState = log(newState, cardOwner, `Card is already in opponent's highest value lane. Shift skipped.`);
                return { newState };
            }

            // Filter out current lane (can't shift to same lane) - should not happen if above check passed
            const filteredLanes = validLanes.filter(l => l !== laneIndex);

            if (filteredLanes.length === 0) {
                newState = log(newState, cardOwner, `No valid destination lane. Shift skipped.`);
                return { newState };
            }

            if (filteredLanes.length === 1) {
                // Auto-shift to the only valid lane (or skip if optional and user doesn't want to)
                if (params.optional) {
                    // Let user decide whether to shift
                    newState.actionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: card.id,
                        cardOwner: cardOwner,
                        originalLaneIndex: laneIndex,
                        sourceCardId: card.id,
                        actor: cardOwner,
                        validLanes: filteredLanes,
                        destinationRestriction: params.destinationRestriction,
                        optional: true,
                    } as any;
                    return { newState };
                }

                // Auto-shift to the only valid lane
                const targetLane = filteredLanes[0];
                console.log(`[Shift Effect] Auto-shifting to opponent's highest value lane: ${targetLane}`);
                const shiftResult = internalShiftCard(newState, card.id, cardOwner, targetLane, cardOwner);
                return { newState: shiftResult.newState, animationRequests: shiftResult.animationRequests };
            }

            // Multiple lanes with same highest value - let player choose
            newState.actionRequired = {
                type: 'select_lane_for_shift',
                cardToShiftId: card.id,
                cardOwner: cardOwner,
                originalLaneIndex: laneIndex,
                sourceCardId: card.id,
                actor: cardOwner,
                validLanes: filteredLanes,
                destinationRestriction: params.destinationRestriction,
                optional: params.optional || false,
            } as any;
            return { newState };
        }

        // Default shiftSelf behavior (Spirit-3, Speed-2)
        newState.actionRequired = {
            type: 'shift_flipped_card_optional',
            cardId: card.id,
            sourceCardId: card.id,
            optional: params.optional || false,
            actor: cardOwner,
            allowCovered: params.allowCoveredSelf || false,  // Speed-2: can shift even if covered
        } as any;
        console.log('[DEBUG shiftExecutor] Created actionRequired:', JSON.stringify(newState.actionRequired, null, 2));
        return { newState };
    }

    const targetFilter = params.targetFilter || {};
    const position = targetFilter.position || 'uncovered';
    const faceState = targetFilter.faceState || 'any';
    const ownerFilter = targetFilter.owner || 'any';
    const excludeSelf = targetFilter.excludeSelf || false;
    const count = params.count || 1;

    // CRITICAL: Spirit-3 special case - "shift this card" (position: 'any' = even if covered)
    // Auto-select the source card, only ask for destination lane
    // Key differentiator: position === 'any' means "this card, even if covered"
    // position === 'uncovered' (default) means normal card selection
    const isShiftThisCard = position === 'any' && ownerFilter === 'own' && !excludeSelf && count === 1;
    if (isShiftThisCard) {
        // This card should shift itself, skip card selection (Spirit-3)
        newState.actionRequired = {
            type: 'shift_flipped_card_optional',
            cardId: card.id,
            sourceCardId: card.id,
            optional: params.optional || false,
            actor: cardOwner,
        } as any;
        return { newState };
    }

    // Collect all potential target cards based on filters
    const potentialTargets: Array<{ card: PlayedCard, currentLane: number, owner: 'player' | 'opponent' }> = [];

    console.log(`[Shift Effect DEBUG] cardOwner: ${cardOwner}, ownerFilter: ${ownerFilter}, position: ${position}, faceState: ${faceState}, excludeSelf: ${excludeSelf}`);
    console.log(`[Shift Effect DEBUG] Source card: ${card.protocol}-${card.value} (id: ${card.id})`);

    for (const player of ['player', 'opponent'] as const) {
        // Skip if owner filter doesn't match
        if (ownerFilter === 'own' && player !== cardOwner) continue;
        if (ownerFilter === 'opponent' && player === cardOwner) continue;

        for (let i = 0; i < newState[player].lanes.length; i++) {
            // CRITICAL: If scope is 'this_lane', only collect cards from the current lane
            // This is for Light-3: "Shift all face-down cards in THIS line to another line"
            // Must include BOTH players' cards in that lane
            if (params.scope === 'this_lane' && i !== laneIndex) continue;

            const lane = newState[player].lanes[i];

            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const targetCard = lane[cardIdx];

                // Skip self if excludeSelf is true
                if (excludeSelf && targetCard.id === card.id) continue;

                // Check position filter
                const isTopCard = cardIdx === lane.length - 1;
                if (position === 'uncovered' && !isTopCard) continue;
                if (position === 'covered' && isTopCard) continue;

                // Check face state filter
                if (faceState === 'face_up' && !targetCard.isFaceUp) continue;
                if (faceState === 'face_down' && targetCard.isFaceUp) continue;

                console.log(`[Shift Effect DEBUG] Found potential target: ${targetCard.protocol}-${targetCard.value} in lane ${i} (owner: ${player})`);
                potentialTargets.push({ card: targetCard, currentLane: i, owner: player });
            }
        }
    }

    console.log(`[Shift Effect DEBUG] Total potential targets: ${potentialTargets.length}`);

    if (potentialTargets.length === 0) {
        newState = log(newState, cardOwner, `No valid cards to shift.`);
        // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals)
        (newState as any)._effectSkippedNoTargets = true;
        return { newState };
    }

    // NEW: Handle "shift all" mode (Light-3: "Shift all face-down cards in this line to another line")
    // When count is "all", collect all valid targets and ask user to select ONE destination lane
    // Then shift ALL cards to that lane at once
    const shouldShiftAll = count === 'all' || (typeof count !== 'number' && count !== 1);

    if (shouldShiftAll && potentialTargets.length > 0) {

        // Determine valid destination lanes based on destinationRestriction
        const validDestinationLanes: number[] = [];
        const destinationRestriction = params.destinationRestriction;

        for (let targetLane = 0; targetLane < 3; targetLane++) {
            // Check destination restriction
            if (destinationRestriction?.type === 'to_another_line') {
                // Can shift to any lane EXCEPT current lane
                if (targetLane === laneIndex) continue;
            } else if (destinationRestriction?.type === 'to_this_lane') {
                // Can only shift to specified lane
                const resolvedDestLaneIndex = destinationRestriction.laneIndex === 'current'
                    ? laneIndex
                    : destinationRestriction.laneIndex;
                if (targetLane !== resolvedDestLaneIndex) continue;
            } else if (!destinationRestriction) {
                // No restriction - can't shift to same lane
                if (targetLane === laneIndex) continue;
            }

            validDestinationLanes.push(targetLane);
        }

        if (validDestinationLanes.length === 0) {
            newState = log(newState, cardOwner, `No valid destination lanes for shifting all cards.`);
            return { newState };
        }

        // Ask user to select destination lane, then shift ALL cards to that lane
        newState = log(newState, cardOwner, `Shifting ${potentialTargets.length} card(s) from this lane.`);
        newState.actionRequired = {
            type: 'select_lane_for_shift_all',
            sourceCardId: card.id,
            actor: cardOwner,
            cardsToShift: potentialTargets.map(t => ({ cardId: t.card.id, owner: t.owner })),
            validDestinationLanes,
            sourceLaneIndex: laneIndex,
        } as any;

        return { newState };
    }

    // Check if ANY target has at least ONE valid destination
    const destinationRestriction = params.destinationRestriction;
    let hasValidTarget = false;

    // NEW: Resolve 'current' laneIndex to actual lane number (Gravity-2, Gravity-4)
    const resolvedDestLaneIndex = destinationRestriction?.laneIndex === 'current'
        ? laneIndex
        : destinationRestriction?.laneIndex;

    for (const { card: targetCard, currentLane, owner } of potentialTargets) {
        // CRITICAL: For non_matching_protocol restriction, we need to know the card's protocol
        // Face-down cards have unknown protocols, so we can't validate destination → skip them
        if (destinationRestriction?.type === 'non_matching_protocol' && !targetCard.isFaceUp) {
            continue; // Skip face-down cards for protocol-based restrictions
        }

        const cardProtocol = targetCard.protocol;

        // Check all 3 lanes
        for (let targetLane = 0; targetLane < 3; targetLane++) {
            // Check destination restriction
            if (destinationRestriction) {
                if (destinationRestriction.type === 'non_matching_protocol') {
                    if (targetLane === currentLane) continue; // Can't shift to same lane
                    const playerProtocol = newState.player.protocols[targetLane];
                    const opponentProtocol = newState.opponent.protocols[targetLane];
                    // Valid only if card's protocol does NOT match either protocol in target lane
                    if (cardProtocol === playerProtocol || cardProtocol === opponentProtocol) {
                        continue; // Skip this destination
                    }
                } else if (destinationRestriction.type === 'specific_lane') {
                    // Only allow shifts within the same lane (actually this means moving position, not changing lane)
                    if (targetLane !== currentLane) continue;
                } else if (destinationRestriction.type === 'to_this_lane') {
                    // NEW: Gravity-2, Gravity-4 - shift TO this line (card must be from another line)
                    if (targetLane !== resolvedDestLaneIndex) continue; // Only allow shift TO specified lane
                    if (currentLane === resolvedDestLaneIndex) continue; // Card must be FROM another lane
                } else if (destinationRestriction.type === 'to_another_line') {
                    // NEW: Shift to any lane EXCEPT current lane
                    if (targetLane === currentLane) continue;
                }
            } else {
                // No restriction - can't shift to same lane
                if (targetLane === currentLane) continue;
            }

            // Found at least one valid destination
            hasValidTarget = true;
            break;
        }

        if (hasValidTarget) break;
    }

    if (!hasValidTarget) {
        newState = log(newState, cardOwner, `No valid shift destinations available.`);
        return { newState };
    }

    // Set actionRequired - use generic 'select_card_to_shift' type

    // NEW: Resolve destination restriction with resolved laneIndex
    const resolvedDestinationRestriction = destinationRestriction && resolvedDestLaneIndex !== undefined
        ? { ...destinationRestriction, laneIndex: resolvedDestLaneIndex }
        : destinationRestriction;

    // CRITICAL: If destination is fixed (to_this_lane), add targetLaneIndex so cardResolver shifts directly
    // This is like Gravity-4: user selects card, shift happens automatically to fixed lane
    const fixedTargetLane = destinationRestriction?.type === 'to_this_lane' && resolvedDestLaneIndex !== undefined
        ? resolvedDestLaneIndex
        : undefined;

    newState.actionRequired = {
        type: 'select_card_to_shift',
        sourceCardId: card.id,
        actor: cardOwner,
        targetFilter: params.targetFilter,
        destinationRestriction: resolvedDestinationRestriction,
        sourceLaneIndex: laneIndex,  // NEW: Store source lane for validation
        targetLaneIndex: fixedTargetLane,  // NEW: Fixed destination (like Gravity-4)
    } as any;

    return { newState };
}
