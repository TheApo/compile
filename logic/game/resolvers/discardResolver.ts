/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player } from '../../../types';
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from '../../utils/log';
import { drawForPlayer } from '../../../utils/gameStateModifiers';
import { handleChainedEffectsOnDiscard, countValidDeleteTargets } from '../helpers/actionUtils';
// NOTE: checkForPlague1Trigger removed - Plague-1 is now custom protocol, triggers via processReactiveEffects
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { queuePendingCustomEffects } from '../phaseManager';

const checkForSpeed1Trigger = (state: GameState, player: Player): GameState => {
    if (state.processedSpeed1TriggerThisTurn) {
        return state;
    }
    const playerState = state[player];
    // Speed-1's effect is in the TOP box, so it doesn't need to be uncovered.
    const hasSpeed1 = playerState.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Speed' && c.value === 1);

    if (hasSpeed1) {
        let newState = { ...state };

        // Set context for Speed-1 trigger (no phase marker - it's a triggered effect)
        newState = setLogSource(newState, "Speed-1");
        newState = setLogPhase(newState, undefined);

        newState = log(newState, player, "Triggers after clearing cache: Draw 1 card.");
        newState = drawForPlayer(newState, player, 1);
        newState.processedSpeed1TriggerThisTurn = true;

        // Clear context after trigger
        newState = setLogSource(newState, undefined);

        // After drawing, the hand limit check for this turn is definitively over.
        // Forcibly advance to the 'end' phase to prevent a loop.
        newState.phase = 'end';
        return newState;
    }

    return state;
};

export const discardCardFromHand = (prevState: GameState, cardId: string): GameState => {
    if (!prevState.actionRequired || prevState.actionRequired.type !== 'discard' || prevState.actionRequired.actor !== 'player') return prevState;

    const cardToDiscard = prevState.player.hand.find(c => c.id === cardId);
    if (!cardToDiscard) return prevState;

    const { id, isFaceUp, ...cardData } = cardToDiscard;
    const newHand = prevState.player.hand.filter(c => c.id !== cardId);
    const newDiscard = [...prevState.player.discard, cardData];
    const currentAction = prevState.actionRequired;
    const remainingDiscards = currentAction.count - 1;

    const newStats = { ...prevState.player.stats, cardsDiscarded: prevState.player.stats.cardsDiscarded + 1 };
    const newPlayerState = { ...prevState.player, hand: newHand, discard: newDiscard, stats: newStats };

    let newState: GameState = {
        ...prevState,
        player: newPlayerState,
        stats: { ...prevState.stats, player: newStats }
    };
    
    const cardName = `${cardToDiscard.protocol}-${cardToDiscard.value}`;
    newState = log(newState, 'player', `Player discards ${cardName}.`);

    if (remainingDiscards <= 0) {
        const isHandLimitDiscard = (prevState.phase === 'hand_limit' && !currentAction.sourceCardId);
        
        let stateAfterDiscard = newState;
        
        if (isHandLimitDiscard) {
            stateAfterDiscard = checkForSpeed1Trigger(stateAfterDiscard, 'player');

            // NEW: Trigger reactive effects after clear cache (Speed-1 custom protocol)
            const reactiveResult = processReactiveEffects(stateAfterDiscard, 'after_clear_cache', { player: 'player' });
            stateAfterDiscard = reactiveResult.newState;

            // CRITICAL: If any after_clear_cache effect was triggered, advance to 'end' phase
            // to prevent infinite hand_limit loops (like original Speed-1 does)
            if ((stateAfterDiscard as any).processedClearCacheTriggerIds?.length > 0) {
                stateAfterDiscard.phase = 'end';
            }

            // CRITICAL: Queue pending custom effects before clearing actionRequired
            stateAfterDiscard = queuePendingCustomEffects(stateAfterDiscard);
            stateAfterDiscard.actionRequired = null;
            return stateAfterDiscard;
        } else {
            // It was a discard from a card effect. Check for chained effects.
            return handleChainedEffectsOnDiscard(newState, 'player', currentAction.sourceEffect, currentAction.sourceCardId);
        }
    } else {
        // More discards are needed for the current action.
        newState.actionRequired = {
            ...currentAction,
            count: remainingDiscards,
        };
    }
    return newState;
};

export const discardCards = (prevState: GameState, cardIds: string[], player: Player): GameState => {
    const playerState = prevState[player];
    const cardsToDiscardSet = new Set(cardIds);
    const discardedCards = playerState.hand.filter(c => cardsToDiscardSet.has(c.id));
    if (discardedCards.length === 0) return prevState;

    const newHand = playerState.hand.filter(c => !cardsToDiscardSet.has(c.id));
    const newDiscard = [...playerState.discard, ...discardedCards.map(({ id, isFaceUp, ...card }) => card)];
    
    const originalAction = (prevState.animationState?.type === 'discardCard' && prevState.animationState.originalAction?.type === 'discard')
        ? prevState.animationState.originalAction
        : (prevState.actionRequired?.type === 'discard' ? prevState.actionRequired : null);

    const newStats = { ...playerState.stats, cardsDiscarded: playerState.stats.cardsDiscarded + discardedCards.length };
    const newPlayerState = { ...playerState, hand: newHand, discard: newDiscard, stats: newStats };

    // CRITICAL: Preserve followUpEffect and conditionalType from originalAction before clearing
    // They will be needed by handleChainedEffectsOnDiscard later
    const followUpEffect = (originalAction as any)?.followUpEffect;
    const conditionalType = (originalAction as any)?.conditionalType;
    const previousHandSize = (originalAction as any)?.previousHandSize;

    let newState = {
        ...prevState,
        [player]: newPlayerState,
        stats: {
            ...prevState.stats,
            [player]: newStats,
        },
        actionRequired: followUpEffect ? {
            type: 'discard_completed',
            followUpEffect,
            conditionalType,
            previousHandSize,
            sourceCardId: originalAction?.sourceCardId,
            actor: player,
        } as any : null
    };

    // IMPORTANT: Set context from source card if this discard was caused by an effect
    // Otherwise clear the context AND reset indent level
    if (originalAction?.sourceCardId) {
        const opponent = player === 'player' ? 'opponent' : 'player';
        const sourceCard = newState.player.lanes.flat().find(c => c.id === originalAction.sourceCardId) ||
                          newState.opponent.lanes.flat().find(c => c.id === originalAction.sourceCardId);
        if (sourceCard) {
            const cardName = `${sourceCard.protocol}-${sourceCard.value}`;
            newState = setLogSource(newState, cardName);
            newState = setLogPhase(newState, 'middle'); // Discard caused by an effect
        } else {
            newState = setLogSource(newState, undefined);
            newState = setLogPhase(newState, undefined);
            newState = { ...newState, _logIndentLevel: 0 }; // Reset indent for non-effect discards
        }
    } else {
        newState = setLogSource(newState, undefined);
        newState = setLogPhase(newState, undefined);
        newState = { ...newState, _logIndentLevel: 0 }; // Reset indent for hand limit discards
    }

    const playerName = player === 'player' ? 'Player' : 'Opponent';
    let logMessage: string;
    if (player === 'player' || discardedCards.every(c => c.isRevealed)) {
        const cardNames = discardedCards.map(c => `${c.protocol}-${c.value}`).join(', ');
        logMessage = `${playerName} discards ${cardNames}.`;
    } else {
        const cardText = discardedCards.length === 1 ? 'card' : 'cards';
        logMessage = `${playerName} discards ${discardedCards.length} ${cardText}.`;
    }
    newState = log(newState, player, logMessage);

    // NOTE: We do NOT change indent here - it's inherited from the effect context

    const handleDiscardCompletion = (state: GameState, action: typeof originalAction) => {
        const isHandLimitDiscard = (prevState.phase === 'hand_limit' && !action?.sourceCardId);
        let stateAfterDiscard = state;
        if (isHandLimitDiscard) {
            stateAfterDiscard = checkForSpeed1Trigger(stateAfterDiscard, player);

            // NEW: Trigger reactive effects after clear cache (Speed-1 custom protocol)
            const reactiveClearResult = processReactiveEffects(stateAfterDiscard, 'after_clear_cache', { player });
            stateAfterDiscard = reactiveClearResult.newState;

            // CRITICAL: If any after_clear_cache effect was triggered, advance to 'end' phase
            // to prevent infinite hand_limit loops (like original Speed-1 does)
            if ((stateAfterDiscard as any).processedClearCacheTriggerIds?.length > 0) {
                stateAfterDiscard.phase = 'end';
            }
        }
        // Trigger reactive effects after opponent discards (Plague-1 custom protocol)
        // Trigger for the opponent of the discarding player
        const opponentOfDiscarder = player === 'player' ? 'opponent' : 'player';
        const reactiveResult = processReactiveEffects(stateAfterDiscard, 'after_opponent_discard', { player: opponentOfDiscarder });
        const stateAfterReactive = reactiveResult.newState;

        return handleChainedEffectsOnDiscard(stateAfterReactive, player, action?.sourceEffect, action?.sourceCardId);
    };

    if (originalAction && originalAction.actor === player) {
        const remainingDiscards = originalAction.count - cardIds.length;
        if (remainingDiscards > 0) {
            newState.actionRequired = { ...originalAction, count: remainingDiscards };
            return newState;
        } else {
            return handleDiscardCompletion(newState, originalAction);
        }
    }

    const directAction = prevState.actionRequired;
    if (directAction && directAction.type === 'discard' && directAction.actor === player) {
        const remainingDiscards = directAction.count - cardIds.length;
        if (remainingDiscards > 0) {
            newState.actionRequired = { ...directAction, count: remainingDiscards };
            return newState;
        } else {
            return handleDiscardCompletion(newState, directAction);
        }
    }
    
    const isHandLimitDiscard = (prevState.phase === 'hand_limit');

    // Trigger reactive effects after opponent discards (Plague-1 custom protocol)
    const opponentOfDiscarder = player === 'player' ? 'opponent' : 'player';
    const reactiveResult = processReactiveEffects(newState, 'after_opponent_discard', { player: opponentOfDiscarder });
    let finalState = reactiveResult.newState;

    if (isHandLimitDiscard) {
        finalState = checkForSpeed1Trigger(finalState, player);

        // NEW: Trigger reactive effects after clear cache (Speed-1 custom protocol)
        const reactiveClearResult = processReactiveEffects(finalState, 'after_clear_cache', { player });
        finalState = reactiveClearResult.newState;

        // CRITICAL: If any after_clear_cache effect was triggered, advance to 'end' phase
        // to prevent infinite hand_limit loops (like original Speed-1 does)
        if ((finalState as any).processedClearCacheTriggerIds?.length > 0) {
            finalState.phase = 'end';
        }
    }

    return finalState;
};

export const resolvePlague2Discard = (prev: GameState, cardIdsToDiscard: string[]): GameState => {
    if (prev.actionRequired?.type !== 'plague_2_player_discard') return prev;

    // FIX: Use actor from actionRequired, not prev.turn (critical for interrupt scenarios)
    const player = prev.actionRequired.actor;
    const opponent = player === 'player' ? 'opponent' : 'player';
    
    // Discard the player's cards first
    let newState = discardCards(prev, cardIdsToDiscard, player);

    // Then, determine opponent's discard count and set the next action
    const opponentDiscardCount = cardIdsToDiscard.length + 1;
    if (newState[opponent].hand.length > 0) {
        newState.actionRequired = {
            type: 'discard',
            actor: opponent,
            count: Math.min(opponentDiscardCount, newState[opponent].hand.length),
            sourceCardId: prev.actionRequired.sourceCardId
        };
    } else {
        // CRITICAL: Queue pending custom effects before clearing actionRequired
        newState = queuePendingCustomEffects(newState);
        newState.actionRequired = null;
    }

    return newState;
};

export const resolvePlague2OpponentDiscard = (prev: GameState, cardIdsToDiscard: string[]): GameState => {
    if (prev.actionRequired?.type !== 'plague_2_opponent_discard') return prev;

    // FIX: Use actor from actionRequired, not hardcoded values (critical for interrupt scenarios)
    const player = prev.actionRequired.actor;
    const opponent = player === 'player' ? 'opponent' : 'player';

    // The Plague-2 owner (actor) discards their cards first
    let newState = discardCards(prev, cardIdsToDiscard, player);

    // Now, require the opponent to discard
    const opponentDiscardCount = cardIdsToDiscard.length + 1;
    if (newState[opponent].hand.length > 0) {
        newState.actionRequired = {
            type: 'discard',
            actor: opponent,
            count: Math.min(opponentDiscardCount, newState[opponent].hand.length),
            sourceCardId: prev.actionRequired.sourceCardId
        };
    } else {
        // CRITICAL: Queue pending custom effects before clearing actionRequired
        newState = queuePendingCustomEffects(newState);
        newState.actionRequired = null;
    }

    return newState;
};

export const resolveFire4Discard = (prevState: GameState, cardIds: string[]): GameState => {
    // Handle both original Fire-4 and custom protocol variable discard
    const isCustomProtocol = prevState.actionRequired?.type === 'discard' && (prevState.actionRequired as any)?.variableCount;
    const isOriginalFire4 = prevState.actionRequired?.type === 'select_cards_from_hand_to_discard_for_fire_4';

    if (!isCustomProtocol && !isOriginalFire4) return prevState;

    // FIX: Use actor from actionRequired, not prevState.turn (critical for interrupt scenarios)
    const player = prevState.actionRequired.actor;
    const sourceCardId = prevState.actionRequired.sourceCardId;

    let newState = discardCards(prevState, cardIds, player);

    // For custom protocols, use handleChainedEffectsOnDiscard to process followUpEffect
    if (isCustomProtocol && sourceCardId) {
        return handleChainedEffectsOnDiscard(newState, player, undefined, sourceCardId);
    }

    // Original Fire-4 logic
    const amountToDraw = cardIds.length + 1;
    newState = log(newState, player, `Fire-4: Drawing ${amountToDraw} card(s).`);
    newState = drawForPlayer(newState, player, amountToDraw);

    return newState;
};

export const resolveHate1Discard = (prevState: GameState, cardIds: string[]): GameState => {
    if (prevState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_hate_1') return prevState;

    const { sourceCardId, actor } = prevState.actionRequired;

    let newState = discardCards(prevState, cardIds, actor);

    // NOTE: Hate-1 does NOT say "other cards", so it can delete itself!
    const disallowedIds: string[] = [];
    const availableTargets = countValidDeleteTargets(newState, disallowedIds);
    const deleteCount = Math.min(2, availableTargets);

    if (deleteCount > 0) {
        newState.actionRequired = {
            type: 'select_cards_to_delete',
            count: deleteCount,
            sourceCardId,
            disallowedIds: [],
            actor: actor,
        };
    } else {
        newState = log(newState, actor, `Hate-1: No valid targets to delete.`);
        // CRITICAL: Queue pending custom effects before clearing actionRequired
        newState = queuePendingCustomEffects(newState);
        newState.actionRequired = null;
    }

    return newState;
};