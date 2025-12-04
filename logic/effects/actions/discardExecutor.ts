/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discard Effect Executor
 *
 * Handles all discard-related effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';

/**
 * Execute DISCARD effect
 */
export function executeDiscardEffect(
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
