/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult } from '../../../types';
import { refreshHandForPlayer } from '../../../utils/gameStateModifiers';
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

    // RULE: An opponent's uncovered face-up Metal-2 blocks playing face-down.
    if (!isFaceUp) {
        const topOpponentCardIsMetalTwo = topOpponentCard && topOpponentCard.isFaceUp && topOpponentCard.protocol === 'Metal' && topOpponentCard.value === 2;
        if (topOpponentCardIsMetalTwo) {
            console.error(`Illegal Move: ${player} tried to play face-down against Metal-2 in lane ${laneIndex}`);
            return { newState: prevState };
        }
    }

    // RULE: Can only play face-up if card protocol matches:
    // 1. Own protocol in this lane, OR
    // 2. Opposing protocol in this lane
    // EXCEPTION: Spirit-1 allows playing face-up regardless of protocol
    // BLOCKER: Psychic-1 blocks all face-up plays
    // Compiled status does NOT bypass this rule!
    if (isFaceUp) {
        const playerProtocol = playerState.protocols[laneIndex];
        const opponentProtocol = prevState[opponent].protocols[laneIndex];
        const playerHasPsychic1 = prevState[player].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
        const playerHasSpirit1 = prevState[player].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

        const canPlayFaceUp = (cardToPlay.protocol === playerProtocol || cardToPlay.protocol === opponentProtocol || playerHasSpirit1) && !playerHasPsychic1;

        if (!canPlayFaceUp) {
            console.error(`Illegal Move: ${player} tried to play ${cardToPlay.protocol}-${cardToPlay.value} face-up in lane ${laneIndex} (protocols: player=${playerProtocol}, opponent=${opponentProtocol})`);
            return { newState: prevState };
        }
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
        if (isFaceUp && !stateAfterMove.actionRequired) {
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

export const performFillHand = (prevState: GameState, player: Player): GameState => {
    return refreshHandForPlayer(prevState, player);
}

export const fillHand = (prevState: GameState, player: Player): GameState => {
    if (prevState.useControlMechanic && prevState.controlCardHolder === player) {
        const newState = log(prevState, player, `${player === 'player' ? 'Player' : 'Opponent'} has Control and may rearrange protocols before refreshing.`);
        return {
            ...newState,
            controlCardHolder: null, // Reset control immediately
            actionRequired: {
                type: 'prompt_use_control_mechanic',
                sourceCardId: 'CONTROL_MECHANIC',
                actor: player,
                originalAction: { type: 'fill_hand' },
            }
        }
    }
    return performFillHand(prevState, player);
};