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

    // CRITICAL: Track processed clear_cache triggers to prevent infinite loops
    // (like Speed_custom-1: after_clear_cache draws a card, which triggers another clear_cache)
    const processedClearCacheTriggerIds = (newState as any).processedClearCacheTriggerIds || [];

    // Find all face-up custom protocol cards with matching reactive trigger
    const reactiveCards: Array<{ card: PlayedCard; owner: Player; laneIndex: number; box: 'top' }> = [];

    // Search both players' lanes for reactive trigger cards
    for (const player of ['player', 'opponent'] as Player[]) {
        newState[player].lanes.forEach((lane, laneIndex) => {
            lane.forEach(card => {
                // Rule: Top box effects are active if the card is face-up, even if covered
                if (card.isFaceUp) {
                    const customCard = card as any;
                    if (customCard.customEffects && customCard.customEffects.topEffects) {
                        const matchingEffects = customCard.customEffects.topEffects.filter(
                            (effect: any) => {
                                // Match exact trigger
                                if (effect.trigger === triggerType) return true;
                                // Also match on_cover_or_flip for both on_cover and on_flip events
                                if (effect.trigger === 'on_cover_or_flip' && (triggerType === 'on_cover' || triggerType === 'on_flip')) return true;
                                return false;
                            }
                        );

                        if (matchingEffects.length > 0) {
                            // CRITICAL: Skip if this card already triggered for after_clear_cache this turn
                            if (triggerType === 'after_clear_cache' && processedClearCacheTriggerIds.includes(card.id)) {
                                console.log(`[Reactive Effects] Skipping ${card.protocol}-${card.value} after_clear_cache - already triggered this turn`);
                                return;
                            }
                            reactiveCards.push({ card, owner: player, laneIndex, box: 'top' });
                        }
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

    console.log(`[Reactive Effects] Found ${reactiveCards.length} card(s) with ${triggerType} trigger`);

    // Execute all matching reactive effects
    for (const { card, owner, laneIndex } of reactiveCards) {
        // Re-validate: card must still be face-up
        const currentLane = newState[owner].lanes[laneIndex];
        const cardStillExists = currentLane?.some(c => c.id === card.id && c.isFaceUp);

        if (!cardStillExists) {
            console.log(`[Reactive Effects] Card ${card.protocol}-${card.value} no longer face-up, skipping`);
            continue;
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
        const matchingEffects = customCard.customEffects.topEffects.filter(
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

        // Log trigger activation
        const triggerLabel = getTriggerLabel(triggerType);
        newState = log(newState, owner, `${triggerLabel}: ${cardName} triggers.`);

        // Build effect context
        const opponent = owner === 'player' ? 'opponent' : 'player';
        const effectContext: EffectContext = {
            cardOwner: owner,
            actor: owner,
            currentTurn: newState.turn,
            opponent,
            triggerType: triggerType as any,
        };

        // CRITICAL: Mark this card as processed for after_clear_cache to prevent infinite loops
        if (triggerType === 'after_clear_cache') {
            const currentProcessedIds = (newState as any).processedClearCacheTriggerIds || [];
            (newState as any).processedClearCacheTriggerIds = [...currentProcessedIds, card.id];
            console.log(`[Reactive Effects] Marked ${cardName} as processed for after_clear_cache`);
        }

        // Execute all filtered effects for this card
        for (const effectDef of filteredEffects) {
            const result = executeCustomEffect(card, laneIndex, newState, effectContext, effectDef);
            newState = recalculateAllLaneValues(result.newState);

            // If an action is required, stop and return
            if (newState.actionRequired) {
                console.log(`[Reactive Effects] Action required after ${cardName} reactive effect`);
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

/**
 * Get human-readable label for trigger type
 */
function getTriggerLabel(trigger: EffectTrigger): string {
    switch (trigger) {
        case 'after_delete': return 'After you delete cards';
        case 'after_opponent_discard': return 'After opponent discards';
        case 'after_draw': return 'After you draw cards';
        case 'after_clear_cache': return 'After you clear cache';
        case 'before_compile_delete': return 'Before deleted by compile';
        case 'after_flip': return 'After cards are flipped';
        case 'after_shift': return 'After cards are shifted';
        case 'after_play': return 'After cards are played';
        case 'on_flip': return 'When this card would be flipped';
        case 'on_cover_or_flip': return 'When this card would be covered or flipped';
        default: return trigger;
    }
}
