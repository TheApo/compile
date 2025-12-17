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

    // NEW: Handle 'both' actor (Peace-1: "Both players discard their hand")
    if (params.actor === 'both') {
        let newState = { ...state };

        // Helper function to discard a player's hand
        const discardHand = (player: Player): { discardedCount: number; discardedCards: any[] } => {
            const hand = newState[player].hand;
            if (hand.length === 0) {
                return { discardedCount: 0, discardedCards: [] };
            }
            const discardedCards = hand.map(({ id, isFaceUp, ...c }: any) => c);
            newState[player] = {
                ...newState[player],
                hand: [],
                discard: [...newState[player].discard, ...discardedCards],
                stats: { ...newState[player].stats, cardsDiscarded: newState[player].stats.cardsDiscarded + discardedCards.length }
            };
            return { discardedCount: discardedCards.length, discardedCards };
        };

        // First: Card owner discards
        const ownerResult = discardHand(cardOwner);
        const ownerName = cardOwner === 'player' ? 'Player' : 'Opponent';
        if (ownerResult.discardedCount > 0) {
            const cardNames = ownerResult.discardedCards.map((c: any) => `${c.protocol}-${c.value}`).join(', ');
            newState = log(newState, cardOwner, `${ownerName} discards their hand (${ownerResult.discardedCount} cards: ${cardNames}).`);
        } else {
            newState = log(newState, cardOwner, `${ownerName} has no cards to discard.`);
        }

        // Then: Opponent discards
        const oppResult = discardHand(context.opponent);
        const oppName = context.opponent === 'player' ? 'Player' : 'Opponent';
        if (oppResult.discardedCount > 0) {
            const cardNames = oppResult.discardedCards.map((c: any) => `${c.protocol}-${c.value}`).join(', ');
            newState = log(newState, context.opponent, `${oppName} discards their hand (${oppResult.discardedCount} cards: ${cardNames}).`);
        } else {
            newState = log(newState, context.opponent, `${oppName} has no cards to discard.`);
        }

        // Store context for follow-up effects
        (newState as any)._discardContext = {
            actor: 'both',
            discardedCount: ownerResult.discardedCount + oppResult.discardedCount,
            sourceCardId: card.id,
        };

        return { newState };
    }

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

    // Handle discard from top of deck or entire deck
    const source = params.source || 'hand';

    // NEW: Time-1 - Discard entire deck
    if (source === 'entire_deck') {
        let newState = { ...state };
        const ownerState = { ...newState[cardOwner] };
        const cardName = `${card.protocol}-${card.value}`;

        // Check if deck has cards
        if (ownerState.deck.length === 0) {
            newState = log(newState, cardOwner, `${cardName}: No cards in deck - effect skipped.`);
            (newState as any)._effectSkippedNoTargets = true;
            (newState as any)._discardContext = { discardedCount: 0 };
            return { newState };
        }

        // Move all cards from deck to discard
        const discardedCount = ownerState.deck.length;
        const discardedCards = [...ownerState.deck];
        ownerState.discard = [...ownerState.discard, ...discardedCards];
        ownerState.deck = [];
        newState[cardOwner] = ownerState;

        newState = log(newState, cardOwner, `${cardName}: Discards entire deck (${discardedCount} card${discardedCount !== 1 ? 's' : ''}).`);

        // Store context for follow-up effects
        (newState as any)._discardContext = {
            actor: cardOwner,
            discardedCount,
            sourceCardId: card.id,
        };

        return { newState };
    }

    if (source === 'top_deck_own' || source === 'top_deck_opponent') {
        const deckOwner = source === 'top_deck_own' ? cardOwner : context.opponent;
        let newState = { ...state };
        const deckOwnerState = { ...newState[deckOwner] };
        const possessiveOwner = deckOwner === cardOwner ? 'your' : "opponent's";

        // Check if deck has cards
        if (deckOwnerState.deck.length === 0) {
            newState = log(newState, cardOwner, `No cards in ${possessiveOwner} deck - effect skipped.`);
            (newState as any)._effectSkippedNoTargets = true;
            (newState as any)._discardContext = { discardedCount: 0 };
            return { newState };
        }

        // Take top card from deck
        const newDeck = [...deckOwnerState.deck];
        const discardedCard = newDeck.shift()!;  // Remove from top (index 0)
        deckOwnerState.deck = newDeck;
        deckOwnerState.discard = [...deckOwnerState.discard, discardedCard];
        newState[deckOwner] = deckOwnerState;

        // Log the discard with revealed card info
        newState = log(newState, cardOwner, `Discard the top card of ${possessiveOwner} deck: ${discardedCard.protocol}-${discardedCard.value}.`);

        // CRITICAL: Store the card ID AND value for follow-up effects
        newState.lastCustomEffectTargetCardId = discardedCard.id;
        newState.lastCustomEffectTargetValue = discardedCard.value;

        // Store context for follow-up effects
        (newState as any)._discardContext = {
            actor: deckOwner,
            discardedCount: 1,
            sourceCardId: card.id,
            discardedCardValue: discardedCard.value,
            discardedCardProtocol: discardedCard.protocol,
        };

        // Show modal to display the discarded card (pass full card for proper display)
        newState.actionRequired = {
            type: 'confirm_deck_discard',
            actor: cardOwner,  // The player who triggered the effect
            sourceCardId: card.id,
            discardedCard: discardedCard,  // Pass full card object for CardComponent
            deckOwner: source === 'top_deck_own' ? 'own' : 'opponent',
            // CRITICAL: Pass conditional info for follow-up effects (e.g., Luck-2: draw cards)
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
            laneIndex,  // Needed for executing follow-up effect
        } as any;

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
        // Save indent level for correct log formatting when follow-up effects are queued
        _savedIndentLevel: state._logIndentLevel,
    } as any;

    return { newState };
}
