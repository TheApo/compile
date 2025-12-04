/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Return Effect Executor
 *
 * Handles all return-related effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';

/**
 * Execute RETURN effect
 */
export function executeReturnEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const count = params.count === 'all' ? 99 : (params.count || 1);
    const owner = params.targetFilter?.owner || 'any';

    // NEW: Handle selectLane (Water-3: "Return all cards with a value of 2 in 1 line")
    // User first selects a lane, then all matching cards in that lane are returned
    if (params.selectLane) {
        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_lane_for_return',
            sourceCardId: card.id,
            actor: cardOwner,
            count: params.count,
            targetFilter: params.targetFilter,
        } as any;

        return { newState };
    }

    // CRITICAL: Check if there are cards on board matching the owner filter
    let availableCards: PlayedCard[] = [];
    if (owner === 'own') {
        availableCards = state[cardOwner].lanes.flat();
    } else if (owner === 'opponent') {
        availableCards = state[opponent].lanes.flat();
    } else { // 'any'
        availableCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
    }

    if (availableCards.length === 0) {
        let newState = log(state, cardOwner, `No cards on board to return. Effect skipped.`);
        return { newState };
    }

    let newState = { ...state };

    // FIX: Use 'select_card_to_return' (same as Fire-2)
    // Pass owner filter so UI can restrict clickable cards
    newState.actionRequired = {
        type: 'select_card_to_return',
        sourceCardId: card.id,
        actor: cardOwner,
        targetOwner: owner, // NEW: Pass owner filter to UI
    } as any;

    return { newState };
}
