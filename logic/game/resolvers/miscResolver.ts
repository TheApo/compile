/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard, AnimationRequest } from '../../../types';
import { drawFromOpponentDeck } from '../../../utils/gameStateModifiers';
import { log, setLogSource, setLogPhase, increaseLogIndent } from '../../utils/log';
import { recalculateAllLaneValues } from '../stateManager';
// NOTE: checkForHate3Trigger removed - Hate-3 is now custom protocol, triggers via processReactiveEffects
// FIX: Import internal helpers to be used by new functions.
import { findCardOnBoard, internalReturnCard, internalResolveTargetedFlip } from '../helpers/actionUtils';
import { performFillHand } from './playResolver';
import { processReactiveEffects } from '../reactiveEffectProcessor';
import { queuePendingCustomEffects } from '../phaseManager';
import { resolveStateNumber } from '../../effects/actions/stateNumberExecutor';
import { resolveStateProtocol } from '../../effects/actions/stateProtocolExecutor';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import { v4 as uuidv4 } from 'uuid';

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
        // Increase indent for Control mechanic sub-actions (skip/rearrange)
        newState = increaseLogIndent(newState);

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

    // NOTE: Compile deletes are NOT counted in cardsDeleted stats
    // Only effect-based deletes (delete 1 card, delete all cards with value X, etc.) should be counted
    // Stats remain unchanged for cardsDeleted during compile
    const newCompilerStats = { ...compilerState.stats };
    const newNonCompilerStats = { ...nonCompilerState.stats };

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

    // Track compile type in detailed stats (First-Compile vs Re-Compile, Player vs AI)
    if (newState.detailedGameStats) {
        const isRecompile = wasAlreadyCompiled;
        const compileKey = compiler === 'player'
            ? (isRecompile ? 'playerRecompile' : 'playerFirstCompile')
            : (isRecompile ? 'aiRecompile' : 'aiFirstCompile');
        newState = {
            ...newState,
            detailedGameStats: {
                ...newState.detailedGameStats,
                compiles: {
                    ...newState.detailedGameStats.compiles,
                    [compileKey]: newState.detailedGameStats.compiles[compileKey] + 1
                }
            }
        };
    }

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
        // Trigger reactive effects after delete (Hate-3 custom protocol)
        const reactiveResult = processReactiveEffects(newState, 'after_delete', { player: compiler });
        newState = reactiveResult.newState;
    }

    // Trigger reactive effects after compile (War-2: after_compile, after_opponent_compile)
    const compileReactiveResult = processReactiveEffects(newState, 'after_compile', { player: compiler });
    newState = compileReactiveResult.newState;

    // Trigger after_opponent_compile for non-compiler's cards (War-2)
    const oppCompileResult = processReactiveEffects(newState, 'after_opponent_compile', { player: nonCompiler });
    newState = oppCompileResult.newState;

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

    const { disallowedLaneIndex, sourceCardId, isFaceDown, actor, destinationRule, condition, faceDown, targetLaneIndex, validLanes, selectableCardIds, valueFilter, forcedLaneIndex } = prevState.actionRequired as any;

    // NEW: Validate that selected card is in the selectable list (for valueFilter effects like Clarity-2)
    if (selectableCardIds && !selectableCardIds.includes(cardId)) {
        return prevState;
    }

    // NEW: Diversity-0 - if forcedLaneIndex is set, restrict to that lane
    // If faceDown is undefined (player chooses orientation), use validLanes so player can click the lane
    // If faceDown is defined (forced orientation), use preSelectedLane for auto-play
    if (forcedLaneIndex !== undefined) {
        const faceDownValue = faceDown !== undefined ? faceDown : isFaceDown;
        const { ignoreProtocolMatching } = prevState.actionRequired as any;

        if (faceDownValue === undefined) {
            // Player chooses orientation - they must click the lane
            // validLanes restricts to only the forced lane
            return {
                ...prevState,
                actionRequired: {
                    type: 'select_lane_for_play',
                    cardInHandId: cardId,
                    sourceCardId,
                    isFaceDown: undefined,  // Player chooses
                    actor,
                    source: 'hand',
                    validLanes: [forcedLaneIndex],  // Only this lane is clickable
                    ignoreProtocolMatching,  // Pass through for face-up determination
                } as any
            };
        } else {
            // Forced orientation - auto-play to the lane
            return {
                ...prevState,
                actionRequired: {
                    type: 'select_lane_for_play',
                    cardInHandId: cardId,
                    sourceCardId,
                    isFaceDown: faceDownValue,
                    actor,
                    source: 'hand',
                    preSelectedLane: forcedLaneIndex,
                } as any
            };
        }
    }

    // NEW: Smoke-3 - if targetLaneIndex is already set, skip lane selection and go directly to play
    if (targetLaneIndex !== undefined) {
        return {
            ...prevState,
            actionRequired: {
                type: 'select_lane_for_play',
                cardInHandId: cardId,
                sourceCardId,
                isFaceDown: isFaceDown || faceDown,
                actor,
                source: 'hand',
                // Pass targetLaneIndex so the resolver knows which lane was pre-selected
                preSelectedLane: targetLaneIndex,
            } as any
        };
    }

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
            validLanes, // NEW: Smoke-3 - pass valid lanes for highlighting
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

/**
 * Clarity-2/3: "Draw 1 card with a value of X revealed this way."
 * Player/AI selects a card from the revealed deck to draw.
 */
export const resolveSelectRevealedDeckCard = (prevState: GameState, selectedCardId: string): GameState => {
    if (prevState.actionRequired?.type !== 'select_card_from_revealed_deck') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';

    let newState = { ...prevState };
    const actorState = { ...newState[actor] };
    const deck = [...actorState.deck];

    // Find the selected card in the deck
    const selectedIndex = deck.findIndex((c: any) => {
        const cardId = c.id || `deck-${deck.indexOf(c)}`;
        return cardId === selectedCardId;
    });

    if (selectedIndex === -1) {
        console.warn(`[resolveSelectRevealedDeckCard] Card ${selectedCardId} not found in deck`);
        newState.actionRequired = null;
        return newState;
    }

    // Remove card from deck and add to hand
    const selectedCard = deck.splice(selectedIndex, 1)[0];
    const newCard = {
        ...selectedCard,
        id: selectedCard.id || `drawn-${Date.now()}`,
        isFaceUp: true
    };

    actorState.deck = deck;
    actorState.hand = [...actorState.hand, newCard];
    // Clear deckRevealed flag since we're done with the reveal interaction
    actorState.deckRevealed = false;

    newState[actor] = actorState;
    newState = log(newState, actor, `${actorName} draws ${selectedCard.protocol}-${selectedCard.value} from the revealed deck.`);
    newState.actionRequired = null;

    // CRITICAL: Queue any pending effects from the source card (Clarity-2 has shuffle_deck and play effects after draw)
    newState = queuePendingCustomEffects(newState);

    return newState;
};

/**
 * Unity-4: "Reveal your deck, draw all Unity cards, shuffle"
 * Player confirms the revealed deck modal, all matching protocol cards are drawn automatically.
 */
export const resolveRevealDeckDrawProtocol = (prevState: GameState): GameState => {
    if (prevState.actionRequired?.type !== 'reveal_deck_draw_protocol') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const targetProtocol = action.targetProtocol as string;
    const shuffleAfter = action.shuffleAfter as boolean;

    let newState = { ...prevState };
    const actorState = { ...newState[actor] };
    const deck = [...actorState.deck];

    // Find all cards of the target protocol
    const matchingCards = deck.filter(c => c.protocol === targetProtocol);
    const remainingDeck = deck.filter(c => c.protocol !== targetProtocol);

    // Convert to PlayedCards with IDs and add to hand
    const newCards = matchingCards.map(c => ({
        ...c,
        id: uuidv4(),
        isFaceUp: true
    }));

    // Update deck (without matching cards)
    actorState.deck = remainingDeck;

    // Add drawn cards to hand
    actorState.hand = [...actorState.hand, ...newCards];

    // Clear deckRevealed flag
    actorState.deckRevealed = false;

    newState[actor] = actorState;

    // Log the draw action
    if (newCards.length > 0) {
        const cardNames = newCards.map(c => `${c.protocol}-${c.value}`).join(', ');
        newState = log(newState, actor, `${actorName} draws ${newCards.length} ${targetProtocol} card${newCards.length !== 1 ? 's' : ''} (${cardNames}).`);
    } else {
        newState = log(newState, actor, `No ${targetProtocol} cards in deck.`);
    }

    // Shuffle the deck if requested
    if (shuffleAfter) {
        const shuffledDeck = [...newState[actor].deck].sort(() => Math.random() - 0.5);
        newState[actor] = {
            ...newState[actor],
            deck: shuffledDeck
        };
        newState = log(newState, actor, `${actorName} shuffles their deck.`);
    }

    newState.actionRequired = null;

    // Queue any pending effects
    newState = queuePendingCustomEffects(newState);

    return newState;
};

/**
 * Luck-0: "State a number" - Player selects a number (0-5)
 */
export const resolveStateNumberAction = (prevState: GameState, selectedNumber: number): GameState => {
    if (prevState.actionRequired?.type !== 'state_number') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;

    // Resolve the state_number action
    let newState = resolveStateNumber(prevState, actor, selectedNumber);

    // CRITICAL: Queue any pending effects from the source card
    newState = queuePendingCustomEffects(newState);

    return newState;
};

/**
 * Luck-3: "State a protocol" - Player selects a protocol from opponent's cards
 */
export const resolveStateProtocolAction = (prevState: GameState, selectedProtocol: string): GameState => {
    if (prevState.actionRequired?.type !== 'state_protocol') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;

    // Resolve the state_protocol action
    let newState = resolveStateProtocol(prevState, actor, selectedProtocol);

    // CRITICAL: Queue any pending effects from the source card
    newState = queuePendingCustomEffects(newState);

    return newState;
};

/**
 * Select from drawn cards to reveal - Player selects which card to reveal
 */
export const resolveSelectFromDrawnToReveal = (prevState: GameState, selectedCardId: string): GameState => {
    if (prevState.actionRequired?.type !== 'select_from_drawn_to_reveal') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const statedNumber = action.statedNumber;
    const thenAction = action.thenAction;

    let newState = { ...prevState };

    // Find the selected card in the player's hand
    const hand = newState[actor].hand;
    const selectedCard = hand.find((c: any) => c.id === selectedCardId);

    if (!selectedCard) {
        // No card selected (empty string) or card not found - skip reveal, continue chain
        newState.actionRequired = null;
        // Queue any pending custom effects to continue the chain
        newState = queuePendingCustomEffects(newState);
        return newState;
    }

    // Log the reveal with appropriate context
    const filterContext = statedNumber !== undefined ? ` (stated value: ${statedNumber})` : '';
    newState = log(newState, actor, `${actorName} reveals ${selectedCard.protocol}-${selectedCard.value}${filterContext}.`);

    // Store the revealed card ID for the optional play
    newState.lastCustomEffectTargetCardId = selectedCardId;
    newState.actionRequired = null;

    // If thenAction is 'may_play', prompt for optional play
    if (thenAction === 'may_play') {
        newState.actionRequired = {
            type: 'prompt_optional_effect',
            actor: actor,
            sourceCardId: action.sourceCardId,
            effectDef: {
                params: {
                    action: 'play',
                    source: 'hand',
                    useCardFromPreviousEffect: true,
                }
            },
            optional: true,
        } as any;
    }

    return newState;
};

/**
 * Confirm deck discard - User acknowledged the discarded card from deck
 * Execute follow-up effect if present (e.g., Luck-2: draw cards equal to value)
 */
export const resolveConfirmDeckDiscard = (prevState: GameState): GameState => {
    if (prevState.actionRequired?.type !== 'confirm_deck_discard') return prevState;

    const action = prevState.actionRequired as any;
    const {
        sourceCardId,
        followUpEffect,
        conditionalType,
        laneIndex,
        actor,
        discardedCard
    } = action;

    let newState = { ...prevState };
    newState.actionRequired = null;

    // Execute follow-up effect if present (e.g., Luck-2: "draw cards equal to value")
    if (followUpEffect && sourceCardId) {
        const sourceCard = findCardOnBoard(newState, sourceCardId);
        if (sourceCard && sourceCard.card.isFaceUp) {
            const context = {
                cardOwner: sourceCard.owner,
                opponent: (sourceCard.owner === 'player' ? 'opponent' : 'player') as Player,
            };
            const effectLaneIndex = laneIndex !== undefined ? laneIndex :
                newState[sourceCard.owner].lanes.findIndex(l => l.some(c => c.id === sourceCardId));

            // CRITICAL: Check conditional type BEFORE executing follow-up (Luck-3: if_protocol_matches_stated)
            if (conditionalType === 'if_protocol_matches_stated') {
                const discardedProtocol = discardedCard?.protocol;
                const statedProtocol = newState.lastStatedProtocol;

                if (!statedProtocol || !discardedProtocol || discardedProtocol !== statedProtocol) {
                    // Protocol doesn't match - skip the follow-up effect
                    newState = log(newState, sourceCard.owner, `Discarded card (${discardedProtocol}) does not match stated protocol "${statedProtocol || 'none'}". Effect skipped.`);
                    newState = queuePendingCustomEffects(newState);
                    return newState;
                }

                // Protocol matches! Log and continue
                newState = log(newState, sourceCard.owner, `Discarded card matches stated protocol "${statedProtocol}"!`);
            }

            const result = executeCustomEffect(sourceCard.card, effectLaneIndex, newState, context, followUpEffect);
            newState = result.newState;

            // If follow-up created a new action, return that state
            if (newState.actionRequired) {
                return newState;
            }
        }
    }

    // Queue any pending custom effects to continue the chain
    newState = queuePendingCustomEffects(newState);

    return newState;
};

/**
 * Time-0: Select card from trash to play
 * Player selects a card from their discard pile to play
 */
export const resolveSelectTrashCardToPlay = (prevState: GameState, selectedCardIndex: number): GameState => {
    if (prevState.actionRequired?.type !== 'select_card_from_trash_to_play') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const { sourceCardId, faceDown, destinationRule, followUpEffect, conditionalType, sourceLaneIndex } = action;

    let newState = { ...prevState };
    const actorState = { ...newState[actor] };

    // Validate index
    if (selectedCardIndex < 0 || selectedCardIndex >= actorState.discard.length) {
        console.warn(`[resolveSelectTrashCardToPlay] Invalid index ${selectedCardIndex}`);
        newState.actionRequired = null;
        return newState;
    }

    // Remove card from trash
    const newDiscard = [...actorState.discard];
    const selectedCard = newDiscard.splice(selectedCardIndex, 1)[0];
    actorState.discard = newDiscard;
    newState[actor] = actorState;

    // Create a playable card with ID
    // Note: isFaceUp will be determined later based on protocol matching if faceDown is not set
    const cardToPlay = {
        ...selectedCard,
        id: `trash-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        // Temporarily set, will be updated by laneResolver based on protocol matching
        isFaceUp: faceDown === true ? false : true,  // Default to true, laneResolver will check protocol
    };

    // Log the selection
    newState = log(newState, actor, `${actorName} selects ${selectedCard.protocol}-${selectedCard.value} from trash.`);

    // Determine if we should use normal play rules (protocol matching)
    // faceDown === undefined means use normal rules
    const useNormalPlayRules = faceDown === undefined;

    // Now transition to lane selection (like playing from hand)
    // Check if there's a destinationRule
    if (destinationRule?.type === 'other_lines') {
        // Exclude current lane
        const validLanes = [0, 1, 2].filter(i => i !== sourceLaneIndex);
        newState.actionRequired = {
            type: 'select_lane_for_play',
            sourceCardId,
            actor,
            isFaceDown: faceDown,
            source: 'trash',
            preDrawnCard: cardToPlay,  // Card is already selected
            disallowedLaneIndex: sourceLaneIndex,
            validLanes,
            useNormalPlayRules,  // NEW: Flag to indicate protocol matching should determine face state
            // CRITICAL: Pass conditional info for follow-up effects
            followUpEffect,
            conditionalType,
        } as any;
    } else {
        // Any lane is valid
        newState.actionRequired = {
            type: 'select_lane_for_play',
            sourceCardId,
            actor,
            isFaceDown: faceDown,
            source: 'trash',
            preDrawnCard: cardToPlay,
            useNormalPlayRules,  // NEW: Flag to indicate protocol matching should determine face state
            // CRITICAL: Pass conditional info for follow-up effects
            followUpEffect,
            conditionalType,
        } as any;
    }

    return newState;
};

/**
 * Time-3: Select card from trash to reveal
 * Player selects a card from their discard pile to reveal
 * The revealed card is then played face-down in another line
 */
export const resolveSelectTrashCardToReveal = (prevState: GameState, selectedCardIndex: number): GameState => {
    if (prevState.actionRequired?.type !== 'select_card_from_trash_to_reveal') return prevState;

    const action = prevState.actionRequired as any;
    const actor = action.actor as Player;
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const { sourceCardId, followUpEffect, conditionalType, sourceLaneIndex } = action;

    let newState = { ...prevState };
    const actorState = { ...newState[actor] };

    // Validate index
    if (selectedCardIndex < 0 || selectedCardIndex >= actorState.discard.length) {
        console.warn(`[resolveSelectTrashCardToReveal] Invalid index ${selectedCardIndex}`);
        newState.actionRequired = null;
        return newState;
    }

    // Remove card from trash
    const newDiscard = [...actorState.discard];
    const selectedCard = newDiscard.splice(selectedCardIndex, 1)[0];
    actorState.discard = newDiscard;
    newState[actor] = actorState;

    // Log the reveal
    newState = log(newState, actor, `${actorName} reveals ${selectedCard.protocol}-${selectedCard.value} from trash.`);

    // Store revealed card info for follow-up play effect
    const revealedCard = {
        ...selectedCard,
        id: `trash-revealed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        isFaceUp: false  // Will be played face-down
    };

    // Execute follow-up effect (Time-3: "Play it face-down in another line")
    if (followUpEffect) {
        const sourceCard = findCardOnBoard(newState, sourceCardId);
        if (sourceCard && sourceCard.card.isFaceUp) {
            // Get valid lanes (exclude current lane for "other_lines")
            const destRule = followUpEffect.params?.destinationRule;
            const validLanes = destRule?.type === 'other_lines'
                ? [0, 1, 2].filter(i => i !== sourceLaneIndex)
                : [0, 1, 2];

            // Transition to lane selection with the revealed card
            newState.actionRequired = {
                type: 'select_lane_for_play',
                sourceCardId,
                actor,
                isFaceDown: true,  // Time-3 plays face-down
                source: 'trash',
                preDrawnCard: revealedCard,
                disallowedLaneIndex: destRule?.type === 'other_lines' ? sourceLaneIndex : undefined,
                validLanes: destRule?.type === 'other_lines' ? validLanes : undefined,
            } as any;
        } else {
            // Source card no longer active - skip follow-up
            newState = log(newState, actor, `Source card no longer active. Play effect skipped.`);
            newState.actionRequired = null;
            newState = queuePendingCustomEffects(newState);
        }
    } else {
        // No follow-up - just revealed the card
        newState.actionRequired = null;
        newState = queuePendingCustomEffects(newState);
    }

    return newState;
};

/**
 * Confirm deck play preview - User saw the card being drawn from deck, now select lane
 * Transitions from preview modal to lane selection
 */
export const resolveConfirmDeckPlayPreview = (prevState: GameState): GameState => {
    if (prevState.actionRequired?.type !== 'confirm_deck_play_preview') return prevState;

    const action = prevState.actionRequired as any;
    const {
        sourceCardId,
        actor,
        drawnCard,
        isFaceDown,
        excludeCurrentLane,
        currentLaneIndex,
        followUpEffect,
        conditionalType
    } = action;

    let newState = { ...prevState };

    // Transition to lane selection with the pre-drawn card
    newState.actionRequired = {
        type: 'select_lane_for_play',
        sourceCardId,
        actor,
        count: 1,
        isFaceDown,
        excludeCurrentLane,
        currentLaneIndex,
        source: 'deck',
        preDrawnCard: drawnCard,  // The card is already drawn!
        // CRITICAL: Pass conditional info for "If you do" effects
        followUpEffect,
        conditionalType,
    } as any;

    return newState;
};