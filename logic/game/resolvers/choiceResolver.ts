/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, EffectContext } from '../../../types';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import { findCardOnBoard } from '../helpers/actionUtils';
import { recalculateAllLaneValues } from '../stateManager';

/**
 * Resolve custom choice (Either/Or) - player selects which option to execute
 */
export const resolveCustomChoice = (prevState: GameState, selectedOptionIndex: number): GameState => {
    if (prevState.actionRequired?.type !== 'custom_choice') return prevState;

    const { options, sourceCardId, actor, laneIndex } = prevState.actionRequired as any;

    if (selectedOptionIndex < 0 || selectedOptionIndex >= options.length) {
        console.error(`[Choice Resolver] Invalid option index: ${selectedOptionIndex}`);
        return prevState;
    }

    const selectedEffect = options[selectedOptionIndex];

    // Find the source card
    const sourceCardInfo = findCardOnBoard(prevState, sourceCardId);
    if (!sourceCardInfo) {
        console.error(`[Choice Resolver] Source card ${sourceCardId} not found`);
        let newState = { ...prevState };
        newState.actionRequired = null;
        return newState;
    }

    // Build effect context
    const opponent: Player = actor === 'player' ? 'opponent' : 'player';
    const effectContext: EffectContext = {
        cardOwner: actor,
        actor,
        currentTurn: prevState.turn,
        opponent,
    };

    // CRITICAL: Clear actionRequired BEFORE executing the effect
    // Otherwise the old custom_choice stays in the state
    let stateBeforeEffect = { ...prevState, actionRequired: null };

    // Execute the selected effect
    const result = executeCustomEffect(sourceCardInfo.card, laneIndex, stateBeforeEffect, effectContext, selectedEffect);
    let newState = recalculateAllLaneValues(result.newState);

    return newState;
};
