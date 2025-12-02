/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player, AnimationRequest } from '../../types';
import { EffectDefinition } from '../../types/customProtocol';
import { log } from '../utils/log';
import { v4 as uuidv4 } from 'uuid';
import { findCardOnBoard, isCardUncovered, handleUncoverEffect, internalShiftCard } from '../game/helpers/actionUtils';
import { drawCards } from '../../utils/gameStateModifiers';
import { processReactiveEffects } from '../game/reactiveEffectProcessor';
import { isFrost1Active, isFrost1BottomActive } from '../game/passiveRuleChecker';
import { executeOnCoverEffect } from '../effectExecutor';
import { getEffectiveCardValue } from '../game/stateManager';

/**
 * Execute a custom effect based on its EffectDefinition
 */
export function executeCustomEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    effectDef: EffectDefinition,
    allEffects?: EffectDefinition[]  // NEW: Pass all effects to check for chains
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
    // EXCEPTION: on_cover triggers are MEANT to fire when the card is covered!
    const position = effectDef.position || 'middle';
    const trigger = effectDef.trigger;
    const isOnCoverTrigger = trigger === 'on_cover';
    const requiresUncovered = position !== 'top' && !isOnCoverTrigger;

    if (requiresUncovered) {
        const sourceIsUncovered = isCardUncovered(state, card.id);
        if (!sourceIsUncovered) {
            return { newState: state };
        }
    }

    // CRITICAL: Handle optional effects BEFORE executing them
    // If params.optional === true, create a prompt instead of executing directly
    // EXCEPTION: 'reveal' with source='board' handles optional internally (needs to check targets first)
    const isRevealBoard = action === 'reveal' && params.source === 'board';

    if (params.optional === true && !isRevealBoard) {
        // CRITICAL FIX: Check if the optional effect CAN be executed before showing the prompt
        // Don't show "Do you want to X?" if there are no valid targets for X
        const actor = params.actor === 'opponent' ? context.opponent : context.cardOwner;
        const opponent = actor === 'player' ? 'opponent' : 'player';
        const targetFilter = params.targetFilter || {};

        // Helper to check if there are valid targets on board
        const hasValidBoardTargets = (checkFn: (card: PlayedCard, owner: Player, laneIdx: number, cardIdx: number) => boolean): boolean => {
            for (const owner of ['player', 'opponent'] as Player[]) {
                for (let laneIdx = 0; laneIdx < state[owner].lanes.length; laneIdx++) {
                    const lane = state[owner].lanes[laneIdx];
                    for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                        if (checkFn(lane[cardIdx], owner, laneIdx, cardIdx)) return true;
                    }
                }
            }
            return false;
        };

        // Check preconditions for each action type
        let canExecute = true;
        let skipReason = '';

        switch (action) {
            case 'discard':
                if (state[actor].hand.length === 0) {
                    canExecute = false;
                    skipReason = 'No cards to discard';
                }
                break;

            case 'flip': {
                const isFrost1Active = (state as any).passiveEffects?.some((e: any) => e.type === 'prevent_flip_to_face_up' && e.isActive);
                canExecute = hasValidBoardTargets((c, owner, laneIdx, cardIdx) => {
                    // Check excludeSelf
                    if (targetFilter.excludeSelf && c.id === card.id) return false;
                    // Check owner filter
                    if (targetFilter.owner === 'own' && owner !== actor) return false;
                    if (targetFilter.owner === 'opponent' && owner === actor) return false;
                    // Check position filter
                    const isUncovered = cardIdx === state[owner].lanes[laneIdx].length - 1;
                    if (targetFilter.position === 'uncovered' && !isUncovered) return false;
                    if (targetFilter.position === 'covered' && isUncovered) return false;
                    // Check faceState filter
                    if (targetFilter.faceState === 'face_up' && !c.isFaceUp) return false;
                    if (targetFilter.faceState === 'face_down' && c.isFaceUp) return false;
                    // Check Frost-1 (can't flip face-down to face-up)
                    if (isFrost1Active && !c.isFaceUp) return false;
                    return true;
                });
                if (!canExecute) skipReason = 'No valid cards to flip';
                break;
            }

            case 'delete': {
                canExecute = hasValidBoardTargets((c, owner, laneIdx, cardIdx) => {
                    // Check excludeSelf
                    if (targetFilter.excludeSelf && c.id === card.id) return false;
                    // Check owner filter
                    if (targetFilter.owner === 'own' && owner !== actor) return false;
                    if (targetFilter.owner === 'opponent' && owner === actor) return false;
                    // Check position filter (default: uncovered)
                    const isUncovered = cardIdx === state[owner].lanes[laneIdx].length - 1;
                    const posFilter = targetFilter.position || 'uncovered';
                    if (posFilter === 'uncovered' && !isUncovered) return false;
                    if (posFilter === 'covered' && isUncovered) return false;
                    // Check faceState filter
                    if (targetFilter.faceState === 'face_up' && !c.isFaceUp) return false;
                    if (targetFilter.faceState === 'face_down' && c.isFaceUp) return false;
                    return true;
                });
                if (!canExecute) skipReason = 'No valid cards to delete';
                break;
            }

            case 'shift': {
                // CRITICAL: If useCardFromPreviousEffect is true, check if the target card still exists
                // This handles "Flip 1 card. You may shift THAT card" where the flipped card (e.g., Metal-6)
                // might have deleted itself
                if (effectDef.useCardFromPreviousEffect) {
                    const targetCardId = state.lastCustomEffectTargetCardId || (state as any)._selectedCardFromPreviousEffect;
                    if (targetCardId) {
                        const targetCardInfo = findCardOnBoard(state, targetCardId);
                        canExecute = !!targetCardInfo;
                        if (!canExecute) skipReason = 'Target card no longer exists';
                    } else {
                        // No target card stored - effect cannot be executed
                        canExecute = false;
                        skipReason = 'No target card from previous effect';
                    }
                } else {
                    // CRITICAL: Spirit-3 special case - "shift this card, even if covered"
                    // When position === 'any' AND owner === 'own' AND !excludeSelf,
                    // the card is shifting ITSELF, not selecting other targets
                    const posFilter = targetFilter.position || 'uncovered';
                    const isShiftSelfEvenIfCovered = posFilter === 'any' &&
                                                     targetFilter.owner === 'own' &&
                                                     !targetFilter.excludeSelf;

                    if (isShiftSelfEvenIfCovered) {
                        // Spirit-3: Always can shift itself (it's face-up, that's the only requirement)
                        canExecute = true;
                    } else {
                        canExecute = hasValidBoardTargets((c, owner, laneIdx, cardIdx) => {
                            // Check excludeSelf
                            if (targetFilter.excludeSelf && c.id === card.id) return false;
                            // Check owner filter
                            if (targetFilter.owner === 'own' && owner !== actor) return false;
                            if (targetFilter.owner === 'opponent' && owner === actor) return false;
                            // Check position filter (default: uncovered)
                            const isUncovered = cardIdx === state[owner].lanes[laneIdx].length - 1;
                            if (posFilter === 'uncovered' && !isUncovered) return false;
                            if (posFilter === 'covered' && isUncovered) return false;
                            // position === 'any' allows both covered and uncovered
                            return true;
                        });
                        if (!canExecute) skipReason = 'No valid cards to shift';
                    }
                }
                break;
            }

            case 'return': {
                // Check if there are cards to return based on targetFilter
                const returnOwner = targetFilter.owner === 'opponent' ? opponent : actor;
                canExecute = hasValidBoardTargets((c, owner, laneIdx, cardIdx) => {
                    if (owner !== returnOwner) return false;
                    // Check position filter
                    const isUncovered = cardIdx === state[owner].lanes[laneIdx].length - 1;
                    const posFilter = targetFilter.position || 'uncovered';
                    if (posFilter === 'uncovered' && !isUncovered) return false;
                    if (posFilter === 'covered' && isUncovered) return false;
                    return true;
                });
                if (!canExecute) skipReason = 'No valid cards to return';
                break;
            }

            case 'draw':
                // Check if there are cards to draw
                if (state[actor].deck.length === 0 && state[actor].discard.length === 0) {
                    canExecute = false;
                    skipReason = 'No cards to draw';
                }
                break;

            case 'play':
                // Check if there are cards to play
                if (state[actor].hand.length === 0) {
                    canExecute = false;
                    skipReason = 'No cards to play';
                }
                break;
        }

        if (!canExecute) {
            console.log(`[Custom Effect] Optional ${action} skipped - ${skipReason}`);
            let newState = log(state, actor, `${skipReason} - effect skipped.`);
            // Mark effect as not executed for if_executed conditionals
            (newState as any)._effectSkippedNoTargets = true;
            if (action === 'discard') {
                (newState as any)._discardContext = { discardedCount: 0 };
            }
            return { newState };
        }

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
        case 'refresh': {
            // Spirit-0: Refresh hand to 5 cards
            const actor = context.actor;
            const currentHandSize = state[actor].hand.length;
            const cardsNeeded = Math.max(0, 5 - currentHandSize);

            if (cardsNeeded > 0) {
                const { drawnCards, remainingDeck, newDiscard } = drawCards(
                    state[actor].deck,
                    state[actor].discard,
                    cardsNeeded
                );

                // CRITICAL: Generate new unique IDs for drawn cards (same as drawForPlayer)
                const newHandCards = drawnCards.map(c => ({ ...c, id: uuidv4() }));

                let newState = {
                    ...state,
                    [actor]: {
                        ...state[actor],
                        hand: [...state[actor].hand, ...newHandCards],
                        deck: remainingDeck,
                        discard: newDiscard
                    }
                };

                // Only show card names to the player who drew them
                const cardNamesRefresh = actor === 'player'
                    ? ` (${drawnCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
                    : '';
                newState = log(newState, actor, `[Refresh] Drew ${drawnCards.length} cards to reach hand size 5${cardNamesRefresh}.`);

                // CRITICAL: Trigger reactive effects after draw (Spirit-3)
                const reactiveResult = processReactiveEffects(newState, 'after_draw', { player: actor, count: drawnCards.length });
                newState = reactiveResult.newState;

                result = { newState };
            } else {
                // Hand already has 5+ cards, no need to draw
                let newState = log(state, actor, `[Refresh] Hand already at ${currentHandSize} cards, no draw needed.`);
                result = { newState };
            }
            break;
        }

        case 'mutual_draw': {
            // Chaos-0: Both players draw from each other's decks
            const actor = context.actor;
            const opponent = actor === 'player' ? 'opponent' : 'player';
            const count = params.count || 1;

            let newState = { ...state };

            // Actor draws from opponent's deck
            if (newState[opponent].deck.length > 0) {
                const { drawnCards, remainingDeck, newDiscard } = drawCards(
                    newState[opponent].deck,
                    newState[opponent].discard,
                    count
                );

                if (drawnCards.length > 0) {
                    const newHandCards = drawnCards.map(c => ({
                        ...c,
                        id: uuidv4(),
                        isFaceUp: true
                    }));

                    newState = {
                        ...newState,
                        [opponent]: {
                            ...newState[opponent],
                            deck: remainingDeck,
                            discard: newDiscard
                        },
                        [actor]: {
                            ...newState[actor],
                            hand: [...newState[actor].hand, ...newHandCards]
                        }
                    };

                    const actorName = actor === 'player' ? 'Player' : 'Opponent';
                    const opponentName = opponent === 'player' ? 'Player' : 'Opponent';
                    // Only show card names to the player who drew them
                    const cardNamesActor = actor === 'player'
                        ? ` (${newHandCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
                        : '';
                    newState = log(newState, actor, `${actorName} drew ${drawnCards.length} card(s) from ${opponentName}'s deck${cardNamesActor}.`);
                }
            }

            // Opponent draws from actor's deck
            if (newState[actor].deck.length > 0) {
                const { drawnCards, remainingDeck, newDiscard } = drawCards(
                    newState[actor].deck,
                    newState[actor].discard,
                    count
                );

                if (drawnCards.length > 0) {
                    const newHandCards = drawnCards.map(c => ({
                        ...c,
                        id: uuidv4(),
                        isFaceUp: true
                    }));

                    newState = {
                        ...newState,
                        [actor]: {
                            ...newState[actor],
                            deck: remainingDeck,
                            discard: newDiscard
                        },
                        [opponent]: {
                            ...newState[opponent],
                            hand: [...newState[opponent].hand, ...newHandCards]
                        }
                    };

                    const opponentName = opponent === 'player' ? 'Player' : 'Opponent';
                    const actorName = actor === 'player' ? 'Player' : 'Opponent';
                    // Only show card names to the player who drew them
                    const cardNamesOpponent = opponent === 'player'
                        ? ` (${newHandCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
                        : '';
                    newState = log(newState, opponent, `${opponentName} drew ${drawnCards.length} card(s) from ${actorName}'s deck${cardNamesOpponent}.`);
                }
            }

            result = { newState };
            break;
        }

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
            // CRITICAL: Pass useCardFromPreviousEffect from effectDef (it's not in params!)
            result = executeShiftEffect(card, laneIndex, state, context, {
                ...params,
                useCardFromPreviousEffect: effectDef.useCardFromPreviousEffect
            });
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

        case 'block_compile':
            result = executeBlockCompileEffect(card, laneIndex, state, context, params);
            break;

        case 'delete_all_in_lane':
            result = executeDeleteAllInLaneEffect(card, laneIndex, state, context, params);
            break;

        default:
            console.error(`[Custom Effect] Unknown action: ${action}`);
            result = { newState: state };
            break;
    }

    // Handle conditional follow-up effects
    if (effectDef.conditional && effectDef.conditional.thenEffect) {
        const { newState } = result;
        console.log('[Custom Effect] Effect has conditional follow-up:', effectDef.id, 'Conditional type:', effectDef.conditional.type, 'Action created?', !!newState.actionRequired, 'actionRequired.type:', newState.actionRequired?.type);

        if (newState.actionRequired) {
            // Store the conditional for later execution (after user completes the action)
            console.log('[Custom Effect] Storing follow-up effect for later execution:', effectDef.conditional.thenEffect.id, 'to actionRequired type:', newState.actionRequired.type);

            // CRITICAL: Store conditional type so we know if it's if_executed or then
            // CRITICAL FIX: Also store the OUTER source card info, in case the actionRequired
            // was created by a DIFFERENT card (e.g., Spirit-3's after_draw interrupted Fire-0's on_cover)
            const stateWithFollowUp = {
                ...newState,
                actionRequired: {
                    ...newState.actionRequired,
                    followUpEffect: effectDef.conditional.thenEffect,
                    conditionalType: effectDef.conditional.type, // NEW: Store conditional type (if_executed or then)
                    outerSourceCardId: card.id, // The card that has the thenEffect (e.g., Fire-0)
                    outerLaneIndex: laneIndex,  // Lane of the outer source card
                } as any
            };
            result = { newState: stateWithFollowUp };
        } else {
            // Effect completed immediately - check if we should execute conditional now
            console.log('[Custom Effect] Effect completed immediately, conditional type:', effectDef.conditional.type);

            // CRITICAL FIX: For "if_executed" conditionals, check if the effect actually did something
            // This handles "Discard 1. If you do, delete 1" when player has no cards to discard
            if (effectDef.conditional.type === 'if_executed') {
                // Check if a discard actually happened
                const discardContext = (newState as any)._discardContext;
                const discardedCount = discardContext?.discardedCount || 0;

                if (discardedCount === 0) {
                    console.log('[Custom Effect] Skipping if_executed follow-up - no action was executed (no discard)');
                    // Clean up and return without executing follow-up
                    delete (newState as any)._discardContext;
                    result = { newState };
                    return result;
                }
            }

            console.log('[Custom Effect] Executing conditional follow-up effect immediately');

            // NEW: Propagate discard context for Chaos-4 "Discard your hand. Draw the same amount of cards"
            let enrichedContext = context;
            const discardContext = (newState as any)._discardContext;
            if (discardContext) {
                enrichedContext = {
                    ...context,
                    discardedCount: discardContext.discardedCount,
                    previousHandSize: discardContext.previousHandSize,
                } as any;
                // Clean up
                delete (newState as any)._discardContext;
                console.log('[Custom Effect] Propagated discard context:', enrichedContext);
            }

            result = executeCustomEffect(card, laneIndex, newState, enrichedContext, effectDef.conditional.thenEffect);
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
                // Count ALL face-down cards on the entire board (both players, all lanes)
                let totalFaceDown = 0;
                for (const player of ['player', 'opponent'] as Player[]) {
                    for (const lane of state[player].lanes) {
                        totalFaceDown += lane.filter(c => !c.isFaceUp).length;
                    }
                }
                dynamicCount = totalFaceDown;
                console.log(`[Draw Effect] count_face_down: ${dynamicCount} face-down cards on entire board`);
                break;
            }

            case 'is_covering': {
                // Life-4: Check if this card is covering another card
                // The card has already been played and added to the lane
                // If lane has > 1 card, then this card is covering something
                const lane = state[cardOwner].lanes[laneIndex];
                const isCovering = lane.length > 1;
                dynamicCount = isCovering ? (params.count || 1) : 0;
                console.log(`[Draw Effect] is_covering: ${isCovering ? 'yes' : 'no'} (lane has ${lane.length} cards)`);
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
        const { drawnCards, remainingDeck, newCards } = drawCardsUtil(
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
        // Generate log text based on conditional type
        let reasonText = '';
        switch (params.conditional.type) {
            case 'non_matching_protocols':
                reasonText = ' from non-matching protocols';
                break;
            case 'is_covering':
                reasonText = ' (this card is covering another)';
                break;
            case 'count_face_down':
                reasonText = ' (for face-down cards)';
                break;
            default:
                reasonText = '';
        }
        // Format the drawn card names for log - only show to player who drew them
        const drawnCardsText = (newCards.length > 0 && drawingPlayer === 'player')
            ? ` (${newCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
            : '';
        newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''}${reasonText}${drawnCardsText}.`);

        // CRITICAL: Trigger reactive effects after draw (Spirit-3)
        if (count > 0) {
            const reactiveResult = processReactiveEffects(newState, 'after_draw', { player: drawingPlayer, count });
            newState = reactiveResult.newState;
        }

        // Add draw animation request
        const animationRequests = count > 0 ? [{ type: 'draw' as const, player: drawingPlayer, count }] : undefined;

        return { newState, animationRequests };
    }

    // NEW: Calculate draw count based on countType
    let count = params.count || 1;
    const countType = params.countType || 'fixed';

    switch (countType) {
        case 'equal_to_card_value': {
            // Light-0: "Flip 1 card. Draw cards equal to that card's value"
            // Use lastCustomEffectTargetCardId from state (set by previous effect)
            const targetCardId = state.lastCustomEffectTargetCardId;
            console.log(`[Draw Effect - Light-0 DEBUG] Starting equal_to_card_value check`);
            console.log(`[Draw Effect - Light-0 DEBUG] lastCustomEffectTargetCardId: ${targetCardId}`);
            console.log(`[Draw Effect - Light-0 DEBUG] Full state keys:`, Object.keys(state));
            console.log(`[Draw Effect - Light-0 DEBUG] actionRequired:`, state.actionRequired?.type);

            if (targetCardId) {
                const targetCardInfo = findCardOnBoard(state, targetCardId);
                console.log(`[Draw Effect - Light-0 DEBUG] findCardOnBoard result:`, targetCardInfo ? `${targetCardInfo.card.protocol}-${targetCardInfo.card.value}` : 'null');

                if (targetCardInfo) {
                    const targetOwner = targetCardInfo.owner;
                    const laneContext = state[targetOwner].lanes.find(l => l.some(c => c.id === targetCardId)) || [];
                    count = getEffectiveCardValue(targetCardInfo.card, laneContext);
                    console.log(`[Draw Effect] Using referenced card value: ${count} from card ${targetCardInfo.card.protocol}-${targetCardInfo.card.value}`);
                } else {
                    // Card was removed from board (e.g., Water-4 returned to hand after flip)
                    count = 0;
                    let newState = log(state, cardOwner, `Cannot draw cards - referenced card is no longer on board (was returned/deleted).`);
                    console.log(`[Draw Effect] Referenced card not found on board - was likely returned/deleted by its own effect. Skipping draw.`);
                    return { newState };
                }
            } else {
                count = context.referencedCardValue || 0;
                console.log(`[Draw Effect - Light-0 DEBUG] No lastCustomEffectTargetCardId, using context.referencedCardValue: ${count}`);
            }
            break;
        }

        case 'equal_to_discarded':
            // Fire-4: "Discard 1 or more cards. Draw the amount discarded plus 1"
            count = (context.discardedCount || 0) + (params.countOffset || 0);
            console.log(`[Draw Effect] Using discarded count: ${context.discardedCount} + offset ${params.countOffset} = ${count}`);
            break;

        case 'hand_size':
        case 'previous_hand_size':
            // Chaos-4 End: "Discard your hand. Draw the same amount of cards"
            // Use previousHandSize from the discard action if available
            count = (context as any).previousHandSize || context.handSize || 0;
            console.log(`[Draw Effect] Using previous hand size: ${count}`);
            break;

        case 'count_face_down': {
            // Frost_custom-0: "Draw 1 card for each face-down card"
            // Count ALL face-down cards on the entire board (both players, all lanes)
            let totalFaceDown = 0;
            for (const player of ['player', 'opponent'] as Player[]) {
                for (const lane of state[player].lanes) {
                    totalFaceDown += lane.filter(c => !c.isFaceUp).length;
                }
            }
            count = totalFaceDown * (params.count || 1);
            console.log(`[Draw Effect] count_face_down: ${totalFaceDown} face-down cards on board, drawing ${count} cards`);
            break;
        }

        case 'fixed':
        default:
            // Standard fixed count
            count = params.count || 1;
            break;
    }

    // Prevent drawing 0 or negative cards
    if (count <= 0) {
        console.log(`[Draw Effect] Count is ${count}, skipping draw`);
        console.log(`[Draw Effect DEBUG] Returning state - turn: ${state.turn}, phase: ${state.phase}, actionRequired: ${state.actionRequired?.type || 'null'}`);
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
            compileBlockedUntilTurn: ((newState as any).turnNumber || 0) + duration,
            compileBlockedPlayer: opponent,
        } as any;

        console.log(`[Draw Effect] Opponent's compile blocked for ${duration} turn(s).`);
        newState = log(newState, cardOwner, `Opponent can't compile for ${duration} turn${duration !== 1 ? 's' : ''}.`);
    }

    // NEW: Handle optional draw (Death-1: "You may draw 1 card")
    if (params.optional) {
        console.log('[Draw Effect] Creating prompt_optional_draw for optional draw, card:', card.protocol, '-', card.value);
        newState.actionRequired = {
            type: 'prompt_optional_draw',
            sourceCardId: card.id,
            actor: cardOwner,
            count,
            drawingPlayer,
        } as any;

        return { newState };
    }

    // NEW: Handle source = 'opponent_deck' (Love-1: "Draw the top card of your opponent's deck")
    const source = params.source || 'own_deck';
    const sourcePlayer = source === 'opponent_deck' ? context.opponent : drawingPlayer;

    // Simple draw without conditionals for now
    const { drawnCards, remainingDeck, newCards } = drawCardsUtil(
        newState[sourcePlayer].deck,
        newState[drawingPlayer].hand,
        count
    );

    // Update the source player's deck (might be opponent's deck!)
    newState[sourcePlayer] = {
        ...newState[sourcePlayer],
        deck: remainingDeck,
    };

    // Update the drawing player's hand
    newState[drawingPlayer] = {
        ...newState[drawingPlayer],
        hand: drawnCards,
    };

    const playerName = drawingPlayer === 'player' ? 'Player' : 'Opponent';

    // Format the drawn card names for log - only show to player who drew them
    const drawnCardsText = (newCards.length > 0 && drawingPlayer === 'player')
        ? ` (${newCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
        : '';

    if (source === 'opponent_deck') {
        const opponentName = sourcePlayer === 'player' ? "Player's" : "Opponent's";
        newState = log(newState, drawingPlayer, `${playerName} draws the top ${count === 1 ? 'card' : `${count} cards`} of ${opponentName} deck${drawnCardsText}.`);
    } else {
        newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''}${drawnCardsText}.`);
    }

    // CRITICAL: Trigger reactive effects after draw (Spirit-3)
    if (drawnCards.length > 0) {
        const reactiveResult = processReactiveEffects(newState, 'after_draw', { player: drawingPlayer, count: drawnCards.length });
        newState = reactiveResult.newState;
    }

    // TEMPORARY FIX: Don't return animation for custom protocol draws to avoid blocking hand interactions
    // The animation causes a race condition where Check Cache runs while animation is still playing
    // TODO: Fix the async timing properly
    // const animationRequests = drawnCards.length > 0 ? [{ type: 'draw' as const, player: drawingPlayer, count: drawnCards.length }] : undefined;

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

    console.log('[DEBUG executeFlipEffect] Called with params:', JSON.stringify(params));
    console.log('[DEBUG executeFlipEffect] card:', `${card.protocol}-${card.value}`, 'laneIndex:', laneIndex, 'cardOwner:', cardOwner);

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
                cardToFlip.isFaceUp = !cardToFlip.isFaceUp;
                const direction = cardToFlip.isFaceUp ? 'face-up' : 'face-down';
                newState = log(newState, cardOwner, `Flips that card ${direction}.`);
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
        } as any;

        return { newState };
    }

    // NEW: Flip self mode (Anarchy-6)
    if (params.flipSelf) {
        console.log('[DEBUG executeFlipEffect] flipSelf mode - card:', `${card.protocol}-${card.value}`, 'laneIndex:', laneIndex, 'cardOwner:', cardOwner);
        console.log('[DEBUG executeFlipEffect] Lanes:', state[cardOwner].lanes.map((l, i) => `Lane ${i}: ${l.map(c => c.id.substring(0, 8)).join(', ')}`));
        console.log('[DEBUG executeFlipEffect] Looking for card.id:', card.id);

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

        console.log('[DEBUG executeFlipEffect] cardInLane found?', !!cardInLane, 'lane length:', lane.length);

        if (cardInLane) {
            cardInLane.isFaceUp = !cardInLane.isFaceUp;
            const playerName = cardOwner === 'player' ? 'Player' : 'Opponent';
            const direction = cardInLane.isFaceUp ? 'face-up' : 'face-down';
            newState = log(newState, cardOwner, `${playerName} flips this card ${direction}.`);
            console.log('[DEBUG executeFlipEffect] Flipped card to', direction);
        } else {
            console.log('[DEBUG executeFlipEffect] Card NOT found in lane! Lane cards:', lane.map(c => c.id));
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
                // CRITICAL: Frost-1 restriction - only face-up cards can be flipped (to become face-down)
                // Face-down cards cannot be flipped because they would become face-up (blocked)
                if (frost1Active && !c.isFaceUp) continue;

                validTargets.push(c.id);
            }
        }
    }

    // If no valid targets, skip the effect (both optional and non-optional)
    if (validTargets.length === 0) {
        let newState = log(state, cardOwner, `No valid cards to flip. Effect skipped.`);
        // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals)
        (newState as any)._effectSkippedNoTargets = true;
        return { newState };
    }

    let newState = { ...state };

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
    let count = params.count || 1;

    // NEW: Generic useCardFromPreviousEffect support
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

                // Handle uncover if was top card
                if (wasTopCard && lane.length > 0) {
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

            // Handle uncover if was top card
            if (wasTopCard && laneCopy.length > 0) {
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
        if (wasTopCard && laneCopy.length > 0 && context.triggerType !== 'cover') {
            const uncoverResult = handleUncoverEffect(newState, owner, laneIndex);
            newState = uncoverResult.newState;
            if (uncoverResult.animationRequests) {
                animationRequests.push(...uncoverResult.animationRequests);
            }
        }

        return { newState, animationRequests };
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
        const rawCount = (context.discardedCount || 0) + (params.countOffset || 0);
        // CRITICAL: Limit to actual hand size (like original Plague-2)
        count = Math.min(rawCount, state[actor].hand.length);
        console.log(`[Discard Effect] Using dynamic count: ${context.discardedCount} + ${params.countOffset} = ${rawCount}, limited to hand size: ${count}`);

        // If count is 0 or negative, skip the discard
        if (count <= 0) {
            console.log('[Discard Effect] Dynamic count is 0 or less, skipping discard.');
            return { newState: state };
        }
    }

    // CRITICAL FIX: Check if actor has any cards to discard
    if (state[actor].hand.length === 0) {
        console.log(`[Discard Effect] ${actor} has no cards to discard - skipping effect.`);
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        let newState = log(state, actor, `${actorName} has no cards to discard - effect skipped.`);
        // CRITICAL: Mark that the effect was NOT executed (for if_executed conditionals like Fire-3)
        (newState as any)._effectSkippedNoTargets = true;
        (newState as any)._discardContext = { discardedCount: 0 };
        return { newState };
    }

    // NEW: "upTo" mode (Hate-1: "Discard up to 3 cards")
    // Adjust count to available hand size
    if (params.upTo) {
        const originalCount = count;
        count = Math.min(count, state[actor].hand.length);
        console.log(`[Discard Effect] upTo mode: requesting ${originalCount}, adjusted to ${count} (hand size: ${state[actor].hand.length})`);
    }

    // CRITICAL: Always limit count to actual hand size (prevents softlock)
    // Also log when partial discard happens
    const requestedCount = count;
    if (typeof count === 'number' && count > state[actor].hand.length) {
        console.log(`[Discard Effect] Count ${count} exceeds hand size ${state[actor].hand.length}, limiting.`);
        count = state[actor].hand.length;
    }
    // Log partial discard (only when not in upTo mode, since upTo is already voluntary)
    const willLogPartialDiscard = !params.upTo && typeof requestedCount === 'number' && requestedCount > count;

    // NEW: Auto-execute "discard all" (Chaos-4: "Discard your hand")
    // When count is 'all', automatically discard entire hand without user selection
    if (count === 'all') {
        console.log(`[Discard Effect] Auto-discarding entire hand for ${actor}`);
        const handCards = state[actor].hand;
        const discardedCards = handCards.map(({ id, isFaceUp, ...card }) => card);
        const newHand: any[] = [];
        const newDiscard = [...state[actor].discard, ...discardedCards];

        const newStats = { ...state[actor].stats, cardsDiscarded: state[actor].stats.cardsDiscarded + discardedCards.length };
        const newPlayerState = { ...state[actor], hand: newHand, discard: newDiscard, stats: newStats };

        let newState = {
            ...state,
            [actor]: newPlayerState,
            stats: {
                ...state.stats,
                [actor]: newStats,
            }
        };

        // Log the discard
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        if (actor === 'player' || discardedCards.every(c => c.isRevealed)) {
            const cardNames = discardedCards.map(c => `${c.protocol}-${c.value}`).join(', ');
            newState = log(newState, actor, `${actorName} discards entire hand (${discardedCards.length} cards: ${cardNames}).`);
        } else {
            newState = log(newState, actor, `${actorName} discards entire hand (${discardedCards.length} cards).`);
        }

        // Store context for follow-up effects (like Chaos-4's draw)
        (newState as any)._discardContext = {
            actor,
            discardedCount: discardedCards.length,
            previousHandSize: handCards.length,
            sourceCardId: card.id,
        };

        return { newState };
    }

    // NOTE: Optional handling is now done centrally in executeCustomEffect
    // No need for special optional logic here anymore

    let newState = { ...state };

    // Log partial discard info (before the action is set)
    if (willLogPartialDiscard) {
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, actor, `${actorName} only has ${count} card${count !== 1 ? 's' : ''} (${requestedCount} required) - discarding all.`);
    }

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

    // NEW: shiftSelf parameter - this card shifts itself (Speed-2, Spirit-3)
    // This bypasses all target filtering and directly shifts the source card
    if (params.shiftSelf) {
        newState.actionRequired = {
            type: 'shift_flipped_card_optional',
            cardId: card.id,
            sourceCardId: card.id,
            optional: params.optional || false,
            actor: cardOwner,
            allowCovered: params.allowCoveredSelf || false,  // Speed-2: can shift even if covered
        } as any;
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

    // NEW: Handle selectLane (Water-3: "Return all cards with a value of 2 in 1 line")
    // User first selects a lane, then all matching cards in that lane are returned
    if (params.selectLane) {
        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_lane_for_return',
            sourceCardId: card.id,
            actor: cardOwner,
            count: params.count,
            targetFilter: params.targetFilter,
        } as any;

        return { newState };
    }

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

    let newState = { ...state };

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
    const { cardOwner, opponent } = context;
    const count = params.count || 1;
    const source = params.source || 'hand';
    // CRITICAL: Only set faceDown if explicitly defined in params
    // If undefined, the resolver will use normal game rules (face-down if not matching protocol)
    const faceDown = params.faceDown; // Can be true, false, or undefined
    const actor = params.actor === 'opponent' ? opponent : cardOwner;

    // CRITICAL: Water-1 logic - Automatic play from deck to each other line
    // If playing from deck with each_other_line, play automatically WITHOUT user interaction
    if (source === 'deck' && params.destinationRule?.type === 'each_other_line') {
        const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
        if (otherLaneIndices.length === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            let newState = log(state, cardOwner, `[Custom Play effect] ${actor} has no cards in deck/discard - skipping.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, otherLaneIndices.length);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play (face-down)
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: false }));

        // Add cards to lanes
        const newPlayerLanes = [...playerState.lanes];
        for (let i = 0; i < newCardsToPlay.length; i++) {
            const targetLaneIndex = otherLaneIndices[i];
            newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCardsToPlay[i]];
        }

        const updatedPlayerState = {
            ...playerState,
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...state,
            [actor]: updatedPlayerState
        };

        // Generic log message (not card-specific!)
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down in other lines.`);
        return { newState };
    }

    // NEW: Life-0 logic - Automatic play from deck to "each line where you/opponent have a card"
    if (source === 'deck' && params.destinationRule?.type === 'each_line_with_card') {
        const ownerFilter = params.destinationRule.ownerFilter || 'any';
        const playerToCheck = ownerFilter === 'own' ? actor :
                             ownerFilter === 'opponent' ? (actor === 'player' ? 'opponent' : 'player') :
                             null;

        // Find all lanes where the specified player has cards
        const lanesWithCards: number[] = [];
        for (let i = 0; i < 3; i++) {
            if (playerToCheck) {
                // Check specific player's lanes
                if (state[playerToCheck].lanes[i].length > 0) {
                    lanesWithCards.push(i);
                }
            } else {
                // Check if ANY player has a card in this lane
                if (state.player.lanes[i].length > 0 || state.opponent.lanes[i].length > 0) {
                    lanesWithCards.push(i);
                }
            }
        }

        if (lanesWithCards.length === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            let newState = log(state, cardOwner, `[Custom Play effect] ${actor} has no cards in deck/discard - skipping.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, lanesWithCards.length);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play (face-down)
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: !faceDown }));

        // Execute on-cover effects for covered cards before playing
        let stateAfterOnCover = state;
        const onCoverAnimations: AnimationRequest[] = [];

        for (let i = 0; i < lanesWithCards.length; i++) {
            const targetLaneIndex = lanesWithCards[i];
            const lane = stateAfterOnCover[actor].lanes[targetLaneIndex];

            if (lane.length > 0) {
                const cardToBeCovered = lane[lane.length - 1];
                const coverContext: EffectContext = {
                    ...context,
                    triggerType: 'cover'
                };
                const onCoverResult = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateAfterOnCover, coverContext);
                stateAfterOnCover = onCoverResult.newState;
                if (onCoverResult.animationRequests) {
                    onCoverAnimations.push(...onCoverResult.animationRequests);
                }
                if (stateAfterOnCover.actionRequired) {
                    break;
                }
            }
        }

        // Add cards to lanes
        const newPlayerLanes = [...stateAfterOnCover[actor].lanes];
        const playAnimations: AnimationRequest[] = [];

        for (let i = 0; i < newCardsToPlay.length; i++) {
            const targetLaneIndex = lanesWithCards[i];
            newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCardsToPlay[i]];

            // Add play animation for each card
            playAnimations.push({
                type: 'play',
                cardId: newCardsToPlay[i].id,
                owner: actor
            });
        }

        const updatedPlayerState = {
            ...stateAfterOnCover[actor],
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...stateAfterOnCover,
            [actor]: updatedPlayerState
        };

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        const ownerText = ownerFilter === 'own' ? 'where you have a card' :
                         ownerFilter === 'opponent' ? 'where opponent has a card' :
                         'with a card';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down in each line ${ownerText}.`);

        // Combine all animations: on_cover animations first, then play animations
        const allAnimations = [...onCoverAnimations, ...playAnimations];

        return {
            newState,
            animationRequests: allAnimations.length > 0 ? allAnimations : undefined
        };
    }

    // NEW: Life-3 logic - Prompt user to select "another line" to play from deck
    if (source === 'deck' && params.destinationRule?.type === 'another_line') {
        console.log(`[another_line] Life-3 triggered! laneIndex=${laneIndex}, source=${source}`);
        const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
        console.log(`[another_line] Other lane indices: ${otherLaneIndices}`);
        if (otherLaneIndices.length === 0) {
            console.log(`[another_line] No other lanes available!`);
            return { newState: state };
        }

        // CRITICAL: Prompt user to select a lane (not automatic!)
        let newState = log(state, cardOwner, `[Custom Play effect - select another line to play]`);
        newState.actionRequired = {
            type: 'select_lane_for_play',
            sourceCardId: card.id,
            actor,
            count: params.count || 1,
            isFaceDown: params.faceDown,  // CRITICAL: Must be isFaceDown, not faceDown!
            excludeCurrentLane: true,  // Life-3: Can't select the current lane
            currentLaneIndex: laneIndex,  // Track which lane to exclude
            source: params.source,  // 'deck'
        } as any;

        console.log(`[another_line] Created prompt for user to select lane`);
        return { newState };
    }

    // NEW: Gravity-0 logic - Conditional play "For every X cards in this line, play from deck under this card"
    if (source === 'deck' && params.destinationRule?.type === 'under_this_card' && params.condition?.type === 'per_x_cards_in_line') {
        const cardCount = params.condition.cardCount || 2;

        // Calculate total cards in this line (both players)
        const cardsInPlayerLane = state[cardOwner].lanes[laneIndex].length;
        const cardsInOpponentLane = state[opponent].lanes[laneIndex].length;
        const totalCardsInLine = cardsInPlayerLane + cardsInOpponentLane;

        // Calculate how many cards to play (totalCards / cardCount, rounded down)
        const cardsToPlayCount = Math.floor(totalCardsInLine / cardCount);

        if (cardsToPlayCount === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            return { newState: state };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, cardsToPlayCount);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play (face-down)
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: false }));

        // Add cards UNDER the source card (splice before the last card)
        const targetLane = [...playerState.lanes[laneIndex]];
        targetLane.splice(targetLane.length - 1, 0, ...newCardsToPlay);

        const newPlayerLanes = [...playerState.lanes];
        newPlayerLanes[laneIndex] = targetLane;

        const updatedPlayerState = {
            ...playerState,
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...state,
            [actor]: updatedPlayerState
        };

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down under itself.`);
        return { newState };
    }

    // NEW: Gravity-6 logic - Automatic play from deck to specific lane
    // Resolve laneIndex: 'current' to actual lane number
    if (source === 'deck' && params.destinationRule?.type === 'specific_lane') {
        const resolvedLaneIndex = params.destinationRule.laneIndex === 'current'
            ? laneIndex
            : params.destinationRule.laneIndex;

        if (resolvedLaneIndex === undefined || resolvedLaneIndex < 0 || resolvedLaneIndex > 2) {
            console.error(`[Play Effect] Invalid lane index: ${resolvedLaneIndex}`);
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            let newState = log(state, cardOwner, `[Custom Play effect] ${actor} has no cards in deck/discard - skipping.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, count);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: !faceDown }));

        // Add cards to the specific lane
        const newPlayerLanes = [...playerState.lanes];
        newPlayerLanes[resolvedLaneIndex] = [...newPlayerLanes[resolvedLaneIndex], ...newCardsToPlay];

        const updatedPlayerState = {
            ...playerState,
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...state,
            [actor]: updatedPlayerState
        };

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        const faceText = faceDown ? 'face-down' : 'face-up';
        const protocolName = state.player.protocols[resolvedLaneIndex];
        newState = log(newState, cardOwner, `${sourceCardName}: ${actorName} plays ${drawnCards.length} card(s) ${faceText} in ${protocolName} line.`);
        return { newState };
    }

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

    // CRITICAL: Check if Frost-1 Bottom effect is active (Protocols cannot be rearranged)
    const frost1BottomActive = isFrost1BottomActive(state);
    if (frost1BottomActive && action === 'rearrange_protocols') {
        let newState = log(state, cardOwner, `Protocols cannot be rearranged (Frost-1 bottom effect is active).`);
        return { newState };
    }

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
    const { cardOwner, opponent } = context;
    const count = params.count || 1;
    const action = params.action;
    const source = params.source || 'own_hand';

    // NEW: Handle board card reveal (Light-2: "Reveal 1 face-down card. You may shift or flip that card.")
    if (action === 'reveal' && source === 'board') {
        const targetFilter = params.targetFilter || { owner: 'any', position: 'uncovered', faceState: 'face_down' };
        const followUpAction = params.followUpAction;  // 'flip' | 'shift' | undefined
        const optional = params.optional !== false;  // Default true

        // Find all valid target cards
        const validTargets: PlayedCard[] = [];
        const players = targetFilter.owner === 'own' ? [cardOwner]
                      : targetFilter.owner === 'opponent' ? [opponent]
                      : [cardOwner, opponent];

        for (const p of players) {
            for (let li = 0; li < state[p].lanes.length; li++) {
                const lane = state[p].lanes[li];
                if (lane.length > 0) {
                    // Filter by position
                    let cardsToCheck: PlayedCard[] = [];
                    if (targetFilter.position === 'uncovered') {
                        cardsToCheck = [lane[lane.length - 1]];
                    } else if (targetFilter.position === 'covered') {
                        cardsToCheck = lane.slice(0, -1);
                    } else {
                        cardsToCheck = [...lane];
                    }

                    // Filter by faceState
                    const filtered = cardsToCheck.filter(c => {
                        if (targetFilter.faceState === 'face_up') return c.isFaceUp;
                        if (targetFilter.faceState === 'face_down') return !c.isFaceUp;
                        return true;  // 'any'
                    });

                    validTargets.push(...filtered);
                }
            }
        }

        if (validTargets.length === 0) {
            let newState = log(state, cardOwner, `No valid cards to reveal. Effect skipped.`);
            return { newState };
        }

        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_board_card_to_reveal_custom',
            sourceCardId: card.id,
            actor: cardOwner,
            targetFilter,  // CRITICAL: Pass targetFilter to UI for card highlighting
            followUpAction,
            optional,
        } as any;

        return { newState };
    }

    // NEW: Handle opponent_hand reveal (Light-4: "Your opponent reveals their hand")
    if (action === 'reveal' && source === 'opponent_hand') {
        let newState = { ...state };
        const opponentState = { ...newState[opponent] };

        if (opponentState.hand.length > 0) {
            // Mark all opponent's cards as revealed (count -1 = all cards)
            opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
            newState[opponent] = opponentState;

            const cardName = `${card.protocol}-${card.value}`;
            newState = log(newState, cardOwner, `${cardName}: Your opponent reveals their hand.`);
        } else {
            const cardName = `${card.protocol}-${card.value}`;
            newState = log(newState, cardOwner, `${cardName}: Opponent has no cards to reveal.`);
        }

        // This effect resolves immediately
        return { newState };
    }

    // CRITICAL: Check if player has any cards in hand (for own_hand reveal/give)
    if (state[cardOwner].hand.length === 0) {
        let newState = log(state, cardOwner, `No cards in hand to ${action}. Effect skipped.`);
        return { newState };
    }

    let newState = { ...state };

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
 * Love-3: "Take 1 random card from your opponent's hand."
 *
 * Parameters:
 * - count: number of cards to take (default 1)
 * - random: if true (default), takes random card(s) immediately without user selection
 *           if false, requires user to select which card(s) to take (NOT YET IMPLEMENTED)
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

    let newState = { ...state };
    const opponentState = { ...newState[opponent] };
    const cardOwnerState = { ...newState[cardOwner] };

    if (random) {
        // Random take - execute immediately (like original Love-3)
        const actualCount = Math.min(count, opponentState.hand.length);
        const takenCards: any[] = [];

        for (let i = 0; i < actualCount; i++) {
            const randomIndex = Math.floor(Math.random() * opponentState.hand.length);
            const takenCard = opponentState.hand.splice(randomIndex, 1)[0];
            cardOwnerState.hand.push(takenCard);
            takenCards.push(takenCard);
        }

        newState = {
            ...newState,
            [cardOwner]: cardOwnerState,
            [opponent]: opponentState,
        };

        const actorName = cardOwner === 'player' ? 'Player' : 'Opponent';
        const cardName = `${card.protocol}-${card.value}`;

        // Log taken cards - only reveal to player if they took the card
        const takenCardNames = takenCards.map(c =>
            cardOwner === 'player' ? `${c.protocol}-${c.value}` : 'a card'
        ).join(', ');

        newState = log(newState, cardOwner, `${cardName}: ${actorName} takes ${takenCardNames} from the opponent's hand.`);

        return { newState };
    } else {
        // Non-random take - requires user selection (future feature)
        // For now, fall back to random behavior
        console.warn('[Take Effect] Non-random take not yet implemented, falling back to random');

        const randomIndex = Math.floor(Math.random() * opponentState.hand.length);
        const takenCard = opponentState.hand.splice(randomIndex, 1)[0];
        cardOwnerState.hand.push(takenCard);

        newState = {
            ...newState,
            [cardOwner]: cardOwnerState,
            [opponent]: opponentState,
        };

        const actorName = cardOwner === 'player' ? 'Player' : 'Opponent';
        const cardName = `${card.protocol}-${card.value}`;
        const takenCardName = cardOwner === 'player' ? `${takenCard.protocol}-${takenCard.value}` : 'a card';

        newState = log(newState, cardOwner, `${cardName}: ${actorName} takes ${takenCardName} from the opponent's hand.`);

        return { newState };
    }
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
 * Execute BLOCK_COMPILE effect (Metal-1: Your opponent cannot compile next turn)
 */
function executeBlockCompileEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const target = params.target || 'opponent';
    const targetPlayer = target === 'opponent' ? opponent : cardOwner;

    // Set cannotCompile flag on target player
    const targetState = { ...state[targetPlayer], cannotCompile: true };
    let newState = { ...state, [targetPlayer]: targetState };

    const sourceCardInfo = findCardOnBoard(state, card.id);
    const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Effect';
    const targetName = targetPlayer === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, cardOwner, `${sourceCardName}: ${targetName} cannot compile next turn.`);

    return { newState };
}

/**
 * Execute DELETE_ALL_IN_LANE effect (Metal-3: Delete all cards in 1 other line with 8 or more cards)
 */
function executeDeleteAllInLaneEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const excludeCurrentLane = params.excludeCurrentLane !== false;
    const minCards = params.laneCondition?.count || 8;

    // Find lanes that meet the condition
    const validLanes: number[] = [];
    for (let i = 0; i < 3; i++) {
        if (excludeCurrentLane && i === laneIndex) continue;
        const totalCards = state.player.lanes[i].length + state.opponent.lanes[i].length;
        if (totalCards >= minCards) {
            validLanes.push(i);
        }
    }

    if (validLanes.length === 0) {
        // No lanes meet the condition - skip effect with log message
        const sourceCardName = `${card.protocol}-${card.value}`;
        let newState = log(state, cardOwner, `${sourceCardName}: No line has ${minCards} or more cards. Effect skipped.`);
        return { newState };
    }

    // Set actionRequired for player to select a lane
    let newState = { ...state };
    newState.actionRequired = {
        type: 'select_lane_for_delete_all',
        sourceCardId: card.id,
        actor: cardOwner,
        validLanes,
        minCards,
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
): { drawnCards: any[]; remainingDeck: any[]; newCards: any[] } {
    const actualDrawCount = Math.min(count, deck.length);
    // Convert deck cards to PlayedCard objects with unique IDs
    const newCards = deck.slice(0, actualDrawCount).map(c => ({
        ...c,
        id: uuidv4(),
        isFaceUp: true
    }));
    const drawnCards = [...hand, ...newCards];
    const remainingDeck = deck.slice(actualDrawCount);
    return { drawnCards, remainingDeck, newCards };
}

