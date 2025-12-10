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

    // IMPORTANT: Prevent recursive reactive effect triggering
    // If we're already processing reactive effects, don't trigger new ones
    if ((newState as any)._processingReactiveEffects) {
        console.log(`[Reactive Effects] Already processing reactive effects, skipping ${triggerType}`);
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

                const customCard = card as any;
                if (!customCard.customEffects) return;

                const isUncovered = cardIndex === lane.length - 1;

                // Rule: Top box effects are active if the card is face-up, even if covered
                if (customCard.customEffects.topEffects && hasMatchingTrigger(customCard.customEffects.topEffects)) {
                    // CRITICAL: Skip if this card already triggered for certain trigger types this turn
                    if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                        console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} after_clear_cache - already triggered this turn`);
                        return;
                    }
                    reactiveCards.push({ card, owner: player, laneIndex, box: 'top' });
                }

                // Rule: Middle box effects are active if the card is face-up, even if covered
                if (customCard.customEffects.middleEffects && hasMatchingTrigger(customCard.customEffects.middleEffects)) {
                    if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                        console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} after_clear_cache (middle) - already triggered this turn`);
                        return;
                    }
                    reactiveCards.push({ card, owner: player, laneIndex, box: 'middle' });
                }

                // Rule: Bottom box effects are ONLY active if the card is face-up AND uncovered
                if (isUncovered && customCard.customEffects.bottomEffects && hasMatchingTrigger(customCard.customEffects.bottomEffects)) {
                    if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                        console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} after_clear_cache (bottom) - already triggered this turn`);
                        return;
                    }
                    reactiveCards.push({ card, owner: player, laneIndex, box: 'bottom' });
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

    console.log(`[Reactive Effects] Found ${reactiveCards.length} card(s) with ${triggerType} trigger`);

    // Execute all matching reactive effects
    for (const { card, owner, laneIndex, box } of reactiveCards) {
        // Re-validate: card must still be face-up (and uncovered for bottom effects)
        const currentLane = newState[owner].lanes[laneIndex];
        const cardIndex = currentLane?.findIndex(c => c.id === card.id);
        const cardStillExists = cardIndex !== undefined && cardIndex !== -1 && currentLane[cardIndex]?.isFaceUp;

        if (!cardStillExists) {
            console.log(`[Reactive Effects] Card ${card.protocol}-${card.value} no longer face-up, skipping`);
            continue;
        }

        // For bottom effects, also check if still uncovered
        if (box === 'bottom') {
            const isStillUncovered = cardIndex === currentLane.length - 1;
            if (!isStillUncovered) {
                console.log(`[Reactive Effects] Card ${card.protocol}-${card.value} no longer uncovered (bottom effect), skipping`);
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
                    console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} ${triggerType} - card owner (${owner}) is not the opponent of discarder (${context.player})`);
                    return false;
                }
                return true;
            }

            // Check if this effect should trigger based on who performed the action
            if (triggerActor === 'self') {
                // Only trigger if card owner performed the action
                if (context.player !== owner) {
                    console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} ${triggerType} - triggerActor=self, but triggered by ${context.player} (owner: ${owner})`);
                    return false;
                }
            } else if (triggerActor === 'opponent') {
                // Only trigger if opponent performed the action
                if (context.player === owner) {
                    console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} ${triggerType} - triggerActor=opponent, but triggered by ${context.player} (owner: ${owner})`);
                    return false;
                }
            }
            // triggerActor === 'any' -> always trigger

            // NEW: Check reactiveScope for lane-based trigger filtering (Ice-1 Bottom)
            const reactiveScope = (effect as any).reactiveScope || 'global';
            if (reactiveScope === 'this_lane' && context?.laneIndex !== undefined) {
                // Only trigger if the event happened in the same lane as this card
                if (laneIndex !== context.laneIndex) {
                    console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} ${triggerType} - reactiveScope=this_lane, event in lane ${context.laneIndex}, card in lane ${laneIndex}`);
                    return false;
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
        newState = setLogPhase(newState, undefined); // Top box effects have no phase marker

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
            console.log(`[Reactive Effects] Marked ${cardName} as processed for after_clear_cache`);
        }
        // NOTE: after_draw triggers are NOT marked as processed!
        // Spirit-3 should be able to trigger on every separate draw event.

        // Execute all filtered effects for this card
        for (const effectDef of filteredEffects) {
            const result = executeCustomEffect(card, laneIndex, newState, effectContext, effectDef);
            newState = recalculateAllLaneValues(result.newState);

            // If an action is required, stop and return
            if (newState.actionRequired) {
                console.log(`[Reactive Effects] Action required after ${cardName} reactive effect`);

                // CRITICAL: If there are pending effects from the original card (e.g., Darkness-0 shift
                // being interrupted by Spirit-3 after_draw), queue them to execute after the reactive prompt
                const pendingEffects = (newState as any)._pendingCustomEffects;
                if (pendingEffects && pendingEffects.effects.length > 0) {
                    console.log(`[Reactive Effects] Queueing ${pendingEffects.effects.length} pending effects from original card`);
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
                return { newState };
            }
        }

        // Clear logging context
        newState = decreaseLogIndent(newState);
        newState = setLogSource(newState, undefined);
        newState = setLogPhase(newState, undefined);
    }

    // Clear recursion flag before returning
    delete (newState as any)._processingReactiveEffects;
    return { newState };
}
