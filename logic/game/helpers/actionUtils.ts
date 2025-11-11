/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, EffectResult, EffectContext } from "../../../types";
import { findAndFlipCards } from "../../../utils/gameStateModifiers";
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent, completeEffectAction } from "../../utils/log";
import { recalculateAllLaneValues, getEffectiveCardValue } from "../stateManager";
import { executeOnCoverEffect, executeOnPlayEffect } from '../../effectExecutor';
import { canFlipCard, canShiftCard } from '../passiveRuleChecker';
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';

export function findCardOnBoard(state: GameState, cardId: string | undefined): { card: PlayedCard, owner: Player } | null {
    if (!cardId) return null;
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            const card = lane.find(c => c.id === cardId);
            if (card) return { card, owner: p };
        }
    }
    return null;
}

/**
 * Check if a card is UNCOVERED (top card in its lane).
 * Returns true only if the card is on top of its lane (not covered by another card).
 */
export function isCardUncovered(state: GameState, cardId: string | undefined): boolean {
    if (!cardId) return false;
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            if (lane.length > 0 && lane[lane.length - 1].id === cardId) {
                return true; // Card is on top of this lane
            }
        }
    }
    return false; // Card not found or is covered
}

/**
 * Handle follow-up effects after flip completes (similar to handleChainedEffectsOnDiscard)
 * For effects like "Flip 1 card. Draw cards equal to that card's value" (Light-0)
 */
export function handleChainedEffectsOnFlip(state: GameState, flippedCardId: string, sourceCardId?: string): GameState {
    let newState = { ...state };

    // Save followUpEffect from custom effects before clearing actionRequired
    const followUpEffect = (state.actionRequired as any)?.followUpEffect;

    // Get the flipped card's value for context
    const flippedCardInfo = findCardOnBoard(newState, flippedCardId);
    const referencedCardValue = flippedCardInfo ? getEffectiveCardValue(flippedCardInfo.card,
        newState[flippedCardInfo.owner].lanes.find(l => l.some(c => c.id === flippedCardId)) || []) : 0;

    // Clear actionRequired
    newState.actionRequired = null;

    // Handle custom effect conditional follow-ups
    if (followUpEffect && sourceCardId) {
        const sourceCardInfo = findCardOnBoard(newState, sourceCardId);
        if (sourceCardInfo) {
            console.log('[Custom Effect] Executing conditional follow-up effect after flip');

            const context: EffectContext = {
                cardOwner: sourceCardInfo.owner,
                opponent: sourceCardInfo.owner === 'player' ? ('opponent' as Player) : ('player' as Player),
                currentTurn: newState.turn,
                actor: sourceCardInfo.owner,
                // NEW: Pass referenced card for follow-up effects
                referencedCard: flippedCardInfo?.card,
                referencedCardValue: referencedCardValue,
            };
            console.log(`[Context Propagation] Flipped card ${flippedCardInfo?.card.protocol}-${flippedCardInfo?.card.value}, value: ${referencedCardValue}`);

            // Find lane index
            let laneIndex = -1;
            for (let i = 0; i < newState[sourceCardInfo.owner].lanes.length; i++) {
                if (newState[sourceCardInfo.owner].lanes[i].some(c => c.id === sourceCardId)) {
                    laneIndex = i;
                    break;
                }
            }
            if (laneIndex !== -1) {
                const result = executeCustomEffect(sourceCardInfo.card, laneIndex, newState, context, followUpEffect);
                return result.newState;
            }
        }
    }

    return newState;
}

export function handleChainedEffectsOnDiscard(state: GameState, player: Player, sourceEffect?: 'fire_1' | 'fire_2' | 'fire_3' | 'spirit_1_start', sourceCardId?: string): GameState {
    let newState = { ...state };

    // Save followUpEffect from custom effects before clearing actionRequired
    const followUpEffect = (state.actionRequired as any)?.followUpEffect;
    const conditionalType = (state.actionRequired as any)?.conditionalType; // "if_executed" or "then"

    // CRITICAL FIX: Always clear actionRequired after discard completes, even if there's no chained effect
    newState.actionRequired = null;

    // IMPORTANT: Decrease indent after the discard action is complete
    // This closes the indentation from the middle effect
    if (sourceCardId) {
        newState = decreaseLogIndent(newState);
    }

    // Handle custom effect conditional follow-ups
    if (followUpEffect && sourceCardId) {
        const sourceCardInfo = findCardOnBoard(newState, sourceCardId);
        if (sourceCardInfo) {
            // NEW: Check if we should execute the follow-up based on conditional type
            const previousHandSize = (state.actionRequired as any)?.previousHandSize || 0;
            const currentHandSize = newState[player].hand.length;
            const discardedCount = Math.max(0, previousHandSize - currentHandSize);

            // CRITICAL: For "if_executed", only execute if at least one card was discarded
            // For "then", always execute
            const shouldExecute = conditionalType === 'then' || (conditionalType === 'if_executed' && discardedCount > 0);

            if (!shouldExecute) {
                console.log(`[Custom Effect] Skipping follow-up effect - conditional type: ${conditionalType}, discarded: ${discardedCount}`);
                return newState;
            }

            console.log(`[Custom Effect] Executing conditional follow-up effect after discard (type: ${conditionalType})`);

            const context: EffectContext = {
                cardOwner: sourceCardInfo.owner,
                opponent: sourceCardInfo.owner === 'player' ? ('opponent' as Player) : ('player' as Player),
                currentTurn: newState.turn,
                actor: player,
                // NEW: Pass discarded count for dynamic draw effects
                discardedCount: discardedCount,
                previousHandSize: previousHandSize, // For Chaos-4: draw same amount as discarded
            } as any;
            console.log(`[Context Propagation] Discarded ${discardedCount} cards, previousHandSize: ${previousHandSize}`);

            // Find lane index
            let laneIndex = -1;
            for (let i = 0; i < newState[sourceCardInfo.owner].lanes.length; i++) {
                if (newState[sourceCardInfo.owner].lanes[i].some(c => c.id === sourceCardId)) {
                    laneIndex = i;
                    break;
                }
            }
            if (laneIndex !== -1) {
                const result = executeCustomEffect(sourceCardInfo.card, laneIndex, newState, context, followUpEffect);
                return result.newState;
            }
        }
        // FIXED: Custom protocol effect was handled, return now
        return newState;
    }

    // If there's no chained effect from custom protocols, check original effects
    if (!sourceEffect || !sourceCardId) {
        return newState; // No chained effect, but actionRequired is now cleared
    }

    const sourceCard = findCardOnBoard(newState, sourceCardId)?.card;
    const sourceCardName = sourceCard ? `${sourceCard.protocol}-${sourceCard.value}` : 'A card effect';

    // FIX: If there are queued actions, we need to queue the chained effect too,
    // rather than setting it as the immediate actionRequired. This prevents
    // queued actions (like Psychic-4 flip) from being lost.
    const hasQueuedActions = newState.queuedActions && newState.queuedActions.length > 0;

    let nextAction: ActionRequired | null = null;

    switch (sourceEffect) {
        case 'fire_1':
            newState = log(newState, player, `${sourceCardName}: Discard successful. Prompting to delete 1 card.`);
            nextAction = {
                type: 'select_cards_to_delete',
                count: 1,
                sourceCardId: sourceCardId,
                disallowedIds: [sourceCardId],
                actor: player,
            };
            break;
        case 'fire_2':
            newState = log(newState, player, `${sourceCardName}: Discard successful. Prompting to return 1 card.`);
            nextAction = {
                type: 'select_card_to_return',
                sourceCardId: sourceCardId,
                actor: player,
            };
            break;
        case 'fire_3':
            newState = log(newState, player, `${sourceCardName}: Discard successful. Prompting to flip 1 card.`);
            nextAction = {
                type: 'select_card_to_flip_for_fire_3',
                sourceCardId: sourceCardId,
                actor: player,
            };
            break;
        case 'spirit_1_start':
            // No chained effect, the action is complete.
            break;
    }

    // FIX: If there are queued actions, we need to insert the chained effect BEFORE any
    // follow-up actions (like shift_flipped_card_optional) to ensure correct order.
    // Example: Fire-1 effect should be: Discard → Delete → Shift (if source still valid)
    if (nextAction) {
        if (hasQueuedActions) {
            // Split queue: chained effect goes BEFORE shift actions, but AFTER other effects
            const existingQueue = newState.queuedActions || [];
            const shiftActions = existingQueue.filter(a =>
                a.type === 'shift_flipped_card_optional' ||
                a.type === 'gravity_2_shift_after_flip'
            );
            const otherActions = existingQueue.filter(a =>
                a.type !== 'shift_flipped_card_optional' &&
                a.type !== 'gravity_2_shift_after_flip'
            );


            // Order: other effects → chained effect → shift actions
            newState.queuedActions = [...otherActions, nextAction, ...shiftActions];
        } else {
            newState.actionRequired = nextAction;
        }
    }

    return newState;
}

export function internalResolveTargetedFlip(state: GameState, targetCardId: string, nextAction: ActionRequired = null): GameState {
    const cardInfo = findCardOnBoard(state, targetCardId);
    if (!cardInfo) return state;

    const { card, owner } = cardInfo;

    // NEW: Check passive rules for flip restrictions (Frost-1, custom cards with block_flips rule)
    if (!card.isFaceUp) {
        // Find which lane the card is in
        let laneIndex = -1;
        for (let i = 0; i < state[owner].lanes.length; i++) {
            if (state[owner].lanes[i].some(c => c.id === targetCardId)) {
                laneIndex = i;
                break;
            }
        }
        if (laneIndex !== -1) {
            const flipCheck = canFlipCard(state, laneIndex);
            if (!flipCheck.allowed) {
                console.log(`Flip blocked: ${flipCheck.reason}`);
                return state; // Block the flip
            }
        }
    }

    // NEW: Trigger reactive effects BEFORE flip (Metal-6: "When this card would be flipped")
    const beforeFlipResult = processReactiveEffects(state, 'on_flip', { player: owner, cardId: targetCardId });
    let newState = beforeFlipResult.newState;

    // Check if the card still exists after on_flip effects (Metal-6 might delete itself)
    const cardAfterOnFlip = findCardOnBoard(newState, targetCardId);
    if (!cardAfterOnFlip) {
        console.log(`[on_flip] Card ${card.protocol}-${card.value} no longer exists after on_flip effect`);
        return newState; // Card was deleted by on_flip effect, abort flip
    }

    // CRITICAL FIX: Use the actor from actionRequired if available, otherwise fall back to state.turn
    // This prevents actor confusion during interrupts (e.g., when Fire-0 is uncovered during Death-0's turn)
    const actor = (newState.actionRequired && 'actor' in newState.actionRequired)
        ? newState.actionRequired.actor
        : newState.turn;

    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = owner === 'player' ? "Player's" : "Opponent's";
    const faceDirection = card.isFaceUp ? "face-down" : "face-up";
    const cardName = `${card.protocol}-${card.value}`; // Always show card name

    newState = log(newState, actor, `${actorName} flips ${ownerName} ${cardName} ${faceDirection}.`);

    const newStats = { ...newState.stats[actor], cardsFlipped: newState.stats[actor].cardsFlipped + 1 };
    const newPlayerState = { ...newState[actor], stats: newStats };
    newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

    newState = findAndFlipCards(new Set([targetCardId]), newState);
    newState.animationState = { type: 'flipCard', cardId: targetCardId };
    newState.actionRequired = nextAction;
    return newState;
}


export function handleUncoverEffect(state: GameState, owner: Player, laneIndex: number): EffectResult {
    const lane = state[owner].lanes[laneIndex];
    if (lane.length === 0) {
        return { newState: state };
    }

    const uncoveredCard = lane[lane.length - 1];

    // CRITICAL: The effect only triggers if the card is BOTH face-up AND still uncovered.
    // Check again that the card is still on top (it might have been covered again by subsequent effects).
    const isStillUncovered = isCardUncovered(state, uncoveredCard.id);

    if (uncoveredCard.isFaceUp && isStillUncovered) {
        // Create a unique ID for this specific uncover event to prevent double-triggering.
        const eventId = `${uncoveredCard.id}-${laneIndex}`;
        if (state.processedUncoverEventIds?.includes(eventId)) {
            return { newState: state }; // This specific event has already been processed in this action chain.
        }

        // Set logging context for uncover
        const cardName = `${uncoveredCard.protocol}-${uncoveredCard.value}`;
        let newState = setLogSource(state, cardName);
        newState = setLogPhase(newState, 'uncover');

        newState = log(newState, owner, `${uncoveredCard.protocol}-${uncoveredCard.value} is uncovered and its effects are re-triggered.`);

        // Increase indent for nested uncover effects
        newState = increaseLogIndent(newState);

        // Mark this event as processed before executing the effect.
        newState.processedUncoverEventIds = [...(newState.processedUncoverEventIds || []), eventId];

        // Re-triggering the on-play effect is the main part of the mechanic.
        const uncoverContext: EffectContext = {
            cardOwner: owner,
            actor: owner,
            currentTurn: newState.turn,
            opponent: owner === 'player' ? 'opponent' : 'player',
            triggerType: 'uncover'
        };
        const result = executeOnPlayEffect(uncoveredCard, laneIndex, newState, uncoverContext);

        // IMPORTANT: Only decrease indent and clear context if there's NO actionRequired
        // If an action is pending, keep the indent and context active until the action completes
        if (!result.newState.actionRequired) {
            result.newState = decreaseLogIndent(result.newState);
            result.newState = setLogSource(result.newState, undefined);
            result.newState = setLogPhase(result.newState, undefined);
        }

        if (result.newState.actionRequired) {
            const newActionActor = result.newState.actionRequired.actor;
            // If an interrupt is already in progress...
            if (state._interruptedTurn) {
                // ...and the new action is for the ORIGINAL turn player...
                if (newActionActor === state._interruptedTurn) {
                    // ...queue the action instead of creating a nested interrupt.
                    result.newState.queuedActions = [
                        ...(result.newState.queuedActions || []),
                        result.newState.actionRequired
                    ];
                    result.newState.actionRequired = null;
                    return result;
                }
            }

            // Standard interrupt logic if no interrupt is in progress, or if the new action
            // is for the currently interrupting player.
            if (newActionActor !== state.turn) {
                result.newState._interruptedTurn = state.turn;
                result.newState._interruptedPhase = state.phase;
                result.newState.turn = newActionActor;

                // CRITICAL: If the action requires continuation (like prompt_rearrange_protocols),
                // set originalAction to resume the interrupted turn after the action completes.
                if (result.newState.actionRequired.type === 'prompt_rearrange_protocols') {
                    result.newState.actionRequired = {
                        ...result.newState.actionRequired,
                        originalAction: {
                            type: 'resume_interrupted_turn',
                            interruptedTurn: state.turn,
                            interruptedPhase: state.phase,
                        }
                    };
                }
            }
        } else {
            // CRITICAL FIX: If the uncover effect didn't create an action requirement,
            // but the turn was previously interrupted, restore the original turn holder.
            // This prevents the current player from getting an extra turn.
            if (result.newState._interruptedTurn) {
                result.newState.turn = result.newState._interruptedTurn;
                result.newState._interruptedTurn = undefined;
            }
        }

        return result;
    }

    return { newState: state };
}

export function internalReturnCard(state: GameState, targetCardId: string): EffectResult {
    const cardInfo = findCardOnBoard(state, targetCardId);
    if (!cardInfo) return { newState: state };

    const { card, owner } = cardInfo;

    const laneIndex = state[owner].lanes.findIndex(l => l.some(c => c.id === card.id));
    if (laneIndex === -1) return { newState: state };

    // Snapshot before removal
    const laneBeforeRemoval = state[owner].lanes[laneIndex];
    const wasTopCard = laneBeforeRemoval.length > 0 && laneBeforeRemoval[laneBeforeRemoval.length - 1].id === targetCardId;
    const hadCardsBelow = laneBeforeRemoval.length > 1 && !wasTopCard;

    let newState = { ...state };
    const ownerState = { ...newState[owner] };

    // Remove from board
    ownerState.lanes = ownerState.lanes.map(lane => lane.filter(c => c.id !== targetCardId));
    // Add to hand
    ownerState.hand = [...ownerState.hand, { ...card, isFaceUp: true, isRevealed: false }];

    newState[owner] = ownerState;

    // FIX: Use actor from actionRequired if available, otherwise fall back to turn
    // This is critical for interrupt scenarios (e.g., Psychic-4 during opponent's turn)
    const actor = (newState.actionRequired && 'actor' in newState.actionRequired)
        ? newState.actionRequired.actor
        : newState.turn;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = owner === 'player' ? "Player's" : "Opponent's";
    const cardName = `${card.protocol}-${card.value}`;
    newState = log(newState, actor, `${actorName} returns ${ownerName} ${cardName} to their hand.`);

    newState.actionRequired = null;
    const stateAfterRecalc = recalculateAllLaneValues(newState);

    // CRITICAL: Uncover happens when:
    // 1. The top card was removed (reveals the card below), OR
    // 2. A card below was removed AND there are still cards in the lane (the top card becomes uncovered)
    if (wasTopCard || hadCardsBelow) {
        const laneAfterRemoval = stateAfterRecalc[owner].lanes[laneIndex];
        if (laneAfterRemoval.length > 0) {
            // There's still a card in the lane - it's now uncovered
            return handleUncoverEffect(stateAfterRecalc, owner, laneIndex);
        }
    }

    return { newState: stateAfterRecalc };
}

export function internalShiftCard(state: GameState, cardToShiftId: string, cardOwner: Player, targetLaneIndex: number, actor: Player): EffectResult {
    console.log('[DEBUG internalShiftCard] Attempting to shift card', cardToShiftId, 'to lane', targetLaneIndex, 'owner:', cardOwner);
    const cardToShiftInfo = findCardOnBoard(state, cardToShiftId);
    if (!cardToShiftInfo || cardToShiftInfo.owner !== cardOwner) return { newState: state };
    const { card: cardToShift } = cardToShiftInfo;

    const ownerState = state[cardOwner];

    let originalLaneIndex = -1;
    for (let i = 0; i < ownerState.lanes.length; i++) {
        if (ownerState.lanes[i].some(c => c.id === cardToShiftId)) {
            originalLaneIndex = i;
            break;
        }
    }

    if (originalLaneIndex === -1) return { newState: state };

    console.log('[DEBUG internalShiftCard] Shifting from lane', originalLaneIndex, 'to lane', targetLaneIndex);

    // NEW: Check passive rules for shift restrictions (Frost-3, custom cards with block_shifts rules)
    const shiftCheck = canShiftCard(state, originalLaneIndex, targetLaneIndex);
    if (!shiftCheck.allowed) {
        console.log(`[SHIFT BLOCKED] ${shiftCheck.reason}`);
        return { newState: state }; // Block the shift
    }
    
    // Snapshot before removal from original lane
    const laneBeforeRemoval = state[cardOwner].lanes[originalLaneIndex];
    const isRemovingTopCard = laneBeforeRemoval.length > 0 && laneBeforeRemoval[laneBeforeRemoval.length - 1].id === cardToShiftId;

    // Create a new lanes array with the card removed from the original lane.
    const lanesAfterRemoval = ownerState.lanes.map((lane, index) => {
        if (index === originalLaneIndex) {
            return lane.filter(c => c.id !== cardToShiftId);
        }
        return lane;
    });

    const cardToBeCovered = lanesAfterRemoval[targetLaneIndex].length > 0
        ? lanesAfterRemoval[targetLaneIndex][lanesAfterRemoval[targetLaneIndex].length - 1]
        : null;

    // Create another new lanes array with the card added to the target lane.
    const lanesAfterAddition = lanesAfterRemoval.map((lane, index) => {
        if (index === targetLaneIndex) {
            return [...lane, cardToShift];
        }
        return lane;
    });
    
    const newOwnerState = { ...ownerState, lanes: lanesAfterAddition };
    let newState = { ...state, [cardOwner]: newOwnerState };

    // IMPORTANT: Only clear effect context if there is NO active effect
    // If we have an active effect (sourceCard + phase), keep it for the shift log
    if (!state._currentEffectSource || !state._currentPhaseContext) {
        newState = setLogSource(newState, undefined);
        newState = setLogPhase(newState, undefined);
    }

    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const ownerName = cardOwner === 'player' ? "Player's" : "Opponent's";
    const cardName = cardToShift.isFaceUp ? `${cardToShift.protocol}-${cardToShift.value}` : 'a card';
    const targetProtocol = newState[cardOwner].protocols[targetLaneIndex];
    newState = log(newState, actor, `${actorName} shifts ${ownerName} ${cardName} to Protocol ${targetProtocol}.`);
    
    const newStats = { ...newState.stats[actor], cardsShifted: newState.stats[actor].cardsShifted + 1 };
    const newActorState = { ...newState[actor], stats: newStats };
    newState = { ...newState, [actor]: newActorState, stats: { ...newState.stats, [actor]: newStats } };
    
    newState.actionRequired = null;

    let stateAfterRecalc = recalculateAllLaneValues(newState);

    let resultAfterOnCover: EffectResult = { newState: stateAfterRecalc };
    if (cardToBeCovered) {
        const coverContext: EffectContext = {
            cardOwner: cardOwner,
            actor: actor,
            currentTurn: stateAfterRecalc.turn,
            opponent: cardOwner === 'player' ? 'opponent' : 'player',
            triggerType: 'cover'
        };
        resultAfterOnCover = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateAfterRecalc, coverContext);
    }

    let stateAfterOriginalLaneUncover = resultAfterOnCover.newState;
    let allAnimations = [...(resultAfterOnCover.animationRequests || [])];

    // If we removed the top card from the original lane, trigger uncover effect there
    if (isRemovingTopCard) {
        const uncoverResult = handleUncoverEffect(stateAfterOriginalLaneUncover, cardOwner, originalLaneIndex);
        stateAfterOriginalLaneUncover = uncoverResult.newState;
        if (uncoverResult.animationRequests) {
            allAnimations.push(...uncoverResult.animationRequests);
        }
    }

    // CRITICAL FIX: If the shifted card is now uncovered and face-up in the target lane, trigger its middle command!
    // This implements the rule: "When a card's text enters play by being played, flipped, or uncovered"
    // IMPORTANT: Only trigger if the card was COVERED before (status changed from covered to uncovered)
    const targetLane = stateAfterOriginalLaneUncover[cardOwner].lanes[targetLaneIndex];
    const shiftedCardIsNowUncovered = targetLane.length > 0 && targetLane[targetLane.length - 1].id === cardToShiftId;
    const cardWasCoveredBefore = !isRemovingTopCard;  // If it wasn't the top card, it was covered

    if (shiftedCardIsNowUncovered && cardToShift.isFaceUp && cardWasCoveredBefore) {
        const uncoverTargetResult = handleUncoverEffect(stateAfterOriginalLaneUncover, cardOwner, targetLaneIndex);
        if (uncoverTargetResult.animationRequests) {
            allAnimations.push(...uncoverTargetResult.animationRequests);
        }

        return {
            newState: uncoverTargetResult.newState,
            animationRequests: allAnimations.length > 0 ? allAnimations : undefined,
        };
    }

    return {
        newState: stateAfterOriginalLaneUncover,
        animationRequests: allAnimations.length > 0 ? allAnimations : undefined,
    };
}

export const countValidDeleteTargets = (state: GameState, disallowedIds: string[], allowedLaneIndices?: number[]): number => {
    let count = 0;
    for (const p of ['player', 'opponent'] as Player[]) {
        for (let i = 0; i < state[p].lanes.length; i++) {
            if (allowedLaneIndices && !allowedLaneIndices.includes(i)) {
                continue;
            }
            const lane = state[p].lanes[i];
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1];
                if (!disallowedIds.includes(topCard.id)) {
                    count++;
                }
            }
        }
    }
    return count;
};

/**
 * Handles the logic for triggering a card's on-play effect when it's flipped from face-down to face-up.
 * This respects the rule that middle-box effects only trigger if the card is uncovered.
 */
export const handleOnFlipToFaceUp = (state: GameState, cardId: string): EffectResult => {
    const cardInfo = findCardOnBoard(state, cardId);
    if (!cardInfo) return { newState: state };

    const { card, owner } = cardInfo;
    const laneIndex = state[owner].lanes.findIndex(l => l.some(c => c.id === card.id));
    if (laneIndex === -1) return { newState: state };

    // executeOnPlayEffect internally handles the "uncovered" check
    const flipContext: EffectContext = {
        cardOwner: owner,
        actor: owner,
        currentTurn: state.turn,
        opponent: owner === 'player' ? 'opponent' : 'player',
        triggerType: 'flip'
    };
    const result = executeOnPlayEffect(card, laneIndex, state, flipContext);
    
    if (result.newState.actionRequired) {
        const newActionActor = result.newState.actionRequired.actor;
        // If an interrupt is already in progress...
        if (state._interruptedTurn) {
            // ...and the new action is for the ORIGINAL turn player...
            if (newActionActor === state._interruptedTurn) {
                // ...queue the action instead of creating a nested interrupt.
                result.newState.queuedActions = [
                    ...(result.newState.queuedActions || []),
                    result.newState.actionRequired
                ];
                result.newState.actionRequired = null;
                return result;
            }
        }

        // Standard interrupt logic if no interrupt is in progress, or if the new action
        // is for the currently interrupting player.
        if (newActionActor !== state.turn) {
            result.newState._interruptedTurn = state.turn;
            result.newState._interruptedPhase = state.phase;
            result.newState.turn = newActionActor;

            // CRITICAL: If the action requires continuation (like prompt_rearrange_protocols),
            // set originalAction to resume the interrupted turn after the action completes.
            if (result.newState.actionRequired.type === 'prompt_rearrange_protocols') {
                result.newState.actionRequired = {
                    ...result.newState.actionRequired,
                    originalAction: {
                        type: 'resume_interrupted_turn',
                        interruptedTurn: state.turn,
                        interruptedPhase: state.phase,
                    }
                };
            }
        }
    }
    return result;
};

/**
 * Find all highest value uncovered cards for a given player.
 * Used for Hate-2 effect where player must choose which of their highest cards to delete.
 *
 * @param state Current game state
 * @param player The player whose uncovered cards to check
 * @returns Array of card info objects for all cards tied for highest value
 */
export function findAllHighestUncoveredCards(
    state: GameState,
    player: Player
): Array<{ card: PlayedCard; laneIndex: number; owner: Player; value: number }> {
    const uncoveredCards: Array<{ card: PlayedCard; laneIndex: number; owner: Player; value: number }> = [];

    // Collect all uncovered cards for the player
    state[player].lanes.forEach((lane, laneIndex) => {
        if (lane.length > 0) {
            const uncoveredCard = lane[lane.length - 1];
            const value = getEffectiveCardValue(uncoveredCard, lane);
            uncoveredCards.push({
                card: uncoveredCard,
                laneIndex,
                owner: player,
                value
            });
        }
    });

    if (uncoveredCards.length === 0) return [];

    // Find the highest value
    const maxValue = Math.max(...uncoveredCards.map(c => c.value));

    // Return all cards with the highest value (handles ties)
    return uncoveredCards.filter(c => c.value === maxValue);
}