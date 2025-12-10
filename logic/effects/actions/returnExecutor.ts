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
import { getPlayerLaneValue } from '../../game/stateManager';

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
    const position = params.targetFilter?.position || 'uncovered';

    // Advanced Conditional Checks - skip effect if condition not met
    if (params.advancedConditional?.type === 'empty_hand') {
        if (state[cardOwner].hand.length > 0) {
            return { newState: state };
        }
    }
    if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
        const opp = cardOwner === 'player' ? 'opponent' : 'player';
        const ownValue = getPlayerLaneValue(state, cardOwner, laneIndex);
        const oppValue = getPlayerLaneValue(state, opp, laneIndex);
        if (oppValue <= ownValue) {
            return { newState: state };
        }
    }

    // Handle selectLane (Water-3: "Return all cards with a value of 2 in 1 line")
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

    // CRITICAL: Check if there are cards on board matching the owner and position filter
    let availableCards: { card: PlayedCard; isUncovered: boolean }[] = [];
    const checkPlayer = (player: Player) => {
        for (const lane of state[player].lanes) {
            for (let i = 0; i < lane.length; i++) {
                const isUncovered = i === lane.length - 1;
                // Check position filter
                if (position === 'uncovered' && !isUncovered) continue;
                if (position === 'covered' && isUncovered) continue;
                // position === 'any' allows both
                availableCards.push({ card: lane[i], isUncovered });
            }
        }
    };

    if (owner === 'own') {
        checkPlayer(cardOwner);
    } else if (owner === 'opponent') {
        checkPlayer(opponent);
    } else { // 'any'
        checkPlayer('player');
        checkPlayer('opponent');
    }

    if (availableCards.length === 0) {
        let newState = log(state, cardOwner, `No cards on board to return. Effect skipped.`);
        return { newState };
    }

    let newState = { ...state };

    // FIX: Use 'select_card_to_return' (same as Fire-2)
    // Pass owner and position filter so UI can restrict clickable cards
    newState.actionRequired = {
        type: 'select_card_to_return',
        sourceCardId: card.id,
        actor: cardOwner,
        targetOwner: owner, // Pass owner filter to UI
        targetFilter: params.targetFilter, // Pass full targetFilter including position
    } as any;

    return { newState };
}
