/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reveal/Give Effect Executor
 *
 * Handles reveal and give card effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';

/**
 * Execute REVEAL/GIVE effect
 */
export function executeRevealGiveEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    // Extract conditional info for "If you do" effects
    const conditional = params._conditional;
    const count = params.count || 1;
    const action = params.action;
    const source = params.source || 'own_hand';

    // NEW: Handle board card reveal (Light-2: "Reveal 1 face-down card. You may shift or flip that card.")
    if (action === 'reveal' && source === 'board') {
        const targetFilter = params.targetFilter || { owner: 'any', position: 'uncovered', faceState: 'face_down' };
        const followUpAction = params.followUpAction;  // 'flip' | 'shift' | undefined
        const optional = params.optional !== false;  // Default true

        // Find all valid target cards
        const validTargets: PlayedCard[] = [];
        const players = targetFilter.owner === 'own' ? [cardOwner]
                      : targetFilter.owner === 'opponent' ? [opponent]
                      : [cardOwner, opponent];

        for (const p of players) {
            for (let li = 0; li < state[p].lanes.length; li++) {
                const lane = state[p].lanes[li];
                if (lane.length > 0) {
                    // Filter by position
                    let cardsToCheck: PlayedCard[] = [];
                    if (targetFilter.position === 'uncovered') {
                        cardsToCheck = [lane[lane.length - 1]];
                    } else if (targetFilter.position === 'covered') {
                        cardsToCheck = lane.slice(0, -1);
                    } else {
                        cardsToCheck = [...lane];
                    }

                    // Filter by faceState
                    const filtered = cardsToCheck.filter(c => {
                        if (targetFilter.faceState === 'face_up') return c.isFaceUp;
                        if (targetFilter.faceState === 'face_down') return !c.isFaceUp;
                        return true;  // 'any'
                    });

                    validTargets.push(...filtered);
                }
            }
        }

        if (validTargets.length === 0) {
            let newState = log(state, cardOwner, `No valid cards to reveal. Effect skipped.`);
            return { newState };
        }

        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_board_card_to_reveal_custom',
            sourceCardId: card.id,
            actor: cardOwner,
            targetFilter,  // CRITICAL: Pass targetFilter to UI for card highlighting
            followUpAction,
            optional,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;

        return { newState };
    }

    // NEW: Handle opponent_hand reveal (Light-4: "Your opponent reveals their hand")
    if (action === 'reveal' && source === 'opponent_hand') {
        let newState = { ...state };
        const opponentState = { ...newState[opponent] };

        if (opponentState.hand.length > 0) {
            // Mark all opponent's cards as revealed (count -1 = all cards)
            opponentState.hand = opponentState.hand.map(c => ({ ...c, isRevealed: true }));
            newState[opponent] = opponentState;

            const cardName = `${card.protocol}-${card.value}`;
            newState = log(newState, cardOwner, `${cardName}: Your opponent reveals their hand.`);
        } else {
            const cardName = `${card.protocol}-${card.value}`;
            newState = log(newState, cardOwner, `${cardName}: Opponent has no cards to reveal.`);
        }

        // This effect resolves immediately
        return { newState };
    }

    // NEW: Handle own_deck_top reveal (Clarity-1: "Reveal the top card of your deck.")
    if (action === 'reveal' && source === 'own_deck_top') {
        let newState = { ...state };
        const ownerState = { ...newState[cardOwner] };
        const cardName = `${card.protocol}-${card.value}`;

        if (ownerState.deck.length === 0) {
            newState = log(newState, cardOwner, `${cardName}: No cards in deck to reveal.`);
            return { newState };
        }

        // CRITICAL: Create a new deck array to avoid mutation issues
        const newDeck = [...ownerState.deck];
        const topCard = newDeck[0];
        newState = log(newState, cardOwner, `${cardName}: Revealed ${topCard.protocol}-${topCard.value} from top of deck.`);

        // Store the revealed card ID for useCardFromPreviousEffect (used by conditional discard)
        // ALWAYS generate a fresh ID to ensure uniqueness across multiple triggers
        const topCardId = `deck-top-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        newDeck[0] = { ...topCard, id: topCardId };
        ownerState.deck = newDeck;
        newState[cardOwner] = ownerState;
        newState.lastCustomEffectTargetCardId = topCardId;


        return { newState };
    }

    // NEW: Handle own_trash reveal (Time-3: "Reveal 1 card from your trash.")
    if (action === 'reveal' && source === 'own_trash') {
        let newState = { ...state };
        const ownerState = { ...newState[cardOwner] };
        const cardName = `${card.protocol}-${card.value}`;

        if (ownerState.discard.length === 0) {
            newState = log(newState, cardOwner, `${cardName}: No cards in trash to reveal.`);
            // CRITICAL: Mark effect as skipped so if_executed conditionals don't trigger
            (newState as any)._effectSkippedNoTargets = true;
            return { newState };
        }

        // Store trash cards for selection (player needs to choose one)
        newState.actionRequired = {
            type: 'select_card_from_trash_to_reveal',
            sourceCardId: card.id,
            actor: cardOwner,
            count: count,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
            sourceLaneIndex: laneIndex,
        } as any;

        return { newState };
    }

    // NEW: Handle own_deck reveal (Clarity-2/3: "Reveal your deck.")
    if (action === 'reveal' && source === 'own_deck') {
        let newState = { ...state };
        const ownerState = { ...newState[cardOwner] };
        const cardName = `${card.protocol}-${card.value}`;

        if (ownerState.deck.length === 0) {
            newState = log(newState, cardOwner, `${cardName}: No cards in deck to reveal.`);
            return { newState };
        }

        // Mark deck as revealed (for UI display)
        ownerState.deckRevealed = true;
        newState[cardOwner] = ownerState;

        // Log the reveal
        const deckContents = ownerState.deck.map(c => `${c.protocol}-${c.value}`).join(', ');
        newState = log(newState, cardOwner, `${cardName}: Revealed deck: ${deckContents}`);

        // This effect resolves immediately - chained effects (draw by value) will follow
        return { newState };
    }

    // CRITICAL: Check if player has any cards in hand (for own_hand reveal/give)
    if (state[cardOwner].hand.length === 0) {
        let newState = log(state, cardOwner, `No cards in hand to ${action}. Effect skipped.`);
        return { newState };
    }

    let newState = { ...state };

    if (action === 'reveal') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_reveal',
            count,
            sourceCardId: card.id,
            actor: cardOwner,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;
    } else if (action === 'give') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_give',
            count,
            sourceCardId: card.id,
            actor: cardOwner,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;
    }

    return { newState };
}
