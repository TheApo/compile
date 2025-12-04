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

// Import modular effect executors (replacing local implementations)
import { executeDrawEffect } from '../effects/actions/drawExecutor';
import { executeFlipEffect } from '../effects/actions/flipExecutor';
import { executeDeleteEffect } from '../effects/actions/deleteExecutor';
import { executeDiscardEffect } from '../effects/actions/discardExecutor';
import { executeShiftEffect } from '../effects/actions/shiftExecutor';
import { executeReturnEffect } from '../effects/actions/returnExecutor';
import { executePlayEffect } from '../effects/actions/playExecutor';
import { executeRevealGiveEffect } from '../effects/actions/revealGiveExecutor';

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

