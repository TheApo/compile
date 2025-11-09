/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from '../../types';
import { EffectDefinition } from '../../types/customProtocol';
import { log } from '../utils/log';
import { v4 as uuidv4 } from 'uuid';
import { findCardOnBoard, isCardUncovered, handleUncoverEffect } from '../game/helpers/actionUtils';

/**
 * Execute a custom effect based on its EffectDefinition
 */
export function executeCustomEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    effectDef: EffectDefinition
): EffectResult {
    const params = effectDef.params as any;
    const action = params.action;

    // CRITICAL: Validate that the source card is still active before executing any effect
    const sourceCardInfo = findCardOnBoard(state, card.id);

    // Check 1: Card must still exist on the board
    if (!sourceCardInfo) {
        return { newState: state };
    }

    // Check 2: Card must be face-up
    if (!sourceCardInfo.card.isFaceUp) {
        return { newState: state };
    }

    // Check 3: ONLY top effects can execute when covered
    // Middle and Bottom effects require uncovered status
    const position = effectDef.position || 'middle';
    const requiresUncovered = position !== 'top';

    if (requiresUncovered) {
        const sourceIsUncovered = isCardUncovered(state, card.id);
        if (!sourceIsUncovered) {
            return { newState: state };
        }
    }

    // CRITICAL: Handle optional effects BEFORE executing them
    // If params.optional === true, create a prompt instead of executing directly
    // This works for ALL effect types (discard, flip, delete, shift, return, etc.)
    if (params.optional === true) {
        console.log(`[Custom Effect] Optional effect detected (${action}) - creating prompt`);
        let newState = { ...state };
        newState.actionRequired = {
            type: 'prompt_optional_effect',
            actor: context.cardOwner,
            sourceCardId: card.id,
            // Store the complete effect definition for later execution
            effectDef: effectDef,
            // Store laneIndex for later execution
            laneIndex: laneIndex,
        } as any;
        return { newState };
    }

    let result: EffectResult;

    switch (action) {
        case 'draw':
            result = executeDrawEffect(card, laneIndex, state, context, params);
            break;

        case 'flip':
            result = executeFlipEffect(card, laneIndex, state, context, params);
            break;

        case 'delete':
            result = executeDeleteEffect(card, laneIndex, state, context, params);
            break;

        case 'discard':
            result = executeDiscardEffect(card, laneIndex, state, context, params);
            break;

        case 'shift':
            result = executeShiftEffect(card, laneIndex, state, context, params);
            break;

        case 'return':
            result = executeReturnEffect(card, laneIndex, state, context, params);
            break;

        case 'play':
            result = executePlayEffect(card, laneIndex, state, context, params);
            break;

        case 'rearrange_protocols':
        case 'swap_protocols':
            result = executeProtocolEffect(card, laneIndex, state, context, params);
            break;

        case 'reveal':
        case 'give':
            result = executeRevealGiveEffect(card, laneIndex, state, context, params);
            break;

        case 'take':
            result = executeTakeEffect(card, laneIndex, state, context, params);
            break;

        case 'choice':
            result = executeChoiceEffect(card, laneIndex, state, context, params);
            break;

        default:
            console.error(`[Custom Effect] Unknown action: ${action}`);
            result = { newState: state };
            break;
    }

    // Handle conditional follow-up effects
    if (effectDef.conditional && effectDef.conditional.thenEffect) {
        const { newState } = result;
        console.log('[Custom Effect] Effect has conditional follow-up:', effectDef.id, 'Conditional type:', effectDef.conditional.type, 'Action created?', !!newState.actionRequired);

        if (newState.actionRequired) {
            // Store the conditional for later execution (after user completes the action)
            console.log('[Custom Effect] Storing follow-up effect for later execution:', effectDef.conditional.thenEffect.id);

            // CRITICAL: Store conditional type so we know if it's if_executed or then
            const stateWithFollowUp = {
                ...newState,
                actionRequired: {
                    ...newState.actionRequired,
                    followUpEffect: effectDef.conditional.thenEffect,
                    conditionalType: effectDef.conditional.type, // NEW: Store conditional type (if_executed or then)
                } as any
            };
            result = { newState: stateWithFollowUp };
        } else {
            // Effect completed immediately, execute conditional now
            console.log('[Custom Effect] Executing conditional follow-up effect immediately');
            result = executeCustomEffect(card, laneIndex, newState, context, effectDef.conditional.thenEffect);
        }
    }

    return result;
}

/**
 * Execute DRAW effect
 */
function executeDrawEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const target = params.target || 'self';
    const drawingPlayer = target === 'opponent' ? context.opponent : cardOwner;

    // NEW: Calculate draw count based on conditional (Anarchy-0)
    if (params.conditional) {
        let dynamicCount = 0;

        switch (params.conditional.type) {
            case 'non_matching_protocols': {
                // Anarchy-0: "For each line that contains a face-up card without matching protocol, draw 1 card"
                for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                    const playerProtocol = state.player.protocols[laneIdx];
                    const opponentProtocol = state.opponent.protocols[laneIdx];

                    // Get all face-up cards in this line (both players' stacks)
                    const playerCardsInLane = state.player.lanes[laneIdx].filter(c => c.isFaceUp);
                    const opponentCardsInLane = state.opponent.lanes[laneIdx].filter(c => c.isFaceUp);
                    const allFaceUpCardsInLane = [...playerCardsInLane, ...opponentCardsInLane];

                    // Check if ANY face-up card in this line doesn't match EITHER protocol
                    const hasNonMatchingCard = allFaceUpCardsInLane.some(c =>
                        c.protocol !== playerProtocol && c.protocol !== opponentProtocol
                    );

                    if (hasNonMatchingCard) {
                        dynamicCount++;
                    }
                }
                console.log(`[Draw Effect] non_matching_protocols: ${dynamicCount} lanes have non-matching face-up cards`);
                break;
            }

            case 'count_face_down': {
                // Count face-down cards in current lane
                const lane = state[cardOwner].lanes[laneIndex];
                dynamicCount = lane.filter(c => !c.isFaceUp).length;
                console.log(`[Draw Effect] count_face_down: ${dynamicCount} face-down cards in lane`);
                break;
            }

            case 'is_covering': {
                // Check if this card is covering another card
                const lane = state[cardOwner].lanes[laneIndex];
                const cardIndex = lane.findIndex(c => c.id === card.id);
                const isCovering = cardIndex < lane.length - 1;
                dynamicCount = isCovering ? (params.count || 1) : 0;
                console.log(`[Draw Effect] is_covering: ${isCovering ? 'yes' : 'no'}`);
                break;
            }
        }

        // Use dynamic count from conditional
        let count = dynamicCount;

        if (count <= 0) {
            console.log(`[Draw Effect] Conditional count is ${count}, skipping draw`);
            return { newState: state };
        }

        // Jump to draw execution
        const { drawnCards, remainingDeck } = drawCardsUtil(
            state[drawingPlayer].deck,
            state[drawingPlayer].hand,
            count
        );

        let newState = { ...state };
        newState[drawingPlayer] = {
            ...newState[drawingPlayer],
            deck: remainingDeck,
            hand: drawnCards,
        };

        const playerName = drawingPlayer === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''} from non-matching protocols.`);

        return { newState };
    }

    // NEW: Calculate draw count based on countType
    let count = params.count || 1;
    const countType = params.countType || 'fixed';

    switch (countType) {
        case 'equal_to_card_value':
            // Light-0: "Flip 1 card. Draw cards equal to that card's value"
            count = context.referencedCardValue || 0;
            console.log(`[Draw Effect] Using referenced card value: ${count}`);
            break;

        case 'equal_to_discarded':
            // Fire-4: "Discard 1 or more cards. Draw the amount discarded plus 1"
            count = (context.discardedCount || 0) + (params.countOffset || 0);
            console.log(`[Draw Effect] Using discarded count: ${context.discardedCount} + offset ${params.countOffset} = ${count}`);
            break;

        case 'hand_size':
            // Chaos-4 End: "Discard your hand. Draw the same amount of cards"
            count = context.handSize || 0;
            console.log(`[Draw Effect] Using hand size: ${count}`);
            break;

        case 'fixed':
        default:
            // Standard fixed count
            count = params.count || 1;
            break;
    }

    // Prevent drawing 0 or negative cards
    if (count <= 0) {
        console.log(`[Draw Effect] Count is ${count}, skipping draw`);
        return { newState: state };
    }

    // NEW: Advanced Conditional - Protocol Matching (Anarchy-6)
    if (params.advancedConditional?.type === 'protocol_match') {
        const requiredProtocol = params.advancedConditional.protocol;
        const cardProtocol = state[cardOwner].protocols[laneIndex];

        if (cardProtocol !== requiredProtocol) {
            console.log(`[Draw Effect] Protocol match failed: card is in ${cardProtocol} lane, requires ${requiredProtocol}. Skipping draw.`);
            return { newState: state };
        }
        console.log(`[Draw Effect] Protocol match success: card is in ${cardProtocol} lane (requires ${requiredProtocol}).`);
    }

    // NEW: Advanced Conditional - Compile Block (Metal-1)
    let newState = { ...state };
    if (params.advancedConditional?.type === 'compile_block') {
        const duration = params.advancedConditional.turnDuration || 1;
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';

        // Set compile block flag on opponent
        newState = {
            ...newState,
            compileBlockedUntilTurn: (newState.turnNumber || 0) + duration,
            compileBlockedPlayer: opponent,
        } as any;

        console.log(`[Draw Effect] Opponent's compile blocked for ${duration} turn(s).`);
        newState = log(newState, cardOwner, `Opponent can't compile for ${duration} turn${duration !== 1 ? 's' : ''}.`);
    }

    // NEW: Handle optional draw (Death-1: "You may draw 1 card")
    if (params.optional) {
        newState.actionRequired = {
            type: 'prompt_optional_draw',
            sourceCardId: card.id,
            actor: cardOwner,
            count,
            drawingPlayer,
        } as any;

        return { newState };
    }

    // Simple draw without conditionals for now
    const { drawnCards, remainingDeck } = drawCardsUtil(
        newState[drawingPlayer].deck,
        newState[drawingPlayer].hand,
        count
    );

    newState[drawingPlayer] = {
        ...newState[drawingPlayer],
        deck: remainingDeck,
        hand: drawnCards,
    };

    const playerName = drawingPlayer === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''}.`);

    return { newState };
}

/**
 * Execute FLIP effect
 */
function executeFlipEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;

    // NEW: Flip self mode (Anarchy-6)
    if (params.flipSelf) {
        // Check advanced conditional
        if (params.advancedConditional?.type === 'protocol_match') {
            const requiredProtocol = params.advancedConditional.protocol;
            const cardProtocol = state[cardOwner].protocols[laneIndex];

            if (cardProtocol !== requiredProtocol) {
                console.log(`[Flip Effect] Protocol match failed: card is in ${cardProtocol} lane, requires ${requiredProtocol}. Skipping flip.`);
                return { newState: state };
            }
            console.log(`[Flip Effect] Protocol match success: card is in ${cardProtocol} lane (requires ${requiredProtocol}).`);
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
        }

        return { newState };
    }

    // NEW: Flip all in lane mode (Apathy-1)
    // ONLY if count is not specified (or explicitly set to 'all')
    // If count is specified (e.g., 1), use normal selection flow below
    const count = params.count || 1;
    const shouldAutoFlipAll = params.scope === 'this_lane' && (count === 'all' || typeof count !== 'number');

    if (shouldAutoFlipAll) {
        let newState = { ...state };
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';
        const targetFilter = params.targetFilter || {};

        const cardsToFlip = new Set<string>();

        // Collect cards from player's side of the lane
        const playerLane = newState[cardOwner].lanes[laneIndex];
        for (const c of playerLane) {
            // Check excludeSelf
            if (targetFilter.excludeSelf && c.id === card.id) continue;
            // Check faceState
            if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
            if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;
            // Check owner
            if (targetFilter.owner === 'opponent') continue; // Skip own cards if only opponent wanted

            cardsToFlip.add(c.id);
        }

        // Collect cards from opponent's side of the lane
        const opponentLane = newState[opponent].lanes[laneIndex];
        for (const c of opponentLane) {
            // Check faceState
            if (targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
            if (targetFilter.faceState === 'face_down' && c.isFaceUp) continue;
            // Check owner
            if (targetFilter.owner === 'own') continue; // Skip opponent cards if only own wanted

            cardsToFlip.add(c.id);
        }

        if (cardsToFlip.size > 0) {
            newState = log(newState, cardOwner, `Flipping ${cardsToFlip.size} card(s) in this lane.`);
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
            newState = log(newState, cardOwner, `No cards to flip in this lane.`);
            return { newState };
        }
    }

    // Standard flip (select target)
    const targetFilter = params.targetFilter || {};

    // CRITICAL DEFAULT: If position is not specified, default to 'uncovered'
    // This matches the game rules: "flip 1 card" means "flip 1 uncovered card"
    // Only if explicitly set to 'any' or 'covered' should covered cards be included
    const position = targetFilter.position || 'uncovered';

    // CRITICAL: Check if there are any valid targets before setting actionRequired
    // This prevents softlocks when no valid targets exist
    const validTargets: string[] = [];
    for (const player of ['player', 'opponent'] as const) {
        for (let laneIdx = 0; laneIdx < state[player].lanes.length; laneIdx++) {
            const lane = state[player].lanes[laneIdx];

            // NEW: If scope is 'this_lane', only check the current lane
            if (params.scope === 'this_lane' && laneIdx !== laneIndex) continue;

            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const c = lane[cardIdx];
                const isUncovered = cardIdx === lane.length - 1;

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

                validTargets.push(c.id);
            }
        }
    }

    // If no valid targets, skip the effect (both optional and non-optional)
    if (validTargets.length === 0) {
        let newState = log(state, cardOwner, `No valid cards to flip. Effect skipped.`);
        return { newState };
    }

    let newState = log(state, cardOwner, `[Custom Flip effect - selecting ${count} card(s) to flip]`);

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
    } as any;

    return { newState };
}

/**
 * Execute DELETE effect
 */
function executeDeleteEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;

    // NEW: Line Filter - Metal-3: "If there are 8 or more cards in this line"
    if (params.scope?.minCardsInLane) {
        const minCards = params.scope.minCardsInLane;
        const cardsInLane = state.lanes[laneIndex].length;

        if (cardsInLane < minCards) {
            console.log(`[Delete Effect] Line filter not met: ${cardsInLane} < ${minCards} cards in lane. Skipping delete.`);
            return { newState: state };
        }
        console.log(`[Delete Effect] Line filter met: ${cardsInLane} >= ${minCards} cards in lane.`);
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
            const lane = state[player].lanes[laneIdx];
            for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                const c = lane[cardIdx];
                const isUncovered = cardIdx === lane.length - 1;

                // Check excludeSelf
                if (params.excludeSelf && c.id === card.id) continue;
                // Check owner
                if (targetFilter.owner === 'own' && player !== actor) continue;
                if (targetFilter.owner === 'opponent' && player === actor) continue;
                // Check position (using default 'uncovered' if not specified)
                if (position === 'uncovered' && !isUncovered) continue;
                if (position === 'covered' && isUncovered) continue;
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
        return { newState };
    }

    let newState = log(state, cardOwner, `[Custom Delete effect - ${actor === cardOwner ? 'you' : 'opponent'} selecting ${count} card(s) to delete]`);

    // NEW: Handle deleteSelf (Death-1: "then delete this card")
    // Directly delete the source card without prompting
    if (params.deleteSelf) {
        const sourceCardInfo = findCardOnBoard(state, card.id);
        if (!sourceCardInfo) {
            newState = log(newState, cardOwner, `Source card no longer on board. Delete effect skipped.`);
            return { newState };
        }

        const { owner, laneIndex } = sourceCardInfo;
        const lane = state[owner].lanes[laneIndex];

        // CRITICAL: Check if lane exists (card might have been deleted already)
        if (!lane || lane.length === 0) {
            newState = log(newState, cardOwner, `Card already deleted. Delete effect skipped.`);
            return { newState };
        }

        const wasTopCard = lane[lane.length - 1].id === card.id;

        // Delete the card immediately
        newState = log(newState, cardOwner, `Deleting ${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}.`);

        // Remove card from lane (make a copy of the lane we already checked)
        const laneCopy = [...lane];
        const cardIndex = laneCopy.findIndex(c => c.id === card.id);
        laneCopy.splice(cardIndex, 1);

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

        // Handle uncover if was top card
        if (wasTopCard && laneCopy.length > 0) {
            const uncoverResult = handleUncoverEffect(newState, owner, laneIndex);
            newState = uncoverResult.newState;
        }

        return { newState };
    }

    // NEW: Handle selectLane (Death-2: "Delete all cards in 1 line with values of 1 or 2")
    // User first selects a lane, then all matching cards in that lane are deleted
    if (params.selectLane) {
        newState.actionRequired = {
            type: 'select_lane_for_delete',
            sourceCardId: card.id,
            actor,
            count: params.count,
            targetFilter: params.targetFilter,
            deleteAll: params.count === 'all' || params.count === undefined,
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
    newState.actionRequired = {
        type: 'select_cards_to_delete',  // CRITICAL: Must be plural 'select_cards_to_delete'
        count,
        sourceCardId: card.id,
        actor,
        disallowedIds: params.excludeSelf ? [card.id] : [],
        targetFilter: params.targetFilter,      // Pass filter to resolver/UI
        scope: params.scope,                     // Pass scope to resolver/UI
        protocolMatching: params.protocolMatching, // Pass protocol matching rule
    } as any;

    return { newState };
}

/**
 * Execute DISCARD effect
 */
function executeDiscardEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const actor = params.actor === 'opponent' ? context.opponent : cardOwner;

    // NEW: Handle dynamic discard count (Plague-2)
    let count = params.count || 1;
    const countType = params.countType || 'fixed';

    if (countType === 'equal_to_discarded') {
        // Use discardedCount from context (from previous discard in the chain)
        count = (context.discardedCount || 0) + (params.countOffset || 0);
        console.log(`[Discard Effect] Using dynamic count: ${context.discardedCount} + ${params.countOffset} = ${count}`);

        // If count is 0 or negative, skip the discard
        if (count <= 0) {
            console.log('[Discard Effect] Dynamic count is 0 or less, skipping discard.');
            return { newState: state };
        }
    }

    // CRITICAL FIX: Check if actor has any cards to discard
    if (state[actor].hand.length === 0) {
        console.log(`[Discard Effect] ${actor} has no cards to discard - skipping effect.`);
        return { newState: state };
    }

    // NOTE: Optional handling is now done centrally in executeCustomEffect
    // No need for special optional logic here anymore

    let newState = { ...state };
    newState.actionRequired = {
        type: 'discard',
        actor,
        count,
        sourceCardId: card.id,
        variableCount: params.variableCount || false, // For Fire-4, Plague-2 first discard
        previousHandSize: state[actor].hand.length, // Store hand size before discard for context propagation
    } as any;

    return { newState };
}

/**
 * Execute SHIFT effect
 */
function executeShiftEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    let newState = { ...state };

    // NEW: If using card from previous effect (e.g., "Flip 1 card. Shift THAT card"), use it directly
    const selectedCardId = (state as any)._selectedCardFromPreviousEffect;

    if (selectedCardId) {
        // Clear the stored card ID
        delete (newState as any)._selectedCardFromPreviousEffect;

        // Use shift_flipped_card_optional (like Darkness-1) to shift the specific card
        newState.actionRequired = {
            type: 'shift_flipped_card_optional',
            cardId: selectedCardId,
            sourceCardId: card.id,
            optional: params.optional || false,
            actor: cardOwner,
        } as any;
        return { newState };
    }

    const targetFilter = params.targetFilter || {};
    const position = targetFilter.position || 'uncovered';
    const faceState = targetFilter.faceState || 'any';
    const ownerFilter = targetFilter.owner || 'any';
    const excludeSelf = targetFilter.excludeSelf || false;

    // Collect all potential target cards based on filters
    const potentialTargets: Array<{ card: PlayedCard, currentLane: number, owner: 'player' | 'opponent' }> = [];

    for (const player of ['player', 'opponent'] as const) {
        // Skip if owner filter doesn't match
        if (ownerFilter === 'own' && player !== cardOwner) continue;
        if (ownerFilter === 'opponent' && player === cardOwner) continue;

        for (let i = 0; i < newState[player].lanes.length; i++) {
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

                potentialTargets.push({ card: targetCard, currentLane: i, owner: player });
            }
        }
    }

    if (potentialTargets.length === 0) {
        newState = log(newState, cardOwner, `[Custom Shift] No valid cards to shift.`);
        return { newState };
    }

    // Check if ANY target has at least ONE valid destination
    const destinationRestriction = params.destinationRestriction;
    let hasValidTarget = false;

    for (const { card: targetCard, currentLane, owner } of potentialTargets) {
        // CRITICAL: For non_matching_protocol restriction, we need to know the card's protocol
        // Face-down cards have unknown protocols, so we can't validate destination → skip them
        if (destinationRestriction?.type === 'non_matching_protocol' && !targetCard.isFaceUp) {
            continue; // Skip face-down cards for protocol-based restrictions
        }

        const cardProtocol = targetCard.protocol;

        // Check all 3 lanes
        for (let targetLane = 0; targetLane < 3; targetLane++) {
            if (targetLane === currentLane) continue; // Can't shift to same lane

            // Check destination restriction
            if (destinationRestriction) {
                if (destinationRestriction.type === 'non_matching_protocol') {
                    const playerProtocol = newState.player.protocols[targetLane];
                    const opponentProtocol = newState.opponent.protocols[targetLane];
                    // Valid only if card's protocol does NOT match either protocol in target lane
                    if (cardProtocol === playerProtocol || cardProtocol === opponentProtocol) {
                        continue; // Skip this destination
                    }
                } else if (destinationRestriction.type === 'specific_lane') {
                    // Only allow shifts within the same lane (actually this means moving position, not changing lane)
                    if (targetLane !== currentLane) continue;
                }
            }

            // Found at least one valid destination
            hasValidTarget = true;
            break;
        }

        if (hasValidTarget) break;
    }

    if (!hasValidTarget) {
        newState = log(newState, cardOwner, `[Custom Shift] No valid shift destinations available.`);
        return { newState };
    }

    // Set actionRequired - use generic 'select_card_to_shift' type
    newState = log(newState, cardOwner, `[Custom Shift effect - selecting card to shift]`);
    newState.actionRequired = {
        type: 'select_card_to_shift',
        sourceCardId: card.id,
        actor: cardOwner,
        targetFilter: params.targetFilter,
        destinationRestriction: params.destinationRestriction,
    } as any;

    return { newState };
}

/**
 * Execute RETURN effect
 */
function executeReturnEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const count = params.count === 'all' ? 99 : (params.count || 1);
    const owner = params.targetFilter?.owner || 'any';

    // CRITICAL: Check if there are cards on board matching the owner filter
    let availableCards: PlayedCard[] = [];
    if (owner === 'own') {
        availableCards = state[cardOwner].lanes.flat();
    } else if (owner === 'opponent') {
        availableCards = state[opponent].lanes.flat();
    } else { // 'any'
        availableCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    }

    if (availableCards.length === 0) {
        let newState = log(state, cardOwner, `No cards on board to return. Effect skipped.`);
        return { newState };
    }

    let newState = log(state, cardOwner, `[Custom Return effect - selecting ${count} card(s) to return]`);

    // FIX: Use 'select_card_to_return' (same as Fire-2)
    // Pass owner filter so UI can restrict clickable cards
    newState.actionRequired = {
        type: 'select_card_to_return',
        sourceCardId: card.id,
        actor: cardOwner,
        targetOwner: owner, // NEW: Pass owner filter to UI
    } as any;

    return { newState };
}

/**
 * Execute PLAY effect
 */
function executePlayEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;
    const source = params.source || 'hand';
    const faceDown = params.faceDown || false;
    const actor = params.actor === 'opponent' ? context.opponent : cardOwner;

    // CRITICAL FIX: Check if actor has any cards in hand to play
    if (source === 'hand' && state[actor].hand.length === 0) {
        console.log(`[Play Effect] ${actor} has no cards in hand to play - skipping effect.`);
        return { newState: state };
    }

    let newState = log(state, cardOwner, `[Custom Play effect - playing ${count} card(s) ${faceDown ? 'face-down' : 'face-up'} from ${source}]`);

    // Convert destinationRule to disallowedLaneIndex for compatibility with existing UI logic
    let disallowedLaneIndex: number | undefined = undefined;
    if (params.destinationRule?.excludeCurrentLane) {
        disallowedLaneIndex = laneIndex;
    }

    newState.actionRequired = {
        type: 'select_card_from_hand_to_play',
        count,
        sourceCardId: card.id,
        actor,
        faceDown,
        source,
        disallowedLaneIndex, // Converted from destinationRule
        destinationRule: params.destinationRule, // Keep original for future use
        condition: params.condition, // For conditional play (Gravity-0, Life-0)
    } as any;

    return { newState };
}

/**
 * Execute PROTOCOL effects (rearrange/swap)
 */
function executeProtocolEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const action = params.action;
    const targetParam = params.target || 'own';

    // Determine which player's protocols are being affected
    const targetPlayer = targetParam === 'opponent' ? opponent : cardOwner;
    // Actor is always the card owner (who performs the action)
    const actingPlayer = cardOwner;

    let newState = log(state, cardOwner, `[Custom Protocol effect - ${action} for ${targetPlayer}]`);

    // NEW: Resolve 'current' lane index to actual lane number (Anarchy-3)
    let disallowedProtocolForLane: { laneIndex: number; protocol: string } | undefined = undefined;
    if (params.restriction) {
        const resolvedLaneIndex = params.restriction.laneIndex === 'current'
            ? laneIndex // Use the lane where this card is located
            : params.restriction.laneIndex;

        disallowedProtocolForLane = {
            laneIndex: resolvedLaneIndex,
            protocol: params.restriction.disallowedProtocol
        };
    }

    if (action === 'rearrange_protocols') {
        newState.actionRequired = {
            type: 'prompt_rearrange_protocols', // CRITICAL: Must use 'prompt_' prefix to trigger modal
            actor: actingPlayer, // Who performs the action (card owner)
            target: targetPlayer, // Who's protocols are being rearranged
            sourceCardId: card.id,
            disallowedProtocolForLane // Match existing resolver field name
        } as any;
    } else if (action === 'swap_protocols') {
        newState.actionRequired = {
            type: 'prompt_swap_protocols', // CRITICAL: Must use 'prompt_' prefix to trigger modal
            actor: actingPlayer, // Who performs the action (card owner)
            target: targetPlayer, // Who's protocols are being swapped
            sourceCardId: card.id,
            disallowedProtocolForLane // Match existing resolver field name
        } as any;
    }

    return { newState };
}

/**
 * Execute REVEAL/GIVE effects
 */
function executeRevealGiveEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;
    const action = params.action;

    // CRITICAL: Check if player has any cards in hand
    if (state[cardOwner].hand.length === 0) {
        let newState = log(state, cardOwner, `No cards in hand to ${action}. Effect skipped.`);
        return { newState };
    }

    let newState = log(state, cardOwner, `[Custom ${action} effect - selecting ${count} card(s)]`);

    if (action === 'reveal') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_reveal',
            count,
            sourceCardId: card.id,
            actor: cardOwner,
        } as any;
    } else if (action === 'give') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_give',
            count,
            sourceCardId: card.id,
            actor: cardOwner,
        } as any;
    }

    return { newState };
}

/**
 * Execute TAKE effect
 */
function executeTakeEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const count = params.count || 1;
    const random = params.random !== false; // default true

    // CRITICAL: Check if opponent has any cards in hand
    if (state[opponent].hand.length === 0) {
        let newState = log(state, cardOwner, `Opponent has no cards in hand. Effect skipped.`);
        return { newState };
    }

    let newState = log(state, cardOwner, `[Custom Take effect - taking ${count} card(s) from opponent's hand]`);

    // Set actionRequired for player to take cards
    newState.actionRequired = {
        type: random ? 'take_random_from_opponent_hand' : 'take_from_opponent_hand',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
    } as any;

    return { newState };
}

/**
 * Execute CHOICE effect (Either/Or)
 */
function executeChoiceEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const options = params.options || [];

    if (options.length !== 2) {
        console.error(`[Choice Effect] Expected 2 options, got ${options.length}`);
        return { newState: state };
    }

    let newState = log(state, cardOwner, `[Custom Choice effect - choose one of two options]`);

    // Set actionRequired for player to choose
    newState.actionRequired = {
        type: 'custom_choice',
        options,
        sourceCardId: card.id,
        actor: cardOwner,
        laneIndex,
    } as any;

    return { newState };
}

/**
 * Helper: Draw cards (copied from gameStateModifiers)
 */
function drawCardsUtil(
    deck: any[],
    hand: any[],
    count: number
): { drawnCards: any[]; remainingDeck: any[] } {
    const actualDrawCount = Math.min(count, deck.length);
    // Convert deck cards to PlayedCard objects with unique IDs
    const newCards = deck.slice(0, actualDrawCount).map(c => ({
        ...c,
        id: uuidv4(),
        isFaceUp: true
    }));
    const drawnCards = [...hand, ...newCards];
    const remainingDeck = deck.slice(actualDrawCount);
    return { drawnCards, remainingDeck };
}

