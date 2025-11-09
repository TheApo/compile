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
                            (effect: any) => effect.trigger === triggerType
                        );

                        if (matchingEffects.length > 0) {
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

        // Execute all matching effects for this card
        for (const effectDef of matchingEffects) {
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
