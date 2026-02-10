/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, Difficulty, EffectResult, AnimationRequest, EffectContext, GamePhase, PlayedCard } from '../../types';
import { easyAI } from '../ai/easy';
import { normalAI } from '../ai/normal';
// TEMPORARILY DISABLED: hardAI is being completely rewritten
// import { hardAI } from '../ai/hardImproved';
import * as resolvers from './resolvers';
import { executeOnPlayEffect } from '../effectExecutor';
import { findCardOnBoard } from './helpers/actionUtils';
import { performShuffleTrash } from '../effects/actions/shuffleExecutor';
import { CardActionResult, applyCardActionResult } from './resolvers/cardResolver';
import { log } from '../utils/log';
import { executeCustomEffect } from '../customProtocols/effectInterpreter';
import { AnimationQueueItem } from '../../types/animation';
import {
    createDelayAnimation,
    enqueueAnimationsFromRequests,
} from '../animation/animationHelpers';
import {
    createAnimationForAIDecision,
    filterAlreadyCreatedAnimations,
    createAndEnqueueDiscardAnimations,
    createAndEnqueueDrawAnimations,
    createAndEnqueueShiftAnimation,
    createAndEnqueueLaneDeleteAnimations,
    createAndEnqueuePlayAnimation,
    createAndEnqueueGiveAnimation,
    processCompileAnimations,
    processRearrangeWithCompile,
} from '../animation/aiAnimationCreators';

type ActionDispatchers = {
    compileLane: (s: GameState, l: number) => GameState,
    playCard: (s: GameState, c: string, l: number, f: boolean, p: Player) => EffectResult,
    fillHand: (s: GameState, p: Player) => GameState,
    discardCards: (s: GameState, c: string[], p: Player) => GameState,
    flipCard: (s: GameState, c: string) => GameState,
    deleteCard: (s: GameState, c: string) => { newState: GameState, animationRequests: AnimationRequest[] },
    returnCard: (s: GameState, c: string) => GameState,
    skipAction: (s: GameState) => GameState,
    resolveOptionalDrawPrompt: (s: GameState, a: boolean) => GameState,
    resolveOptionalDiscardCustomPrompt: (s: GameState, a: boolean) => GameState,
    resolveOptionalEffectPrompt: (s: GameState, a: boolean) => GameState,
    resolveVariableDiscard: (s: GameState, cardIds: string[]) => GameState,
    resolveRearrangeProtocols: (s: GameState, newOrder: string[]) => GameState,
    resolveActionWithHandCard: (s: GameState, cardId: string) => GameState,
    resolveSwapProtocols: (s: GameState, indices: [number, number]) => GameState,
    revealOpponentHand: (s: GameState) => GameState,
    resolveCustomChoice: (s: GameState, choiceIndex: number) => GameState,
}

type PhaseManager = {
    processEndOfAction: (s: GameState) => GameState,
    processStartOfTurn: (s: GameState) => GameState,
    continueTurnAfterStartPhaseAction: (s: GameState) => GameState,
    continueTurnProgression: (s: GameState) => GameState,
}

// Helper function to correctly end an action based on current phase
// CRITICAL: Start phase actions must use continueTurnAfterStartPhaseAction
// Otherwise the turn gets stuck (e.g., after Spirit-1's "discard or flip" choice)
const endActionForPhase = (state: GameState, phaseManager: PhaseManager): GameState => {
    if (state.phase === 'start') {
        return phaseManager.continueTurnAfterStartPhaseAction(state);
    }
    return phaseManager.processEndOfAction(state);
};

const getAIAction = (state: GameState, action: ActionRequired | null, difficulty: Difficulty): AIAction => {
    switch (difficulty) {
        case 'normal':
            return normalAI(state, action);
        case 'hard':
            // TEMPORARILY: Hard AI falls back to normal AI until rewritten
            return normalAI(state, action);
        default:
            return easyAI(state, action);
    }
};


// =============================================================================
// NEW SYNCHRONOUS AI SYSTEM
// =============================================================================

/**
 * SYNCHRONOUS version of handleRequiredAction.
 * Handles a single actionRequired and returns the new state.
 * Does NOT use setTimeout or callbacks - all logic is synchronous.
 * Animations are enqueued but NOT waited for.
 */
export const handleRequiredActionSync = (
    state: GameState,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    phaseManager: PhaseManager,
    enqueueAnimation: (item: Omit<AnimationQueueItem, 'id'>) => void
): GameState => {
    const action = state.actionRequired!;

    // --- EXECUTE FOLLOW UP EFFECT (AUTOMATIC - NO AI DECISION NEEDED) ---
    // CRITICAL: Must come BEFORE getAIAction because this is an automatic effect!
    if (action.type === 'execute_follow_up_effect') {
        const { sourceCardId, followUpEffect, actor, logContext } = action as any;
        const sourceCardInfo = findCardOnBoard(state, sourceCardId);

        if (!sourceCardInfo || !sourceCardInfo.card.isFaceUp) {
            let newState = { ...state };
            if (logContext?.sourceCardName) newState._currentEffectSource = logContext.sourceCardName;
            if (logContext?.phase) newState._currentPhaseContext = logContext.phase;
            if (logContext?.indentLevel !== undefined) newState._logIndentLevel = logContext.indentLevel;
            const cardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'the source card';
            const reason = !sourceCardInfo ? 'deleted' : 'flipped face-down';
            newState = log(newState, actor, `Follow-up effect from ${cardName} skipped (${reason}).`);
            newState.actionRequired = null;
            return endActionForPhase(newState, phaseManager);
        }

        const lane = state[sourceCardInfo.owner].lanes.find(l => l.some(c => c.id === sourceCardId));
        const laneIdx = state[sourceCardInfo.owner].lanes.indexOf(lane!);
        const context = {
            cardOwner: sourceCardInfo.owner,
            actor: actor,
            currentTurn: state.turn,
            opponent: (sourceCardInfo.owner === 'player' ? 'opponent' : 'player') as Player,
        };

        // Restore log context
        let newState = { ...state, actionRequired: null };
        if (logContext?.sourceCardName) newState._currentEffectSource = logContext.sourceCardName;
        if (logContext?.phase) newState._currentPhaseContext = logContext.phase;
        if (logContext?.indentLevel !== undefined) newState._logIndentLevel = logContext.indentLevel;

        const result = executeCustomEffect(sourceCardInfo.card, laneIdx, newState, context, followUpEffect);
        newState = result.newState;

        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    const aiDecision = getAIAction(state, action, difficulty);

    // --- SKIP ---
    if (aiDecision.type === 'skip') {
        const newState = actions.skipAction(state);
        return state.phase === 'start'
            ? phaseManager.continueTurnAfterStartPhaseAction(newState)
            : phaseManager.processEndOfAction(newState);
    }

    // --- SELECT LANE (for shift, play from deck, delete, etc.) ---
    if (aiDecision.type === 'selectLane') {
        // CRITICAL: Create animations BEFORE state change using DRY helpers
        const shiftAnimationCreated = createAndEnqueueShiftAnimation(state, action, aiDecision.laneIndex, enqueueAnimation, true);

        // DRY: Use centralized helper for lane-based delete animations (Death-2, Metal-3)
        // Create a batch wrapper for enqueueAnimation
        const enqueueAnimationsBatch = enqueueAnimation
            ? (items: Omit<AnimationQueueItem, 'id'>[]) => items.forEach(item => enqueueAnimation!(item))
            : undefined;
        const deleteAnimationCreated = enqueueAnimationsBatch
            ? createAndEnqueueLaneDeleteAnimations(state, action, aiDecision.laneIndex, enqueueAnimationsBatch, true)
            : false;

        // Execute lane selection synchronously
        const { nextState, requiresAnimation } = resolvers.resolveActionWithLane(state, aiDecision.laneIndex);

        // Process remaining animations (filter out already created ones)
        if (requiresAnimation && enqueueAnimation) {
            let filteredRequests = requiresAnimation.animationRequests;
            if (shiftAnimationCreated) {
                filteredRequests = filteredRequests.filter(r => r.type !== 'shift');
            }
            if (deleteAnimationCreated) {
                filteredRequests = filteredRequests.filter(r => r.type !== 'delete');
            }
            if (filteredRequests.length > 0) {
                enqueueAnimationsFromRequests(state, filteredRequests, enqueueAnimation);
            }
        }

        if (nextState.actionRequired && nextState.actionRequired.actor === 'opponent') {
            return nextState; // More actions to handle - loop will continue
        }
        return endActionForPhase(nextState, phaseManager);
    }

    // --- SELECT CARD (flip, delete, return, shift) ---
    if (aiDecision.type === 'flipCard' || aiDecision.type === 'deleteCard' || aiDecision.type === 'returnCard' || aiDecision.type === 'shiftCard' || aiDecision.type === 'selectCard') {
        // DRY: Create animation BEFORE state change using centralized helper
        createAnimationForAIDecision(state, aiDecision, enqueueAnimation);

        // Execute card action synchronously (don't pass enqueueAnimation - we already created animation)
        const result = resolvers.resolveActionWithCard(state, aiDecision.cardId);

        // CRITICAL: Use applyCardActionResult to ensure followUpEffects are ALWAYS processed
        // This is where Death-1's "then delete this card" etc. gets executed
        const endTurnCb = (stateToProgress: GameState): GameState => {
            if (stateToProgress.actionRequired && stateToProgress.actionRequired.actor === 'opponent') {
                return stateToProgress;
            }
            return state.phase === 'start'
                ? phaseManager.continueTurnAfterStartPhaseAction(stateToProgress)
                : phaseManager.processEndOfAction(stateToProgress);
        };
        let stateAfterCallback = applyCardActionResult(result, endTurnCb);

        // Enqueue any pending animations collected during sync execution
        if (stateAfterCallback._pendingAnimations && stateAfterCallback._pendingAnimations.length > 0) {
            for (const animItem of stateAfterCallback._pendingAnimations) {
                const { id, ...itemWithoutId } = animItem;
                enqueueAnimation(itemWithoutId);
            }
            stateAfterCallback = { ...stateAfterCallback, _pendingAnimations: undefined };
        }

        if (stateAfterCallback.actionRequired && stateAfterCallback.actionRequired.actor === 'opponent') {
            return stateAfterCallback;
        }
        if (result.requiresTurnEnd || (stateAfterCallback.queuedActions && stateAfterCallback.queuedActions.length > 0)) {
            return endActionForPhase(stateAfterCallback, phaseManager);
        }
        return stateAfterCallback;
    }

    // --- DISCARD CARDS ---
    if (aiDecision.type === 'discardCards' && action.type === 'discard') {
        const isVariableCount = (action as any).variableCount === true;
        const maxCards = isVariableCount ? aiDecision.cardIds.length : action.count;
        const cardIdsToDiscard = aiDecision.cardIds.slice(0, maxCards);

        // NOTE: discardCards() now sets _pendingAnimationRequests (DRY - single place for discard animations)
        const newState = actions.discardCards(state, cardIdsToDiscard, 'opponent');
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- REARRANGE PROTOCOLS ---
    if (aiDecision.type === 'rearrangeProtocols' && action.type === 'prompt_rearrange_protocols') {
        // DRY: Use centralized helper for rearrange → compile animation handling
        const stateBeforeRearrange = state;
        let newState = actions.resolveRearrangeProtocols(state, aiDecision.newOrder);
        newState = processRearrangeWithCompile(newState, stateBeforeRearrange, action.originalAction, enqueueAnimation);

        return endActionForPhase(newState, phaseManager);
    }

    // --- OPTIONAL PROMPTS ---
    if (aiDecision.type === 'resolveOptionalEffectPrompt') {
        if (action.type === 'prompt_optional_draw') {
            const nextState = actions.resolveOptionalDrawPrompt(state, aiDecision.accept);
            if (nextState.actionRequired) return nextState;
            return endActionForPhase(nextState, phaseManager);
        }
        const nextState = actions.resolveOptionalEffectPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- CUSTOM CHOICE ---
    if (aiDecision.type === 'resolveCustomChoice' && action.type === 'custom_choice') {
        const nextState = actions.resolveCustomChoice(state, aiDecision.optionIndex);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- SWAP PROTOCOLS ---
    if (aiDecision.type === 'resolveSwapProtocols' && action.type === 'prompt_swap_protocols') {
        const nextState = actions.resolveSwapProtocols(state, aiDecision.indices);
        return endActionForPhase(nextState, phaseManager);
    }

    // --- CONTROL MECHANIC ---
    if (aiDecision.type === 'resolveControlMechanicPrompt' && action.type === 'prompt_use_control_mechanic') {
        const { choice } = aiDecision;
        const { originalAction, actor } = action;

        if (choice === 'skip') {
            let stateAfterSkip = log(state, actor, "Opponent skips rearranging protocols.");
            stateAfterSkip.actionRequired = null;
            stateAfterSkip = { ...stateAfterSkip, _logIndentLevel: 0 };

            if (originalAction.type === 'compile') {
                // Return state - compile will be handled by main loop
                return { ...stateAfterSkip, phase: 'compile' as GamePhase };
            } else if (originalAction.type === 'fill_hand') {
                const stateAfterFill = actions.fillHand(stateAfterSkip, actor);
                return phaseManager.processEndOfAction(stateAfterFill);
            } else {
                return phaseManager.processEndOfAction(stateAfterSkip);
            }
        } else {
            const target = choice;
            const actorName = 'Opponent';
            const targetName = target === 'opponent' ? "the player's" : "their own";
            let stateWithChoice = log(state, actor, `${actorName} chooses to rearrange ${targetName} protocols.`);
            stateWithChoice.actionRequired = {
                type: 'prompt_rearrange_protocols',
                sourceCardId: 'CONTROL_MECHANIC',
                target,
                actor,
                originalAction,
            };
            return stateWithChoice;
        }
    }

    // --- PLAY CARD FROM HAND (Speed-0, Darkness-3) ---
    if (aiDecision.type === 'playCard' && action.type === 'select_card_from_hand_to_play') {
        const { cardId, laneIndex, isFaceUp } = aiDecision;

        // DRY: Create play animation BEFORE state change using centralized helper
        createAndEnqueuePlayAnimation(state, cardId, laneIndex, isFaceUp, 'opponent', enqueueAnimation, true);

        // Execute play logic
        const { newState: stateAfterPlay, animationRequests } = actions.playCard(
            { ...state, actionRequired: null },
            cardId, laneIndex, isFaceUp, 'opponent'
        );

        // Enqueue effect animations
        if (animationRequests && animationRequests.length > 0) {
            enqueueAnimationsFromRequests(stateAfterPlay, animationRequests, enqueueAnimation);
        }

        const stateWithFlag = { ...stateAfterPlay, _cardPlayedThisActionPhase: true };

        if (stateWithFlag.actionRequired) {
            return stateWithFlag;
        }
        return endActionForPhase(stateWithFlag, phaseManager);
    }

    // --- LUCK PROTOCOL HANDLERS ---
    if (aiDecision.type === 'stateNumber' && action.type === 'state_number') {
        const newState = resolvers.resolveStateNumberAction(state, aiDecision.number);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'stateProtocol' && action.type === 'state_protocol') {
        const newState = resolvers.resolveStateProtocolAction(state, aiDecision.protocol);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'selectFromDrawnToReveal' && action.type === 'select_from_drawn_to_reveal') {
        const newState = resolvers.resolveSelectFromDrawnToReveal(state, aiDecision.cardId);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'confirmDeckDiscard' && action.type === 'confirm_deck_discard') {
        const newState = resolvers.resolveConfirmDeckDiscard(state);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'confirmDeckPlayPreview' && action.type === 'confirm_deck_play_preview') {
        const newState = resolvers.resolveConfirmDeckPlayPreview(state);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- TIME PROTOCOL HANDLERS ---
    if (aiDecision.type === 'selectTrashCard' && action.type === 'select_card_from_trash_to_play') {
        const newState = resolvers.resolveSelectTrashCardToPlay(state, aiDecision.cardIndex);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    if (aiDecision.type === 'selectTrashCard' && action.type === 'select_card_from_trash_to_reveal') {
        const newState = resolvers.resolveSelectTrashCardToReveal(state, aiDecision.cardIndex);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- GIVE CARD ---
    if (aiDecision.type === 'giveCard' && action.type === 'select_card_from_hand_to_give') {
        // Create give animation BEFORE state change (Capture → Change → Enqueue)
        if (enqueueAnimation) {
            createAndEnqueueGiveAnimation(state, aiDecision.cardId, 'opponent', enqueueAnimation);
        }
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- REVEAL CARD ---
    if (aiDecision.type === 'revealCard' && action.type === 'select_card_from_hand_to_reveal') {
        const newState = actions.resolveActionWithHandCard(state, aiDecision.cardId);
        return newState; // Should create a new action to flip
    }

    // --- REVEAL DECK DRAW PROTOCOL (Unity-4) ---
    if (aiDecision.type === 'confirmRevealDeckDrawProtocol' && action.type === 'reveal_deck_draw_protocol') {
        const newState = resolvers.resolveRevealDeckDrawProtocol(state);
        return endActionForPhase(newState, phaseManager);
    }

    // --- SELECT REVEALED DECK CARD (Clarity-2/3) ---
    if (aiDecision.type === 'selectRevealedDeckCard' && action.type === 'select_card_from_revealed_deck') {
        const newState = resolvers.resolveSelectRevealedDeckCard(state, aiDecision.cardId);
        return endActionForPhase(newState, phaseManager);
    }

    // --- REVEAL BOARD CARD PROMPT (shift or flip) ---
    if (aiDecision.type === 'resolveRevealBoardCardPrompt' &&
        (action.type === 'prompt_shift_or_flip_revealed_card' || action.type === 'prompt_shift_or_flip_board_card_custom')) {
        const nextState = resolvers.resolveRevealBoardCardPrompt(state, aiDecision.choice);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- OPTIONAL SHUFFLE TRASH (Clarity-4) ---
    if (aiDecision.type === 'resolvePrompt' && action.type === 'prompt_optional_shuffle_trash') {
        if (!aiDecision.accept) {
            let skippedState = { ...state, actionRequired: null };
            skippedState = log(skippedState, action.actor, `Opponent skips shuffling trash into deck.`);
            return endActionForPhase(skippedState, phaseManager);
        }
        const nextState = performShuffleTrash(state, action.actor, `Clarity-4`);
        return endActionForPhase(nextState.newState, phaseManager);
    }

    // --- OPTIONAL DISCARD CUSTOM ---
    if (aiDecision.type === 'resolveOptionalDiscardCustomPrompt' && action.type === 'prompt_optional_discard_custom') {
        const nextState = actions.resolveOptionalDiscardCustomPrompt(state, aiDecision.accept);
        if (nextState.actionRequired) return nextState;
        return endActionForPhase(nextState, phaseManager);
    }

    // --- EXECUTE CONDITIONAL FOLLOWUP ---
    if (action.type === 'execute_conditional_followup') {
        const { sourceCardId, laneIndex, followUpEffect, context: effectContext, actor, logSource, logPhase, logIndentLevel } = action as any;
        const sourceCard = findCardOnBoard(state, sourceCardId);

        if (!sourceCard) {
            let newState = { ...state };
            if (logSource !== undefined) newState._currentEffectSource = logSource;
            if (logPhase !== undefined) newState._currentPhaseContext = logPhase;
            if (logIndentLevel !== undefined) newState._logIndentLevel = logIndentLevel;
            newState = log(newState, actor, `Follow-up effect skipped (source no longer active).`);
            newState.actionRequired = null;
            return endActionForPhase(newState, phaseManager);
        }

        let newState = { ...state, actionRequired: null };
        const result = executeCustomEffect(sourceCard.card, laneIndex, newState, effectContext, followUpEffect);
        newState = result.newState;

        if (newState.actionRequired) return newState;
        return endActionForPhase(newState, phaseManager);
    }

    // --- UNKNOWN ACTION ---
    return endActionForPhase({ ...state, actionRequired: null }, phaseManager);
};

/**
 * SYNCHRONOUS version of runOpponentTurn.
 * Processes the ENTIRE AI turn in one synchronous call.
 * Returns the final state after all AI actions are complete.
 * Animations are enqueued but NOT waited for.
 *
 * This function uses a while loop to handle all AI actions:
 * 1. Start phase effects
 * 2. actionRequired handling (shift, flip, etc.)
 * 3. Compile phase
 * 4. Action phase (play card or fill hand)
 * 5. End phase
 *
 * The loop continues until no more AI actions are needed.
 */
export const runOpponentTurnSync = (
    initialState: GameState,
    difficulty: Difficulty,
    actions: ActionDispatchers,
    phaseManager: PhaseManager,
    enqueueAnimation: (item: Omit<AnimationQueueItem, 'id'>) => void,
    onCompileLane?: (state: GameState, laneIndex: number) => GameState
): GameState => {
    let state = { ...initialState };

    // Enqueue a delay animation at the start of opponent's turn (AI "thinking" time)
    // This replaces the old 1500ms setTimeout delay and shows the correct game state during the wait
    const delayAnimation = createDelayAnimation(state, 1000);
    enqueueAnimation(delayAnimation);

    // Safety counter to prevent infinite loops
    let iterations = 0;
    const MAX_ITERATIONS = 50;

    while (iterations < MAX_ITERATIONS) {
        iterations++;

        // Exit conditions
        if (state.winner) return state;
        if (state.turn !== 'opponent') return state;

        // 1. Process start phase effects (first iteration only)
        if (state.phase === 'start' && !state.actionRequired) {
            state = phaseManager.processStartOfTurn(state);
            // After start phase, continue to check for actions
        }

        // 2. Handle actionRequired for opponent
        if (state.actionRequired) {
            const action = state.actionRequired;

            // Check if this action is for the player (opponent should wait)
            const isPlayerAction = 'actor' in action && action.actor === 'player';

            if (isPlayerAction) {
                // Player needs to act - return current state
                return state;
            }

            // Handle opponent action synchronously
            state = handleRequiredActionSync(state, difficulty, actions, phaseManager, enqueueAnimation);
            continue; // Loop back to check for more actions
        }

        // 3. Handle compile phase
        if (state.phase === 'compile' && state.compilableLanes.length > 0) {
            const decision = getAIAction(state, null, difficulty);
            if (decision.type === 'compile') {
                const laneIndex = decision.laneIndex;

                // CRITICAL: Save state BEFORE compile for animation snapshot
                const stateBeforeCompile = state;

                // Use provided compile function or default
                if (onCompileLane) {
                    state = onCompileLane(state, laneIndex);
                } else {
                    state = actions.compileLane(state, laneIndex);
                }

                // DRY: Use central helper for compile animations
                state = processCompileAnimations(state, stateBeforeCompile, laneIndex, 'opponent', enqueueAnimation);

                if (state.winner) return state;

                // Process end of compile action
                state = phaseManager.processEndOfAction(state);
                continue; // Check for control mechanic prompt
            }
        }

        // 4. Handle action phase
        if (state.phase === 'action' && !state._cardPlayedThisActionPhase) {
            const decision = getAIAction(state, null, difficulty);

            // Fill hand
            // NOTE: drawForPlayer sets _pendingAnimationRequests (DRY - single place for draw animations)
            // Animations are processed via useEffect for _pendingAnimationRequests
            if (decision.type === 'fillHand') {
                state = resolvers.fillHand(state, 'opponent');
                if (state.actionRequired) continue;
                state = phaseManager.processEndOfAction(state);
                continue;
            }

            // Play card
            if (decision.type === 'playCard') {
                const { cardId, laneIndex, isFaceUp } = decision;

                // DRY: Create play animation BEFORE state change using centralized helper
                createAndEnqueuePlayAnimation(state, cardId, laneIndex, isFaceUp, 'opponent', enqueueAnimation, true);

                // Execute play logic
                const { newState: stateAfterPlay, animationRequests } = actions.playCard(
                    state, cardId, laneIndex, isFaceUp, 'opponent'
                );

                state = { ...stateAfterPlay, _cardPlayedThisActionPhase: true };

                // Enqueue effect animations (on-cover)
                if (animationRequests && animationRequests.length > 0) {
                    enqueueAnimationsFromRequests(state, animationRequests, enqueueAnimation);
                }

                // Process on-play effect if queued
                if (!state.actionRequired && state.queuedEffect) {
                    const { card: effectCard, laneIndex: effectLane } = state.queuedEffect;
                    const onPlayContext: EffectContext = {
                        cardOwner: 'opponent',
                        actor: 'opponent',
                        currentTurn: state.turn,
                        opponent: 'player',
                        triggerType: 'play'
                    };
                    const onPlayResult = executeOnPlayEffect(effectCard, effectLane, state, onPlayContext);
                    state = { ...onPlayResult.newState, queuedEffect: undefined };

                    // Enqueue on-play effect animations (including draw animations - now uses animationRequests like all effects)
                    if (onPlayResult.animationRequests && onPlayResult.animationRequests.length > 0) {
                        enqueueAnimationsFromRequests(state, onPlayResult.animationRequests, enqueueAnimation);
                    }
                }

                // Continue to check for actionRequired from effects
                continue;
            }
        }

        // 5. No more actions in current phase - advance phase
        // Check if we need to process queuedActions
        if (state.queuedActions && state.queuedActions.length > 0) {
            state = phaseManager.processEndOfAction(state);
            continue;
        }

        // Process end of action/phase
        if (state.phase === 'action' && state._cardPlayedThisActionPhase) {
            // Card was played, advance to hand_limit
            state = { ...state, phase: 'hand_limit' as GamePhase, _cardPlayedThisActionPhase: undefined };
        }

        // Continue turn progression
        state = phaseManager.continueTurnProgression(state);

        // If turn switched to player, we're done
        if (state.turn === 'player') {
            return state;
        }

        // If we're still in opponent's turn but no action to take, continue loop
        // (This handles phase transitions like end -> start of next turn)
    }

    console.error('[SYNC] AI turn exceeded max iterations, returning current state');
    return state;
};
