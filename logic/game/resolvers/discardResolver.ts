/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player } from '../../../types';
import { log } from '../../utils/log';
import { drawForPlayer } from '../../../utils/gameStateModifiers';
import { handleChainedEffectsOnDiscard, countValidDeleteTargets } from '../helpers/actionUtils';
import { checkForPlague1Trigger } from '../../effects/plague/Plague-1-trigger';

const checkForSpeed1Trigger = (state: GameState, player: Player): GameState => {
    if (state.processedSpeed1TriggerThisTurn) {
        return state;
    }
    const playerState = state[player];
    // Speed-1's effect is in the TOP box, so it doesn't need to be uncovered.
    const hasSpeed1 = playerState.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Speed' && c.value === 1);
    
    if (hasSpeed1) {
        let newState = { ...state };
        newState = log(newState, player, "Speed-1 triggers after clearing cache: Draw 1 card.");
        newState = drawForPlayer(newState, player, 1);
        newState.processedSpeed1TriggerThisTurn = true;
        
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

    let newState = { 
        ...prevState, 
        [player]: newPlayerState, 
        stats: { 
            ...prevState.stats, 
            [player]: newStats,
        },
        actionRequired: null 
    };

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

    const handleDiscardCompletion = (state: GameState, action: typeof originalAction) => {
        const isHandLimitDiscard = (prevState.phase === 'hand_limit' && !action?.sourceCardId);
        let stateAfterDiscard = state;
        if (isHandLimitDiscard) {
            stateAfterDiscard = checkForSpeed1Trigger(stateAfterDiscard, player);
        }
        const stateAfterPlagueTrigger = checkForPlague1Trigger(stateAfterDiscard, player);
        return handleChainedEffectsOnDiscard(stateAfterPlagueTrigger, player, action?.sourceEffect, action?.sourceCardId);
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
    let finalState = checkForPlague1Trigger(newState, player);
    if (isHandLimitDiscard) {
        finalState = checkForSpeed1Trigger(finalState, player);
    }
    
    return finalState;
};

export const resolvePlague2Discard = (prev: GameState, cardIdsToDiscard: string[]): GameState => {
    if (prev.actionRequired?.type !== 'plague_2_player_discard') return prev;

    const player = prev.turn;
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
        newState.actionRequired = null;
    }

    return newState;
};

export const resolvePlague2OpponentDiscard = (prev: GameState, cardIdsToDiscard: string[]): GameState => {
    if (prev.actionRequired?.type !== 'plague_2_opponent_discard') return prev;

    const player = 'opponent';
    const opponent = 'player';
    
    // AI discards its cards
    let newState = discardCards(prev, cardIdsToDiscard, player);

    // Now, require the human player (opponent of the current turn) to discard.
    const opponentDiscardCount = cardIdsToDiscard.length + 1;
    if (newState[opponent].hand.length > 0) {
        newState.actionRequired = {
            type: 'discard',
            actor: opponent,
            count: Math.min(opponentDiscardCount, newState[opponent].hand.length),
            sourceCardId: prev.actionRequired.sourceCardId
        };
    } else {
        newState.actionRequired = null;
    }

    return newState;
};

export const resolveFire4Discard = (prevState: GameState, cardIds: string[]): GameState => {
    if (prevState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_fire_4') return prevState;

    const player = prevState.turn;
    
    let newState = discardCards(prevState, cardIds, player);

    const amountToDraw = cardIds.length + 1;
    newState = log(newState, player, `Fire-4: Drawing ${amountToDraw} card(s).`);
    newState = drawForPlayer(newState, player, amountToDraw);

    return newState;
};

export const resolveHate1Discard = (prevState: GameState, cardIds: string[]): GameState => {
    if (prevState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_hate_1') return prevState;

    const { sourceCardId, actor } = prevState.actionRequired;
    
    let newState = discardCards(prevState, cardIds, actor);

    const disallowedIds = [sourceCardId];
    const availableTargets = countValidDeleteTargets(newState, disallowedIds);
    const deleteCount = Math.min(2, availableTargets);

    if (deleteCount > 0) {
        newState.actionRequired = {
            type: 'select_cards_to_delete',
            count: deleteCount,
            sourceCardId,
            disallowedIds: [sourceCardId],
            actor: actor,
        };
    } else {
        newState = log(newState, actor, `Hate-1: No valid targets to delete.`);
        newState.actionRequired = null;
    }

    return newState;
};