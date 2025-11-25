/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult, EffectContext } from '../../../types';
import { refreshHandForPlayer } from '../../../utils/gameStateModifiers';
import { executeOnCoverEffect, executeOnPlayEffect } from '../../effectExecutor';
import { recalculateAllLaneValues } from '../stateManager';
import { log, setLogSource, setLogPhase } from '../../utils/log';
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { canPlayCard as checkPassiveRuleCanPlay, hasAnyProtocolPlayRule, hasRequireNonMatchingProtocolRule } from '../passiveRuleChecker';

export const playCard = (prevState: GameState, cardId: string, laneIndex: number, isFaceUp: boolean, player: Player): EffectResult => {
    const playerState = { ...prevState[player] };
    const cardToPlay = playerState.hand.find(c => c.id === cardId);
    if (!cardToPlay) return { newState: prevState };

    // NEW: Check passive rule restrictions (Metal-2, Plague-0, Psychic-1, etc.)
    const passiveRuleCheck = checkPassiveRuleCanPlay(prevState, player, laneIndex, isFaceUp, cardToPlay.protocol);
    if (!passiveRuleCheck.allowed) {
        console.error(`Illegal Move: ${player} tried to play ${cardToPlay.protocol}-${cardToPlay.value} - ${passiveRuleCheck.reason}`);
        return { newState: prevState };
    }

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
    // EXCEPTION: Spirit-1 OR Chaos-3 allows playing face-up regardless of protocol
    // BLOCKER: Psychic-1 blocks all face-up plays
    // INVERTER: Anarchy-1 inverts the rule - can only play face-up if protocol does NOT match
    // Compiled status does NOT bypass this rule!
    if (isFaceUp) {
        const playerProtocol = playerState.protocols[laneIndex];
        const opponentProtocol = prevState[opponent].protocols[laneIndex];

        // Check for modifiers on BOTH players' fields (these affect both players)
        // FIXED: Psychic-1 only blocks the OPPONENT from playing face-up, not the owner
        const opponentHasPsychic1 = prevState[opponent].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
        const anyPlayerHasAnarchy1 = [...prevState.player.lanes.flat(), ...prevState.opponent.lanes.flat()].some(c => c.isFaceUp && c.protocol === 'Anarchy' && c.value === 1);

        // NEW: Check for custom cards with require_non_matching_protocol passive rule
        const hasCustomNonMatchingRule = hasRequireNonMatchingProtocolRule(prevState);

        const playerHasSpirit1 = prevState[player].lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

        // Check for Chaos-3: Must be uncovered (last in lane) AND face-up
        const playerHasChaosThree = prevState[player].lanes.some((lane) => {
            if (lane.length === 0) return false;
            const uncoveredCard = lane[lane.length - 1];
            return uncoveredCard.isFaceUp && uncoveredCard.protocol === 'Chaos' && uncoveredCard.value === 3;
        });

        // NEW: Check for custom cards with allow_any_protocol_play passive rule
        const hasCustomAnyProtocolRule = hasAnyProtocolPlayRule(prevState, player, laneIndex);

        let canPlayFaceUp: boolean;

        if (anyPlayerHasAnarchy1 || hasCustomNonMatchingRule) {
            // Anarchy-1 OR custom require_non_matching_protocol: INVERTED rule - can only play if protocol does NOT match
            const doesNotMatch = cardToPlay.protocol !== playerProtocol && cardToPlay.protocol !== opponentProtocol;
            canPlayFaceUp = doesNotMatch && !opponentHasPsychic1;
        } else {
            // Normal rule: can only play if protocol DOES match (or Spirit-1/Chaos-3/custom rule override)
            const doesMatch = cardToPlay.protocol === playerProtocol || cardToPlay.protocol === opponentProtocol;
            canPlayFaceUp = (doesMatch || playerHasSpirit1 || playerHasChaosThree || hasCustomAnyProtocolRule) && !opponentHasPsychic1;
        }

        if (!canPlayFaceUp) {
            const reason = (anyPlayerHasAnarchy1 || hasCustomNonMatchingRule) ? 'Non-matching protocol required' : 'matching protocol required';
            console.error(`Illegal Move: ${player} tried to play ${cardToPlay.protocol}-${cardToPlay.value} face-up in lane ${laneIndex} (${reason}, protocols: player=${playerProtocol}, opponent=${opponentProtocol})`);
            return { newState: prevState };
        }
    }

    // 1. Check for onCover effect on the state BEFORE the card is played.
    let onCoverResult: EffectResult = { newState: prevState };
    const targetLaneBeforePlay = prevState[player].lanes[laneIndex];
    if (targetLaneBeforePlay.length > 0) {
        const topCard = targetLaneBeforePlay[targetLaneBeforePlay.length - 1];
        const coverContext: EffectContext = {
            cardOwner: player,
            actor: player,
            currentTurn: prevState.turn,
            opponent: player === 'player' ? 'opponent' : 'player',
            triggerType: 'cover'
        };
        onCoverResult = executeOnCoverEffect(topCard, laneIndex, prevState, coverContext);
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

    // CRITICAL FIX: Preserve queuedActions from prevState
    // When resolving an interrupt by playing a card, the queuedActions must be maintained
    // so they can be processed after the new interrupt is resolved.
    // IMPORTANT: Only use stateAfterOnCover.queuedActions if it's DIFFERENT from prevState.queuedActions!
    // If executeOnCoverEffect didn't add new actions, it returns the input state unchanged,
    // which would cause duplicate queue entries if we blindly merge.
    const oldQueue = prevState.queuedActions || [];
    const coverQueue = stateAfterOnCover.queuedActions || [];

    // Check if coverQueue is the SAME array reference as oldQueue (no new actions added)
    if (coverQueue === oldQueue || (coverQueue.length === oldQueue.length && coverQueue.every((a, i) => a === oldQueue[i]))) {
        // No new actions from onCover, just use oldQueue
        if (oldQueue.length > 0) {
            stateAfterMove.queuedActions = oldQueue;
        }
    } else {
        // onCover added new actions, merge them
        console.log('[DEBUG] playCard - Merging queuedActions: oldQueue:', oldQueue.length, 'coverQueue:', coverQueue.length);
        stateAfterMove.queuedActions = [...oldQueue, ...coverQueue];
    }

    // Set the last played card ID for the UI
    stateAfterMove.lastPlayedCardId = newCardOnBoard.id;

    stateAfterMove = recalculateAllLaneValues(stateAfterMove);

    // 3. Log the play action.
    // IMPORTANT: Clear effect context before logging non-effect actions
    stateAfterMove = setLogSource(stateAfterMove, undefined);
    stateAfterMove = setLogPhase(stateAfterMove, undefined);

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

    // NEW: Trigger reactive effects after play
    const reactivePlayResult = processReactiveEffects(stateAfterMove, 'after_play', { player, cardId: newCardOnBoard.id });
    stateAfterMove = reactivePlayResult.newState;

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
            const playContext: EffectContext = {
                cardOwner: player,
                actor: player,
                currentTurn: stateAfterMove.turn,
                opponent: player === 'player' ? 'opponent' : 'player',
                triggerType: 'play'
            };
            onPlayResult = executeOnPlayEffect(newCardOnBoard, laneIndex, stateAfterMove, playContext);
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
    console.log('[DEBUG performFillHand] Called for player:', player, 'Current hand length:', prevState[player].hand.length);
    // IMPORTANT: Clear effect context before filling hand at phase level
    // This is a phase action, not part of a card effect
    let newState = setLogSource(prevState, undefined);
    newState = setLogPhase(newState, undefined);
    newState = { ...newState, _logIndentLevel: 0 };

    const result = refreshHandForPlayer(newState, player);
    console.log('[DEBUG performFillHand] After refresh, hand length:', result[player].hand.length);
    return result;
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