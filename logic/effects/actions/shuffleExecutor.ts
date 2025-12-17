/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shuffle Effect Executor
 *
 * Handles shuffle_trash and shuffle_deck effects.
 * - shuffle_trash: Clarity-4 "You may shuffle your trash into your deck."
 *   (In this codebase, "trash" = "discard pile")
 * - shuffle_deck: Clarity-2/3 "Shuffle your deck."
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';
import { shuffleDeck } from '../../../utils/gameLogic';
import { processReactiveEffects } from '../../game/reactiveEffectProcessor';

/**
 * Execute SHUFFLE_TRASH effect (Clarity-4)
 * Note: "trash" in COMPILE = discard pile (discarded + deleted cards)
 */
export function executeShuffleTrashEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    // Extract conditional info for "If you do" effects
    const conditional = params._conditional;
    const cardName = `${card.protocol}-${card.value}`;
    const isOptional = params.optional !== false;

    // Check advancedConditional: trash_not_empty
    if (params.advancedConditional?.type === 'trash_not_empty') {
        if (state[cardOwner].discard.length === 0) {
            let newState = log(state, cardOwner, `${cardName}: No cards in trash - effect skipped.`);
            return { newState };
        }
    }

    // Check if there's anything in discard (trash)
    if (state[cardOwner].discard.length === 0) {
        let newState = log(state, cardOwner, `${cardName}: No cards in trash to shuffle.`);
        return { newState };
    }

    // If optional, prompt the player
    if (isOptional) {
        let newState = { ...state };
        newState.actionRequired = {
            type: 'prompt_optional_shuffle_trash',
            sourceCardId: card.id,
            actor: cardOwner,
            trashCount: state[cardOwner].discard.length,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;
        return { newState };
    }

    // Otherwise, execute immediately
    return performShuffleTrash(state, cardOwner, cardName);
}

/**
 * Actually perform the shuffle trash operation
 * Note: "trash" in COMPILE = discard pile
 */
export function performShuffleTrash(
    state: GameState,
    player: Player,
    cardName: string
): EffectResult {
    let newState = { ...state };
    const playerState = { ...newState[player] };

    const trashCount = playerState.discard.length;
    if (trashCount === 0) {
        newState = log(newState, player, `${cardName}: No cards in trash to shuffle.`);
        return { newState };
    }

    // Move all cards from discard (trash) to deck
    playerState.deck = [...playerState.deck, ...playerState.discard];
    playerState.discard = [];

    // Shuffle the deck
    playerState.deck = shuffleDeck([...playerState.deck]);

    newState[player] = playerState;
    newState = log(newState, player, `${cardName}: Shuffled ${trashCount} card${trashCount !== 1 ? 's' : ''} from trash into deck.`);

    // Trigger reactive effects after shuffle (Time-2)
    const shuffleResult = processReactiveEffects(newState, 'after_shuffle', { player });
    newState = shuffleResult.newState;

    return { newState };
}

/**
 * Execute SHUFFLE_DECK effect (Clarity-2/3)
 */
export function executeShuffleDeckEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const cardName = `${card.protocol}-${card.value}`;

    let newState = { ...state };
    const playerState = { ...newState[cardOwner] };

    if (playerState.deck.length === 0) {
        newState = log(newState, cardOwner, `${cardName}: No cards in deck to shuffle.`);
        return { newState };
    }

    // Shuffle the deck
    playerState.deck = shuffleDeck([...playerState.deck]);

    // Clear deckRevealed flag if it was set
    playerState.deckRevealed = false;

    newState[cardOwner] = playerState;
    newState = log(newState, cardOwner, `${cardName}: Shuffled deck.`);

    // Trigger reactive effects after shuffle (Time-2)
    const shuffleResult = processReactiveEffects(newState, 'after_shuffle', { player: cardOwner });
    newState = shuffleResult.newState;

    return { newState };
}
