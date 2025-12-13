/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Precondition Checker
 *
 * Checks if an effect can be executed before creating user prompts.
 * This prevents "dead" prompts where no valid selection exists.
 */

import { GameState, Player, PlayedCard } from '../../../types';
import { EffectDefinition } from '../../../types/customProtocol';
import { findValidTargets, hasValidTargets } from './targetResolver';

/**
 * Result of precondition check
 */
export interface PreconditionResult {
    /** Whether the effect can be executed */
    canExecute: boolean;
    /** Reason why it cannot be executed (if canExecute is false) */
    skipReason?: string;
    /** Count of valid targets (for target-requiring effects) */
    validTargetCount?: number;
}

/**
 * Check if an effect's preconditions are met
 */
export function checkEffectPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    effect: EffectDefinition
): PreconditionResult {
    const params = effect.params || {};
    const action = params.action;

    // Route to specific precondition checkers
    switch (action) {
        case 'flip':
            return checkFlipPrecondition(state, card, laneIndex, cardOwner, params);

        case 'delete':
            return checkDeletePrecondition(state, card, laneIndex, cardOwner, params);

        case 'shift':
            return checkShiftPrecondition(state, card, laneIndex, cardOwner, params);

        case 'return':
            return checkReturnPrecondition(state, card, laneIndex, cardOwner, params);

        case 'draw':
            return checkDrawPrecondition(state, card, laneIndex, cardOwner, params);

        case 'discard':
            return checkDiscardPrecondition(state, card, laneIndex, cardOwner, params);

        case 'play':
            return checkPlayPrecondition(state, card, laneIndex, cardOwner, params);

        case 'give':
        case 'reveal':
            return checkHandPrecondition(state, card, laneIndex, cardOwner, params);

        case 'take':
            return checkTakePrecondition(state, card, laneIndex, cardOwner, params);

        default:
            return { canExecute: true };
    }
}

/**
 * Check flip effect preconditions
 */
function checkFlipPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    // Flip self always possible if card exists
    if (params.flipSelf) {
        return { canExecute: true };
    }

    const targetFilter = params.targetFilter || {};
    const scopeLaneIndex = params.scope === 'this_lane' ? laneIndex : undefined;

    const findOptions = {
        state,
        filter: targetFilter,
        sourceCardId: card.id,
        actor: cardOwner,
        scopeLaneIndex
    };

    if (!hasValidTargets(findOptions)) {
        return {
            canExecute: false,
            skipReason: getNoTargetsMessage('flip', targetFilter)
        };
    }

    const targets = findValidTargets(findOptions);
    return { canExecute: true, validTargetCount: targets.length };
}

/**
 * Check delete effect preconditions
 */
function checkDeletePrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    // Delete self always possible
    if (params.deleteSelf) {
        return { canExecute: true };
    }

    const targetFilter = params.targetFilter || {};
    const scope = params.scope;

    // For each_other_line, check if any other lane has targets
    if (scope === 'each_other_line') {
        const otherLanes = [0, 1, 2].filter(i => i !== laneIndex);
        for (const li of otherLanes) {
            const findOptions = {
                state,
                filter: targetFilter,
                sourceCardId: card.id,
                actor: cardOwner,
                scopeLaneIndex: li
            };

            if (hasValidTargets(findOptions)) {
                return { canExecute: true };
            }
        }

        return {
            canExecute: false,
            skipReason: 'No valid cards to delete in other lanes'
        };
    }

    // Standard delete
    const scopeLaneIndex = scope === 'this_lane' ? laneIndex : undefined;
    const findOptions = {
        state,
        filter: targetFilter,
        sourceCardId: card.id,
        actor: cardOwner,
        scopeLaneIndex
    };

    if (!hasValidTargets(findOptions)) {
        return {
            canExecute: false,
            skipReason: getNoTargetsMessage('delete', targetFilter)
        };
    }

    const targets = findValidTargets(findOptions);
    return { canExecute: true, validTargetCount: targets.length };
}

/**
 * Check shift effect preconditions
 */
function checkShiftPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    // Shift self - check if there are other lanes
    if (params.shiftSelf) {
        const otherLanes = [0, 1, 2].filter(i => i !== laneIndex);
        if (otherLanes.length === 0) {
            return {
                canExecute: false,
                skipReason: 'No other lanes to shift to'
            };
        }
        return { canExecute: true };
    }

    const targetFilter = params.targetFilter || {};
    // CRITICAL FIX: Pass scopeLaneIndex when scope is 'this_lane' (Light-3)
    // Otherwise precondition checks all lanes but executor only checks current lane
    const scopeLaneIndex = params.scope === 'this_lane' ? laneIndex : undefined;
    const findOptions = {
        state,
        filter: targetFilter,
        sourceCardId: card.id,
        actor: cardOwner,
        scopeLaneIndex
    };

    if (!hasValidTargets(findOptions)) {
        return {
            canExecute: false,
            skipReason: getNoTargetsMessage('shift', targetFilter)
        };
    }

    const targets = findValidTargets(findOptions);
    return { canExecute: true, validTargetCount: targets.length };
}

/**
 * Check return effect preconditions
 */
function checkReturnPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    const targetFilter = params.targetFilter || {};
    const owner = targetFilter.owner || 'any';
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';

    // Check if any cards exist on board based on owner filter
    let hasCards = false;

    if (owner === 'own' || owner === 'any') {
        hasCards = hasCards || state[cardOwner].lanes.some(lane => lane.length > 0);
    }
    if (owner === 'opponent' || owner === 'any') {
        hasCards = hasCards || state[opponent].lanes.some(lane => lane.length > 0);
    }

    if (!hasCards) {
        return {
            canExecute: false,
            skipReason: 'No cards on board to return'
        };
    }

    const findOptions = {
        state,
        filter: targetFilter,
        sourceCardId: card.id,
        actor: cardOwner
    };

    if (!hasValidTargets(findOptions)) {
        return {
            canExecute: false,
            skipReason: getNoTargetsMessage('return', targetFilter)
        };
    }

    return { canExecute: true };
}

/**
 * Check draw effect preconditions
 */
function checkDrawPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    const target = params.target || 'self';
    const source = params.source || 'own_deck';
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';

    const drawingPlayer = target === 'opponent' ? opponent : cardOwner;
    const sourcePlayer = source === 'opponent_deck' ? opponent : drawingPlayer;

    // Check if source has cards
    const totalCards = state[sourcePlayer].deck.length + state[sourcePlayer].discard.length;

    if (totalCards === 0) {
        return {
            canExecute: false,
            skipReason: `${sourcePlayer === cardOwner ? 'You have' : 'Opponent has'} no cards to draw`
        };
    }

    return { canExecute: true };
}

/**
 * Check discard effect preconditions
 */
function checkDiscardPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    const target = params.target || 'self';
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';
    const discardingPlayer = target === 'opponent' ? opponent : cardOwner;

    if (state[discardingPlayer].hand.length === 0) {
        return {
            canExecute: false,
            skipReason: `${discardingPlayer === cardOwner ? 'You have' : 'Opponent has'} no cards to discard`
        };
    }

    return { canExecute: true };
}

/**
 * Check play effect preconditions
 */
function checkPlayPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    const source = params.source || 'hand';
    const actor = params.actor === 'opponent'
        ? (cardOwner === 'player' ? 'opponent' : 'player')
        : cardOwner;

    if (source === 'hand') {
        if (state[actor].hand.length === 0) {
            return {
                canExecute: false,
                skipReason: 'No cards in hand to play'
            };
        }
    } else if (source === 'deck') {
        const totalCards = state[actor].deck.length + state[actor].discard.length;
        if (totalCards === 0) {
            return {
                canExecute: false,
                skipReason: 'No cards in deck to play'
            };
        }
    }

    return { canExecute: true };
}

/**
 * Check hand-based effect preconditions (give, reveal)
 */
function checkHandPrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    const source = params.source || 'own_hand';

    if (source === 'opponent_hand') {
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';
        if (state[opponent].hand.length === 0) {
            return {
                canExecute: false,
                skipReason: 'Opponent has no cards in hand'
            };
        }
    } else if (source === 'board') {
        // For board reveals, check for face-down cards
        const targetFilter = params.targetFilter || { faceState: 'face_down' };
        const findOptions = {
            state,
            filter: targetFilter,
            sourceCardId: card.id,
            actor: cardOwner
        };

        if (!hasValidTargets(findOptions)) {
            return {
                canExecute: false,
                skipReason: 'No valid cards to reveal'
            };
        }
    } else {
        if (state[cardOwner].hand.length === 0) {
            return {
                canExecute: false,
                skipReason: 'No cards in hand'
            };
        }
    }

    return { canExecute: true };
}

/**
 * Check take effect preconditions
 */
function checkTakePrecondition(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    params: any
): PreconditionResult {
    const opponent = cardOwner === 'player' ? 'opponent' : 'player';

    if (state[opponent].hand.length === 0) {
        return {
            canExecute: false,
            skipReason: 'Opponent has no cards in hand to take'
        };
    }

    return { canExecute: true };
}

/**
 * Generate appropriate "no targets" message based on filter
 */
function getNoTargetsMessage(action: string, filter: any): string {
    const parts: string[] = [];

    if (filter.owner === 'own') {
        parts.push('your');
    } else if (filter.owner === 'opponent') {
        parts.push("opponent's");
    }

    if (filter.faceState === 'face_up') {
        parts.push('face-up');
    } else if (filter.faceState === 'face_down') {
        parts.push('face-down');
    }

    if (filter.position === 'covered') {
        parts.push('covered');
    } else if (filter.position === 'uncovered') {
        parts.push('uncovered');
    }

    parts.push('cards');

    return `No valid ${parts.join(' ')} to ${action}`;
}

/**
 * Check if effect is optional and has no valid targets
 * Returns true if effect should be skipped entirely
 */
export function shouldSkipOptionalEffect(
    state: GameState,
    card: PlayedCard,
    laneIndex: number,
    cardOwner: Player,
    effect: EffectDefinition
): boolean {
    const params = effect.params || {};

    // Non-optional effects are never skipped this way
    if (!params.optional) {
        return false;
    }

    const precondition = checkEffectPrecondition(state, card, laneIndex, cardOwner, effect);
    return !precondition.canExecute;
}
