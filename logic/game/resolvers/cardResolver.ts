/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, ActionRequired, AnimationRequest, EffectResult, EffectContext } from '../../../types';
import { drawForPlayer, findAndFlipCards } from '../../../utils/gameStateModifiers';
import { log, decreaseLogIndent, setLogSource, setLogPhase } from '../../utils/log';
import { findCardOnBoard, isCardUncovered, internalResolveTargetedFlip, internalReturnCard, internalShiftCard, handleUncoverEffect, countValidDeleteTargets, handleOnFlipToFaceUp, findAllHighestUncoveredCards, handleChainedEffectsOnFlip } from '../helpers/actionUtils';
// NOTE: checkForHate3Trigger removed - Hate-3 is now custom protocol, triggers via processReactiveEffects
import * as phaseManager from '../phaseManager';
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import { canFlipSpecificCard } from '../passiveRuleChecker';

export type CardActionResult = {
    nextState: GameState;
    requiresAnimation?: {
        animationRequests: AnimationRequest[];
        onCompleteCallback: (s: GameState, endTurnCb: (s2: GameState) => GameState) => GameState;
    } | null;
    requiresTurnEnd?: boolean;
};

// List of action types that trigger Metal-6's self-delete (flip actions only)
// NOTE: Most legacy card-specific flip types have been removed - now using generic handlers
const METAL6_FLIP_ACTION_TYPES = [
    'select_card_to_flip',       // Generic flip handler (used by most custom protocols)
    'select_any_card_to_flip',   // Life-1 multi-flip
];

function handleMetal6Flip(state: GameState, targetCardId: string, action: ActionRequired): CardActionResult | null {
    // CRITICAL: Metal-6 should ONLY delete itself when FLIPPED, not when returned/shifted/deleted
    // Check if this is a flip action before proceeding
    if (!action || !METAL6_FLIP_ACTION_TYPES.includes(action.type)) {
        return null; // Not a flip action - Metal-6 should not trigger
    }

    const cardInfo = findCardOnBoard(state, targetCardId);
    if (cardInfo && cardInfo.card.protocol === 'Metal' && cardInfo.card.value === 6) {
        // FIX: Use actor from action parameter, not state.turn (critical for interrupts)
        const actor = 'actor' in action ? action.actor : state.turn;
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";

        // Determine source card name for better logging
        let sourceCardName = 'An effect';
        if ('sourceCardId' in action && action.sourceCardId) {
            const sourceCard = findCardOnBoard(state, action.sourceCardId);
            if (sourceCard) {
                sourceCardName = `${sourceCard.card.protocol}-${sourceCard.card.value}`;
            }
        }

        // Log which card is being flipped and by what
        let newState = log(state, actor, `${sourceCardName}: ${actorName} flips ${ownerName} Metal-6.`);
        newState = log(newState, actor, `Metal-6: Deletes itself when flipped.`);

        const newStats = { ...state.stats[actor], cardsDeleted: state.stats[actor].cardsDeleted + 1 };
        const newPlayerState = { ...state[actor], stats: newStats };
        newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

        // CRITICAL: Store lane info BEFORE the callback (card will be gone after animation)
        const cardOwner = cardInfo.owner;
        const laneIndex = state[cardOwner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
        const lane = state[cardOwner].lanes[laneIndex];
        const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;
        const hadCardBelow = lane && lane.length > 1;

        // CRITICAL: Capture pending effects BEFORE the callback runs
        // The callback receives a fresh state after animation, so we need to preserve _pendingCustomEffects
        const savedPendingEffects = (state as any)._pendingCustomEffects;

        const onCompleteCallback = (s: GameState, endTurnCb: (s2: GameState) => GameState) => {
            // CRITICAL: Restore pending effects from before the animation
            // These are the remaining effects from the source card (e.g., Fire-0's draw after flip)
            let workingState = { ...s };

            // CRITICAL FIX: Only restore savedPendingEffects if they haven't been processed yet.
            // We track this by checking if they're already in queuedActions (by sourceCardId match).
            const alreadyQueued = savedPendingEffects && workingState.queuedActions?.some(
                (action: any) => action.type === 'execute_remaining_custom_effects' &&
                                action.sourceCardId === savedPendingEffects.sourceCardId
            );

            if (savedPendingEffects && !alreadyQueued) {
                (workingState as any)._pendingCustomEffects = savedPendingEffects;
                // Also set lastCustomEffectTargetCardId to the flipped card
                // This allows the shift effect to detect that the card no longer exists
                workingState.lastCustomEffectTargetCardId = targetCardId;
            }

            // Trigger reactive effects after delete (Hate-3 custom protocol)
            const reactiveResult = processReactiveEffects(workingState, 'after_delete', { player: workingState.turn });
            let stateAfterTriggers = reactiveResult.newState;

            // CRITICAL: Handle uncover effect if deleted card was top card and there was a card below
            if (wasTopCard && hadCardBelow) {
                const uncoverResult = handleUncoverEffect(stateAfterTriggers, cardOwner, laneIndex);
                stateAfterTriggers = uncoverResult.newState;
            }

            // NOTE: Legacy Light-0 and Water-0 specific handlers removed
            // Now uses generic select_card_to_flip with draws/followUpEffect parameters

            // FIX: Use a proper type guard for 'count' property and remove 'as any' cast.
            if (action && 'count' in action && action.count > 1) {
                const remainingCount = action.count - 1;
                stateAfterTriggers.actionRequired = { ...action, count: remainingCount };
                return { ...stateAfterTriggers, animationState: null };
            }
            // CRITICAL: If the input state already has actionRequired or queuedActions,
            // it means processQueuedActions already ran and set up the next action.
            // We should NOT override it by calling queuePendingCustomEffects again.
            if (workingState.actionRequired || (workingState.queuedActions && workingState.queuedActions.length > 0)) {
                // Preserve actionRequired/queuedActions from working state
                // CRITICAL: Must clear animationState since endTurnCb won't be called
                return {
                    ...stateAfterTriggers,
                    actionRequired: workingState.actionRequired,
                    queuedActions: workingState.queuedActions,
                    animationState: null
                };
            }

            // CRITICAL FIX: Check if savedPendingEffects are already in queue before restoring
            // This prevents double-queueing when handleUncoverEffect already queued them
            const effectsAlreadyInQueue = savedPendingEffects && stateAfterTriggers.queuedActions?.some(
                (action: any) => action.type === 'execute_remaining_custom_effects' &&
                                action.sourceCardId === savedPendingEffects.sourceCardId
            );

            if (savedPendingEffects && !(stateAfterTriggers as any)._pendingCustomEffects && !effectsAlreadyInQueue) {
                (stateAfterTriggers as any)._pendingCustomEffects = savedPendingEffects;
                // Also restore the target card ID for "shift THAT card" effects
                stateAfterTriggers.lastCustomEffectTargetCardId = targetCardId;
            }

            stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);
            stateAfterTriggers.actionRequired = null;

            if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                const newQueue = [...stateAfterTriggers.queuedActions];
                const nextAction = newQueue.shift();

                // CRITICAL FIX: execute_remaining_custom_effects is an INTERNAL action type
                // It must be processed by processQueuedActions, NOT set as actionRequired!
                // Setting it as actionRequired causes a softlock because there's no UI for it.
                if ((nextAction as any)?.type === 'execute_remaining_custom_effects') {
                    // Put the action back in queue and process it properly
                    const stateWithQueue = { ...stateAfterTriggers, queuedActions: [nextAction, ...newQueue] };
                    const processedState = phaseManager.processQueuedActions(stateWithQueue);

                    // If processing created an actionRequired (like a shift prompt), return it
                    if (processedState.actionRequired) {
                        return { ...processedState, animationState: null };
                    }

                    // If no actionRequired, check for more queued actions
                    if (processedState.queuedActions && processedState.queuedActions.length > 0) {
                        const nextQueue = [...processedState.queuedActions];
                        const nextNextAction = nextQueue.shift();
                        return { ...processedState, actionRequired: nextNextAction, queuedActions: nextQueue, animationState: null };
                    }

                    // Nothing left to do - end turn
                    return endTurnCb(processedState);
                }

                // For other action types, set as actionRequired normally
                return { ...stateAfterTriggers, actionRequired: nextAction, queuedActions: newQueue, animationState: null };
            }
            return endTurnCb(stateAfterTriggers);
        };

        return {
            nextState: { ...newState, actionRequired: null },
            requiresAnimation: {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback,
            },
            requiresTurnEnd: false,
        };
    }
    return null;
}

export const resolveActionWithCard = (prev: GameState, targetCardId: string): CardActionResult => {
    if (!prev.actionRequired) return { nextState: prev };

    let newState: GameState = { ...prev };
    let requiresTurnEnd = true;
    let requiresAnimation: CardActionResult['requiresAnimation'] = null;

    const metal6Result = handleMetal6Flip(prev, targetCardId, prev.actionRequired);
    if (metal6Result) return metal6Result;

    switch (prev.actionRequired.type) {
        // Generic flip handler - all legacy types now use select_card_to_flip with targetFilter
        case 'select_card_to_flip': {
            // CRITICAL: Validate that the card is not "committed" (being played but not yet landed)
            // Per rules: "the committed card IS NOT a valid selection" during on_cover effects
            const committedCardId = (prev as any)._committedCardId;
            if (committedCardId && targetCardId === committedCardId) {
                return { nextState: prev }; // Invalid selection, return unchanged state
            }

            // NEW: Validate that this card can be flipped (Ice-4: block_flip_this_card)
            const flipCheck = canFlipSpecificCard(prev, targetCardId);
            if (!flipCheck.allowed) {
                return { nextState: prev }; // Invalid selection, return unchanged state
            }

            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const draws = 'draws' in prev.actionRequired ? prev.actionRequired.draws : 0;

            newState = internalResolveTargetedFlip(prev, targetCardId);

            // CRITICAL: Save this value to restore after handleOnFlipToFaceUp
            const savedTargetCardId = targetCardId;
            newState.lastCustomEffectTargetCardId = savedTargetCardId;

            if (draws && draws > 0) {
                const { actor, sourceCardId } = prev.actionRequired as { actor: Player, sourceCardId: string };
                const sourceCardInfo = findCardOnBoard(newState, sourceCardId);
                const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'A card effect';
                newState = log(newState, actor, `${sourceCardName}: Drawing ${draws} card(s).`);
                newState = drawForPlayer(newState, actor, draws);
            }

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const result = handleOnFlipToFaceUp(newState, targetCardId);
                newState = result.newState;
                // CRITICAL: Restore lastCustomEffectTargetCardId after handleOnFlipToFaceUp
                newState.lastCustomEffectTargetCardId = savedTargetCardId;
                if (result.animationRequests) {
                    requiresAnimation = {
                        animationRequests: result.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired || (s.queuedActions && s.queuedActions.length > 0)) return s;
                            return endTurnCb(s);
                        }
                    };
                }
            }

            // NEW: Handle custom protocol follow-up effects (e.g., "Flip 1 card. Draw cards equal to that card's value")
            const hasFollowUpEffect = (prev.actionRequired as any)?.followUpEffect;
            const sourceCardId = (prev.actionRequired as any)?.sourceCardId;
            if (hasFollowUpEffect && sourceCardId) {
                newState = handleChainedEffectsOnFlip(newState, targetCardId, sourceCardId);
            }

            // NEW: Trigger reactive effects after flip
            const flipActor = (prev.actionRequired as any)?.actor || prev.turn;
            const reactiveFlipResult = processReactiveEffects(newState, 'after_flip', { player: flipActor, cardId: targetCardId });
            newState = reactiveFlipResult.newState;

            // NEW: Handle pending custom effects (for "Flip 1 card. Shift THAT card" chains)
            // CRITICAL: ALWAYS queue pending effects to execute after the flipped card's on-flip effects complete
            const pendingEffects = (newState as any)._pendingCustomEffects;
            if (pendingEffects && pendingEffects.effects.length > 0) {

                // ALWAYS queue the pending effects - never execute immediately
                // This ensures the flipped card's on-flip effects (which may set actionRequired) complete first
                const pendingAction: ActionRequired = {
                    type: 'execute_remaining_custom_effects' as any,
                    sourceCardId: pendingEffects.sourceCardId,
                    laneIndex: pendingEffects.laneIndex,
                    effects: pendingEffects.effects,
                    context: pendingEffects.context,
                    actor: pendingEffects.context.cardOwner,  // CRITICAL: Use cardOwner from context, NOT flipActor (which could be from an uncover interrupt)
                    // Store the flipped card ID if needed for "that card" effects
                    selectedCardFromPreviousEffect: pendingEffects.effects[0].useCardFromPreviousEffect ? targetCardId : undefined,
                    // Log-Kontext weitergeben für korrekte Einrückung/Quellkarte nach Interrupts
                    logSource: pendingEffects.logSource,
                    logPhase: pendingEffects.logPhase,
                    logIndentLevel: pendingEffects.logIndentLevel
                } as any;


                // ALWAYS queue the pending effects, never set as actionRequired!
                // execute_remaining_custom_effects is an internal action, not a user action
                newState.queuedActions = [
                    ...(newState.queuedActions || []),
                    pendingAction
                ];


                // Clear from state after queueing
                delete (newState as any)._pendingCustomEffects;
            }

            // NEW: Handle each_lane continuation (scope: 'each_lane' parameter)
            const remainingLanes = (prev.actionRequired as any)?.remainingLanes;
            if (remainingLanes && remainingLanes.length > 0 && !newState.actionRequired) {
                // Continue with next lane
                const nextLane = remainingLanes[0];
                const newRemainingLanes = remainingLanes.slice(1);
                const actionParams = (prev.actionRequired as any)?.params;
                const actionSourceCardId = (prev.actionRequired as any)?.sourceCardId;
                const actionActor = (prev.actionRequired as any)?.actor;
                const actionTargetFilter = (prev.actionRequired as any)?.targetFilter;

                newState.actionRequired = {
                    type: 'select_card_to_flip',
                    sourceCardId: actionSourceCardId,
                    actor: actionActor,
                    currentLaneIndex: nextLane,
                    remainingLanes: newRemainingLanes,
                    targetFilter: actionTargetFilter,  // CRITICAL: Pass targetFilter for targeting
                    params: actionParams,
                    // CRITICAL: Pass through followUpEffect for if_executed conditionals
                    followUpEffect: (prev.actionRequired as any)?.followUpEffect,
                    conditionalType: (prev.actionRequired as any)?.conditionalType,
                } as any;
            }

            if(newState.actionRequired || (newState.queuedActions && newState.queuedActions.length > 0)) {
                requiresTurnEnd = false;
            }
            break;
        }
        // NOTE: Legacy select_opponent_card_to_flip removed - now uses select_card_to_flip with followUpEffect

        // Generic shift handler - all legacy types now use select_card_to_shift with parameters
        case 'select_card_to_shift': {
            // Optional shift actions validate source card in phaseManager
            const { sourceCardId, optional } = prev.actionRequired;
            if (optional && sourceCardId) {
                const sourceCardInfo = findCardOnBoard(prev, sourceCardId);
                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                    // Source card was deleted/returned/flipped → Cancel the shift
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                    // CRITICAL: Temporarily set log source to the cancelled card
                    const previousLogSource = (prev as any)._logSource;
                    newState = setLogSource(prev, cardName);
                    newState = log(newState, prev.actionRequired.actor, `Shift was cancelled because the source is no longer active.`);
                    newState = setLogSource(newState, previousLogSource);
                    newState = phaseManager.queuePendingCustomEffects(newState);
                    newState.actionRequired = null;
                    requiresTurnEnd = true;
                    break;
                }
            }

            const cardInfo = findCardOnBoard(prev, targetCardId);

            if (cardInfo) {
                const { owner: cardOwner } = cardInfo;

                // Find the lane index manually since findCardOnBoard doesn't return it
                let originalLaneIndex = -1;
                for (let i = 0; i < prev[cardOwner].lanes.length; i++) {
                    if (prev[cardOwner].lanes[i].some(c => c.id === targetCardId)) {
                        originalLaneIndex = i;
                        break;
                    }
                }

                if (originalLaneIndex === -1) {
                    return { nextState: prev, requiresTurnEnd: false }; // Card not found in any lane
                }

                // CRITICAL: Server-side validation - check if card is allowed to be shifted based on targetFilter
                const targetFilter = (prev.actionRequired as any).targetFilter || {};
                const positionFilter = targetFilter.position || 'uncovered'; // Default to uncovered
                const lane = prev[cardOwner].lanes[originalLaneIndex];
                const cardIndex = lane.findIndex(c => c.id === targetCardId);
                const isUncovered = cardIndex === lane.length - 1;

                // Validate position filter
                if (positionFilter === 'uncovered' && !isUncovered) {
                    return { nextState: prev, requiresTurnEnd: false }; // Silently reject
                }
                if (positionFilter === 'covered' && isUncovered) {
                    return { nextState: prev, requiresTurnEnd: false }; // Silently reject
                }

                // NEW: Validate scope filter (Fear-3: "in this line")
                const scope = (prev.actionRequired as any).scope;
                const sourceLaneIndex = (prev.actionRequired as any).sourceLaneIndex;
                if (scope === 'this_lane' && sourceLaneIndex !== undefined && originalLaneIndex !== sourceLaneIndex) {
                    return { nextState: prev, requiresTurnEnd: false }; // Silently reject
                }

                if (originalLaneIndex !== -1) {
                    // CRITICAL: If targetLaneIndex is specified (like Gravity-4 and custom 'to_this_lane'), shift directly!
                    // No lane selection needed - destination is fixed
                    const fixedTargetLane = (prev.actionRequired as any).targetLaneIndex;
                    if (fixedTargetLane !== undefined) {
                        // Execute shift immediately like Gravity-4
                        const actor = prev.actionRequired.actor;
                        const shiftResult = internalShiftCard(prev, targetCardId, cardOwner, fixedTargetLane, actor);
                        newState = shiftResult.newState;
                        requiresTurnEnd = !newState.actionRequired;
                        break;
                    }

                    // No fixed destination - ask user to select lane
                    // FIX: Use actor from the current action, not prev.turn
                    // This is critical for interrupt scenarios (e.g., Psychic-3 uncovered during opponent's turn)
                    const nextAction: ActionRequired = {
                        type: 'select_lane_for_shift',
                        cardToShiftId: targetCardId,
                        cardOwner,
                        originalLaneIndex,
                        sourceCardId: prev.actionRequired.sourceCardId,
                        actor: prev.actionRequired.actor,
                        destinationRestriction: (prev.actionRequired as any).destinationRestriction,  // Pass through for custom protocols
                        // CRITICAL: Pass through followUpEffect for if_executed conditionals (Speed-3: "If you do, flip this card")
                        followUpEffect: (prev.actionRequired as any).followUpEffect,
                        conditionalType: (prev.actionRequired as any).conditionalType,
                    };
                    newState.actionRequired = nextAction;
                }
            }
            requiresTurnEnd = false; // This action has a follow-up
            break;
        }
        // NOTE: Legacy gravity_4, own_other, opponent_face_down, speed_3 shift handlers removed
        // Now handled by generic select_card_to_shift with targetFilter and followUpEffect
        // REMOVED: select_card_to_delete_for_death_1 - Death-1 now uses custom protocol with delete_self followUp
        case 'delete_self': {
            // NEW: Composable self-delete (Death-1: "then delete this card")
            const { sourceCardId, cardToDeleteId, actor } = prev.actionRequired as any;
            const cardInfo = findCardOnBoard(prev, cardToDeleteId);

            if (!cardInfo) {
                newState = log(prev, actor, `Card no longer on board. Delete skipped.`);
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            const { owner, laneIndex } = cardInfo;
            const wasTopCard = prev[owner].lanes[laneIndex][prev[owner].lanes[laneIndex].length - 1].id === cardToDeleteId;

            // Delete the card
            const lane = [...prev[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === cardToDeleteId);
            lane.splice(cardIndex, 1);

            const newLanes = [...prev[owner].lanes];
            newLanes[laneIndex] = lane;

            let stateAfterDelete = {
                ...prev,
                [owner]: { ...prev[owner], lanes: newLanes },
            };

            newState = phaseManager.queuePendingCustomEffects(stateAfterDelete);
            newState.actionRequired = null;

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            newState = { ...newState, stats: { ...newState.stats, [actor]: newStats } };

            // Handle uncover if was top card
            if (wasTopCard && lane.length > 0) {
                const uncoverResult = handleUncoverEffect(newState, owner, laneIndex);
                newState = uncoverResult.newState;
            }

            requiresTurnEnd = true;
            break;
        }
        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete':
        case 'select_low_value_card_to_delete':
        case 'select_card_from_other_lanes_to_delete': {
            // REMOVED: select_card_to_delete_for_anarchy_2 - now uses generic protocolMatching
            // Rule: An effect is cancelled if its source card is no longer active (face-up on the board).
            const { sourceCardId, actor } = prev.actionRequired;
            const sourceCardInfoCheck = findCardOnBoard(prev, sourceCardId);
            if (!sourceCardInfoCheck || !sourceCardInfoCheck.card.isFaceUp) {
                const cardName = sourceCardInfoCheck ? `${sourceCardInfoCheck.card.protocol}-${sourceCardInfoCheck.card.value}` : 'the source card';
                newState = log(prev, actor, `Effect from ${cardName} was cancelled because the source is no longer active.`);
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            // GENERIC VALIDATION for protocolMatching (custom protocols)
            if ((prev.actionRequired as any).protocolMatching) {
                const protocolMatching = (prev.actionRequired as any).protocolMatching;
                const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
                if (cardLaneIndex !== -1) {
                    const playerProtocolAtLane = prev.player.protocols[cardLaneIndex];
                    const opponentProtocolAtLane = prev.opponent.protocols[cardLaneIndex];
                    const cardProtocol = cardInfo.card.protocol;
                    const hasMatch = cardProtocol === playerProtocolAtLane || cardProtocol === opponentProtocolAtLane;

                    if (protocolMatching === 'must_match' && !hasMatch) {
                        console.error(`Illegal delete: ${cardProtocol}-${cardInfo.card.value} in lane ${cardLaneIndex} (protocols: ${playerProtocolAtLane}/${opponentProtocolAtLane}) - card must be in lane with matching protocol`);
                        return { nextState: prev }; // Block the illegal delete
                    } else if (protocolMatching === 'must_not_match' && hasMatch) {
                        console.error(`Illegal delete: ${cardProtocol}-${cardInfo.card.value} in lane ${cardLaneIndex} (protocols: ${playerProtocolAtLane}/${opponentProtocolAtLane}) - card must be in lane without matching protocol`);
                        return { nextState: prev }; // Block the illegal delete
                    }
                }
            }

            // GENERIC VALIDATION for calculation: highest_value / lowest_value (Hate-2)
            const targetFilter = (prev.actionRequired as any).targetFilter;
            if (targetFilter?.calculation === 'highest_value' || targetFilter?.calculation === 'lowest_value') {
                // Determine the target player based on owner filter
                const ownerFilter = targetFilter.owner;
                const targetPlayer = ownerFilter === 'opponent'
                    ? (actor === 'player' ? 'opponent' : 'player')
                    : (ownerFilter === 'own' ? actor : cardInfo.owner);

                // Find all highest/lowest value uncovered cards for the target player
                const uncoveredCards = findAllHighestUncoveredCards(prev, targetPlayer as Player);
                const isValid = uncoveredCards.some(c => c.card.id === targetCardId);
                const calcType = targetFilter.calculation === 'highest_value' ? 'highest' : 'lowest';

                if (!isValid) {
                    console.error(`Illegal delete: Card ${targetCardId} is not one of the ${calcType} value uncovered cards`);
                    return { nextState: prev }; // Block the illegal delete
                }
            }

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const ownerName = cardInfo.owner === 'player' ? "Player's" : "Opponent's";
            const laneIdx = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const protocolName = laneIdx !== -1 ? prev[cardInfo.owner].protocols[laneIdx] : 'unknown';
            const cardName = cardInfo.card.isFaceUp
                ? `${cardInfo.card.protocol}-${cardInfo.card.value}`
                : `face-down card in Protocol ${protocolName}`;
            const sourceCardInfo = findCardOnBoard(prev, prev.actionRequired.sourceCardId);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
            newState = log(newState, actor, `${sourceCardName}: ${actorName} deletes ${ownerName} ${cardName}.`);

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    const deletingPlayer = prev.actionRequired.actor;
                    const originalAction = prev.actionRequired;


                    // Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(s, 'after_delete', { player: deletingPlayer });
                    let stateAfterTriggers = reactiveResult.newState;

                    // CRITICAL: Queue pending custom effects after delete completes (Hate-1: multiple deletes)
                    stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);

                    // 2. Determine the next step of the ORIGINAL multi-step delete action BEFORE uncovering
                    let nextStepOfDeleteAction: ActionRequired = null;
                    const sourceCardInfo = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);
                    const sourceIsUncovered = isCardUncovered(stateAfterTriggers, originalAction.sourceCardId);

                    // Check if there's a follow-up effect (Death-1: "then delete this card")
                    const followUpEffect = (originalAction as any).followUpEffect;

                    // CRITICAL: Multi-step effects (like Hate-1) require the source to be UNCOVERED AND face-up
                    if (sourceCardInfo && sourceCardInfo.card.isFaceUp && sourceIsUncovered) {
                        // NEW: Handle each_lane continuation (scope: 'each_lane' parameter)
                        const remainingLanes = (originalAction as any).remainingLanes;
                        if (originalAction.type === 'select_cards_to_delete' && remainingLanes && remainingLanes.length > 0) {
                            // Continue with next lane
                            const nextLane = remainingLanes[0];
                            const newRemainingLanes = remainingLanes.slice(1);

                            nextStepOfDeleteAction = {
                                type: 'select_cards_to_delete',
                                count: (originalAction as any).params?.count || originalAction.count,  // Reset count for next lane
                                sourceCardId: originalAction.sourceCardId,
                                actor: originalAction.actor,
                                currentLaneIndex: nextLane,
                                remainingLanes: newRemainingLanes,
                                disallowedIds: (originalAction as any).params?.excludeSelf ? [originalAction.sourceCardId] : [],
                                targetFilter: (originalAction as any).targetFilter,
                                scope: (originalAction as any).scope,
                                protocolMatching: (originalAction as any).protocolMatching,
                                params: (originalAction as any).params,
                            } as any;
                        } else if (originalAction.type === 'select_cards_to_delete' && originalAction.count > 1) {
                             nextStepOfDeleteAction = {
                                type: 'select_cards_to_delete',
                                count: originalAction.count - 1,
                                sourceCardId: originalAction.sourceCardId,
                                disallowedIds: [...originalAction.disallowedIds, targetCardId],
                                actor: originalAction.actor,
                                followUpEffect: followUpEffect  // Preserve followUpEffect for subsequent deletes
                            } as any;
                        } else if (originalAction.type === 'select_card_from_other_lanes_to_delete' && originalAction.count > 1) {
                            const cardLaneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));

                            // CRITICAL: Check if remaining lanes have any cards (Death-0 validation)
                            const allSelectedLanes = [...originalAction.lanesSelected, cardLaneIndex];
                            const remainingLanes = [0, 1, 2].filter(i =>
                                i !== originalAction.disallowedLaneIndex && !allSelectedLanes.includes(i)
                            );
                            const hasCardsInRemainingLanes = remainingLanes.some(laneIdx =>
                                stateAfterTriggers.player.lanes[laneIdx].length > 0 ||
                                stateAfterTriggers.opponent.lanes[laneIdx].length > 0
                            );

                            if (hasCardsInRemainingLanes) {
                                nextStepOfDeleteAction = {
                                    type: 'select_card_from_other_lanes_to_delete',
                                    count: originalAction.count - 1,
                                    sourceCardId: originalAction.sourceCardId,
                                    disallowedLaneIndex: originalAction.disallowedLaneIndex,
                                    lanesSelected: allSelectedLanes,
                                    actor: originalAction.actor
                                };
                            } else {
                                // No cards left in remaining lanes - skip the rest
                                stateAfterTriggers = log(stateAfterTriggers, originalAction.actor, `No cards left in remaining lanes. Effect skipped.`);
                            }
                        }
                    } else if ('count' in originalAction && originalAction.count > 1) {
                        const sourceName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                        const reason = !sourceCardInfo || !sourceCardInfo.card.isFaceUp
                            ? "the source is no longer active"
                            : "the source was covered";
                        stateAfterTriggers = log(stateAfterTriggers, originalAction.actor, `Remaining deletes from ${sourceName} were cancelled because ${reason}.`);
                    }

                    // 3. Handle uncovering with the pre-computed next delete action
                    let hadInterruptThatResolved = false;
                    if (wasTopCard) {
                        const stateBeforeUncover = stateAfterTriggers;
                        const uncoverResult = handleUncoverEffect(stateBeforeUncover, cardInfo.owner, laneIndex);

                        // Check if the uncover created an interrupt (turn switch)
                        const uncoverCreatedInterrupt = uncoverResult.newState._interruptedTurn !== undefined;

                        // Check if an interrupt was resolved during this callback
                        if (stateBeforeUncover._interruptedTurn && !uncoverResult.newState._interruptedTurn) {
                            hadInterruptThatResolved = true;
                        }

                        // Use the queue from the uncover result (it already includes any existing queued actions)
                        // IMPORTANT: Don't merge with stateBeforeUncover.queuedActions because that would duplicate
                        // actions that were created by the uncover effect itself!
                        const mergedQueue = [
                            ...(uncoverResult.newState.queuedActions || [])
                        ];

                        // If we have a next delete step, ensure it's preserved
                        if (nextStepOfDeleteAction) {
                            if (uncoverCreatedInterrupt) {
                                // The uncover interrupted - queue the next delete for AFTER the interrupt resolves
                                mergedQueue.push(nextStepOfDeleteAction);
                            } else {
                                // No interrupt - the next delete should happen immediately after the uncover effect
                                mergedQueue.unshift(nextStepOfDeleteAction);
                            }
                        }

                        stateAfterTriggers = {
                            ...uncoverResult.newState,
                            queuedActions: mergedQueue
                        };
                    } else if (nextStepOfDeleteAction) {
                        // No uncover happened, but we have a next delete step
                        stateAfterTriggers.queuedActions = [
                            ...(stateAfterTriggers.queuedActions || []),
                            nextStepOfDeleteAction
                        ];
                    }

                    // CRITICAL: Handle followUpEffect (Death-1: "then delete this card") when delete is complete
                    // This only applies when we DON'T have a nextStepOfDeleteAction (i.e., this was the last/only delete)
                    if (followUpEffect && !nextStepOfDeleteAction) {

                        // If there's already an actionRequired (from uncover effect), queue the followUp for later
                        if (stateAfterTriggers.actionRequired) {

                            // Find source card info for context
                            const sourceCardForQueue = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);
                            const opponent: Player = originalAction.actor === 'player' ? 'opponent' : 'player';

                            // Determine lane index for context
                            let queueLaneIndex = -1;
                            if (sourceCardForQueue) {
                                queueLaneIndex = stateAfterTriggers[sourceCardForQueue.owner].lanes.findIndex(
                                    l => l.some(c => c.id === originalAction.sourceCardId)
                                );
                            }

                            // Create context for the queued effect
                            const queueContext: EffectContext = {
                                cardOwner: originalAction.actor,
                                actor: originalAction.actor,
                                currentTurn: stateAfterTriggers.turn,
                                opponent,
                                triggerType: 'start' as const
                            };

                            // Create a queued action that will execute the followUpEffect
                            // CRITICAL: Use 'effects' array format as expected by phaseManager.ts
                            const followUpAction = {
                                type: 'execute_remaining_custom_effects',
                                sourceCardId: originalAction.sourceCardId,
                                actor: originalAction.actor,
                                laneIndex: queueLaneIndex,
                                effects: [followUpEffect],  // Use effects array format
                                context: queueContext,
                                // Log-Kontext weitergeben für korrekte Einrückung/Quellkarte
                                logSource: stateAfterTriggers._currentEffectSource,
                                logPhase: stateAfterTriggers._currentPhaseContext,
                                logIndentLevel: stateAfterTriggers._logIndentLevel || 0
                            };

                            stateAfterTriggers.queuedActions = [
                                ...(stateAfterTriggers.queuedActions || []),
                                followUpAction
                            ];
                        } else {
                            // No current actionRequired - execute followUpEffect immediately
                            const sourceCardForFollowUp = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);
                            const opponent: Player = originalAction.actor === 'player' ? 'opponent' : 'player';

                            if (sourceCardForFollowUp) {
                                const followUpLaneIndex = stateAfterTriggers[sourceCardForFollowUp.owner].lanes.findIndex(
                                    l => l.some(c => c.id === originalAction.sourceCardId)
                                );
                                const context: EffectContext = {
                                    cardOwner: originalAction.actor,
                                    actor: originalAction.actor,
                                    currentTurn: stateAfterTriggers.turn,
                                    opponent,
                                    triggerType: 'start' as const
                                };

                                // CRITICAL: Restore log context for followUpEffect
                                const sourceCardName = `${sourceCardForFollowUp.card.protocol}-${sourceCardForFollowUp.card.value}`;
                                stateAfterTriggers = setLogSource(stateAfterTriggers, sourceCardName);
                                stateAfterTriggers = setLogPhase(stateAfterTriggers, 'start');

                                const followUpResult = executeCustomEffect(
                                    sourceCardForFollowUp.card,
                                    followUpLaneIndex,
                                    stateAfterTriggers,
                                    context,
                                    followUpEffect
                                );
                                stateAfterTriggers = followUpResult.newState;

                                // Queue any pending effects from the follow-up
                                stateAfterTriggers = phaseManager.queuePendingCustomEffects(stateAfterTriggers);
                            } else {
                                // Source card not found - create synthetic context for delete_self

                                // For deleteSelf effects, we need to find the card by sourceCardId
                                // It might have been moved or we need to execute directly
                                if (followUpEffect.params?.deleteSelf) {
                                    // CRITICAL: Restore log context before delete
                                    stateAfterTriggers = setLogSource(stateAfterTriggers, 'the source card');
                                    stateAfterTriggers = setLogPhase(stateAfterTriggers, 'start');

                                    // Execute delete_self directly
                                    const deleteResult = internalDeleteCard(stateAfterTriggers, originalAction.sourceCardId);
                                    stateAfterTriggers = deleteResult.newState;
                                    stateAfterTriggers = log(stateAfterTriggers, originalAction.actor, `Deletes itself.`);
                                }
                            }
                        }
                    }

                    // 4. Handle action priority
                    const actionFromTriggers = stateAfterTriggers.actionRequired;

                    if (actionFromTriggers) {
                        // Uncover created an interrupt - the next delete is already in the queue
                        return stateAfterTriggers;
                    }

                    // No interrupt from uncover - check if we have queued actions
                    if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                        // CRITICAL: Auto-resolve actions should be processed via processQueuedActions
                        // instead of being set as actionRequired (which expects user input)
                        const firstAction = stateAfterTriggers.queuedActions[0];
                        if (firstAction?.type === 'execute_remaining_custom_effects') {
                            const stateAfterQueue = phaseManager.processQueuedActions(stateAfterTriggers);

                            // If processQueuedActions set an actionRequired, return it
                            if (stateAfterQueue.actionRequired) {
                                return stateAfterQueue;
                            }

                            // Otherwise end turn
                            return endTurnCb(stateAfterQueue);
                        }

                        // Pop the first queued action and make it the current action
                        const queueCopy = [...stateAfterTriggers.queuedActions];
                        const nextAction = queueCopy.shift();

                        // CRITICAL: Validate shift actions before setting as actionRequired!
                        if (nextAction?.type === 'shift_flipped_card_optional' || nextAction?.type === 'gravity_2_shift_after_flip') {
                            const sourceCardInfo = findCardOnBoard(stateAfterTriggers, nextAction.sourceCardId);
                            const sourceIsUncovered = isCardUncovered(stateAfterTriggers, nextAction.sourceCardId);

                            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp || !sourceIsUncovered) {
                                // Source card was deleted/returned/flipped face-down/covered → Cancel the shift
                                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                                let loggedState = log(stateAfterTriggers, nextAction.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);

                                // Continue processing remaining queue
                                if (queueCopy.length > 0) {
                                    const nextNextAction = queueCopy.shift();
                                    return { ...loggedState, actionRequired: nextNextAction, queuedActions: queueCopy };
                                } else {
                                    // No more queued actions - end turn
                                    return endTurnCb({ ...loggedState, actionRequired: null, queuedActions: [] });
                                }
                            }
                        }

                        return {
                            ...stateAfterTriggers,
                            actionRequired: nextAction,
                            queuedActions: queueCopy
                        };
                    }

                    // CRITICAL: If we just resolved an interrupt, DON'T call endTurnCb
                    // because it would progress phases based on the ORIGINAL phase (before interrupt).
                    // Instead, check if there are queued actions (like the second delete from Hate-1)
                    // and process them before returning.
                    if (hadInterruptThatResolved) {

                        // CRITICAL FIX: After interrupt resolves, we need to process any queued actions
                        // (like the second delete from Hate-1) before returning.
                        if (stateAfterTriggers.queuedActions && stateAfterTriggers.queuedActions.length > 0) {
                            const queueCopy = [...stateAfterTriggers.queuedActions];
                            const nextAction = queueCopy.shift();

                            // CRITICAL FIX: execute_remaining_custom_effects must be processed by processQueuedActions
                            if ((nextAction as any)?.type === 'execute_remaining_custom_effects') {
                                const stateWithQueue = { ...stateAfterTriggers, queuedActions: [nextAction, ...queueCopy] };
                                const processedState = phaseManager.processQueuedActions(stateWithQueue);
                                if (processedState.actionRequired) {
                                    return processedState;
                                }
                                return stateAfterTriggers; // Return without ending turn
                            }

                            // Return state with next queued action as actionRequired
                            return {
                                ...stateAfterTriggers,
                                actionRequired: nextAction,
                                queuedActions: queueCopy
                            };
                        }

                        // No queued actions - just return the state without ending the turn
                        return stateAfterTriggers;
                    }


                    // NEW: Execute follow-up effect if it exists (Death-1: "then delete this card")
                    if (followUpEffect && sourceCardInfo && sourceCardInfo.card.isFaceUp) {
                        // CRITICAL: Only TOP effects can execute when covered
                        // Middle and Bottom effects require uncovered status
                        const followUpPosition = followUpEffect.position || 'middle';
                        const requiresUncovered = followUpPosition !== 'top';
                        const canExecute = !requiresUncovered || sourceIsUncovered;

                        if (canExecute) {

                            const cardLaneIndex = stateAfterTriggers[sourceCardInfo.owner].lanes.findIndex(l => l.some(c => c.id === originalAction.sourceCardId));
                            const opponent: Player = originalAction.actor === 'player' ? 'opponent' : 'player';
                            const followUpTrigger = followUpEffect.trigger || 'on_play';
                            const context: EffectContext = {
                                cardOwner: originalAction.actor,
                                actor: originalAction.actor,
                                currentTurn: stateAfterTriggers.turn,
                                opponent,
                                triggerType: followUpTrigger as any
                            };
                            const result = executeCustomEffect(sourceCardInfo.card, cardLaneIndex, stateAfterTriggers, context, followUpEffect);
                            stateAfterTriggers = result.newState;

                            // DEBUG: Check if card still exists after deleteSelf
                            const cardStillExists = findCardOnBoard(stateAfterTriggers, originalAction.sourceCardId);

                            // If followUpEffect created an action, return it (don't end turn yet)
                            if (stateAfterTriggers.actionRequired) {
                                return stateAfterTriggers;
                            }
                        }
                    }

                    return endTurnCb(stateAfterTriggers);
                }
            };
            requiresTurnEnd = false; // Callback handles turn progression
            break;
        }
        case 'plague_4_opponent_delete': {
            const cardInfo = findCardOnBoard(prev, targetCardId);
            if (!cardInfo) return { nextState: prev };

            const actor = prev.actionRequired.actor; // The opponent is the one deleting


            newState = log(newState, actor, `Plague-4: Opponent deletes one of their face-down cards.`);

            const newStats = { ...newState.stats[actor], cardsDeleted: newState.stats[actor].cardsDeleted + 1 };
            const newPlayerState = { ...newState[actor], stats: newStats };
            newState = { ...newState, [actor]: newPlayerState, stats: { ...newState.stats, [actor]: newStats } };

            const laneIndex = prev[cardInfo.owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            const lane = prev[cardInfo.owner].lanes[laneIndex];
            const wasTopCard = lane && lane.length > 0 && lane[lane.length - 1].id === targetCardId;

            newState = phaseManager.queuePendingCustomEffects(newState);
            newState.actionRequired = null;
            requiresAnimation = {
                animationRequests: [{ type: 'delete', cardId: targetCardId, owner: cardInfo.owner }],
                onCompleteCallback: (s, endTurnCb) => {
                    // Trigger reactive effects after delete (Hate-3 custom protocol)
                    const reactiveResult = processReactiveEffects(s, 'after_delete', { player: actor });
                    let stateWithTriggers = reactiveResult.newState;

                    if (wasTopCard) {
                        const uncoverResult = handleUncoverEffect(stateWithTriggers, cardInfo.owner, laneIndex);
                        stateWithTriggers = uncoverResult.newState;
                    }

                    // CRITICAL: The flip prompt is for the Plague-4 card owner (the "you" in card text).
                    // We need to find who owns the source card to determine the correct actor.
                    const sourceCardInfo = findCardOnBoard(stateWithTriggers, prev.actionRequired.sourceCardId);
                    const plague4Owner = sourceCardInfo?.owner || prev.turn;

                    const nextAction: ActionRequired = {
                        type: 'plague_4_player_flip_optional',
                        sourceCardId: prev.actionRequired.sourceCardId,
                        optional: true,
                        actor: plague4Owner, // The prompt is for the Plague-4 owner
                    };

                    // If uncover effect created an action, queue the plague_4 flip action
                    if (stateWithTriggers.actionRequired) {
                        stateWithTriggers.queuedActions = [
                            ...(stateWithTriggers.queuedActions || []),
                            nextAction
                        ];
                    } else {
                        stateWithTriggers.actionRequired = nextAction;
                    }
                    return stateWithTriggers;
                }
            };
            requiresTurnEnd = false;
            break;
        }
        // REMOVED: select_own_highest_card_to_delete_for_hate_2 - Hate-2 now uses custom protocol with calculation: 'highest_value'
        // REMOVED: select_opponent_highest_card_to_delete_for_hate_2 - now uses generic select_cards_to_delete
        case 'select_card_to_return': {
            const { sourceCardId, actor } = prev.actionRequired;
            const followUpEffect = (prev.actionRequired as any)?.followUpEffect;
            const conditionalType = (prev.actionRequired as any)?.conditionalType;
            const targetFilter = (prev.actionRequired as any)?.targetFilter;

            // CRITICAL: Validate that target card is uncovered (unless targetFilter explicitly allows covered)
            const targetCardInfo = findCardOnBoard(prev, targetCardId);
            if (targetCardInfo) {
                const lane = prev[targetCardInfo.owner].lanes[targetCardInfo.laneIndex];
                const isUncovered = lane[lane.length - 1]?.id === targetCardId;
                const allowsCovered = targetFilter?.position === 'covered' || targetFilter?.position === 'any';

                if (!isUncovered && !allowsCovered) {
                    console.error(`[cardResolver] Invalid return target: ${targetCardInfo.card.protocol}-${targetCardInfo.card.value} is covered`);
                    return { nextState: prev, requiresTurnEnd: false };
                }
            }

            const result = internalReturnCard(prev, targetCardId);
            newState = result.newState;
            if (result.animationRequests) {
                 requiresAnimation = {
                    animationRequests: result.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.actionRequired) return s;

                        let finalState = s;

                        // NEW: Handle generic followUpEffect for custom protocols ("Return 1. If you do, flip 1.")
                        if (followUpEffect && sourceCardId) {
                            const shouldExecute = conditionalType !== 'if_executed' || targetCardId;

                            if (shouldExecute) {
                                const sourceCard = findCardOnBoard(finalState, sourceCardId);
                                if (sourceCard && sourceCard.card.isFaceUp) {
                                    const lane = finalState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                                    const laneIndex = finalState[sourceCard.owner].lanes.indexOf(lane!);
                                    const context = {
                                        cardOwner: sourceCard.owner,
                                        actor: actor,
                                        currentTurn: finalState.turn,
                                        opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                                    };
                                    const resultEffect = executeCustomEffect(sourceCard.card, laneIndex, finalState, context, followUpEffect);
                                    finalState = resultEffect.newState;

                                    if (finalState.actionRequired) {
                                        return finalState;
                                    }
                                }
                            }
                        }

                        return endTurnCb(finalState);
                    }
                };
            } else {
                // No animation - execute followUp immediately if present
                if (followUpEffect && sourceCardId) {
                    const shouldExecute = conditionalType !== 'if_executed' || targetCardId;

                    if (shouldExecute) {
                        const sourceCard = findCardOnBoard(newState, sourceCardId);
                        if (sourceCard && sourceCard.card.isFaceUp) {
                            const lane = newState[sourceCard.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
                            const laneIndex = newState[sourceCard.owner].lanes.indexOf(lane!);
                            const context = {
                                cardOwner: sourceCard.owner,
                                actor: actor,
                                currentTurn: newState.turn,
                                opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
                            };
                            const resultEffect = executeCustomEffect(sourceCard.card, laneIndex, newState, context, followUpEffect);
                            newState = resultEffect.newState;
                        }
                    }
                }
            }
            // Queue any pending custom effects from multi-effect cards
            newState = phaseManager.queuePendingCustomEffects(newState);
            requiresTurnEnd = !newState.actionRequired && (!newState.queuedActions || newState.queuedActions.length === 0);
            break;
        }
        case 'select_opponent_card_to_return': { // Psychic-4
            const { sourceCardId, actor } = prev.actionRequired;


            const result = internalReturnCard(prev, targetCardId);
            let stateAfterReturn = result.newState;

            // FIX: If the return triggered an interrupt (e.g., uncover effect),
            // queue the self-flip to happen after the interrupt resolves.
            if (stateAfterReturn.actionRequired) {
                const flipAction: ActionRequired = {
                    type: 'flip_self',
                    sourceCardId: sourceCardId,
                    actor: actor,
                };
                // CRITICAL: Self-flip should execute BEFORE pending effects
                stateAfterReturn.queuedActions = [
                    flipAction,  // ← AN DEN ANFANG!
                    ...(stateAfterReturn.queuedActions || []),
                ];
                newState = stateAfterReturn;
                requiresTurnEnd = false; // There's still an action pending
            } else {
                // No interrupt - flip immediately
                const sourceCardInfo = findCardOnBoard(stateAfterReturn, sourceCardId);
                if (sourceCardInfo) {
                    const cardName = `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}`;
                    stateAfterReturn = log(stateAfterReturn, actor, `${cardName}: Flips itself.`);
                    stateAfterReturn = findAndFlipCards(new Set([sourceCardId]), stateAfterReturn);
                    stateAfterReturn.animationState = { type: 'flipCard', cardId: sourceCardId };
                }
                newState = stateAfterReturn;
                requiresTurnEnd = true;
            }

            if (result.animationRequests) {
                requiresAnimation = {
                    animationRequests: result.animationRequests,
                    onCompleteCallback: (s, endTurnCb) => {
                        if (s.actionRequired) return s; // An interrupt happened, will be resolved separately
                        return endTurnCb(s);
                    },
                };
            }
            // Queue any pending custom effects from multi-effect cards
            newState = phaseManager.queuePendingCustomEffects(newState);
            if (!requiresTurnEnd) {
                requiresTurnEnd = !newState.actionRequired && (!newState.queuedActions || newState.queuedActions.length === 0);
            }
            break;
        }
        // REMOVED: select_own_card_to_return_for_water_4 - Water-4 now uses custom protocol with select_card_to_return
        case 'select_any_card_to_flip': { // Life-1
            const cardInfoBeforeFlip = findCardOnBoard(prev, targetCardId);
            const { count, sourceCardId, actor } = prev.actionRequired;

            // Rule: An effect is cancelled if its source card is no longer active.
            const sourceCardInfo = findCardOnBoard(prev, sourceCardId);
            if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
                const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card';
                newState = log(prev, actor, `Effect from ${cardName} was cancelled because the source is no longer active.`);
                newState = phaseManager.queuePendingCustomEffects(newState);
                newState.actionRequired = null;
                requiresTurnEnd = true;
                break;
            }

            let nextActionInChain: ActionRequired = null;
            if (count > 1) {
                nextActionInChain = {
                    type: 'select_any_card_to_flip',
                    count: count - 1,
                    sourceCardId,
                    actor,
                };
            }

            let stateAfterFlip = internalResolveTargetedFlip(prev, targetCardId, nextActionInChain);

            if (cardInfoBeforeFlip && !cardInfoBeforeFlip.card.isFaceUp) {
                const onFlipResult = handleOnFlipToFaceUp(stateAfterFlip, targetCardId);
                const interruptAction = onFlipResult.newState.actionRequired;

                if (interruptAction && interruptAction !== nextActionInChain) {
                    if (nextActionInChain) {
                        onFlipResult.newState.queuedActions = [
                            ...(onFlipResult.newState.queuedActions || []),
                            nextActionInChain
                        ];
                    }
                }

                newState = onFlipResult.newState;
                if (onFlipResult.animationRequests) {
                    requiresAnimation = {
                        animationRequests: onFlipResult.animationRequests,
                        onCompleteCallback: (s, endTurnCb) => {
                            if (s.actionRequired || (s.queuedActions && s.queuedActions.length > 0)) return s;
                            return endTurnCb(s);
                        }
                    };
                }
            } else {
                newState = stateAfterFlip;
            }

            // CRITICAL FIX: Queue pending custom effects (e.g., Life-1's second "Flip 1 card" effect)
            // Life-1 has TWO SEPARATE middleEffects, not ONE effect with count=2.
            // When the first effect completes, _pendingCustomEffects contains the second effect.
            // Without this call, the second flip would never execute, causing a softlock.
            newState = phaseManager.queuePendingCustomEffects(newState);

            requiresTurnEnd = !newState.actionRequired && (!newState.queuedActions || newState.queuedActions.length === 0);
            break;
        }
        // REMOVED: select_card_to_flip_for_light_0 - Light-0 now uses custom protocol with select_card_to_flip + followUpEffect
        // REMOVED: select_any_other_card_to_flip_for_water_0 - Water-0 now uses custom protocol with select_card_to_flip + flip_self followUp
        // REMOVED: select_card_to_flip_and_shift_for_gravity_2 - Gravity-2 now uses custom protocol
        // REMOVED: gravity_2_shift_after_flip - replaced by generic shift_flipped_card_optional
        // REMOVED: select_face_down_card_to_reveal_for_light_2 - Light-2 now uses select_board_card_to_reveal_custom
        case 'select_board_card_to_reveal_custom': {
            const { sourceCardId, actor, followUpAction, optional } = prev.actionRequired;
            const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
            const cardInfo = findCardOnBoard(prev, targetCardId);

            if (!cardInfo) return { nextState: prev, requiresTurnEnd: true };

            // CRITICAL: Temporarily flip the card face-up so the player can see it
            const owner = cardInfo.owner;
            const laneIndex = prev[owner].lanes.findIndex(l => l.some(c => c.id === targetCardId));
            if (laneIndex === -1) return { nextState: prev, requiresTurnEnd: true };

            const lane = [...prev[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === targetCardId);
            if (cardIndex === -1) return { nextState: prev, requiresTurnEnd: true };

            // Flip the card temporarily
            lane[cardIndex] = { ...lane[cardIndex], isFaceUp: true };
            const newLanes = [...prev[owner].lanes];
            newLanes[laneIndex] = lane;

            newState = {
                ...prev,
                [owner]: { ...prev[owner], lanes: newLanes }
            };

            const cardName = `${lane[cardIndex].protocol}-${lane[cardIndex].value}`;
            newState = log(newState, actor, `${actorName} reveals ${cardName}.`);

            // NOTE: No animation here - card is just revealed (temporarily shown), not flipped
            // The visual update happens through state change (isFaceUp: true)

            newState.actionRequired = {
                type: 'prompt_shift_or_flip_board_card_custom',
                sourceCardId,
                revealedCardId: targetCardId,
                followUpAction,
                optional: optional !== false,
                actor,
            };
            requiresTurnEnd = false; // Action has a follow-up
            break;
        }

        case 'select_phase_effect': {
            // Player selected which phase effect (Start/End) to execute first
            // targetCardId is the cardId of the selected effect
            const action = prev.actionRequired as {
                type: 'select_phase_effect';
                actor: Player;
                phase: 'Start' | 'End';
                availableEffects: Array<{ cardId: string; cardName: string; box: 'top' | 'bottom'; effectDescription: string }>;
            };

            // Validate that the selected cardId is in the available effects
            const selectedEffect = action.availableEffects.find(e => e.cardId === targetCardId);
            if (!selectedEffect) {
                console.warn(`[cardResolver] Invalid phase effect selection: ${targetCardId} not in available effects`);
                return { nextState: prev };
            }


            // Store the selected effect ID so processTriggeredEffects knows which one to execute
            const selectedEffectIdKey = action.phase === 'Start' ? '_selectedStartEffectId' : '_selectedEndEffectId';
            (newState as any)[selectedEffectIdKey] = targetCardId;

            // Clear the actionRequired so processTriggeredEffects can continue
            newState.actionRequired = null;

            requiresTurnEnd = false; // The phase will continue
            break;
        }

        default: return { nextState: prev, requiresTurnEnd: true };
    }
    
    // Fallback check: if an action was supposed to be chained but isn't, end the turn.
    if (!requiresAnimation && newState.actionRequired === null) {
        if (newState.queuedActions && newState.queuedActions.length > 0) {
            const newQueue = [...newState.queuedActions];
            const nextAction = newQueue.shift();

            // CRITICAL: execute_remaining_custom_effects should NOT be set as actionRequired!
            // It's an internal action that should be processed by processQueuedActions in phaseManager
            if (nextAction?.type === 'execute_remaining_custom_effects') {
                // Put it back in queue and return with no action required
                // This will trigger turnProgressionCb -> processEndOfAction -> processQueuedActions
                const stateWithQueue = phaseManager.queuePendingCustomEffects(newState);
                return { nextState: { ...stateWithQueue, actionRequired: null, queuedActions: [nextAction, ...newQueue] }, requiresTurnEnd: false };
            }

            // CRITICAL: Validate shift actions before setting as actionRequired!
            // If the source card (e.g., Darkness-1, Gravity-2) was flipped face-down/covered during the interrupt,
            // the shift action must be cancelled.
            if (nextAction?.type === 'shift_flipped_card_optional' || nextAction?.type === 'gravity_2_shift_after_flip') {
                const sourceCardInfo = findCardOnBoard(newState, nextAction.sourceCardId);
                const sourceIsUncovered = isCardUncovered(newState, nextAction.sourceCardId);

                if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp || !sourceIsUncovered) {
                    // Source card was deleted/returned/flipped face-down/covered → Cancel the shift
                    const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
                    const loggedState = log(newState, nextAction.actor, `Shift from ${cardName} was cancelled because the source is no longer active.`);

                    // Continue processing remaining queue
                    if (newQueue.length > 0) {
                        const nextNextAction = newQueue.shift();
                        // CRITICAL FIX: execute_remaining_custom_effects must be processed properly
                        if ((nextNextAction as any)?.type === 'execute_remaining_custom_effects') {
                            const stateWithQueue = { ...loggedState, queuedActions: [nextNextAction, ...newQueue] };
                            return { nextState: stateWithQueue, requiresTurnEnd: false };
                        }
                        return { nextState: { ...loggedState, actionRequired: nextNextAction, queuedActions: newQueue }, requiresTurnEnd: false };
                    } else {
                        return { nextState: { ...loggedState, actionRequired: null, queuedActions: [] }, requiresTurnEnd: true };
                    }
                }
            }

            // CRITICAL FIX: execute_remaining_custom_effects is an internal action
            // It must be processed by processQueuedActions, not set as actionRequired
            if ((nextAction as any)?.type === 'execute_remaining_custom_effects') {
                const stateWithQueue = { ...newState, queuedActions: [nextAction, ...newQueue] };
                return { nextState: stateWithQueue, requiresTurnEnd: false };
            }

            return { nextState: { ...newState, actionRequired: nextAction, queuedActions: newQueue }, requiresTurnEnd: false };
        }
    } else if (!requiresAnimation && newState.actionRequired !== null) {
        requiresTurnEnd = false;
    }


    return { nextState: newState, requiresAnimation, requiresTurnEnd };
};