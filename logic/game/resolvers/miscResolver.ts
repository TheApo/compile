/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// FIX: Implemented the entire module which was missing and causing multiple import/property errors.
import { GameState, Player, PlayedCard } from "../../../types";
import { log } from "../../utils/log";
import { recalculateAllLaneValues } from "../stateManager";
import { findCardOnBoard } from "../helpers/actionUtils";
import { drawForPlayer } from "../../../utils/gameStateModifiers";
import { checkForHate3Trigger } from "../../effects/hate/Hate-3";

export const compileLane = (prevState: GameState, laneIndex: number, onEndGame: (winner: Player) => void): GameState => {
    const compiler = prevState.turn;
    const nonCompiler = compiler === 'player' ? 'opponent' : 'player';
    
    let newState = { ...prevState };
    const compilerState = { ...newState[compiler] };
    const nonCompilerState = { ...newState[nonCompiler] };

    const wasAlreadyCompiled = compilerState.compiled[laneIndex];

    // Intercept Speed-2 cards before they are deleted.
    const compilerSpeed2sToShift: PlayedCard[] = [];
    const nonCompilerSpeed2sToShift: PlayedCard[] = [];

    const compilerDeletedCards = compilerState.lanes[laneIndex].filter(c => {
        if (c.protocol === 'Speed' && c.value === 2) {
            compilerSpeed2sToShift.push(c);
            return false;
        }
        return true;
    });
    const nonCompilerDeletedCards = nonCompilerState.lanes[laneIndex].filter(c => {
        if (c.protocol === 'Speed' && c.value === 2) {
            nonCompilerSpeed2sToShift.push(c);
            return false;
        }
        return true;
    });

    // Move the remaining cards to discard.
    compilerState.discard = [...compilerState.discard, ...compilerDeletedCards.map(({ id, isFaceUp, ...card }) => card)];
    nonCompilerState.discard = [...nonCompilerState.discard, ...nonCompilerDeletedCards.map(({ id, isFaceUp, ...card }) => card)];

    // Clear lanes, but leave the Speed-2 cards for now (they will be shifted from here).
    const newCompilerLanes = [...compilerState.lanes];
    newCompilerLanes[laneIndex] = compilerSpeed2sToShift;
    compilerState.lanes = newCompilerLanes;

    const newNonCompilerLanes = [...nonCompilerState.lanes];
    newNonCompilerLanes[laneIndex] = nonCompilerSpeed2sToShift;
    nonCompilerState.lanes = newNonCompilerLanes;

    // Mark protocol as compiled
    const newCompiled = [...compilerState.compiled];
    newCompiled[laneIndex] = true;
    compilerState.compiled = newCompiled;

    newState = { ...newState, [compiler]: compilerState, [nonCompiler]: nonCompilerState };

    const compilerName = compiler === 'player' ? 'Player' : 'Opponent';
    const protocolName = compilerState.protocols[laneIndex];
    newState = log(newState, compiler, `${compilerName} compiles Protocol ${protocolName}!`);

    // Handle re-compile reward
    if (wasAlreadyCompiled) {
        newState = log(newState, compiler, `${compilerName} draws 1 card from the opponent's deck as a re-compile reward.`);
        newState = drawForPlayer(newState, compiler, 1);
    }
    
    newState = recalculateAllLaneValues(newState);

    // Check for win condition
    const win = compilerState.compiled.every(c => c === true);
    if (win) {
        newState.winner = compiler;
        onEndGame(compiler);
    }

    // Trigger Hate-3 for all deleted cards
    const totalDeleted = compilerDeletedCards.length + nonCompilerDeletedCards.length;
    for (let i = 0; i < totalDeleted; i++) {
        newState = checkForHate3Trigger(newState, compiler);
    }

    // Queue actions for shifting Speed-2 cards
    const queuedActions = [...newState.queuedActions];

    for (const card of compilerSpeed2sToShift) {
        newState = log(newState, compiler, `Speed-2 survives compilation and must be shifted.`);
        queuedActions.push({
            type: 'select_lane_for_shift',
            cardToShiftId: card.id,
            cardOwner: compiler,
            originalLaneIndex: laneIndex,
            sourceCardId: card.id,
            actor: compiler
        });
    }

    for (const card of nonCompilerSpeed2sToShift) {
        newState = log(newState, nonCompiler, `Speed-2 survives compilation and must be shifted.`);
        queuedActions.push({
            type: 'select_lane_for_shift',
            cardToShiftId: card.id,
            cardOwner: nonCompiler,
            originalLaneIndex: laneIndex,
            sourceCardId: card.id,
            actor: nonCompiler
        });
    }
    
    // Handle turn interruption if the non-compiling player has a Speed-2
    if (nonCompilerSpeed2sToShift.length > 0) {
        newState._interruptedTurn = compiler;
        newState.turn = nonCompiler;
        newState.actionRequired = queuedActions.shift()!;
    } else if (queuedActions.length > 0) {
        // No interruption, but the compiler might have their own Speed-2 to shift
        newState.actionRequired = queuedActions.shift()!;
    }
    
    newState.queuedActions = queuedActions;

    return newState;
};

export const selectHandCardForAction = (prevState: GameState, cardId: string): GameState => {
    if (prevState.actionRequired?.type !== 'select_card_from_hand_to_play') return prevState;
    
    // FIX: Destructure 'actor' to pass it to the next action.
    const { disallowedLaneIndex, sourceCardId, isFaceDown, actor } = prevState.actionRequired;
    return {
        ...prevState,
        actionRequired: {
            type: 'select_lane_for_play',
            cardInHandId: cardId,
            disallowedLaneIndex,
            sourceCardId,
            isFaceDown,
            actor,
        }
    };
};

export const skipAction = (prevState: GameState): GameState => {
    if (!prevState.actionRequired || !('optional' in prevState.actionRequired) || !prevState.actionRequired.optional) return prevState;
    const actor = prevState.turn;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    let newState = { ...prevState, actionRequired: null };
    newState = log(newState, actor, `${actorName} skips the optional action.`);
    return newState;
};

export const revealOpponentHand = (prevState: GameState): GameState => {
    if (prevState.actionRequired?.type !== 'reveal_opponent_hand') return prevState;
    
    const opponentId = prevState.turn === 'player' ? 'opponent' : 'player';
    let newState = { ...prevState };
    const opponent = { ...newState[opponentId] };

    if (opponent.hand.length > 0) {
        opponent.hand = opponent.hand.map(c => ({ ...c, isRevealed: true }));
        newState[opponentId] = opponent;
        const sourceCard = findCardOnBoard(newState, prevState.actionRequired.sourceCardId);
        const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
        newState = log(newState, prevState.turn, `${sourceName}: Opponent reveals their hand.`);
    }

    newState.actionRequired = null;
    return newState;
};