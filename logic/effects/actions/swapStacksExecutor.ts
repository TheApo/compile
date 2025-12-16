/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Swap Stacks Effect Executor (Mirror-2)
 *
 * Swaps all cards between two of the player's own lanes.
 * Does NOT swap protocols - only the card stacks.
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';

/**
 * Execute SWAP_STACKS effect
 *
 * Finds all lanes with cards and prompts the player to select two lanes.
 * Then swaps all cards between those lanes.
 */
export function executeSwapStacksEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;

    // Check if at least one lane has cards (otherwise nothing to swap)
    const hasAnyCards = state[cardOwner].lanes.some(lane => lane.length > 0);
    if (!hasAnyCards) {
        const newState = log(state, cardOwner, `Cannot swap stacks: no cards on board.`);
        return { newState };
    }

    // All lanes are valid for selection (including empty lanes)
    // Swapping with an empty lane = moving all cards to that lane
    const allLanes = [0, 1, 2];

    // Set up action for lane selection (two-step process)
    let newState = { ...state };
    newState.actionRequired = {
        type: 'select_lanes_for_swap_stacks',
        actor: cardOwner,
        sourceCardId: card.id,
        validLanes: allLanes,
        selectedFirstLane: undefined,  // Will be set after first selection
    } as any;

    return { newState };
}
