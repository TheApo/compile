/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, PlayedCard, Player, EffectResult } from '../../../types';
import { drawCards, checkForSpirit3Trigger } from '../../../utils/gameStateModifiers';
import { executeOnCoverEffect, executeOnPlayEffect } from '../../effectExecutor';
import { recalculateAllLaneValues } from '../stateManager';
import { log } from '../../utils/log';

export const playCard = (prevState: GameState, cardId: string, laneIndex: number, isFaceUp: boolean, player: Player): EffectResult => {
    const playerState = { ...prevState[player] };
    const cardToPlay = playerState.hand.find(c => c.id === cardId);
    if (!cardToPlay) return { newState: prevState };

    const opponent = player === 'player' ? 'opponent' : 'player';
    const opponentLane = prevState[opponent].lanes[laneIndex];
    const topOpponentCard = opponentLane.length > 0 ? opponentLane[opponentLane.length - 1] : null;

    // RULE: An opponent's uncovered Plague-0 blocks playing into a lane.
    if (topOpponentCard && topOpponentCard.isFaceUp && topOpponentCard.protocol === 'Plague' && topOpponentCard.value === 0) {
        return { newState: prevState };
    }

    // 1. Check for onCover effect on the state BEFORE the card is played.
    let onCoverResult: EffectResult = { newState: prevState };
    const targetLaneBeforePlay = prevState[player].lanes[laneIndex];
    if (targetLaneBeforePlay.length > 0) {
        const topCard = targetLaneBeforePlay[targetLaneBeforePlay.length - 1];
        onCoverResult = executeOnCoverEffect(topCard, laneIndex, prevState);
    }
    const stateAfterOnCover = onCoverResult.newState;

    // 2. Physically play the card onto the board from the state returned by the onCover effect.
    const playerStateAfterOnCover = { ...stateAfterOnCover[player] };
    const newCardOnBoard: PlayedCard = { ...cardToPlay, isFaceUp, isRevealed: false };
    
    const newStats = {
        ...playerStateAfterOnCover.stats,
        cardsPlayed: playerStateAfterOnCover.stats.cardsPlayed + 1,
    };
    
    const newPlayerState = {
        ...playerStateAfterOnCover,
        hand: playerStateAfterOnCover.hand.filter(c => c.id !== cardId),
        lanes: playerStateAfterOnCover.lanes.map((lane, i) =>
            i === laneIndex ? [...lane, newCardOnBoard] : lane
        ),
        stats: newStats,
    };

    let stateAfterMove: GameState = { 
        ...stateAfterOnCover, 
        [player]: newPlayerState,
        stats: {
            ...stateAfterOnCover.stats,
            [player]: newStats
        }
    };
    
    // Set the last played card ID for the UI
    stateAfterMove.lastPlayedCardId = newCardOnBoard.id;

    stateAfterMove = recalculateAllLaneValues(stateAfterMove);

    // 3. Log the play action.
    const playerName = player === 'player' ? 'Player' : 'Opponent';
    const protocolName = stateAfterMove[player].protocols[laneIndex];
    let logMessage: string;

    if (player === 'opponent' && !isFaceUp) {
        logMessage = `${playerName} plays a face-down card into Protocol ${protocolName}.`;
    } else {
        const cardName = `${cardToPlay.protocol}-${cardToPlay.value}`;
        logMessage = `${playerName} plays ${cardName}`;
        if (!isFaceUp) {
            logMessage += ' face-down';
        }
        logMessage += ` into Protocol ${protocolName}.`;
    }
    stateAfterMove = log(stateAfterMove, player, logMessage);

    // 4. Decide whether to execute onPlay now or queue it.
    if (stateAfterOnCover.actionRequired) {
        // onCover triggered an action. This action is already in stateAfterMove.
        // Queue the onPlay effect.
        if (isFaceUp) {
            stateAfterMove.queuedEffect = { card: newCardOnBoard, laneIndex };
        }
        return {
            newState: stateAfterMove,
            animationRequests: onCoverResult.animationRequests,
        };
    } else {
        // For AI, always queue the onPlay effect to create a visual delay.
        if (player === 'opponent') {
            if (isFaceUp) {
                stateAfterMove.queuedEffect = { card: newCardOnBoard, laneIndex };
            }
            return {
                newState: stateAfterMove,
                animationRequests: onCoverResult.animationRequests,
            };
        }

        // For human player, execute immediately.
        let onPlayResult: EffectResult = { newState: stateAfterMove };
        if (isFaceUp) {
            onPlayResult = executeOnPlayEffect(newCardOnBoard, laneIndex, stateAfterMove, player);
        }

        // Combine animations from both onCover (which had no action but might have animations) and onPlay.
        const finalAnimationRequests = [
            ...(onCoverResult.animationRequests || []),
            ...(onPlayResult.animationRequests || [])
        ];
        
        return {
            newState: onPlayResult.newState,
            animationRequests: finalAnimationRequests.length > 0 ? finalAnimationRequests : undefined,
        };
    }
};


export const fillHand = (prevState: GameState, player: Player): GameState => {
    const playerState = prevState[player];
    if (playerState.hand.length >= 5) return prevState;
    
    const cardsToDraw = 5 - playerState.hand.length;
    if (cardsToDraw <= 0) return prevState;

    // Explicitly handle drawing and state updates to ensure triggers are not missed.
    const { drawnCards, remainingDeck, newDiscard, reshuffled } = drawCards(playerState.deck, playerState.discard, cardsToDraw);
    if (drawnCards.length === 0) return prevState;

    const newHandCards = drawnCards.map(c => ({...c, id: uuidv4(), isFaceUp: true}));
    const drawnCardIds = newHandCards.map(c => c.id);

    const newStats = {
        ...playerState.stats,
        cardsDrawn: playerState.stats.cardsDrawn + drawnCards.length,
    };

    const newPlayerState = {
        ...playerState,
        deck: remainingDeck,
        discard: newDiscard,
        hand: [...playerState.hand, ...newHandCards],
        stats: newStats,
    };

    let newState: GameState = { 
        ...prevState, 
        [player]: newPlayerState,
        stats: {
            ...prevState.stats,
            [player]: newStats
        },
        animationState: { type: 'drawCard', owner: player, cardIds: drawnCardIds }
    };

    if (reshuffled) {
        const playerName = player === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, player, `${playerName}'s deck is empty. Discard pile has been reshuffled into the deck.`);
    }

    const playerName = player === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, player, `${playerName} fills their hand, drawing ${cardsToDraw} card(s).`);

    // Explicitly check for the Spirit-3 trigger AFTER all state changes from drawing are applied.
    newState = checkForSpirit3Trigger(newState, player);

    return newState;
};