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
        // STRATEGY: Evaluate ALL possible swaps between compiled and uncompiled lanes
        // Score = uncompiled_value - compiled_value
        // Higher score = better for AI (hurts player more)

        const compiledIndices: number[] = [];
        const uncompiledIndices: number[] = [];

        for (let i = 0; i < 3; i++) {
            if (playerState.compiled[i]) {
                compiledIndices.push(i);
            } else {
                uncompiledIndices.push(i);
            }
        }

        if (compiledIndices.length === 0 || uncompiledIndices.length === 0) {
            // Can't swap if we don't have both compiled and uncompiled lanes
            return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
        }

        // Evaluate ALL combinations
        let bestSwap: { compiledIdx: number; uncompiledIdx: number; score: number } | null = null;

        for (const compiledIdx of compiledIndices) {
            for (const uncompiledIdx of uncompiledIndices) {
                const score = playerState.laneValues[uncompiledIdx] - playerState.laneValues[compiledIdx];

                if (!bestSwap || score > bestSwap.score) {
                    bestSwap = { compiledIdx, uncompiledIdx, score };
                }
            }
        }

        // Only swap if it actually hurts the player (score > 0)
        if (bestSwap && bestSwap.score > 0) {
            const newOrder = [...playerState.protocols];
            [newOrder[bestSwap.compiledIdx], newOrder[bestSwap.uncompiledIdx]] =
                [newOrder[bestSwap.uncompiledIdx], newOrder[bestSwap.compiledIdx]];
            return { type: 'rearrangeProtocols', newOrder };
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
        // STRATEGY: Evaluate ALL possible swaps between compiled and uncompiled lanes
        // Score = compiled_value - uncompiled_value
        // Higher score = better for AI (strengthens AI more)

        const compiledIndices: number[] = [];
        const uncompiledIndices: number[] = [];

        for (let i = 0; i < 3; i++) {
            if (aiState.compiled[i]) {
                compiledIndices.push(i);
            } else {
                uncompiledIndices.push(i);
            }
        }

        if (compiledIndices.length === 0 || uncompiledIndices.length === 0) {
            // Can't swap if we don't have both compiled and uncompiled lanes
            // Check if forced rearrange
            const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';
            if (isForcedRearrange) {
                // FORCED rearrange - we MUST swap something
                const newOrder = [...aiState.protocols];
                [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
                return { type: 'rearrangeProtocols', newOrder };
            }
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }

        // Evaluate ALL combinations
        let bestSwap: { compiledIdx: number; uncompiledIdx: number; score: number } | null = null;

        for (const compiledIdx of compiledIndices) {
            for (const uncompiledIdx of uncompiledIndices) {
                const score = aiState.laneValues[compiledIdx] - aiState.laneValues[uncompiledIdx];

                if (!bestSwap || score > bestSwap.score) {
                    bestSwap = { compiledIdx, uncompiledIdx, score };
                }
            }
        }

        // Only swap if it actually helps us (score > 0)
        if (bestSwap && bestSwap.score > 0) {
            const newOrder = [...aiState.protocols];
            [newOrder[bestSwap.compiledIdx], newOrder[bestSwap.uncompiledIdx]] =
                [newOrder[bestSwap.uncompiledIdx], newOrder[bestSwap.compiledIdx]];
            return { type: 'rearrangeProtocols', newOrder };
        }

        // No beneficial swap found
        // Check if source is forced effect (not Control Mechanic)
        const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';

        if (isForcedRearrange) {
            // FORCED rearrange - we MUST swap something
            // Find the safest swap that minimally impacts AI
            const newOrder = [...aiState.protocols];
            [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
            return { type: 'rearrangeProtocols', newOrder };
        }

        // Control Mechanic - no beneficial swap found, SKIP (don't change anything)
        return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
    }

    // Fallback
    return { type: 'rearrangeProtocols', newOrder: [...state.opponent.protocols] };
}
