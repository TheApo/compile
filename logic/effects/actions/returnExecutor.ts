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
import { isCardCommitted, isCardAtIndexUncovered } from '../../game/helpers/actionUtils';

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
    // Extract conditional info for "If you do" effects
    const conditional = params._conditional;
    const count = params.count === 'all' ? 99 : (params.count || 1);
    const owner = params.targetFilter?.owner || 'any';
    const position = params.targetFilter?.position || 'uncovered';
    const faceState = params.targetFilter?.faceState;  // 'face_up' | 'face_down' | undefined
    const destination = params.destination || 'owner_hand';  // 'owner_hand' | 'actor_hand'

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
    // NEW: Check this_card_is_covered - only execute if this card is covered
    if (params.advancedConditional?.type === 'this_card_is_covered') {
        const ownerLanes = state[cardOwner].lanes;
        let isCardCovered = false;

        for (let i = 0; i < ownerLanes.length; i++) {
            const lane = ownerLanes[i];
            const cardIndex = lane.findIndex(c => c.id === card.id);
            if (cardIndex !== -1 && cardIndex < lane.length - 1) {
                isCardCovered = true;
                break;
            }
        }

        if (!isCardCovered) {
            return { newState: state };
        }
    }

    // NEW: Handle returnSelf - return this card to hand
    if (params.returnSelf) {
        let newState = { ...state };
        const ownerLanes = newState[cardOwner].lanes;

        // Find and remove this card from its lane
        for (let i = 0; i < ownerLanes.length; i++) {
            const lane = ownerLanes[i];
            const cardIndex = lane.findIndex(c => c.id === card.id);
            if (cardIndex !== -1) {
                const [returnedCard] = lane.splice(cardIndex, 1);
                newState[cardOwner].hand.push(returnedCard);
                const playerName = cardOwner === 'player' ? 'Player' : 'Opponent';
                newState = log(newState, cardOwner, `${playerName} returns this card to hand.`);
                break;
            }
        }

        return { newState };
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
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;

        return { newState };
    }

    // CRITICAL: Check if there are cards on board matching the owner and position filter
    let availableCards: { card: PlayedCard; isUncovered: boolean }[] = [];
    const checkPlayer = (player: Player) => {
        for (const lane of state[player].lanes) {
            for (let i = 0; i < lane.length; i++) {
                const c = lane[i];

                // CRITICAL: Exclude committed card
                if (isCardCommitted(state, c.id)) continue;

                // CRITICAL: Use central helper for uncovered calculation
                const isUncovered = isCardAtIndexUncovered(state, lane, i);

                // Check position filter
                if (position === 'uncovered' && !isUncovered) continue;
                if (position === 'covered' && isUncovered) continue;
                // position === 'any' allows both

                // Check face state filter (for Assimilation-0: face-down only)
                if (faceState === 'face_up' && !c.isFaceUp) continue;
                if (faceState === 'face_down' && c.isFaceUp) continue;
                // faceState undefined allows both

                // Check valueEquals filter (Water-3: "Return all cards with a value of 2")
                const valueEquals = params.targetFilter?.valueEquals;
                if (valueEquals !== undefined && c.value !== valueEquals) continue;

                availableCards.push({ card: c, isUncovered });
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
    // CRITICAL: Pass allowedIds so animation system knows which cards are valid targets
    const allowedIds = availableCards.map(ac => ac.card.id);
    newState.actionRequired = {
        type: 'select_card_to_return',
        sourceCardId: card.id,
        actor: cardOwner,
        targetOwner: owner, // Pass owner filter to UI
        targetFilter: params.targetFilter, // Pass full targetFilter including position and faceState
        destination: destination, // 'owner_hand' or 'actor_hand' (for stealing)
        allowedIds, // CRITICAL: For animation system to only animate valid targets
        // CRITICAL: Pass conditional info for "If you do" effects
        followUpEffect: conditional?.thenEffect,
        conditionalType: conditional?.type,
    } as any;

    return { newState };
}
