/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from '../../types';
import { EffectDefinition } from '../../types/customProtocol';
import { log } from '../utils/log';

/**
 * Execute a custom effect based on its EffectDefinition
 */
export function executeCustomEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    effectDef: EffectDefinition
): EffectResult {
    const params = effectDef.params as any;
    const action = params.action;

    console.log('[Custom Effect] Executing:', action, params);

    let result: EffectResult;

    switch (action) {
        case 'draw':
            result = executeDrawEffect(card, laneIndex, state, context, params);
            break;

        case 'flip':
            result = executeFlipEffect(card, laneIndex, state, context, params);
            break;

        case 'delete':
            result = executeDeleteEffect(card, laneIndex, state, context, params);
            break;

        case 'discard':
            result = executeDiscardEffect(card, laneIndex, state, context, params);
            break;

        case 'shift':
            result = executeShiftEffect(card, laneIndex, state, context, params);
            break;

        case 'return':
            result = executeReturnEffect(card, laneIndex, state, context, params);
            break;

        case 'play':
            result = executePlayEffect(card, laneIndex, state, context, params);
            break;

        case 'rearrange_protocols':
        case 'swap_protocols':
            result = executeProtocolEffect(card, laneIndex, state, context, params);
            break;

        case 'reveal':
        case 'give':
            result = executeRevealGiveEffect(card, laneIndex, state, context, params);
            break;

        case 'take':
            result = executeTakeEffect(card, laneIndex, state, context, params);
            break;

        default:
            console.error(`[Custom Effect] Unknown action: ${action}`);
            result = { newState: state };
            break;
    }

    // Handle conditional follow-up effects
    if (effectDef.conditional && effectDef.conditional.thenEffect) {
        const { newState } = result;

        if (newState.actionRequired) {
            // Store the conditional for later execution (after user completes the action)
            newState.actionRequired = {
                ...newState.actionRequired,
                followUpEffect: effectDef.conditional.thenEffect,
            } as any;
            result = { newState };
        } else {
            // Effect completed immediately, execute conditional now
            console.log('[Custom Effect] Executing conditional follow-up effect immediately');
            result = executeCustomEffect(card, laneIndex, newState, context, effectDef.conditional.thenEffect);
        }
    }

    return result;
}

/**
 * Execute DRAW effect
 */
function executeDrawEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;
    const target = params.target || 'self';

    const drawingPlayer = target === 'opponent' ? context.opponent : cardOwner;

    // Simple draw without conditionals for now
    const { drawnCards, remainingDeck } = drawCardsUtil(
        state[drawingPlayer].deck,
        state[drawingPlayer].hand,
        count
    );

    let newState = { ...state };
    newState[drawingPlayer] = {
        ...newState[drawingPlayer],
        deck: remainingDeck,
        hand: drawnCards,
    };

    const playerName = drawingPlayer === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''}.`);

    return { newState };
}

/**
 * Execute FLIP effect
 */
function executeFlipEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    // For now, return actionRequired for player interaction
    // TODO: Implement full flip logic with targetFilter

    const { cardOwner } = context;
    const count = params.count || 1;
    const targetOwner = params.targetFilter?.owner || 'any';

    let newState = log(state, cardOwner, `[Custom Flip effect - selecting ${count} card(s) to flip]`);

    // Set actionRequired for player to select cards
    newState.actionRequired = {
        type: 'select_opponent_face_up_card_to_flip',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
    } as any;

    return { newState };
}

/**
 * Execute DELETE effect
 */
function executeDeleteEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    // For now, return actionRequired for player interaction
    // TODO: Implement full delete logic with targetFilter

    const { cardOwner } = context;
    const count = params.count || 1;

    let newState = log(state, cardOwner, `[Custom Delete effect - selecting ${count} card(s) to delete]`);

    // Set actionRequired for player to select cards
    newState.actionRequired = {
        type: 'select_card_to_delete',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
    } as any;

    return { newState };
}

/**
 * Execute DISCARD effect
 */
function executeDiscardEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;
    const actor = params.actor === 'opponent' ? context.opponent : cardOwner;

    let newState = { ...state };
    newState.actionRequired = {
        type: 'discard',
        actor,
        count,
        sourceCardId: card.id,
    };

    return { newState };
}

/**
 * Execute SHIFT effect
 */
function executeShiftEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const targetOwner = params.targetFilter?.owner === 'opponent' ? context.opponent : cardOwner;

    let newState = log(state, cardOwner, `[Custom Shift effect - selecting card to shift]`);

    // Set actionRequired based on target owner
    if (targetOwner === context.opponent) {
        newState.actionRequired = {
            type: 'select_opponent_covered_card_to_shift',
            sourceCardId: card.id,
            actor: cardOwner,
        } as any;
    } else {
        newState.actionRequired = {
            type: 'select_own_covered_card_to_shift',
            sourceCardId: card.id,
            actor: cardOwner,
        } as any;
    }

    return { newState };
}

/**
 * Execute RETURN effect
 */
function executeReturnEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count === 'all' ? 99 : (params.count || 1);

    let newState = log(state, cardOwner, `[Custom Return effect - selecting ${count} card(s) to return]`);

    newState.actionRequired = {
        type: 'select_own_cards_to_return',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
    } as any;

    return { newState };
}

/**
 * Execute PLAY effect
 */
function executePlayEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;
    const source = params.source || 'hand';
    const faceDown = params.faceDown || false;

    let newState = log(state, cardOwner, `[Custom Play effect - playing ${count} card(s) ${faceDown ? 'face-down' : 'face-up'} from ${source}]`);

    newState.actionRequired = {
        type: 'select_card_from_hand_to_play',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
        faceDown,
    } as any;

    return { newState };
}

/**
 * Execute PROTOCOL effects (rearrange/swap)
 */
function executeProtocolEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const action = params.action;
    const target = params.target || 'self';

    const actingPlayer = target === 'opponent' ? context.opponent : cardOwner;

    let newState = log(state, cardOwner, `[Custom Protocol effect - ${action} for ${actingPlayer}]`);

    if (action === 'rearrange_protocols') {
        newState.actionRequired = {
            type: 'rearrange_protocols',
            actor: actingPlayer,
            sourceCardId: card.id,
        } as any;
    } else if (action === 'swap_protocols') {
        newState.actionRequired = {
            type: 'swap_protocols',
            actor: actingPlayer,
            sourceCardId: card.id,
        } as any;
    }

    return { newState };
}

/**
 * Execute REVEAL/GIVE effects
 */
function executeRevealGiveEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const count = params.count || 1;
    const action = params.action;

    let newState = log(state, cardOwner, `[Custom ${action} effect - selecting ${count} card(s)]`);

    if (action === 'reveal') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_reveal',
            count,
            sourceCardId: card.id,
            actor: cardOwner,
        } as any;
    } else if (action === 'give') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_give',
            count,
            sourceCardId: card.id,
            actor: cardOwner,
        } as any;
    }

    return { newState };
}

/**
 * Execute TAKE effect
 */
function executeTakeEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const count = params.count || 1;
    const random = params.random !== false; // default true

    let newState = log(state, cardOwner, `[Custom Take effect - taking ${count} card(s) from opponent's hand]`);

    // Set actionRequired for player to take cards
    newState.actionRequired = {
        type: random ? 'take_random_from_opponent_hand' : 'take_from_opponent_hand',
        count,
        sourceCardId: card.id,
        actor: cardOwner,
    } as any;

    return { newState };
}

/**
 * Helper: Draw cards (copied from gameStateModifiers)
 */
function drawCardsUtil(
    deck: any[],
    hand: any[],
    count: number
): { drawnCards: any[]; remainingDeck: any[] } {
    const actualDrawCount = Math.min(count, deck.length);
    const drawnCards = [...hand, ...deck.slice(0, actualDrawCount)];
    const remainingDeck = deck.slice(actualDrawCount);
    return { drawnCards, remainingDeck };
}
