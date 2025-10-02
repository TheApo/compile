/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction } from '../../types';

/**
 * Determines the best rearrangement of protocols when the AI uses the Control Mechanic.
 * @param state The current game state.
 * @param action The `prompt_rearrange_protocols` action.
 * @returns An `AIAction` with the new protocol order.
 */
export function handleControlRearrange(state: GameState, action: ActionRequired): AIAction {
    // FIX: The action could be null, or not of the expected type. This guard handles both cases.
    if (!action || action.type !== 'prompt_rearrange_protocols') {
        // Fallback for safety, should not be reached.
        // If action is null, or the wrong type, we can't safely access `action.target`.
        // A safe fallback is to return an unchanged protocol order for the opponent.
        return { type: 'rearrangeProtocols', newOrder: [...state.opponent.protocols] };
    }
    
    const targetPlayerKey = action.target;

    // PRIORITY 1: If AI can rearrange PLAYER's protocols, use it strategically!
    if (targetPlayerKey === 'player') {
        const playerState = state.player;

        // Find player's compiled protocols
        const compiledIndex = playerState.compiled.findIndex(c => c);

        if (compiledIndex === -1) {
            // Player has no compiled protocols yet - nothing to disrupt
            return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
        }

        // CRITICAL STRATEGY: Move player's compiled protocol to the lane where they are CLOSEST to compiling
        // This forces them to recompile (only get 1 card) instead of first compile (flip protocol)
        // This is MUCH more valuable than just reducing incentive!

        // Find the lane with highest value that is NOT compiled (closest to compile)
        let strongestUncompiledLane = -1;
        let maxValue = -1;
        for (let i = 0; i < 3; i++) {
            if (!playerState.compiled[i] && playerState.laneValues[i] > maxValue) {
                maxValue = playerState.laneValues[i];
                strongestUncompiledLane = i;
            }
        }

        // CRITICAL CHECK: Only swap if it ACTUALLY disrupts the player!
        // Don't swap if:
        // 1. The compiled lane already has the HIGHEST value (no benefit to swap)
        // 2. The strongest uncompiled lane is too weak (< 7) to be a threat
        const compiledLaneValue = playerState.laneValues[compiledIndex];

        if (strongestUncompiledLane !== -1 && maxValue >= 7) {
            // Only swap if the strongest uncompiled lane has HIGHER value than compiled lane
            // This forces player to waste progress
            if (maxValue > compiledLaneValue) {
                const newOrder = [...playerState.protocols];
                [newOrder[compiledIndex], newOrder[strongestUncompiledLane]] =
                    [newOrder[strongestUncompiledLane], newOrder[compiledIndex]];
                return { type: 'rearrangeProtocols', newOrder };
            }
        }

        // Alternative strategy: If no strong uncompiled lane, move to lane with most cards
        // BUT only if it actually disrupts (more cards than compiled lane)
        let laneWithMostCards = -1;
        let maxCards = -1;
        for (let i = 0; i < 3; i++) {
            if (i !== compiledIndex && !playerState.compiled[i] && playerState.lanes[i].length > maxCards) {
                maxCards = playerState.lanes[i].length;
                laneWithMostCards = i;
            }
        }

        const compiledLaneCardCount = playerState.lanes[compiledIndex].length;

        if (laneWithMostCards !== -1 && maxCards > compiledLaneCardCount) {
            // Only swap if the lane with most cards has MORE cards than the compiled lane
            // This wastes the player's progress on that lane
            const newOrder = [...playerState.protocols];
            [newOrder[compiledIndex], newOrder[laneWithMostCards]] =
                [newOrder[laneWithMostCards], newOrder[compiledIndex]];
            return { type: 'rearrangeProtocols', newOrder };
        }

        // No good disruption found
        // BUT: If this is a FORCED rearrange (e.g. Psychic-2), we MUST change something!
        // Check if source is Psychic-2 or other forced effect (not Control Mechanic)
        const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';

        if (isForcedRearrange) {
            // FORCED rearrange - we MUST swap something even if not optimal
            // Just swap the first two protocols to show we did something
            const newOrder = [...playerState.protocols];
            [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
            return { type: 'rearrangeProtocols', newOrder };
        }

        // Control Mechanic - no good disruption found, skip
        return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
    }

    // PRIORITY 2: If AI must rearrange its own protocols (less useful)
    // Only optimize if it actually helps
    if (targetPlayerKey === 'opponent') {
        const aiState = state.opponent;

        // Find compiled AI protocols
        const compiledIndices = aiState.compiled
            .map((isCompiled, i) => isCompiled ? i : -1)
            .filter(i => i !== -1);

        // If no compiled protocols, keep current order
        if (compiledIndices.length === 0) {
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }

        // Strategy: Move uncompiled protocols to better positions based on hand
        // Check if we can improve playability by rearranging
        const canImprove = aiState.hand.some(card => {
            const matchingLanes = aiState.protocols
                .map((p, i) => !aiState.compiled[i] && p === card.protocol ? i : -1)
                .filter(i => i !== -1);
            return matchingLanes.length === 0 && aiState.protocols.includes(card.protocol);
        });

        if (canImprove) {
            // Sort uncompiled protocols to front for better playability
            const lanes = aiState.protocols.map((p, i) => ({ protocol: p, compiled: aiState.compiled[i], index: i }));
            lanes.sort((a, b) => {
                if (a.compiled && !b.compiled) return 1; // Uncompiled first
                if (!a.compiled && b.compiled) return -1;
                return 0;
            });
            return { type: 'rearrangeProtocols', newOrder: lanes.map(l => l.protocol) };
        }

        // Otherwise keep current order
        return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
    }

    // Fallback
    return { type: 'rearrangeProtocols', newOrder: [...state.opponent.protocols] };
}
