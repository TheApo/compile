/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Flip Effect Executor
 *
 * Handles all flip-related effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';
import { findCardOnBoard, isCardCommitted, isCardAtIndexUncovered, countUniqueProtocolsOnField } from '../../game/helpers/actionUtils';
import { isFrost1Active, canFlipSpecificCard } from '../../game/passiveRuleChecker';
import { getPlayerLaneValue } from '../../game/stateManager';

/**
 * Execute FLIP effect
 */
export function executeFlipEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    // Extract conditional info for "If you do" effects
    const conditional = params._conditional;


    // NEW: Generic useCardFromPreviousEffect support
    // If this effect should operate on the card from the previous effect, use lastCustomEffectTargetCardId
    if (params.useCardFromPreviousEffect && state.lastCustomEffectTargetCardId) {
        const targetCardId = state.lastCustomEffectTargetCardId;
        const targetCardInfo = findCardOnBoard(state, targetCardId);

        if (!targetCardInfo) {
            // Card no longer exists
            let newState = log(state, cardOwner, `Target card from previous effect no longer exists. Flip skipped.`);
            return { newState };
        }

        // Flip the target card directly
        let newState = { ...state };
        const owner = targetCardInfo.owner;
        const targetLaneIndex = newState[owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));

        if (targetLaneIndex !== -1) {
            const lane = newState[owner].lanes[targetLaneIndex];
            const cardToFlip = lane.find(c => c.id === targetCardId);

            if (cardToFlip) {
                // NEW: Luck-1 - If skipMiddleCommand is true, set the flag to skip middle command
                if (params.skipMiddleCommand && !cardToFlip.isFaceUp) {
                    // Card is face-down and will be flipped face-up - skip its middle command
                    newState.skipNextMiddleCommand = targetCardId;
                }

                cardToFlip.isFaceUp = !cardToFlip.isFaceUp;
                const direction = cardToFlip.isFaceUp ? 'face-up' : 'face-down';
                const skipText = params.skipMiddleCommand && cardToFlip.isFaceUp ? ', ignoring its middle commands' : '';
                newState = log(newState, cardOwner, `Flips that card ${direction}${skipText}.`);
            }
        }

        return { newState };
    }

    // NEW: Each lane mode (Chaos-0: "In each line, flip 1 covered card")
    if (params.scope === 'each_lane') {
        const targetFilter = params.targetFilter || {};
        const frost1Active = isFrost1Active(state);

        // Helper: Check if a lane has valid flip targets
        const hasValidTargets = (targetLaneIndex: number): boolean => {
            const playerLane = state.player.lanes[targetLaneIndex];
            const opponentLane = state.opponent.lanes[targetLaneIndex];

            let allCards: PlayedCard[] = [];

            // Collect cards based on position filter
            if (targetFilter.position === 'covered') {
                // Only covered cards (not the top card)
                allCards = [
                    ...playerLane.filter((c, idx) => idx < playerLane.length - 1),
                    ...opponentLane.filter((c, idx) => idx < opponentLane.length - 1)
                ];
            } else {
                // All cards in lane
                allCards = [...playerLane, ...opponentLane];
            }

            // Apply owner filter
            if (targetFilter.owner === 'own') {
                allCards = allCards.filter(c => {
                    return playerLane.includes(c) && cardOwner === 'player' ||
                           opponentLane.includes(c) && cardOwner === 'opponent';
                });
            } else if (targetFilter.owner === 'opponent') {
                const opponent = cardOwner === 'player' ? 'opponent' : 'player';
                allCards = allCards.filter(c => {
                    return playerLane.includes(c) && opponent === 'player' ||
                           opponentLane.includes(c) && opponent === 'opponent';
                });
            }

            // Apply excludeSelf
            if (targetFilter.excludeSelf) {
                allCards = allCards.filter(c => c.id !== card.id);
            }

            // Apply Frost-1 restriction
            const validCards = frost1Active ? allCards.filter(c => c.isFaceUp) : allCards;

            return validCards.length > 0;
        };

        // Find all lanes with valid targets
        const lanesWithTargets = [0, 1, 2].filter(i => hasValidTargets(i));

        if (lanesWithTargets.length === 0) {
            // No valid targets in any lane
            let newState = log(state, cardOwner, frost1Active
                ? "No valid face-up targets to flip (Frost-1 is active)."
                : "No valid targets to flip in any lane.");
            // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals)
            (newState as any)._effectSkippedNoTargets = true;
            return { newState };
        }

        // Start with first lane, queue remaining lanes
        const firstLane = lanesWithTargets[0];
        const remainingLanes = lanesWithTargets.slice(1);

        let newState = { ...state };
        // Use existing 'select_card_to_flip' action with lane parameters (flexible)
        newState.actionRequired = {
            type: 'select_card_to_flip',
            sourceCardId: card.id,
            actor: cardOwner,
            currentLaneIndex: firstLane,  // Optional: Restricts selection to this lane
            remainingLanes: remainingLanes,  // Optional: Lanes to process after this one
            targetFilter: params.targetFilter,  // CRITICAL: Pass targetFilter directly for targeting.ts
            params: params,  // Store params for continuation
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;

        return { newState };
    }

    // NEW: Flip self mode (Anarchy-6)
    if (params.flipSelf) {

        // Check advanced conditional
        if (params.advancedConditional?.type === 'protocol_match') {
            const requiredProtocol = params.advancedConditional.protocol;
            const cardProtocol = state[cardOwner].protocols[laneIndex];

            if (cardProtocol !== requiredProtocol) {
                return { newState: state };
            }
        }

        // NEW: Check opponent_higher_value_in_lane (Courage-6)
        if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
            const opponent = cardOwner === 'player' ? 'opponent' : 'player';
            const ownValue = getPlayerLaneValue(state, cardOwner, laneIndex);
            const oppValue = getPlayerLaneValue(state, opponent, laneIndex);

            if (oppValue <= ownValue) {
                return { newState: state };
            }
        }

        // NEW: Check hand_size_greater_than (Peace-6)
        if (params.advancedConditional?.type === 'hand_size_greater_than') {
            const threshold = params.advancedConditional.threshold ?? 0;
            const handSize = state[cardOwner].hand.length;

            if (handSize <= threshold) {
                // Hand size is NOT greater than threshold - skip effect
                return { newState: state };
            }
        }

        // Flip this card
        let newState = { ...state };
        const lane = newState[cardOwner].lanes[laneIndex];
        const cardInLane = lane.find(c => c.id === card.id);


        if (cardInLane) {
            cardInLane.isFaceUp = !cardInLane.isFaceUp;
            const playerName = cardOwner === 'player' ? 'Player' : 'Opponent';
            const direction = cardInLane.isFaceUp ? 'face-up' : 'face-down';
            newState = log(newState, cardOwner, `${playerName} flips this card ${direction}.`);
        } else {
        }

        return { newState };
    }

    // NEW: Flip all mode (Apathy-1: this_lane, Plague-3: anywhere)
    // ONLY if count is not specified (or explicitly set to 'all')
    // If count is specified (e.g., 1), use normal selection flow below
    const count = params.count || 1;
    const scopeType = params.scope?.type || params.scope || 'anywhere';
    const isFlipAll = count === 'all' || typeof count !== 'number';
    const shouldAutoFlipAllInLane = scopeType === 'this_lane' && isFlipAll;
    const shouldAutoFlipAllGlobal = scopeType === 'anywhere' && isFlipAll;

    if (shouldAutoFlipAllInLane || shouldAutoFlipAllGlobal) {
        let newState = { ...state };
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';
        const targetFilter = params.targetFilter || {};

        // CRITICAL: Check Frost-1 restriction
        const frost1Active = isFrost1Active(state);

        const cardsToFlip = new Set<string>();

        // Determine which lanes to process
        const lanesToProcess = shouldAutoFlipAllGlobal ? [0, 1, 2] : [laneIndex];

        for (const currentLaneIdx of lanesToProcess) {
            // Collect cards from player's side of the lane
            const playerLane = newState[cardOwner].lanes[currentLaneIdx];
            for (const c of playerLane) {
                // Check excludeSelf
                if (targetFilter.excludeSelf && c.id === card.id) continue;
                // Check faceState
                if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
                if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;
                // Check owner
                if (targetFilter.owner === 'opponent') continue; // Skip own cards if only opponent wanted
                // Check position - default is uncovered for flip effects
                const isUncovered = playerLane.indexOf(c) === playerLane.length - 1;
                if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                if (targetFilter.position === 'covered' && isUncovered) continue;
                // For global flip all without explicit position filter, default to uncovered
                if (shouldAutoFlipAllGlobal && !targetFilter.position && !isUncovered) continue;
                // CRITICAL: Frost-1 restriction - only face-up cards can be flipped
                if (frost1Active && !c.isFaceUp) continue;

                cardsToFlip.add(c.id);
            }

            // Collect cards from opponent's side of the lane
            const opponentLane = newState[opponent].lanes[currentLaneIdx];
            for (const c of opponentLane) {
                // Check faceState
                if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
                if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;
                // Check owner
                if (targetFilter.owner === 'own') continue; // Skip opponent cards if only own wanted
                // Check position - default is uncovered for flip effects
                const isUncovered = opponentLane.indexOf(c) === opponentLane.length - 1;
                if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                if (targetFilter.position === 'covered' && isUncovered) continue;
                // For global flip all without explicit position filter, default to uncovered
                if (shouldAutoFlipAllGlobal && !targetFilter.position && !isUncovered) continue;
                // CRITICAL: Frost-1 restriction - only face-up cards can be flipped
                if (frost1Active && !c.isFaceUp) continue;

                cardsToFlip.add(c.id);
            }
        }

        if (cardsToFlip.size > 0) {
            const scopeText = shouldAutoFlipAllGlobal ? '' : ' in this lane';
            newState = log(newState, cardOwner, `Flipping ${cardsToFlip.size} card(s)${scopeText}.`);
            // Flip the cards
            for (const cardId of cardsToFlip) {
                for (const player of ['player', 'opponent'] as const) {
                    for (const lane of newState[player].lanes) {
                        const cardToFlip = lane.find(c => c.id === cardId);
                        if (cardToFlip) {
                            cardToFlip.isFaceUp = !cardToFlip.isFaceUp;
                        }
                    }
                }
            }
            return { newState };
        } else {
            const scopeText = shouldAutoFlipAllGlobal ? '' : ' in this lane';
            newState = log(newState, cardOwner, `No cards to flip${scopeText}.`);
            return { newState };
        }
    }

    // Standard flip (select target)
    const targetFilter = params.targetFilter || {};

    // CRITICAL DEFAULT: If position is not specified, default to 'uncovered'
    // This matches the game rules: "flip 1 card" means "flip 1 uncovered card"
    // Only if explicitly set to 'any' or 'covered' should covered cards be included
    const position = targetFilter.position || 'uncovered';

    // CRITICAL: Check Frost-1 restriction (Cards cannot be flipped face-up)
    const frost1Active = isFrost1Active(state);

    // CRITICAL: Check if there are any valid targets before setting actionRequired
    // This prevents softlocks when no valid targets exist
    const validTargets: string[] = [];
    for (const player of ['player', 'opponent'] as const) {
        for (let laneIdx = 0; laneIdx < state[player].lanes.length; laneIdx++) {
            const lane = state[player].lanes[laneIdx];

            // NEW: If scope is 'this_lane', only check the current lane
            if (params.scope === 'this_lane' && laneIdx !== laneIndex) continue;

            // NEW: Mirror-3 - sameLaneAsFirst: only check the lane from the first flip
            if (params.sameLaneAsFirst && state.lastFlipLaneIndex !== undefined && laneIdx !== state.lastFlipLaneIndex) continue;

            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const c = lane[cardIdx];

                // CRITICAL: Exclude committed card (card being played that triggered on_cover)
                // Per rules: "the committed card IS NOT a valid selection" during on_cover effects
                if (isCardCommitted(state, c.id)) continue;

                // CRITICAL: Use central helper that considers committed cards for uncovered calculation
                const isUncovered = isCardAtIndexUncovered(state, lane, cardIdx);

                // Check excludeSelf
                if (targetFilter.excludeSelf && c.id === card.id) continue;
                // Check owner
                if (targetFilter.owner === 'own' && player !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && player === cardOwner) continue;
                // Check position (using default 'uncovered' if not specified)
                if (position === 'uncovered' && !isUncovered) continue;
                if (position === 'covered' && isUncovered) continue;
                // Check faceState
                if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
                if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;
                // CRITICAL: Frost-1 restriction - only face-up cards can be flipped (to become face-down)
                // Face-down cards cannot be flipped because they would become face-up (blocked)
                if (frost1Active && !c.isFaceUp) continue;

                // NEW: Check block_flip_this_card (Ice-4) - specific card cannot be flipped
                const specificCardCheck = canFlipSpecificCard(state, c.id);
                if (!specificCardCheck.allowed) continue;

                // NEW: Check valueMinGreaterThanHandSize - target must have value > hand size
                if (targetFilter.valueMinGreaterThanHandSize) {
                    const handSize = state[cardOwner].hand.length;
                    if (c.value <= handSize) continue;
                }

                // NEW: Check valueLessThanUniqueProtocolsOnField - target must have value < unique protocols
                if (targetFilter.valueLessThanUniqueProtocolsOnField) {
                    const threshold = countUniqueProtocolsOnField(state);
                    if (c.value >= threshold) continue;
                }

                validTargets.push(c.id);
            }
        }
    }

    // If no valid targets, skip the effect (both optional and non-optional)
    if (validTargets.length === 0) {
        let newState = state;
        // Provide specific reason when valueMinGreaterThanHandSize filter caused no targets
        if (targetFilter.valueMinGreaterThanHandSize) {
            const handSize = state[cardOwner].hand.length;
            const minValue = handSize + 1;
            newState = log(newState, cardOwner, `Hand size: ${handSize} cards. No cards with value ${minValue} or higher available. Effect skipped.`);
        } else if (targetFilter.valueLessThanUniqueProtocolsOnField) {
            const threshold = countUniqueProtocolsOnField(state);
            newState = log(newState, cardOwner, `${threshold} unique protocols on field. No cards with value less than ${threshold} available. Effect skipped.`);
        } else {
            newState = log(newState, cardOwner, `No valid cards to flip. Effect skipped.`);
        }
        // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals)
        (newState as any)._effectSkippedNoTargets = true;
        return { newState };
    }

    let newState = { ...state };

    // NEW: Log hand size info for valueMinGreaterThanHandSize filter
    if (targetFilter.valueMinGreaterThanHandSize) {
        const handSize = state[cardOwner].hand.length;
        const minValue = handSize + 1;
        const countText = count === 'all' ? 'all cards' : count === 1 ? '1 card' : `${count} cards`;
        newState = log(newState, cardOwner, `Hand size: ${handSize} cards. Flip ${countText} with value ${minValue} or higher.`);
    }

    // Set actionRequired for player to select cards - use generic type
    newState.actionRequired = {
        type: 'select_card_to_flip',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
        targetFilter: params.targetFilter,
        optional: params.optional || false,
        scope: params.scope, // NEW: Pass scope for lane filtering
        laneIndex: params.scope === 'this_lane' ? laneIndex : undefined, // NEW: Pass lane index
        // NEW: Mirror-3 - pass sameLaneAsFirst constraint
        sameLaneAsFirst: params.sameLaneAsFirst || false,
        restrictedLaneIndex: params.sameLaneAsFirst ? state.lastFlipLaneIndex : undefined,
        // CRITICAL: Pass conditional info for "If you do" effects
        followUpEffect: conditional?.thenEffect,
        conditionalType: conditional?.type,
    } as any;

    return { newState };
}
