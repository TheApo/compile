/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copy Opponent Middle Effect Executor (Mirror-1)
 *
 * Allows the player to select one of the opponent's face-up uncovered cards
 * and execute its middle effects as if they were on this card.
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from '../../../types';
import { log } from '../../utils/log';
import { findCardOnBoard } from '../../game/helpers/actionUtils';

/**
 * Check if a card has copyable middle effects
 */
function hasMiddleEffects(card: PlayedCard): boolean {
    const customCard = card as any;
    return customCard.customEffects?.middleEffects?.length > 0;
}

/**
 * Get a card's middle effects
 */
export function getMiddleEffects(card: PlayedCard): any[] {
    const customCard = card as any;
    return customCard.customEffects?.middleEffects || [];
}

/**
 * Execute COPY_OPPONENT_MIDDLE effect
 *
 * Finds all face-up uncovered opponent cards with middle effects
 * and prompts the player to select one to copy.
 */
export function executeCopyOpponentMiddleEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const opponent: Player = cardOwner === 'player' ? 'opponent' : 'player';
    const optional = params.optional ?? false;

    // Find all face-up UNCOVERED opponent cards with middle effects
    const validTargets: string[] = [];

    for (let laneIdx = 0; laneIdx < state[opponent].lanes.length; laneIdx++) {
        const lane = state[opponent].lanes[laneIdx];
        if (lane.length === 0) continue;

        // Only the top card (uncovered) is selectable
        const topCard = lane[lane.length - 1];

        // Must be face-up
        if (!topCard.isFaceUp) continue;

        // Must have middle effects to copy
        if (!hasMiddleEffects(topCard)) continue;

        validTargets.push(topCard.id);
    }

    // If no valid targets, skip the effect
    if (validTargets.length === 0) {
        const newState = log(state, cardOwner,
            `No opponent cards with middle commands to copy.`
        );
        return { newState };
    }

    // Set up action for card selection
    let newState = { ...state };
    newState.actionRequired = {
        type: 'select_card_for_copy_middle',
        actor: cardOwner,
        sourceCardId: card.id,
        validTargetIds: validTargets,
        optional,
    } as any;

    return { newState };
}
