/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, GamePhase, PlayedCard } from '../../../types';
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from '../../utils/log';
import { findAndFlipCards, drawForPlayer } from '../../../utils/gameStateModifiers';
import { findCardOnBoard, handleOnFlipToFaceUp } from '../helpers/actionUtils';
import { recalculateAllLaneValues } from '../stateManager';
import { performCompile } from './miscResolver';
import { performFillHand } from './playResolver';
import * as phaseManager from '../phaseManager';
import { queuePendingCustomEffects } from '../phaseManager';
import { canRearrangeProtocols } from '../passiveRuleChecker';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';

// NEW: Generic optional draw prompt resolver (composable for any card)
export const resolveOptionalDrawPrompt = (prevState: GameState, accept: boolean): GameState => {
    console.log('[DEBUG resolveOptionalDrawPrompt] Called with accept:', accept, 'actionRequired type:', prevState.actionRequired?.type);
    if (prevState.actionRequired?.type !== 'prompt_optional_draw') {
        console.log('[DEBUG resolveOptionalDrawPrompt] Type mismatch! Returning prev state.');
        return prevState;
    }

    const { sourceCardId, actor, count, drawingPlayer } = prevState.actionRequired as any;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, `${actorName} chooses to draw ${count} card${count !== 1 ? 's' : ''}.`);
        // Execute the draw
        newState = drawForPlayer(newState, drawingPlayer || actor, count);

        // Check if there's a follow-up effect from conditional chaining
        const followUpEffect = (prevState.actionRequired as any).followUpEffect;
        if (followUpEffect) {

            // Execute the follow-up effect (e.g., delete other card)
            const sourceCard = findCardOnBoard(newState, sourceCardId);
            if (sourceCard) {
                const laneIndex = newState[sourceCard.owner].lanes.findIndex(l => l.some(c => c.id === sourceCardId));
                const opponent = actor === 'player' ? 'opponent' : 'player';
                const context = {
                    cardOwner: actor,
                    actor,
                    currentTurn: newState.turn,
                    opponent,
                    triggerType: 'start' as const
                };
                const result = executeCustomEffect(sourceCard.card, laneIndex, newState, context, followUpEffect);
                newState = result.newState;

                // CRITICAL: Queue pending custom effects (Death-1: nested conditionals)
                newState = queuePendingCustomEffects(newState);
            } else {
                newState.actionRequired = null;
            }
        } else {
            newState.actionRequired = null;
        }
    } else {
        newState = log(newState, actor, `${actorName} skips the draw.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveDeath1Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_death_1_effect') return prevState;

    const { sourceCardId, actor } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, `Death-1: ${actorName} chooses to draw and delete.`);
        // The actor draws one card.
        newState = drawForPlayer(newState, actor, 1);
        newState.actionRequired = {
            type: 'select_card_to_delete_for_death_1',
            sourceCardId,
            actor,
        };
    } else {
        newState = log(newState, actor, `Death-1: ${actorName} skips the effect.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveLove1Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_give_card_for_love_1') return prevState;

    const { actor } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, `Love-1 End: ${actorName} chooses to give 1 card to draw 2.`);
        newState.actionRequired = {
            type: 'select_card_from_hand_to_give',
            sourceCardId: prevState.actionRequired.sourceCardId,
            sourceEffect: 'love_1_end',
            actor,
        };
    } else {
        newState = log(newState, actor, `Love-1 End: ${actorName} skips the effect.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolvePlague4Flip = (prevState: GameState, accept: boolean, player: Player): GameState => {
    if (prevState.actionRequired?.type !== 'plague_4_player_flip_optional') return prevState;

    let newState = { ...prevState, actionRequired: null };

    // Set context for Plague-4 (indent is already set by the End effect)
    newState = setLogSource(newState, 'Plague-4');
    newState = setLogPhase(newState, 'end');

    if (accept) {
        const { sourceCardId } = prevState.actionRequired;
        const actorName = player === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, player, `${actorName} chooses to flip the card.`);
        newState = findAndFlipCards(new Set([sourceCardId]), newState);
        newState.animationState = { type: 'flipCard', cardId: sourceCardId };
    } else {
        const actorName = player === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, player, `${actorName} skips flipping the card.`);
    }

    // Clear context and decrease indent (closing the End effect)
    newState = setLogSource(newState, undefined);
    newState = setLogPhase(newState, undefined);
    newState = decreaseLogIndent(newState);

    return newState;
};

export const resolveFire3Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_fire_3_discard') return prevState;

    const { actor } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, `Fire-3 End: ${actorName} chooses to discard 1 to flip 1.`);
        newState.actionRequired = {
            type: 'discard',
            actor: actor,
            count: 1,
            sourceCardId: prevState.actionRequired.sourceCardId,
            sourceEffect: 'fire_3',
            previousHandSize: newState[actor].hand.length, // Track for "If you do" check
        } as any;
    } else {
        newState = log(newState, actor, `Fire-3 End: ${actorName} skips the effect.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveOptionalDiscardCustomPrompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_optional_discard_custom') return prevState;

    const { actor, count, sourceCardId } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    // CRITICAL: Save followUpEffect AND conditionalType before clearing
    const followUpEffect = (prevState.actionRequired as any)?.followUpEffect;
    const conditionalType = (prevState.actionRequired as any)?.conditionalType;

    if (accept) {
        newState = log(newState, actor, `${actorName} chooses to discard ${count} card(s).`);
        newState.actionRequired = {
            type: 'discard',
            actor: actor,
            count: count,
            sourceCardId: sourceCardId,
            followUpEffect: followUpEffect, // Pass through followUpEffect
            conditionalType: conditionalType, // CRITICAL: Pass through conditionalType for if_executed
            previousHandSize: newState[actor].hand.length,
        } as any;
    } else {
        newState = log(newState, actor, `${actorName} skips the discard.`);
        newState.actionRequired = null;
    }
    return newState;
};

/**
 * GENERIC optional effect prompt resolver
 * Works for ALL optional effects (flip, delete, shift, return, discard, etc.)
 */
export const resolveOptionalEffectPrompt = (prevState: GameState, accept: boolean): GameState => {
    console.log('[DEBUG resolveOptionalEffectPrompt] Called with accept:', accept, 'actionRequired type:', prevState.actionRequired?.type);
    if (prevState.actionRequired?.type !== 'prompt_optional_effect') return prevState;

    const { actor, sourceCardId, effectDef, laneIndex } = prevState.actionRequired as any;
    console.log('[DEBUG resolveOptionalEffectPrompt] effectDef:', effectDef.id, 'has conditional?', !!effectDef.conditional);
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        // User accepts the optional effect - execute it now
        const action = effectDef.params.action;
        newState = log(newState, actor, `${actorName} chooses to execute the optional ${action} effect.`);

        // CRITICAL: Clear actionRequired BEFORE executing the effect
        // Otherwise the old prompt_optional_effect will be inherited by the new state
        newState.actionRequired = null;

        // Find the card and execute the effect
        const sourceCard = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()]
            .find(c => c.id === sourceCardId);

        if (!sourceCard) {
            console.error('[Optional Effect] Source card not found!');
            return newState;
        }

        const context = {
            cardOwner: actor,
            opponent: actor === 'player' ? 'opponent' as const : 'player' as const,
            currentTurn: newState.turn,
            actor: actor,
        };

        // Execute the effect (without optional flag to avoid recursion)
        // CRITICAL: Also remove the conditional to prevent re-evaluation
        // The conditional will be handled by this function after the effect executes
        const effectToExecute = {
            ...effectDef,
            params: { ...effectDef.params, optional: false },
            conditional: undefined  // Remove conditional - we handle it here
        };

        const result = executeCustomEffect(sourceCard, laneIndex, newState, context, effectToExecute);
        console.log('[DEBUG resolveOptionalEffectPrompt] After executeCustomEffect, actionRequired:', result.newState.actionRequired?.type || 'null');

        // CRITICAL: Check if effect was skipped due to no valid targets
        const effectWasSkipped = (result.newState as any)._effectSkippedNoTargets;
        if (effectWasSkipped) {
            console.log('[DEBUG resolveOptionalEffectPrompt] Effect was skipped (no valid targets), NOT executing if_executed followUp');
            // Clean up the marker
            const cleanedState = { ...result.newState };
            delete (cleanedState as any)._effectSkippedNoTargets;
            return cleanedState;
        }

        // CRITICAL: Handle conditional follow-up effects (if_executed)
        if (effectDef.conditional && effectDef.conditional.type === 'if_executed' && effectDef.conditional.thenEffect) {
            console.log('[DEBUG resolveOptionalEffectPrompt] Has if_executed followUp:', effectDef.conditional.thenEffect.id);

            // If the effect created an actionRequired (user needs to select something),
            // we need to attach the followUp to it so it executes AFTER the action completes
            if (result.newState.actionRequired) {
                console.log('[DEBUG resolveOptionalEffectPrompt] Effect has actionRequired, attaching followUp for later execution');
                const stateWithFollowUp = {
                    ...result.newState,
                    actionRequired: {
                        ...result.newState.actionRequired,
                        followUpEffect: effectDef.conditional.thenEffect,
                        conditionalType: 'if_executed',
                    } as any
                };
                return stateWithFollowUp;
            }

            // Effect completed immediately (no actionRequired), execute followUp now
            console.log('[DEBUG resolveOptionalEffectPrompt] Executing if_executed followUp immediately:', effectDef.conditional.thenEffect.id);
            const followUpResult = executeCustomEffect(sourceCard, laneIndex, result.newState, context, effectDef.conditional.thenEffect);
            return followUpResult.newState;
        }

        return result.newState;
    } else {
        // User declines the optional effect
        const action = effectDef.params.action;
        newState = log(newState, actor, `${actorName} skips the optional ${action} effect.`);

        // CRITICAL: If there's an if_executed conditional, it should NOT execute
        // The effect was declined, so followUp is skipped
        newState.actionRequired = null;
        return newState;
    }
};

export const resolveSpeed3Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_for_speed_3') return prevState;

    const { actor, sourceCardId } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        // CRITICAL: Check if there are valid targets (cards in other protocols)
        // A valid target is an uncovered card that is not the source card.
        const validTargets: PlayedCard[] = [];
        for (const lane of newState[actor].lanes) {
            if (lane.length > 0) {
                const topCard = lane[lane.length - 1]; // This is the uncovered card.
                if (topCard.id !== sourceCardId) {
                    validTargets.push(topCard);
                }
            }
        }

        if (validTargets.length > 0) {
            newState = log(newState, actor, `Speed-3 End: ${actorName} chooses to shift a card.`);
            newState.actionRequired = {
                type: 'select_own_card_to_shift_for_speed_3',
                sourceCardId,
                actor,
            };
        } else {
            // No valid targets - auto-skip
            newState = log(newState, actor, `Speed-3 End: ${actorName} has no cards to shift, skipping effect.`);
            newState.actionRequired = null;
        }
    } else {
        newState = log(newState, actor, `Speed-3 End: ${actorName} skips the shift.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveLight2Prompt = (prevState: GameState, choice: 'shift' | 'flip' | 'skip'): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_or_flip_for_light_2') return prevState;

    const { actor, sourceCardId, revealedCardId } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    switch (choice) {
        case 'shift':
            newState = log(newState, actor, `Light-2: ${actorName} chooses to shift the revealed card.`);
            newState.actionRequired = {
                type: 'select_lane_to_shift_revealed_card_for_light_2',
                sourceCardId,
                revealedCardId,
                actor,
            };
            break;
        case 'flip': {
            newState = log(newState, actor, `Light-2: ${actorName} chooses to flip the revealed card face-up.`);
            // FIX: Clear the current action *before* flipping and triggering the next effect.
            // This prevents the Light-2 prompt from persisting and causing an infinite loop.
            const stateWithoutPrompt = { ...newState, actionRequired: null };
            let stateAfterFlip = findAndFlipCards(new Set([revealedCardId]), stateWithoutPrompt);
            stateAfterFlip.animationState = { type: 'flipCard', cardId: revealedCardId };
            
            // Now trigger the on-play effect since it's officially flipped
            const result = handleOnFlipToFaceUp(stateAfterFlip, revealedCardId);
            newState = result.newState;
    
            // The on-play effect might create a new action, which is fine. The old one is gone.
            break;
        }
        case 'skip':
            newState = log(newState, actor, `Light-2: ${actorName} chooses to do nothing with the revealed card.`);
            newState.actionRequired = null;
            break;
    }
    return newState;
};

export const resolveRearrangeProtocols = (
    prevState: GameState,
    newOrder: string[],
    onEndGame: (winner: Player, finalState: GameState) => void
): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_rearrange_protocols') return prevState;

    // NEW: Check passive rules for protocol rearrangement restrictions (Frost-1, custom cards)
    const rearrangeCheck = canRearrangeProtocols(prevState);
    if (!rearrangeCheck.allowed) {
        console.error(`Protocol rearrangement blocked: ${rearrangeCheck.reason}`);
        return prevState; // Block the rearrange
    }

    const { target, actor, originalAction, sourceCardId, disallowedProtocolForLane } = prevState.actionRequired;

    // CRITICAL VALIDATION for Anarchy-3 End Effect: "Anarchy cannot be on this line"
    if (disallowedProtocolForLane) {
        const { laneIndex, protocol } = disallowedProtocolForLane;
        if (newOrder[laneIndex] === protocol) {
            console.error(`Illegal rearrange: ${protocol} cannot be placed on lane ${laneIndex} due to Anarchy-3 restriction`);
            return prevState; // Block the illegal rearrange
        }
    }

    let newState = { ...prevState };
    const targetState = { ...newState[target] };

    // Create a map to preserve the compiled status of each protocol.
    const compiledStatusMap: { [key: string]: boolean } = {};
    targetState.protocols.forEach((proto, index) => {
        compiledStatusMap[proto] = targetState.compiled[index];
    });

    // Create the new array of compiled statuses based on the new protocol order.
    const newCompiled: boolean[] = newOrder.map(proto => compiledStatusMap[proto]);

    // Update only the protocols and their compiled status. The lanes (cards) remain in place.
    targetState.protocols = newOrder;
    targetState.compiled = newCompiled;

    newState[target] = targetState;
    newState.actionRequired = null; // Clear the rearrange action

    // NEW: Handle pending custom effects (for Chaos-1: two rearrange effects)
    // This is duplicated from the central logic because we need it BEFORE processQueuedActions
    const pendingEffects = (newState as any)._pendingCustomEffects;
    if (pendingEffects && pendingEffects.effects.length > 0) {
        console.log('[resolveRearrangeProtocols] Found pending effects:', pendingEffects.effects.length);
        const pendingAction: any = {
            type: 'execute_remaining_custom_effects',
            sourceCardId: pendingEffects.sourceCardId,
            laneIndex: pendingEffects.laneIndex,
            effects: pendingEffects.effects,
            context: pendingEffects.context,
            actor: actor,
        };

        // Queue the pending effects
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            pendingAction
        ];

        // Clear from state after queueing
        delete (newState as any)._pendingCustomEffects;
        console.log('[resolveRearrangeProtocols] Queued pending effects');
    }

    // Convert sourceCardId to a readable name
    let sourceText = 'Control Action';
    if (sourceCardId !== 'CONTROL_MECHANIC') {
        // Find the card and convert to Protocol-Value format
        const card = [...newState.player.lanes.flat(), ...newState.opponent.lanes.flat()].find(c => c.id === sourceCardId);
        if (card) {
            sourceText = `${card.protocol}-${card.value}`;
        }
    }

    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    const targetName = target === actor ? 'their own' : `the opponent's`;

    // Log the new protocol order to make debugging easier
    const protocolOrder = newOrder.join(' | ');
    newState = log(newState, actor, `${sourceText}: ${actorName} rearranges ${targetName} protocols.`);
    newState = log(newState, actor, `New protocol order for ${target}: ${protocolOrder}`);

    let stateAfterRecalc = recalculateAllLaneValues(newState);

    if (originalAction) {
        console.log('[DEBUG resolveRearrangeProtocols] originalAction:', originalAction);
        if (originalAction.type === 'compile') {
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming Compile action...`);
            return performCompile(stateAfterRecalc, originalAction.laneIndex, onEndGame);
        } else if (originalAction.type === 'fill_hand') {
            console.log('[DEBUG resolveRearrangeProtocols] Calling performFillHand for actor:', actor, 'hand before:', stateAfterRecalc[actor].hand.length);
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming Refresh action...`);
            const stateAfterFill = performFillHand(stateAfterRecalc, actor);
            console.log('[DEBUG resolveRearrangeProtocols] After performFillHand, hand length:', stateAfterFill[actor].hand.length);
            console.log('[DEBUG resolveRearrangeProtocols] RETURNING state with', stateAfterFill[actor].hand.length, 'cards');
            return stateAfterFill;
        } else if (originalAction.type === 'continue_turn') {
            // After compile + control rearrange, the turn should END (unless there are Speed-2 actions)
            if (originalAction.queuedSpeed2Actions && originalAction.queuedSpeed2Actions.length > 0) {
                stateAfterRecalc = log(stateAfterRecalc, actor, `Processing remaining Speed-2 effects...`);
                stateAfterRecalc.queuedActions = [
                    ...originalAction.queuedSpeed2Actions,
                    ...(stateAfterRecalc.queuedActions || [])
                ];
            } else {
                // No more actions - turn ends after compile
                stateAfterRecalc = log(stateAfterRecalc, actor, `Turn ends after compile.`);
                stateAfterRecalc.phase = 'hand_limit';
            }
        } else if (originalAction.type === 'resume_interrupted_turn') {
            // CRITICAL: Restore the interrupt after rearrange
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming interrupted turn...`);
            stateAfterRecalc._interruptedTurn = originalAction.interruptedTurn;
            stateAfterRecalc._interruptedPhase = originalAction.interruptedPhase;

            if (originalAction.queuedSpeed2Actions && originalAction.queuedSpeed2Actions.length > 0) {
                stateAfterRecalc.queuedActions = [
                    ...originalAction.queuedSpeed2Actions,
                    ...(stateAfterRecalc.queuedActions || [])
                ];
            }
        }
    }

    return stateAfterRecalc;
};


export const resolvePsychic4Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_return_for_psychic_4') return prevState;
    
    const { actor } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, `Psychic-4 End: ${actorName} chooses to return an opponent's card.`);
        newState.actionRequired = {
            type: 'select_opponent_card_to_return',
            sourceCardId: prevState.actionRequired.sourceCardId,
            actor,
        };
    } else {
        newState = log(newState, actor, `Psychic-4 End: ${actorName} skips the effect.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSpirit1Prompt = (prevState: GameState, choice: 'discard' | 'flip'): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_spirit_1_start') return prevState;

    const { actor, sourceCardId } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (choice === 'discard') {
        newState = log(newState, actor, `Spirit-1 Start: ${actorName} chooses to discard 1 card.`);
        newState.actionRequired = {
            type: 'discard',
            actor: actor,
            count: 1,
            sourceCardId,
            sourceEffect: 'spirit_1_start',
        };
    } else { // flip
        newState = log(newState, actor, `Spirit-1 Start: ${actorName} chooses to flip the card.`);
        newState = findAndFlipCards(new Set([sourceCardId]), newState);
        newState.animationState = { type: 'flipCard', cardId: sourceCardId };
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSpirit3Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_for_spirit_3') return prevState;

    const { actor, sourceCardId } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    let newState = { ...prevState };

    if (accept) {
        const cardInfo = findCardOnBoard(newState, sourceCardId);
        if (cardInfo) {
            const { owner, card } = cardInfo;
            let originalLaneIndex = -1;
            for (let i = 0; i < newState[owner].lanes.length; i++) {
                if (newState[owner].lanes[i].some(c => c.id === card.id)) {
                    originalLaneIndex = i;
                    break;
                }
            }
            if (originalLaneIndex !== -1) {
                newState = log(newState, actor, `Spirit-3 Trigger: ${actorName} chooses to shift the card.`);
                newState.actionRequired = {
                    type: 'select_lane_for_shift',
                    cardToShiftId: sourceCardId,
                    cardOwner: owner,
                    originalLaneIndex: originalLaneIndex,
                    sourceCardId: sourceCardId,
                    actor: actor,
                    // Spirit-3 only shifts, it does NOT flip afterwards
                };
            }
        }
    } else {
        newState = log(newState, actor, `Spirit-3 Trigger: ${actorName} skips the shift.`);
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSwapProtocols = (prevState: GameState, indices: [number, number], onEndGame: (winner: Player, finalState: GameState) => void): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_swap_protocols') return prevState;
    
    const { actor, target, originalAction, sourceCardId } = prevState.actionRequired;
    const playerState = { ...prevState[target] };
    const [index1, index2] = indices.sort((a,b) => a-b);

    const newProtocols = [...playerState.protocols];
    const newCompiled = [...playerState.compiled];
    
    // Swap protocols and compiled status, but NOT the lanes themselves.
    [newProtocols[index1], newProtocols[index2]] = [newProtocols[index2], newProtocols[index1]];
    [newCompiled[index1], newCompiled[index2]] = [newCompiled[index2], newCompiled[index1]];

    playerState.protocols = newProtocols;
    playerState.compiled = newCompiled;
    
    let newState = { ...prevState, [target]: playerState, actionRequired: null };

    // NEW: Handle pending custom effects (for cards with multiple swap effects)
    // This is duplicated from the central logic because we need it BEFORE processQueuedActions
    const pendingEffects = (newState as any)._pendingCustomEffects;
    if (pendingEffects && pendingEffects.effects.length > 0) {
        console.log('[resolveSwapProtocols] Found pending effects:', pendingEffects.effects.length);
        const pendingAction: any = {
            type: 'execute_remaining_custom_effects',
            sourceCardId: pendingEffects.sourceCardId,
            laneIndex: pendingEffects.laneIndex,
            effects: pendingEffects.effects,
            context: pendingEffects.context,
            actor: actor,
        };

        // Queue the pending effects
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            pendingAction
        ];

        // Clear from state after queueing
        delete (newState as any)._pendingCustomEffects;
        console.log('[resolveSwapProtocols] Queued pending effects');
    }

    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    const targetName = target.charAt(0).toUpperCase() + target.slice(1);
    const sourceText = sourceCardId === 'CONTROL_MECHANIC' ? 'Control' : 'Spirit-4';
    newState = log(newState, actor, `${sourceText}: ${actorName} swaps ${targetName}'s protocols ${newProtocols[index2]} and ${newProtocols[index1]}.`);

    if (sourceCardId === 'CONTROL_MECHANIC') {
        newState.controlCardHolder = null;
    }
    
    let stateAfterRecalc = recalculateAllLaneValues(newState);

    if (originalAction) {
        if (originalAction.type === 'compile') {
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming Compile action...`);
            return performCompile(stateAfterRecalc, originalAction.laneIndex, onEndGame);
        } else if (originalAction.type === 'fill_hand') {
            stateAfterRecalc = log(stateAfterRecalc, actor, `Resuming Refresh action...`);
            return performFillHand(stateAfterRecalc, actor);
        }
    }

    return stateAfterRecalc;
};

/**
 * NEW: Resolve Custom Protocol Reveal Board Card Prompt
 * Similar to Light-2 but for custom protocols with flexible followUpAction
 */
export const resolveRevealBoardCardPrompt = (prevState: GameState, choice: 'shift' | 'flip' | 'skip'): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_or_flip_board_card_custom') return prevState;

    const { actor, sourceCardId, revealedCardId, followUpAction, optional } = prevState.actionRequired;
    const actorName = actor.charAt(0).toUpperCase() + actor.slice(1);
    const cardInfo = findCardOnBoard(prevState, revealedCardId);

    if (!cardInfo) return prevState;

    // If followUpAction specified, validate choice
    if (followUpAction && choice !== 'skip' && choice !== followUpAction) {
        console.error(`Invalid choice: ${choice}, followUpAction restricts to: ${followUpAction}`);
        return prevState;
    }

    const owner = cardInfo.owner;
    const laneIndex = prevState[owner].lanes.findIndex(l => l.some(c => c.id === revealedCardId));
    if (laneIndex === -1) return prevState;

    let newState = { ...prevState };

    switch (choice) {
        case 'shift': {
            // CRITICAL: Flip card back to face-down BEFORE shifting
            const lane = [...newState[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === revealedCardId);
            if (cardIndex !== -1) {
                lane[cardIndex] = { ...lane[cardIndex], isFaceUp: false };
                const newLanes = [...newState[owner].lanes];
                newLanes[laneIndex] = lane;
                newState = {
                    ...newState,
                    [owner]: { ...newState[owner], lanes: newLanes }
                };
            }

            newState = log(newState, actor, `${actorName} chooses to shift the revealed card (face-down).`);
            newState.actionRequired = {
                type: 'select_lane_to_shift_revealed_board_card_custom',
                sourceCardId,
                revealedCardId,
                actor,
            };
            break;
        }
        case 'flip': {
            // Card is already face-up from reveal, just trigger effects
            newState = log(newState, actor, `${actorName} chooses to flip the revealed card face-up permanently.`);
            const stateWithoutPrompt = { ...newState, actionRequired: null };

            // Trigger on-flip effects
            const result = handleOnFlipToFaceUp(stateWithoutPrompt, revealedCardId);
            newState = result.newState;
            break;
        }
        case 'skip': {
            // CRITICAL: Flip card back to face-down
            const lane = [...newState[owner].lanes[laneIndex]];
            const cardIndex = lane.findIndex(c => c.id === revealedCardId);
            if (cardIndex !== -1) {
                lane[cardIndex] = { ...lane[cardIndex], isFaceUp: false };
                const newLanes = [...newState[owner].lanes];
                newLanes[laneIndex] = lane;
                newState = {
                    ...newState,
                    [owner]: { ...newState[owner], lanes: newLanes }
                };
            }

            newState = log(newState, actor, `${actorName} chooses to do nothing with the revealed card.`);
            newState.actionRequired = null;
            break;
        }
    }
    return newState;
};
