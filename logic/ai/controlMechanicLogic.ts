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

    // Check both players' win status to determine priority
    const aiState = state.opponent;
    const playerState = state.player;
    const aiCompiledCount = aiState.compiled.filter(c => c).length;
    const playerCompiledCount = playerState.compiled.filter(c => c).length;

    // CRITICAL PRIORITY: If BOTH players have 2 compiled protocols - compare who is closer to winning!
    if (playerCompiledCount === 2 && aiCompiledCount === 2) {
        // Find uncompiled lanes
        const playerUncompiledIndex = playerState.compiled.findIndex(c => !c);
        const aiUncompiledIndex = aiState.compiled.findIndex(c => !c);
        const playerUncompiledValue = playerState.laneValues[playerUncompiledIndex];
        const aiUncompiledValue = aiState.laneValues[aiUncompiledIndex];

        // If player is closer to victory (higher value), prioritize disrupting them
        if (playerUncompiledValue > aiUncompiledValue && targetPlayerKey === 'player') {
            // Find player's compiled lane with LOWEST value (safest to swap)
            let playerWeakestCompiledIndex = -1;
            let minCompiledValue = Infinity;
            for (let i = 0; i < 3; i++) {
                if (playerState.compiled[i] && playerState.laneValues[i] < minCompiledValue) {
                    minCompiledValue = playerState.laneValues[i];
                    playerWeakestCompiledIndex = i;
                }
            }

            // CRITICAL: Only swap if it WORSENS player's position (doesn't give them advantage)
            // Don't swap if the compiled lane we're moving has higher value than their uncompiled
            if (playerWeakestCompiledIndex !== -1 && minCompiledValue <= playerUncompiledValue) {
                const newOrder = [...playerState.protocols];
                [newOrder[playerUncompiledIndex], newOrder[playerWeakestCompiledIndex]] =
                    [newOrder[playerWeakestCompiledIndex], newOrder[playerUncompiledIndex]];
                return { type: 'rearrangeProtocols', newOrder };
            }
            // No good swap found - skip to avoid helping player
            return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
        }

        // If AI is closer or equal, prioritize advancing ourselves
        if (playerUncompiledValue <= aiUncompiledValue && targetPlayerKey === 'opponent') {
            // Find AI's compiled lane with HIGHEST value
            let bestCompiledIndex = -1;
            let maxCompiledValue = -1;
            for (let i = 0; i < 3; i++) {
                if (aiState.compiled[i] && aiState.laneValues[i] > maxCompiledValue) {
                    maxCompiledValue = aiState.laneValues[i];
                    bestCompiledIndex = i;
                }
            }

            // CRITICAL: Only swap if it IMPROVES AI's position
            // Swap if compiled lane has MORE value than uncompiled (advances towards victory)
            if (bestCompiledIndex !== -1 && maxCompiledValue > aiUncompiledValue && maxCompiledValue > 0) {
                const newOrder = [...aiState.protocols];
                [newOrder[aiUncompiledIndex], newOrder[bestCompiledIndex]] =
                    [newOrder[bestCompiledIndex], newOrder[aiUncompiledIndex]];
                return { type: 'rearrangeProtocols', newOrder };
            }
            // No beneficial swap - skip
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }
    }

    // PRIORITY 1: If AI can rearrange PLAYER's protocols, use it strategically!
    if (targetPlayerKey === 'player') {
        // Find player's compiled protocols
        const compiledIndex = playerState.compiled.findIndex(c => c);

        if (compiledIndex === -1) {
            // Player has no compiled protocols yet - nothing to disrupt
            return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
        }

        // CRITICAL STRATEGY: Move player's compiled protocol to the lane where they are CLOSEST to compiling
        // This forces them to recompile (only get 1 card) instead of first compile (flip protocol)

        // Find the lane with highest value that is NOT compiled (closest to compile)
        let strongestUncompiledLane = -1;
        let maxValue = -1;
        for (let i = 0; i < 3; i++) {
            if (!playerState.compiled[i] && playerState.laneValues[i] > maxValue) {
                maxValue = playerState.laneValues[i];
                strongestUncompiledLane = i;
            }
        }

        const compiledLaneValue = playerState.laneValues[compiledIndex];

        // CRITICAL CHECK: Only swap if it ACTUALLY WORSENS player's position!
        // Don't swap if it would HELP the player by giving them a better position
        if (strongestUncompiledLane !== -1 && maxValue >= 7) {
            // Only swap if:
            // 1. The strongest uncompiled lane has HIGHER value than compiled lane (waste their progress)
            // 2. The compiled protocol we're moving doesn't give them MORE value than they have now
            if (maxValue > compiledLaneValue) {
                // Calculate net effect: player loses maxValue, gains compiledLaneValue
                // This is good for us if they lose more than they gain
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
            // Only swap if it disrupts without helping
            const laneWithMostCardsValue = playerState.laneValues[laneWithMostCards];
            // Don't swap if the lane with most cards already has HIGH value (would give them advantage)
            if (laneWithMostCardsValue < 8) {
                const newOrder = [...playerState.protocols];
                [newOrder[compiledIndex], newOrder[laneWithMostCards]] =
                    [newOrder[laneWithMostCards], newOrder[compiledIndex]];
                return { type: 'rearrangeProtocols', newOrder };
            }
        }

        // No good disruption found
        // Check if source is Psychic-2 or other forced effect (not Control Mechanic)
        const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';

        if (isForcedRearrange) {
            // FORCED rearrange - we MUST swap something
            // Find the safest swap that minimally impacts player
            const newOrder = [...playerState.protocols];
            [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
            return { type: 'rearrangeProtocols', newOrder };
        }

        // Control Mechanic - no good disruption found, SKIP to avoid helping player
        return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
    }

    // PRIORITY 2: If AI must rearrange its own protocols - ONLY if it's beneficial!
    if (targetPlayerKey === 'opponent') {
        // Count how many protocols are already compiled
        const compiledCount = aiState.compiled.filter(c => c).length;

        // If AI has 2 compiled protocols, it's CRITICAL to focus on the last one!
        if (compiledCount === 2) {
            // Find the uncompiled lane
            const uncompiledIndex = aiState.compiled.findIndex(c => !c);
            const uncompiledValue = aiState.laneValues[uncompiledIndex];

            // Find the compiled lane with HIGHEST value
            let bestCompiledIndex = -1;
            let maxCompiledValue = -1;
            for (let i = 0; i < 3; i++) {
                if (aiState.compiled[i] && aiState.laneValues[i] > maxCompiledValue) {
                    maxCompiledValue = aiState.laneValues[i];
                    bestCompiledIndex = i;
                }
            }

            // ONLY swap if it IMPROVES our position (compiled value > uncompiled value)
            // Don't swap if it makes us worse!
            if (bestCompiledIndex !== -1 && maxCompiledValue > uncompiledValue && maxCompiledValue > 0) {
                const newOrder = [...aiState.protocols];
                [newOrder[uncompiledIndex], newOrder[bestCompiledIndex]] =
                    [newOrder[bestCompiledIndex], newOrder[uncompiledIndex]];
                return { type: 'rearrangeProtocols', newOrder };
            }
            // No beneficial swap - SKIP
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }

        // If AI has 1 compiled protocol, prioritize getting the second one
        if (compiledCount === 1) {
            const compiledIndex = aiState.compiled.findIndex(c => c);

            // Find the uncompiled lane with HIGHEST value (closest to compile)
            let strongestUncompiledIndex = -1;
            let maxUncompiledValue = -1;
            for (let i = 0; i < 3; i++) {
                if (!aiState.compiled[i] && aiState.laneValues[i] > maxUncompiledValue) {
                    maxUncompiledValue = aiState.laneValues[i];
                    strongestUncompiledIndex = i;
                }
            }

            const compiledValue = aiState.laneValues[compiledIndex];

            // ONLY swap if it IMPROVES our position AND is worth it
            // Swap if compiled lane has significantly MORE value (≥ 7) than strongest uncompiled
            if (strongestUncompiledIndex !== -1 && compiledValue > maxUncompiledValue && compiledValue >= 7) {
                const newOrder = [...aiState.protocols];
                [newOrder[compiledIndex], newOrder[strongestUncompiledIndex]] =
                    [newOrder[strongestUncompiledIndex], newOrder[compiledIndex]];
                return { type: 'rearrangeProtocols', newOrder };
            }
            // No significant improvement - SKIP
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }

        // If no compiled protocols yet (early game), be conservative
        if (compiledCount === 0) {
            // Find the lane with highest value (closest to first compile)
            let strongestLaneIndex = -1;
            let maxValue = -1;
            for (let i = 0; i < 3; i++) {
                if (aiState.laneValues[i] > maxValue) {
                    maxValue = aiState.laneValues[i];
                    strongestLaneIndex = i;
                }
            }

            // Only consider rearranging if we have a strong lane (≥ 7)
            if (strongestLaneIndex !== -1 && maxValue >= 7) {
                // Find which protocol from hand could be played to boost another lane
                const bestProtocolInHand = aiState.hand.find(card => {
                    return card.protocol !== aiState.protocols[strongestLaneIndex];
                });

                if (bestProtocolInHand) {
                    const protocolIndex = aiState.protocols.findIndex(p => p === bestProtocolInHand.protocol);
                    const protocolLaneValue = protocolIndex !== -1 ? aiState.laneValues[protocolIndex] : -1;

                    // Only swap if the protocol lane is WEAKER than our strongest (makes sense to consolidate)
                    if (protocolIndex !== -1 && protocolIndex !== strongestLaneIndex && protocolLaneValue < maxValue - 2) {
                        const newOrder = [...aiState.protocols];
                        [newOrder[strongestLaneIndex], newOrder[protocolIndex]] =
                            [newOrder[protocolIndex], newOrder[strongestLaneIndex]];
                        return { type: 'rearrangeProtocols', newOrder };
                    }
                }
            }
        }

        // No beneficial swap found - SKIP (don't change anything)
        return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
    }

    // Fallback
    return { type: 'rearrangeProtocols', newOrder: [...state.opponent.protocols] };
}
