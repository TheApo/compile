/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectContext, EffectResult } from '../../types';
import { EffectTrigger } from '../../types/customProtocol';
import { executeCustomEffect } from '../customProtocols/effectInterpreter';
import { recalculateAllLaneValues } from './stateManager';
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from '../utils/log';

/**
 * Process reactive effects after a game event
 * Finds all face-up custom protocol cards with matching reactive triggers and executes them
 */
export function processReactiveEffects(
    state: GameState,
    triggerType: EffectTrigger,
    context?: {
        player?: Player;          // Player who triggered the event
        cardId?: string;          // Specific card involved (for before_compile_delete, on_flip)
        count?: number;           // Count for after_draw, etc.
        laneIndex?: number;       // Lane where the event happened (for reactiveScope filtering)
    }
): EffectResult {
    let newState = { ...state };
    // CRITICAL FIX: Collect ALL animation requests from reactive effects
    const allAnimationRequests: EffectResult['animationRequests'] = [];

    // IMPORTANT: Prevent recursive reactive effect triggering
    // If we're already processing reactive effects, don't trigger new ones
    if ((newState as any)._processingReactiveEffects) {
        return { newState };
    }

    // Set flag to prevent recursion
    newState = { ...newState, _processingReactiveEffects: true } as any;

    // CRITICAL: Track processed triggers to prevent infinite loops and double-triggering
    // (like Speed_custom-1: after_clear_cache draws a card, which triggers another clear_cache)
    // NOTE: after_clear_cache should only trigger once per turn (when hand limit is checked)
    const processedClearCacheTriggerIds = (newState as any).processedClearCacheTriggerIds || [];
    // NOTE: after_draw triggers are NOT tracked across different draw events!
    // Spirit-3 should trigger on EVERY draw, just not multiple times within the same draw event.
    // The _processingReactiveEffects flag already prevents recursive triggering within the same event.

    // Find all face-up custom protocol cards with matching reactive trigger
    const reactiveCards: Array<{ card: PlayedCard; owner: Player; laneIndex: number; box: 'top' | 'middle' | 'bottom' }> = [];

    // Helper function to check if effects match the trigger
    const hasMatchingTrigger = (effects: any[]): boolean => {
        return effects.some((effect: any) => {
            if (effect.trigger === triggerType) return true;
            if (effect.trigger === 'on_cover_or_flip' && (triggerType === 'on_cover' || triggerType === 'on_flip')) return true;
            return false;
        });
    };

    // Search both players' lanes for reactive trigger cards
    for (const player of ['player', 'opponent'] as Player[]) {
        newState[player].lanes.forEach((lane, laneIndex) => {
            lane.forEach((card, cardIndex) => {
                if (!card.isFaceUp) return;

                // CRITICAL: Committed cards cannot trigger reactive effects
                // Per rules: "While a card is committed... it cannot be manipulated in any way by another game effect"
                // This also means the committed card's own effects don't trigger until it lands
                const committedCardId = (newState as any)._committedCardId;
                if (committedCardId && card.id === committedCardId) return;

                const customCard = card as any;
                if (!customCard.customEffects) return;

                const isUncovered = cardIndex === lane.length - 1;

                // Rule: Top box effects are active if the card is face-up, even if covered
                if (customCard.customEffects.topEffects && hasMatchingTrigger(customCard.customEffects.topEffects)) {
                    // CRITICAL: Skip if this card already triggered for certain trigger types this turn
                    if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                        return;
                    }
                    reactiveCards.push({ card, owner: player, laneIndex, box: 'top' });
                }

                // Rule: Middle box effects are active if the card is face-up, even if covered
                if (customCard.customEffects.middleEffects && hasMatchingTrigger(customCard.customEffects.middleEffects)) {
                    if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                        return;
                    }
                    reactiveCards.push({ card, owner: player, laneIndex, box: 'middle' });
                }

                // Rule: Bottom box effects are ONLY active if the card is face-up AND uncovered
                // CRITICAL: Skip 'on_cover' trigger for bottom effects - these are handled by executeOnCoverEffect
                // processReactiveEffects should only handle REACTIVE triggers (on_cover_or_flip, after_draw, etc.)
                if (isUncovered && customCard.customEffects.bottomEffects) {
                    // Filter out pure 'on_cover' effects - they're handled by executeOnCoverEffect in playResolver
                    const reactiveBottomEffects = customCard.customEffects.bottomEffects.filter((e: any) =>
                        e.trigger !== 'on_cover'
                    );
                    if (reactiveBottomEffects.length > 0 && hasMatchingTrigger(reactiveBottomEffects)) {
                        if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                            return;
                        }
                        reactiveCards.push({ card, owner: player, laneIndex, box: 'bottom' });
                    }
                }
            });
        });
    }

    // No reactive cards found
    if (reactiveCards.length === 0) {
        // Clear recursion flag before returning
        delete (newState as any)._processingReactiveEffects;
        return { newState };
    }


    // Execute all matching reactive effects
    for (const { card, owner, laneIndex, box } of reactiveCards) {
        // Re-validate: card must still be face-up (and uncovered for bottom effects)
        const currentLane = newState[owner].lanes[laneIndex];
        const cardIndex = currentLane?.findIndex(c => c.id === card.id);
        const cardStillExists = cardIndex !== undefined && cardIndex !== -1 && currentLane[cardIndex]?.isFaceUp;

        if (!cardStillExists) {
            continue;
        }

        // For bottom effects, also check if still uncovered
        if (box === 'bottom') {
            const isStillUncovered = cardIndex === currentLane.length - 1;
            if (!isStillUncovered) {
                continue;
            }
        }

        // Special handling for before_compile_delete: only trigger for the specific card
        if (triggerType === 'before_compile_delete' && context?.cardId !== card.id) {
            continue;
        }

        // Special handling for on_flip: only trigger for the specific card being flipped
        if (triggerType === 'on_flip' && context?.cardId !== card.id) {
            continue;
        }

        // Special handling for on_cover_or_flip: only trigger for the specific card
        if (triggerType === 'on_cover' || triggerType === 'on_flip') {
            // on_cover_or_flip should also match if cardId is relevant
            if (context?.cardId && context.cardId !== card.id) {
                continue;
            }
        }

        const customCard = card as any;
        // Get effects from the correct box (top, middle, or bottom)
        const effectsFromBox = box === 'top' ? customCard.customEffects.topEffects :
                               box === 'middle' ? customCard.customEffects.middleEffects :
                               customCard.customEffects.bottomEffects;

        const matchingEffects = effectsFromBox.filter(
            (effect: any) => {
                // Match exact trigger OR on_cover_or_flip for both on_cover and on_flip events
                if (effect.trigger === triggerType) {
                    return true;
                }
                if (effect.trigger === 'on_cover_or_flip' && (triggerType === 'on_cover' || triggerType === 'on_flip')) {
                    return true;
                }
                return false;
            }
        );

        // CRITICAL: Filter effects based on reactiveTriggerActor
        // Default is 'self' (only when card owner performs action)
        const filteredEffects = matchingEffects.filter((effect: any) => {
            const triggerActor = effect.reactiveTriggerActor || 'self';

            if (!context?.player) {
                // No context player - trigger for everyone (backwards compatibility)
                return true;
            }

            // Special case: after_opponent_discard
            // context.player is the OPPONENT of the discarding player (i.e., the one who should benefit)
            // The card should trigger if its owner IS context.player (they are the opponent of the discarder)
            if (triggerType === 'after_opponent_discard') {
                if (context.player !== owner) {
                    return false;
                }
                return true;
            }

            // Special case: after_opponent_draw (Mirror-4)
            // context.player is the OPPONENT of the drawing player (i.e., the one who should benefit)
            // The card should trigger if its owner IS context.player (they are the opponent of the drawer)
            if (triggerType === 'after_opponent_draw') {
                if (context.player !== owner) {
                    return false;
                }
                return true;
            }

            // Special case: after_opponent_refresh (War-1)
            // context.player is the OPPONENT of the refreshing player
            // The card should trigger if its owner IS context.player
            if (triggerType === 'after_opponent_refresh') {
                if (context.player !== owner) {
                    return false;
                }
                return true;
            }

            // Special case: after_opponent_compile (War-2)
            // context.player is the NON-compiler (opponent of the compiling player)
            // The card should trigger if its owner IS context.player
            if (triggerType === 'after_opponent_compile') {
                if (context.player !== owner) {
                    return false;
                }
                return true;
            }

            // Check if this effect should trigger based on who performed the action
            if (triggerActor === 'self') {
                // Only trigger if card owner performed the action
                if (context.player !== owner) {
                    return false;
                }
            } else if (triggerActor === 'opponent') {
                // Only trigger if opponent performed the action
                if (context.player === owner) {
                    return false;
                }
            }
            // triggerActor === 'any' -> always trigger

            // NEW: Check reactiveScope for lane-based trigger filtering (Ice-1 Bottom)
            const reactiveScope = (effect as any).reactiveScope || 'global';
            if (reactiveScope === 'this_lane' && context?.laneIndex !== undefined) {
                // Only trigger if the event happened in the same lane as this card
                if (laneIndex !== context.laneIndex) {
                    return false;
                }
            }

            // NEW: Check onlyDuringOpponentTurn (Peace-4)
            // This card should only trigger during opponent's turn
            if ((effect as any).onlyDuringOpponentTurn) {
                // owner = card owner, newState.turn = whose turn it currently is
                if (newState.turn === owner) {
                    return false;  // Skip - it's the card owner's turn, not opponent's
                }
            }

            return true;
        });

        // Skip if no effects passed the filter
        if (filteredEffects.length === 0) {
            continue;
        }

        // Set logging context
        const cardName = `${card.protocol}-${card.value}`;
        newState = increaseLogIndent(newState);
        newState = setLogSource(newState, cardName);
        newState = setLogPhase(newState, 'after'); // Reactive effects get [After] prefix

        // Build effect context
        const opponent = owner === 'player' ? 'opponent' : 'player';
        const effectContext: EffectContext = {
            cardOwner: owner,
            actor: owner,
            currentTurn: newState.turn,
            opponent,
            triggerType: triggerType as any,
        };

        // CRITICAL: Mark this card as processed to prevent re-triggering
        if (triggerType === 'after_clear_cache') {
            const currentProcessedIds = (newState as any).processedClearCacheTriggerIds || [];
            (newState as any).processedClearCacheTriggerIds = [...currentProcessedIds, card.id];
        }
        // NOTE: after_draw triggers are NOT marked as processed!
        // Spirit-3 should be able to trigger on every separate draw event.

        // Execute all filtered effects for this card
        for (const effectDef of filteredEffects) {
            const result = executeCustomEffect(card, laneIndex, newState, effectContext, effectDef);
            newState = recalculateAllLaneValues(result.newState);

            // CRITICAL FIX: Collect animation requests from this effect
            if (result.animationRequests) {
                allAnimationRequests.push(...result.animationRequests);
            }

            // CRITICAL: Also accumulate animation requests on the state for nested effects
            // This allows the UI layer to pick them up after callbacks complete
            if (result.animationRequests && result.animationRequests.length > 0) {
                const existing = (newState as any)._pendingAnimationRequests || [];
                (newState as any)._pendingAnimationRequests = [...existing, ...result.animationRequests];
            }

            // If an action is required, stop and return
            if (newState.actionRequired) {
                // CRITICAL FIX: If the reactive effect created an action for a different player than the current turn,
                // we need to mark this as an interrupt so the turn flow returns correctly after the action completes.
                const actionActor = (newState.actionRequired as any).actor || owner;
                if (actionActor !== state.turn && !newState._interruptedTurn) {
                    newState._interruptedTurn = state.turn;
                    newState._interruptedPhase = state.phase;
                    // CRITICAL FIX: Save _cardPlayedThisActionPhase so it can be restored after interrupt
                    newState._interruptedCardPlayedFlag = state._cardPlayedThisActionPhase;
                    newState.turn = actionActor;
                }

                // CRITICAL: If there are pending effects from the original card (e.g., Darkness-0 shift
                // being interrupted by Spirit-3 after_draw), queue them to execute after the reactive prompt
                const pendingEffects = (newState as any)._pendingCustomEffects;
                if (pendingEffects && pendingEffects.effects.length > 0) {
                    const pendingAction: any = {
                        type: 'execute_remaining_custom_effects',
                        sourceCardId: pendingEffects.sourceCardId,
                        laneIndex: pendingEffects.laneIndex,
                        effects: pendingEffects.effects,
                        context: pendingEffects.context,
                        actor: pendingEffects.context.cardOwner,
                    };
                    newState.queuedActions = [
                        pendingAction,
                        ...(newState.queuedActions || [])
                    ];
                    delete (newState as any)._pendingCustomEffects;
                }

                // Clear recursion flag before returning
                delete (newState as any)._processingReactiveEffects;
                // Return with collected animation requests
                return { newState, animationRequests: allAnimationRequests.length > 0 ? allAnimationRequests : undefined };
            }
        }

        // Clear logging context
        newState = decreaseLogIndent(newState);
        newState = setLogSource(newState, undefined);
        newState = setLogPhase(newState, undefined);
    }

    // Clear recursion flag before returning
    delete (newState as any)._processingReactiveEffects;
    // Return with all collected animation requests
    return { newState, animationRequests: allAnimationRequests.length > 0 ? allAnimationRequests : undefined };
}
