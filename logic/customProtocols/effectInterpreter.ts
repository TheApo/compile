/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player, AnimationRequest } from '../../types';
import { EffectDefinition } from '../../types/customProtocol';
import { log } from '../utils/log';
import { v4 as uuidv4 } from 'uuid';
import { findCardOnBoard, isCardUncovered, handleUncoverEffect, internalShiftCard, countUniqueProtocolsOnField, countFaceUpProtocolCardsOnField, hasOtherFaceUpSameProtocolCard } from '../game/helpers/actionUtils';
import { drawCards } from '../../utils/gameStateModifiers';
import { processReactiveEffects } from '../game/reactiveEffectProcessor';
import { isFrost1Active, isFrost1BottomActive, canPlayerDraw } from '../game/passiveRuleChecker';
import { executeOnCoverEffect } from '../effectExecutor';
import { getEffectiveCardValue, getOpponentHighestValueLanes } from '../game/stateManager';

// Import modular effect executors (replacing local implementations)
import { executeDrawEffect } from '../effects/actions/drawExecutor';
import { executeFlipEffect } from '../effects/actions/flipExecutor';
import { executeDeleteEffect } from '../effects/actions/deleteExecutor';
import { executeDiscardEffect } from '../effects/actions/discardExecutor';
import { executeShiftEffect } from '../effects/actions/shiftExecutor';
import { executeReturnEffect } from '../effects/actions/returnExecutor';
import { executePlayEffect } from '../effects/actions/playExecutor';
import { executeRevealGiveEffect } from '../effects/actions/revealGiveExecutor';
import { executeShuffleTrashEffect, executeShuffleDeckEffect } from '../effects/actions/shuffleExecutor';
import { executeStateNumberEffect } from '../effects/actions/stateNumberExecutor';
import { executeStateProtocolEffect } from '../effects/actions/stateProtocolExecutor';
import { executeSwapStacksEffect } from '../effects/actions/swapStacksExecutor';
import { executeCopyOpponentMiddleEffect } from '../effects/actions/copyEffectExecutor';

/**
 * Execute AUTO_COMPILE effect (Diversity-0)
 * Marks the lane as compiled WITHOUT deleting cards - they stay on the board.
 * This is different from normal compile which moves cards to trash.
 */
function executeAutoCompileEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    let newState = { ...state };

    // Check protocolCountConditional (Diversity-0: "If there are 6 different protocols on cards in the field")
    if (params.protocolCountConditional?.type === 'unique_protocols_on_field') {
        const threshold = params.protocolCountConditional.threshold;
        const protocolCount = countUniqueProtocolsOnField(state);

        if (protocolCount < threshold) {
            // Condition NOT met (not enough protocols on field) - skip compile
            newState = log(newState, cardOwner, `Not enough different protocols on field (${protocolCount}/${threshold}). Effect skipped.`);
            return { newState };
        }

        // Condition met - proceed with compile
        newState = log(newState, cardOwner, `${protocolCount} different protocols on field. Protocol compiled!`);
    } else if (params.protocolCountConditional?.type === 'same_protocol_count_on_field') {
        // Unity-1: "If there are 5 or more face-up Unity cards in the field"
        // CRITICAL: Only count FACE-UP cards!
        const threshold = params.protocolCountConditional.threshold;
        const sameProtocolCount = countFaceUpProtocolCardsOnField(state, card.protocol);

        if (sameProtocolCount < threshold) {
            // Condition NOT met - skip compile
            newState = log(newState, cardOwner, `Not enough face-up ${card.protocol} cards on field (${sameProtocolCount}/${threshold}). Effect skipped.`);
            return { newState };
        }

        // Condition met - proceed with compile
        newState = log(newState, cardOwner, `${sameProtocolCount} face-up ${card.protocol} cards on field. Protocol compiled!`);
    }

    // Mark the lane as compiled - but DO NOT move cards to trash!
    // Cards stay on the board
    if (!newState[cardOwner].compiled[laneIndex]) {
        newState[cardOwner] = {
            ...newState[cardOwner],
            compiled: [
                ...newState[cardOwner].compiled.slice(0, laneIndex),
                true,
                ...newState[cardOwner].compiled.slice(laneIndex + 1)
            ]
        };

        // Update stats
        const newStats = {
            ...newState.stats[cardOwner],
            protocolsCompiled: newState.stats[cardOwner].protocolsCompiled + 1
        };
        newState = {
            ...newState,
            stats: { ...newState.stats, [cardOwner]: newStats }
        };
    }

    // CRITICAL: Handle deleteAllInLane (Unity-1: "compile this protocol and delete all cards in this line")
    if (params.deleteAllInLane) {
        // Delete ALL cards in this lane (both player's and opponent's)
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';

        // Get all cards in the lane before deleting
        const playerCardsInLane = [...newState[cardOwner].lanes[laneIndex]];
        const opponentCardsInLane = [...newState[opponent].lanes[laneIndex]];

        // Move cards to discard (delete = move to trash)
        const playerCardsToDiscard = playerCardsInLane.map(({ id, isFaceUp, ...c }) => c);
        const opponentCardsToDiscard = opponentCardsInLane.map(({ id, isFaceUp, ...c }) => c);

        // Update both players' lanes and discard piles
        newState = {
            ...newState,
            [cardOwner]: {
                ...newState[cardOwner],
                lanes: [
                    ...newState[cardOwner].lanes.slice(0, laneIndex),
                    [], // Empty the lane
                    ...newState[cardOwner].lanes.slice(laneIndex + 1)
                ],
                discard: [...newState[cardOwner].discard, ...playerCardsToDiscard]
            },
            [opponent]: {
                ...newState[opponent],
                lanes: [
                    ...newState[opponent].lanes.slice(0, laneIndex),
                    [], // Empty the lane
                    ...newState[opponent].lanes.slice(laneIndex + 1)
                ],
                discard: [...newState[opponent].discard, ...opponentCardsToDiscard]
            }
        };

        // Log the deletion
        const totalDeleted = playerCardsInLane.length + opponentCardsInLane.length;
        if (totalDeleted > 0) {
            newState = log(newState, cardOwner, `All ${totalDeleted} cards in this line deleted.`);
        }
    }

    return { newState };
}

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
    // CRITICAL: Include conditional info in params for ALL effects
    // This enables "If you do" patterns like Death-1, Speed-3, etc.
    const params = {
        ...effectDef.params as any,
        _conditional: effectDef.conditional  // Pass conditional for followUpEffect handling
    };
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
    // EXCEPTION: useCardFromPreviousEffect effects target a specific card (e.g., deck top), not the board
    const position = effectDef.position || 'middle';
    const trigger = effectDef.trigger;
    const isOnCoverTrigger = trigger === 'on_cover';
    const usesCardFromPreviousEffect = params.useCardFromPreviousEffect === true;
    const requiresUncovered = position !== 'top' && !isOnCoverTrigger && !usesCardFromPreviousEffect;

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
                // CRITICAL: If useCardFromPreviousEffect is set, we're discarding a specific card
                // (e.g., from deck for Clarity-1), NOT from hand - so skip the hand check
                if (!params.useCardFromPreviousEffect && state[actor].hand.length === 0) {
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
                } else if (params.shiftSelf && params.destinationRestriction?.type === 'opponent_highest_value_lane') {
                    // Courage-3: "Shift this card to opponent's highest value lane"
                    // Skip if already in that lane
                    const validLanes = getOpponentHighestValueLanes(state, context.cardOwner);
                    if (validLanes.includes(laneIndex)) {
                        canExecute = false;
                        skipReason = 'Card is already in opponent\'s highest value lane';
                    }
                } else if (params.advancedConditional?.type === 'this_card_is_covered') {
                    // Ice-3: "If this card is covered, you may shift it"
                    // Check if the card is actually covered (not the topmost card in lane)
                    const ownerLanes = state[context.cardOwner].lanes;
                    let isCardCovered = false;
                    for (let i = 0; i < ownerLanes.length; i++) {
                        const lane = ownerLanes[i];
                        const cardIndex = lane.findIndex(c => c.id === card.id);
                        if (cardIndex !== -1) {
                            isCardCovered = cardIndex < lane.length - 1;
                            break;
                        }
                    }
                    if (!isCardCovered) {
                        canExecute = false;
                        skipReason = 'Card is not covered';
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
            let newState = log(state, actor, `${skipReason} - effect skipped.`);
            // Mark effect as not executed for if_executed conditionals
            (newState as any)._effectSkippedNoTargets = true;
            if (action === 'discard') {
                (newState as any)._discardContext = { discardedCount: 0 };
            }
            return { newState };
        }

        let newState = { ...state };
        // GENERIC: Create prompt_optional_effect for ALL optional actions
        // The effectDef contains the full effect definition including any conditionals
        newState.actionRequired = {
            type: 'prompt_optional_effect',
            actor: context.cardOwner,
            sourceCardId: card.id,
            // Store the complete effect definition for later execution
            effectDef: effectDef,
            // Store laneIndex for later execution
            laneIndex: laneIndex,
            // Preserve log context for proper indentation/phase
            logSource: state._currentEffectSource,
            logPhase: state._currentPhaseContext,
            logIndentLevel: state._logIndentLevel || 0,
        } as any;
        return { newState };
    }

    let result: EffectResult;

    // Store current log context for later propagation to actionRequired
    const currentLogContext = {
        logSource: state._currentEffectSource,
        logPhase: state._currentPhaseContext,
        logIndentLevel: state._logIndentLevel || 0,
    };

    switch (action) {
        case 'refresh': {
            // Spirit-0: Refresh hand to 5 cards
            // FIX: Check params.target to determine who refreshes (Test-3: "your opponent refreshes")
            const target = params.target || 'self';
            const actor = target === 'opponent' ? context.opponent : context.actor;

            // NEW: Check if player can draw (Ice-6: block_draw_conditional)
            // Refresh is a form of drawing, so the same restriction applies
            const refreshDrawCheck = canPlayerDraw(state, actor);
            if (!refreshDrawCheck.allowed) {
                let newState = log(state, context.cardOwner, refreshDrawCheck.reason || 'Cannot refresh (draw blocked).');
                result = { newState };
                break;
            }

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
                    },
                    // Set animationState for draw animation
                    animationState: { type: 'drawCard' as const, owner: actor, cardIds: newHandCards.map(c => c.id) }
                };

                // Only show card names to the player who drew them
                const cardNamesRefresh = actor === 'player'
                    ? ` (${drawnCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
                    : '';
                newState = log(newState, actor, `[Refresh] Drew ${drawnCards.length} cards to reach hand size 5${cardNamesRefresh}.`);

                // CRITICAL: Trigger reactive effects after draw (Spirit-3)
                const reactiveResult = processReactiveEffects(newState, 'after_draw', { player: actor, count: drawnCards.length });
                newState = reactiveResult.newState;

                // CRITICAL: Trigger reactive effects after refresh (Assimilation-1, War-0)
                // Pass the actor who refreshed so reactiveTriggerActor can filter correctly
                const refreshReactiveResult = processReactiveEffects(newState, 'after_refresh', { player: actor });
                newState = refreshReactiveResult.newState;

                result = { newState };
            } else {
                // Hand already has 5+ cards, no need to draw
                let newState = log(state, actor, `[Refresh] Hand already at ${currentHandSize} cards, no draw needed.`);

                // CRITICAL: Still trigger after_refresh even when no cards were drawn
                // The refresh action happened, even if hand was already full
                const refreshReactiveResult = processReactiveEffects(newState, 'after_refresh', { player: actor });
                newState = refreshReactiveResult.newState;

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
                        },
                        // Set animationState for draw animation (actor draws from opponent's deck)
                        animationState: { type: 'drawCard' as const, owner: actor, cardIds: newHandCards.map(c => c.id) }
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
                        },
                        // Set animationState for draw animation (opponent draws from actor's deck)
                        animationState: { type: 'drawCard' as const, owner: opponent, cardIds: newHandCards.map(c => c.id) }
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
            // CRITICAL: Pass useCardFromPreviousEffect from effectDef (it's not in params!)
            // CRITICAL: Pass _conditional for follow-up effects (Mirror-3: "Flip 1 of your cards. Flip 1 opponent's in same lane")
            result = executeFlipEffect(card, laneIndex, state, context, {
                ...params,
                useCardFromPreviousEffect: effectDef.useCardFromPreviousEffect,
                _conditional: effectDef.conditional
            });
            break;

        case 'delete':
            // CRITICAL: Pass _conditional for follow-up effects (Death-1: "delete other, then delete self")
            result = executeDeleteEffect(card, laneIndex, state, context, {
                ...params,
                _conditional: effectDef.conditional
            });
            break;

        case 'discard':
            // CRITICAL: Pass _conditional for follow-up effects (Plague-2: "Discard X. Your opponent discards X+1")
            result = executeDiscardEffect(card, laneIndex, state, context, {
                ...params,
                _conditional: effectDef.conditional
            });
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

        case 'shuffle_trash':
            result = executeShuffleTrashEffect(card, laneIndex, state, context, params);
            break;

        case 'shuffle_deck':
            result = executeShuffleDeckEffect(card, laneIndex, state, context, params);
            break;

        case 'state_number':
            result = executeStateNumberEffect(card, laneIndex, state, context, params);
            break;

        case 'state_protocol':
            result = executeStateProtocolEffect(card, laneIndex, state, context, params);
            break;

        case 'swap_stacks':
            result = executeSwapStacksEffect(card, laneIndex, state, context, params);
            break;

        case 'copy_opponent_middle':
            result = executeCopyOpponentMiddleEffect(card, laneIndex, state, context, params);
            break;

        case 'auto_compile':
            result = executeAutoCompileEffect(card, laneIndex, state, context, params);
            break;

        default:
            console.error(`[Custom Effect] Unknown action: ${action}`);
            result = { newState: state };
            break;
    }

    // CRITICAL: Propagate log context to actionRequired for proper indentation/phase in resolvers
    // This ensures that when a user action is resolved, the log context can be restored
    if (result.newState.actionRequired && !result.newState.actionRequired.logSource) {
        result = {
            ...result,
            newState: {
                ...result.newState,
                actionRequired: {
                    ...result.newState.actionRequired,
                    logSource: currentLogContext.logSource,
                    logPhase: currentLogContext.logPhase,
                    logIndentLevel: currentLogContext.logIndentLevel,
                }
            }
        };
    }

    // Handle conditional follow-up effects
    if (effectDef.conditional && effectDef.conditional.thenEffect) {
        const { newState } = result;

        console.log('[EFFECT INTERPRETER DEBUG] ===== CONDITIONAL DETECTED =====');
        console.log('[EFFECT INTERPRETER DEBUG] conditional.type:', effectDef.conditional.type);
        console.log('[EFFECT INTERPRETER DEBUG] conditional.thenEffect:', effectDef.conditional.thenEffect);
        console.log('[EFFECT INTERPRETER DEBUG] newState.actionRequired:', newState.actionRequired?.type);
        console.log('[EFFECT INTERPRETER DEBUG] card:', `${card.protocol}-${card.value}`);

        if (newState.actionRequired) {
            // Store the conditional for later execution (after user completes the action)

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
            console.log('[EFFECT INTERPRETER DEBUG] followUpEffect ATTACHED to actionRequired');
            result = { newState: stateWithFollowUp };
        } else {
            // Effect completed immediately - check if we should execute conditional now

            // CRITICAL FIX: For "if_executed" conditionals, check if the effect actually did something
            // This handles "Discard 1. If you do, delete 1" when player has no cards to discard
            if (effectDef.conditional.type === 'if_executed') {
                // Check if a discard actually happened
                const discardContext = (newState as any)._discardContext;
                const discardedCount = discardContext?.discardedCount || 0;

                if (discardedCount === 0) {
                    // Clean up and return without executing follow-up
                    delete (newState as any)._discardContext;
                    result = { newState };
                    return result;
                }
            }

            // NEW: For "if_protocol_matches_stated" conditionals (Luck-3)
            // Check if the discarded card's protocol matches the stated protocol
            if (effectDef.conditional.type === 'if_protocol_matches_stated') {
                const discardContext = (newState as any)._discardContext;
                const discardedCardProtocol = discardContext?.discardedCardProtocol;
                const statedProtocol = newState.lastStatedProtocol;

                if (!statedProtocol || !discardedCardProtocol || discardedCardProtocol !== statedProtocol) {
                    // Protocol doesn't match - skip the follow-up effect
                    let skipState = log(newState, context.cardOwner, `Discarded card does not match stated protocol "${statedProtocol || 'none'}". Effect skipped.`);
                    // Clean up
                    delete (skipState as any)._discardContext;
                    result = { newState: skipState };
                    return result;
                }

                // Protocol matches! Log and continue to execute the thenEffect
                let matchState = log(newState, context.cardOwner, `Discarded card matches stated protocol "${statedProtocol}"!`);
                delete (matchState as any)._discardContext;
                result = { newState: matchState };
            }

            // NEW: For 'optional' conditionals, create a prompt instead of executing immediately
            if (effectDef.conditional.type === 'optional') {
                let promptState = { ...newState };
                promptState.actionRequired = {
                    type: 'prompt_optional_effect',
                    actor: context.cardOwner,
                    sourceCardId: card.id,
                    effectDef: effectDef.conditional.thenEffect,
                    laneIndex: laneIndex,
                    // CRITICAL: Preserve the target card ID for useCardFromPreviousEffect
                    savedTargetCardId: newState.lastCustomEffectTargetCardId,
                } as any;
                result = { newState: promptState };
                return result;
            }


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
            }

            result = executeCustomEffect(card, laneIndex, newState, enrichedContext, effectDef.conditional.thenEffect);
        }
    }

    return result;
}

// NOTE: executeDrawEffect moved to ../effects/actions/drawExecutor.ts
// NOTE: executeFlipEffect moved to ../effects/actions/flipExecutor.ts
// NOTE: executeDeleteEffect moved to ../effects/actions/deleteExecutor.ts
// NOTE: executeDiscardEffect moved to ../effects/actions/discardExecutor.ts
// NOTE: executeShiftEffect moved to ../effects/actions/shiftExecutor.ts
// NOTE: executeReturnEffect moved to ../effects/actions/returnExecutor.ts
// NOTE: executePlayEffect moved to ../effects/actions/playExecutor.ts

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

    let newState = { ...state };

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

// NOTE: executeRevealGiveEffect moved to ../effects/actions/revealGiveExecutor.ts

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

    // Check advancedConditional - same_protocol_on_field (Unity-0)
    if (params.advancedConditional?.type === 'same_protocol_on_field') {
        if (!hasOtherFaceUpSameProtocolCard(state, card)) {
            // No other face-up same-protocol card - skip choice effect
            return { newState: state };
        }
    }

    if (options.length !== 2) {
        console.error(`[Choice Effect] Expected 2 options, got ${options.length}`);
        return { newState: state };
    }

    let newState = { ...state };

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

