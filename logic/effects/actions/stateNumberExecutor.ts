/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * State Number Effect Executor
 *
 * Handles the "state a number" effect (Luck-0).
 * Player chooses a number (0-5) which is stored in state for subsequent effects.
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';

/**
 * Execute STATE_NUMBER effect
 * Sets up actionRequired for player to choose a number
 */
export function executeStateNumberEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;

    let newState = { ...state };

    // Set actionRequired for player to choose a number
    newState.actionRequired = {
        type: 'state_number',
        actor: cardOwner,
        sourceCardId: card.id,
        numberSource: params.numberSource || 'own_protocol_values',
    } as any;

    return { newState };
}

/**
 * Resolve the state_number action when player selects a number
 * Called from miscResolver when player chooses
 */
export function resolveStateNumber(
    state: GameState,
    actor: string,
    selectedNumber: number
): GameState {
    let newState = { ...state };

    // Store the stated number for subsequent effects
    newState.lastStatedNumber = selectedNumber;

    // Log the action
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, actor as any, `${actorName} states the number ${selectedNumber}.`);

    // Clear actionRequired
    newState.actionRequired = null;

    return newState;
}
