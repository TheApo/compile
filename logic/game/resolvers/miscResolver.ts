/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard } from '../../../types';
import { drawFromOpponentDeck } from '../../../utils/gameStateModifiers';
import { log, setLogSource, setLogPhase } from '../../utils/log';
import { recalculateAllLaneValues } from '../stateManager';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
// FIX: Import internal helpers to be used by new functions.
import { findCardOnBoard, internalReturnCard, internalResolveTargetedFlip } from '../helpers/actionUtils';
import { performFillHand } from './playResolver';

export const performCompile = (prevState: GameState, laneIndex: number, onEndGame: (winner: Player, finalState: GameState) => void): GameState => {
    const compiler = prevState.turn;
    const nonCompiler = compiler === 'player' ? 'opponent' : 'player';

    let newState = { ...prevState };
    let compilerState = { ...newState[compiler] };
    let nonCompilerState = { ...newState[nonCompiler] };

    const wasAlreadyCompiled = compilerState.compiled[laneIndex];

    // Intercept Speed-2 cards before they are deleted.
    const compilerSpeed2sToShift: PlayedCard[] = [];
    const nonCompilerSpeed2sToShift: PlayedCard[] = [];

    const compilerDeletedCards = compilerState.lanes[laneIndex].filter(c => {
        if (c.protocol === 'Speed' && c.value === 2 && c.isFaceUp) {
            compilerSpeed2sToShift.push(c);
            return false;
        }
        return true;
    });
    const nonCompilerDeletedCards = nonCompilerState.lanes[laneIndex].filter(c => {
        if (c.protocol === 'Speed' && c.value === 2 && c.isFaceUp) {
            nonCompilerSpeed2sToShift.push(c);
            return false;
        }
        return true;
    });

    const newCompilerStats = { ...compilerState.stats, cardsDeleted: compilerState.stats.cardsDeleted + compilerDeletedCards.length };
    const newNonCompilerStats = { ...nonCompilerState.stats, cardsDeleted: nonCompilerState.stats.cardsDeleted + nonCompilerDeletedCards.length };

    compilerState.stats = newCompilerStats;
    nonCompilerState.stats = newNonCompilerStats;

    compilerState.discard = [...compilerState.discard, ...compilerDeletedCards.map(({ id, isFaceUp, ...card }) => card)];
    nonCompilerState.discard = [...nonCompilerState.discard, ...nonCompilerDeletedCards.map(({ id, isFaceUp, ...card }) => card)];

    const newCompilerLanes = [...compilerState.lanes];
    newCompilerLanes[laneIndex] = compilerSpeed2sToShift;
    compilerState.lanes = newCompilerLanes;

    const newNonCompilerLanes = [...nonCompilerState.lanes];
    newNonCompilerLanes[laneIndex] = nonCompilerSpeed2sToShift;
    nonCompilerState.lanes = newNonCompilerLanes;

    const newCompiled = [...compilerState.compiled];
    newCompiled[laneIndex] = true;
    compilerState.compiled = newCompiled;

    newState = { 
        ...newState, 
        [compiler]: compilerState, 
        [nonCompiler]: nonCompilerState,
        stats: { ...newState.stats, [compiler]: newCompilerStats, [nonCompiler]: newNonCompilerStats }
    };

    // IMPORTANT: Clear effect context before compile log
    // Compile is not part of a card effect, it's a phase action
    newState = setLogSource(newState, undefined);
    newState = setLogPhase(newState, undefined);
    newState = { ...newState, _logIndentLevel: 0 };

    const compilerName = compiler === 'player' ? 'Player' : 'Opponent';
    const protocolName = compilerState.protocols[laneIndex];
    newState = log(newState, compiler, `${compilerName} compiles Protocol ${protocolName}!`);

    if (wasAlreadyCompiled) {
        newState = log(newState, compiler, `${compilerName} draws 1 card from the opponent's deck as a re-compile reward.`);
        newState = drawFromOpponentDeck(newState, compiler, 1);
    }
    
    newState = recalculateAllLaneValues(newState);

    const win = compilerState.compiled.every(c => c === true);
    if (win) {
        newState.winner = compiler;
        onEndGame(compiler, newState);
        return newState;
    }

    const totalDeleted = compilerDeletedCards.length + nonCompilerDeletedCards.length;
    if (totalDeleted > 0) {
        newState = checkForHate3Trigger(newState, compiler);
    }
    
    // --- Centralized Post-Compile Logic ---
    const allSpeed2s = [...compilerSpeed2sToShift, ...nonCompilerSpeed2sToShift];
    const queuedSpeed2Actions = allSpeed2s.map(card => {
        const owner = findCardOnBoard(newState, card.id)!.owner;
        newState = log(newState, owner, `Speed-2 survives compilation and must be shifted.`);
        return {
            // FIX: Explicitly cast 'type' to a literal type to match the ActionRequired discriminated union.
            type: 'select_lane_for_shift' as const,
            cardToShiftId: card.id,
            cardOwner: owner,
            originalLaneIndex: laneIndex,
            sourceCardId: card.id,
            actor: owner
        };
    });

    const compilerHadControl = newState.useControlMechanic && newState.controlCardHolder === compiler;

    // CRITICAL: Check if we're in an interrupt before handling control mechanic
    const wasInterrupted = newState._interruptedTurn !== undefined;
    const originalTurnBeforeInterrupt = newState._interruptedTurn;
    const originalPhaseBeforeInterrupt = newState._interruptedPhase;

    if (compilerHadControl) {
        newState = log(newState, compiler, `${compiler === 'player' ? 'Player' : 'Opponent'} has Control and may rearrange protocols after compiling.`);

        // If we were interrupted, preserve that information in originalAction
        // CRITICAL FIX: Create a deep copy of queuedSpeed2Actions to prevent mutation issues
        const queuedSpeed2ActionsCopy = queuedSpeed2Actions.map(action => ({ ...action }));
        const originalAction = wasInterrupted
            ? { type: 'resume_interrupted_turn' as const, interruptedTurn: originalTurnBeforeInterrupt!, interruptedPhase: originalPhaseBeforeInterrupt!, queuedSpeed2Actions: queuedSpeed2ActionsCopy }
            : { type: 'continue_turn' as const, queuedSpeed2Actions: queuedSpeed2ActionsCopy };

        newState.actionRequired = {
            type: 'prompt_use_control_mechanic',
            sourceCardId: 'CONTROL_MECHANIC',
            actor: compiler,
            originalAction,
        };
        newState.controlCardHolder = null;
        newState.queuedActions = [];

        // Clear interrupt flags temporarily - they'll be restored after control mechanic
        if (wasInterrupted) {
            delete newState._interruptedTurn;
            delete newState._interruptedPhase;
        }
    } else if (queuedSpeed2Actions.length > 0) {
        const firstAction = queuedSpeed2Actions.shift()!;
        newState.actionRequired = firstAction;
        newState.queuedActions = queuedSpeed2Actions;

        if (firstAction.actor !== compiler) {
            newState._interruptedTurn = compiler;
            newState._interruptedPhase = newState.phase;
            newState.turn = firstAction.actor;
        }
    } else {
        newState.actionRequired = null;
        newState.queuedActions = [];
    }
    
    return newState;
};


export const compileLane = (prevState: GameState, laneIndex: number): GameState => {
    // The check for the control mechanic has been moved to the useGameState hook,
    // to be executed *after* the compile action is fully resolved. This function
    // now simply returns the state to allow the compile animation to proceed.
    return prevState;
};

export const selectHandCardForAction = (prevState: GameState, cardId: string): GameState => {
    if (prevState.actionRequired?.type !== 'select_card_from_hand_to_play') return prevState;
    
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
    // FIX: Use actor from actionRequired, not prevState.turn (critical for interrupt scenarios)
    const actor = 'actor' in prevState.actionRequired ? prevState.actionRequired.actor : prevState.turn;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    let newState = { ...prevState, actionRequired: null };
    newState = log(newState, actor, `${actorName} skips the optional action.`);
    return newState;
};

export const revealOpponentHand = (prevState: GameState): GameState => {
    if (prevState.actionRequired?.type !== 'reveal_opponent_hand') return prevState;

    // FIX: Use actor from actionRequired, not prevState.turn (critical for interrupt scenarios)
    const actor = prevState.actionRequired.actor;
    const opponentId = actor === 'player' ? 'opponent' : 'player';
    let newState = { ...prevState };
    const opponent = { ...newState[opponentId] };

    if (opponent.hand.length > 0) {
        opponent.hand = opponent.hand.map(c => ({ ...c, isRevealed: true }));
        newState[opponentId] = opponent;
        const sourceCard = findCardOnBoard(newState, prevState.actionRequired.sourceCardId);
        const sourceName = sourceCard ? `${sourceCard.card.protocol}-${sourceCard.card.value}` : 'A card effect';
        newState = log(newState, actor, `${sourceName}: Opponent reveals their hand.`);
    }

    newState.actionRequired = null;
    return newState;
};

export const flipCard = (prevState: GameState, targetCardId: string): GameState => {
    // This is a simplified flip that doesn't handle on-flip effects,
    // because it's only used by the AI for simple, direct actions.
    // The main resolver `resolveActionWithCard` handles complex flips.
    return internalResolveTargetedFlip(prevState, targetCardId);
};

export const returnCard = (prevState: GameState, targetCardId: string): GameState => {
    // This is a simplified return that doesn't handle complex on-cover/uncover effects.
    // Used by AI. The main resolver handles the full logic.
    return internalReturnCard(prevState, targetCardId).newState;
};