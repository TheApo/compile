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
    // Extract conditional info for "If you do" effects
    const conditional = params._conditional;
    const actor = params.actor === 'opponent' ? context.opponent : cardOwner;

    // NEW: Handle useCardFromPreviousEffect (Clarity-1: discard the revealed deck top card)
    if (params.useCardFromPreviousEffect && state.lastCustomEffectTargetCardId) {
        const targetCardId = state.lastCustomEffectTargetCardId;
        let newState = { ...state };
        const actorState = { ...newState[actor] };
        const cardName = `${card.protocol}-${card.value}`;
        const actorName = actor === 'player' ? 'Player' : 'Opponent';


        // Find the card - it could be in deck (Clarity-1 revealed top)
        const deckIndex = actorState.deck.findIndex((c: any) => c.id === targetCardId);
        if (deckIndex !== -1) {
            // CRITICAL: Create new array copies to avoid mutation issues
            const newDeck = [...actorState.deck];
            const discardedCard = newDeck.splice(deckIndex, 1)[0];
            actorState.deck = newDeck;
            actorState.discard = [...actorState.discard, discardedCard];
            newState[actor] = actorState;
            newState = log(newState, actor, `${actorName} discards ${discardedCard.protocol}-${discardedCard.value} from their deck.`);

            // Store context for follow-up effects
            (newState as any)._discardContext = {
                actor,
                discardedCount: 1,
                sourceCardId: card.id,
            };

            return { newState };
        }

        // Could also be in hand - check there too
        const handIndex = actorState.hand.findIndex((c: any) => c.id === targetCardId);
        if (handIndex !== -1) {
            // CRITICAL: Create new array copies to avoid mutation issues
            const newHand = [...actorState.hand];
            const discardedCard = newHand.splice(handIndex, 1)[0];
            const { id, isFaceUp, ...cardWithoutExtras } = discardedCard as any;
            actorState.hand = newHand;
            actorState.discard = [...actorState.discard, cardWithoutExtras];
            newState[actor] = actorState;
            newState = log(newState, actor, `${actorName} discards ${discardedCard.protocol}-${discardedCard.value}.`);

            (newState as any)._discardContext = {
                actor,
                discardedCount: 1,
                sourceCardId: card.id,
            };

            return { newState };
        }

        // Card not found - skip effect
        console.warn(`[Discard Effect] useCardFromPreviousEffect: Card ${targetCardId} not found`);
        newState = log(newState, actor, `${cardName}: Card to discard not found - effect skipped.`);
        (newState as any)._discardContext = { discardedCount: 0 };
        return { newState };
    }

    // NEW: Handle dynamic discard count (Plague-2)
    let count = params.count || 1;
    const countType = params.countType || 'fixed';

    if (countType === 'equal_to_discarded') {
        // Use discardedCount from context (from previous discard in the chain)
        const rawCount = (context.discardedCount || 0) + (params.countOffset || 0);
        // CRITICAL: Limit to actual hand size (like original Plague-2)
        count = Math.min(rawCount, state[actor].hand.length);

        // If count is 0 or negative, skip the discard
        if (count <= 0) {
            return { newState: state };
        }
    }

    // CRITICAL FIX: Check if actor has any cards to discard
    if (state[actor].hand.length === 0) {
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
    }

    // CRITICAL: Always limit count to actual hand size (prevents softlock)
    // Also log when partial discard happens
    const requestedCount = count;
    if (typeof count === 'number' && count > state[actor].hand.length) {
        count = state[actor].hand.length;
    }
    // Log partial discard (only when not in upTo mode, since upTo is already voluntary)
    const willLogPartialDiscard = !params.upTo && typeof requestedCount === 'number' && requestedCount > count;

    // Random discard: automatically select random card(s) without user choice
    if (params.random && actor !== cardOwner) {
        const handCards = [...state[actor].hand];
        const actualCount = Math.min(count as number, handCards.length);

        // Select random cards
        const selectedIndices: number[] = [];
        const availableIndices = handCards.map((_, i) => i);

        for (let i = 0; i < actualCount && availableIndices.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * availableIndices.length);
            selectedIndices.push(availableIndices[randomIndex]);
            availableIndices.splice(randomIndex, 1);
        }

        // Sort descending to safely remove from array
        selectedIndices.sort((a, b) => b - a);

        const discardedCards: any[] = [];
        const newHand = [...handCards];

        for (const idx of selectedIndices) {
            const { id, isFaceUp, ...card } = newHand.splice(idx, 1)[0] as any;
            discardedCards.push(card);
        }

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
        const cardWord = discardedCards.length === 1 ? 'card' : 'cards';
        if (actor === 'player' || discardedCards.every(c => c.isRevealed)) {
            const cardNames = discardedCards.map(c => `${c.protocol}-${c.value}`).join(', ');
            newState = log(newState, actor, `${actorName} randomly discards ${discardedCards.length} ${cardWord}: ${cardNames}.`);
        } else {
            newState = log(newState, actor, `${actorName} randomly discards ${discardedCards.length} ${cardWord}.`);
        }

        // Store context for follow-up effects
        (newState as any)._discardContext = {
            actor,
            discardedCount: discardedCards.length,
            sourceCardId: card.id,
        };

        return { newState };
    }

    // Auto-execute "discard all"
    // When count is 'all', automatically discard entire hand without user selection
    if (count === 'all') {
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
        // CRITICAL: Pass conditional info for "If you do" effects
        followUpEffect: conditional?.thenEffect,
        conditionalType: conditional?.type,
    } as any;

    return { newState };
}
