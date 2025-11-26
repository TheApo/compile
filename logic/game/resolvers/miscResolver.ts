/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard, AnimationRequest } from '../../../types';
import { drawFromOpponentDeck } from '../../../utils/gameStateModifiers';
import { log, setLogSource, setLogPhase } from '../../utils/log';
import { recalculateAllLaneValues } from '../stateManager';
import { checkForHate3Trigger } from '../../effects/hate/Hate-3';
// FIX: Import internal helpers to be used by new functions.
import { findCardOnBoard, internalReturnCard, internalResolveTargetedFlip } from '../helpers/actionUtils';
import { performFillHand } from './playResolver';
import { processReactiveEffects } from '../reactiveEffectProcessor';

/**
 * CompileResult includes animation requests for deleted cards
 */
export type CompileResult = {
    newState: GameState;
    animationRequests?: AnimationRequest[];
};

export const performCompile = (prevState: GameState, laneIndex: number, onEndGame: (winner: Player, finalState: GameState) => void): GameState => {
    const compiler = prevState.turn;
    const nonCompiler = compiler === 'player' ? 'opponent' : 'player';

    let newState = { ...prevState };

    // NEW: Check for compile block (Metal-1 effect)
    const compileBlocked = (newState as any).compileBlockedPlayer === compiler &&
                           (newState as any).compileBlockedUntilTurn > (newState.turnNumber || 0);

    if (compileBlocked) {
        const compilerName = compiler === 'player' ? 'Player' : 'Opponent';
        console.log(`[Compile Block] ${compilerName}'s compile is blocked until turn ${(newState as any).compileBlockedUntilTurn}`);
        newState = log(newState, compiler, `${compilerName} can't compile - blocked by opponent's effect.`);
        return newState;
    }

    // CHECK FIRST: If compiler has control, prompt for rearrange BEFORE deleting cards
    const compilerHadControl = newState.useControlMechanic && newState.controlCardHolder === compiler;

    if (compilerHadControl) {
        const compilerName = compiler === 'player' ? 'Player' : 'Opponent';
        newState = setLogSource(newState, undefined);
        newState = setLogPhase(newState, undefined);
        newState = { ...newState, _logIndentLevel: 0 };
        newState = log(newState, compiler, `${compilerName} has Control and may rearrange protocols before compiling.`);

        newState.actionRequired = {
            type: 'prompt_use_control_mechanic',
            sourceCardId: 'CONTROL_MECHANIC',
            actor: compiler,
            originalAction: { type: 'compile' as const, laneIndex },
        };
        newState.controlCardHolder = null;
        return newState;
    }

    // If no control or after rearrange, proceed with compile
    let compilerState = { ...newState[compiler] };
    let nonCompilerState = { ...newState[nonCompiler] };

    const wasAlreadyCompiled = compilerState.compiled[laneIndex];

    // NEW: Process before_compile_delete reactive effects for custom cards
    // These effects execute BEFORE the card is deleted by compile
    const customCardsWithBeforeDelete: Array<{ card: PlayedCard; owner: Player }> = [];

    for (const player of [compiler, nonCompiler] as Player[]) {
        const lane = newState[player].lanes[laneIndex];
        lane.forEach(card => {
            if (card.isFaceUp) {
                const customCard = card as any;
                if (customCard.customEffects && customCard.customEffects.topEffects) {
                    const hasBeforeDelete = customCard.customEffects.topEffects.some(
                        (effect: any) => effect.trigger === 'before_compile_delete'
                    );
                    if (hasBeforeDelete) {
                        customCardsWithBeforeDelete.push({ card, owner: player });
                    }
                }
            }
        });
    }

    // Execute before_compile_delete effects
    for (const { card, owner } of customCardsWithBeforeDelete) {
        console.log(`[before_compile_delete] Executing effect for custom card ${card.protocol}-${card.value}`);
        const reactiveResult = processReactiveEffects(newState, 'before_compile_delete', { player: owner, cardId: card.id });
        newState = reactiveResult.newState;
    }

    // Refresh player states after reactive effects
    compilerState = { ...newState[compiler] };
    nonCompilerState = { ...newState[nonCompiler] };

    // Intercept Speed-2 cards AND custom cards with before_compile_delete shift before they are deleted.
    // Helper function to check if a card has before_compile_delete with shiftSelf
    const hasBeforeCompileDeleteShift = (card: PlayedCard): boolean => {
        // Original Speed-2
        if (card.protocol === 'Speed' && card.value === 2 && card.isFaceUp) {
            return true;
        }
        // Custom cards with before_compile_delete + shiftSelf effect
        const customCard = card as any;
        if (customCard.customEffects && customCard.customEffects.topEffects && card.isFaceUp) {
            return customCard.customEffects.topEffects.some(
                (effect: any) => effect.trigger === 'before_compile_delete' &&
                                 effect.params?.action === 'shift' &&
                                 effect.params?.shiftSelf === true
            );
        }
        return false;
    };

    const compilerCardsToShift: PlayedCard[] = [];
    const nonCompilerCardsToShift: PlayedCard[] = [];

    const compilerDeletedCards = compilerState.lanes[laneIndex].filter(c => {
        if (hasBeforeCompileDeleteShift(c)) {
            compilerCardsToShift.push(c);
            return false;
        }
        return true;
    });
    const nonCompilerDeletedCards = nonCompilerState.lanes[laneIndex].filter(c => {
        if (hasBeforeCompileDeleteShift(c)) {
            nonCompilerCardsToShift.push(c);
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
    newCompilerLanes[laneIndex] = compilerCardsToShift;
    compilerState.lanes = newCompilerLanes;

    const newNonCompilerLanes = [...nonCompilerState.lanes];
    newNonCompilerLanes[laneIndex] = nonCompilerCardsToShift;
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

        // NEW: Trigger reactive effects after delete (Hate-3 custom protocol)
        const reactiveResult = processReactiveEffects(newState, 'after_delete', { player: compiler });
        newState = reactiveResult.newState;
    }

    // --- Centralized Post-Compile Logic ---
    // Handle all cards that survived compile due to before_compile_delete shift effect (Speed-2, custom cards)
    const allCardsToShift = [...compilerCardsToShift, ...nonCompilerCardsToShift];
    const queuedShiftActions = allCardsToShift.map(card => {
        const owner = findCardOnBoard(newState, card.id)!.owner;
        const cardName = card.isFaceUp ? `${card.protocol}-${card.value}` : 'Card';
        newState = log(newState, owner, `${cardName} survives compilation and must be shifted.`);
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

    // Handle shift actions if any
    if (queuedShiftActions.length > 0) {
        const firstAction = queuedShiftActions.shift()!;
        newState.actionRequired = firstAction;
        newState.queuedActions = queuedShiftActions;

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

    const { disallowedLaneIndex, sourceCardId, isFaceDown, actor, destinationRule, condition, faceDown } = prevState.actionRequired as any;
    return {
        ...prevState,
        actionRequired: {
            type: 'select_lane_for_play',
            cardInHandId: cardId,
            disallowedLaneIndex,
            sourceCardId,
            isFaceDown: isFaceDown || faceDown, // Support both naming conventions
            actor,
            destinationRule, // Pass through for custom protocols
            condition, // Pass through for conditional play
        } as any
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