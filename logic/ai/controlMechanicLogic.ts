/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Control Mechanic Logic for AI
 *
 * CRITICAL: When evaluating rearrangements during a compile action,
 * the lane being compiled will have its value RESET TO 0 after the compile.
 * This must be considered when determining beneficial swaps!
 */

import { GameState, ActionRequired, AIAction } from '../../types';

/**
 * Gets the effective lane values, accounting for a lane about to be compiled.
 * @param laneValues Current lane values
 * @param compilingLaneIndex The lane being compiled (will be 0 after compile)
 * @returns Adjusted lane values
 */
function getEffectiveLaneValues(laneValues: number[], compilingLaneIndex: number | null): number[] {
    const effective = [...laneValues];
    if (compilingLaneIndex !== null && compilingLaneIndex >= 0 && compilingLaneIndex < 3) {
        effective[compilingLaneIndex] = 0;
    }
    return effective;
}

/**
 * Checks if rearranging PLAYER's protocols would be beneficial for the AI.
 * Returns true if there's at least one swap that hurts the player (score > 0).
 */
export function canBenefitFromPlayerRearrange(state: GameState, compilingLaneIndex: number | null = null): boolean {
    const playerState = state.player;
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
        return false;
    }

    // Get effective values (compiling lane = 0)
    const effectiveValues = getEffectiveLaneValues(playerState.laneValues, compilingLaneIndex);

    // Check if ANY swap would hurt the player (score > 0)
    for (const compiledIdx of compiledIndices) {
        for (const uncompiledIdx of uncompiledIndices) {
            const score = effectiveValues[uncompiledIdx] - effectiveValues[compiledIdx];
            if (score > 0) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks if rearranging AI's (opponent's) own protocols would be beneficial.
 * Returns true if there's a swap that brings uncompiled protocol closer to victory (distance <= 3).
 */
export function canBenefitFromOwnRearrange(state: GameState, compilingLaneIndex: number | null = null): boolean {
    const aiState = state.opponent;
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
        return false;
    }

    // Get effective values (compiling lane = 0)
    const effectiveValues = getEffectiveLaneValues(aiState.laneValues, compilingLaneIndex);

    // Check if ANY swap brings us closer to victory
    for (const compiledIdx of compiledIndices) {
        for (const uncompiledIdx of uncompiledIndices) {
            const valueAfterSwap = effectiveValues[compiledIdx];
            const distanceToWin = 10 - valueAfterSwap;

            if (distanceToWin >= 0 && distanceToWin <= 3) {
                const currentUncompiledValue = effectiveValues[uncompiledIdx];
                const currentDistance = 10 - currentUncompiledValue;

                if (distanceToWin < currentDistance) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Determines the best rearrangement of protocols when the AI uses the Control Mechanic.
 *
 * CRITICAL FIX: When control is used during compile, the lane being compiled
 * will have value 0 AFTER the compile. So when evaluating swaps:
 * - If player is compiling lane X, treat player.laneValues[X] as 0
 * - If AI is compiling lane X, treat opponent.laneValues[X] as 0
 *
 * Example: Player has values [8, 0, 4] and is compiling lane 0 (value 8).
 * After compile, lane 0 will be 0. So effective values are [0, 0, 4].
 * Best strategy: Move compiled protocol to lane 2 (where player has 4),
 * NOT lane 0 (which will be 0 anyway).
 */
export function handleControlRearrange(state: GameState, action: ActionRequired): AIAction {
    if (!action || action.type !== 'prompt_rearrange_protocols') {
        return { type: 'rearrangeProtocols', newOrder: [...state.opponent.protocols] };
    }

    const targetPlayerKey = action.target;
    const disallowedProtocolForLane = action.disallowedProtocolForLane;

    // Determine if this is during a compile and which lane
    // Extract from originalAction if it's a compile action
    let compilingLaneIndex: number | null = null;
    if (action.originalAction && action.originalAction.type === 'compile') {
        compilingLaneIndex = action.originalAction.laneIndex;
    }

    // Helper function to check if a protocol arrangement is valid (respects Anarchy-3 restriction)
    const isValidArrangement = (protocols: string[]): boolean => {
        if (!disallowedProtocolForLane) return true;
        const { laneIndex, protocol } = disallowedProtocolForLane;
        return protocols[laneIndex] !== protocol;
    };

    const aiState = state.opponent;
    const playerState = state.player;

    // Get effective lane values (compiling lane = 0)
    // CRITICAL: AI is the one compiling, so we need to consider which lane AI is compiling
    const aiEffectiveValues = getEffectiveLaneValues(aiState.laneValues, compilingLaneIndex);
    const playerEffectiveValues = getEffectiveLaneValues(playerState.laneValues, compilingLaneIndex);

    const aiCompiledCount = aiState.compiled.filter(c => c).length;
    const playerCompiledCount = playerState.compiled.filter(c => c).length;

    // CRITICAL PRIORITY: If BOTH players have 2 compiled protocols - compare who is closer to winning!
    if (playerCompiledCount === 2 && aiCompiledCount === 2) {
        const playerUncompiledIndex = playerState.compiled.findIndex(c => !c);
        const aiUncompiledIndex = aiState.compiled.findIndex(c => !c);
        const playerUncompiledValue = playerEffectiveValues[playerUncompiledIndex];
        const aiUncompiledValue = aiEffectiveValues[aiUncompiledIndex];

        // If player is closer to victory, prioritize disrupting them
        if (playerUncompiledValue > aiUncompiledValue && targetPlayerKey === 'player') {
            let playerWeakestCompiledIndex = -1;
            let minCompiledValue = Infinity;
            for (let i = 0; i < 3; i++) {
                if (playerState.compiled[i] && playerEffectiveValues[i] < minCompiledValue) {
                    minCompiledValue = playerEffectiveValues[i];
                    playerWeakestCompiledIndex = i;
                }
            }

            if (playerWeakestCompiledIndex !== -1 && minCompiledValue <= playerUncompiledValue) {
                const newOrder = [...playerState.protocols];
                [newOrder[playerUncompiledIndex], newOrder[playerWeakestCompiledIndex]] =
                    [newOrder[playerWeakestCompiledIndex], newOrder[playerUncompiledIndex]];

                if (isValidArrangement(newOrder)) {
                    return { type: 'rearrangeProtocols', newOrder };
                }
            }
            return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
        }

        // If AI is closer or equal, prioritize advancing ourselves
        if (playerUncompiledValue <= aiUncompiledValue && targetPlayerKey === 'opponent') {
            let bestCompiledIndex = -1;
            let maxCompiledValue = -1;
            for (let i = 0; i < 3; i++) {
                if (aiState.compiled[i] && aiEffectiveValues[i] > maxCompiledValue) {
                    maxCompiledValue = aiEffectiveValues[i];
                    bestCompiledIndex = i;
                }
            }

            if (bestCompiledIndex !== -1 && maxCompiledValue > aiUncompiledValue && maxCompiledValue > 0) {
                const newOrder = [...aiState.protocols];
                [newOrder[aiUncompiledIndex], newOrder[bestCompiledIndex]] =
                    [newOrder[bestCompiledIndex], newOrder[aiUncompiledIndex]];

                if (isValidArrangement(newOrder)) {
                    return { type: 'rearrangeProtocols', newOrder };
                }
            }
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }
    }

    // PRIORITY 1: If AI can rearrange PLAYER's protocols, use it strategically!
    if (targetPlayerKey === 'player') {
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
            // No compiled/uncompiled distinction, but forced rearrange still requires a swap
            const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';
            if (isForcedRearrange) {
                // Must swap SOMETHING - just swap first two
                const newOrder = [...playerState.protocols];
                [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
                if (isValidArrangement(newOrder)) {
                    return { type: 'rearrangeProtocols', newOrder };
                }
            }
            return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
        }

        // Evaluate ALL combinations using EFFECTIVE values
        let bestSwap: { compiledIdx: number; uncompiledIdx: number; score: number } | null = null;

        for (const compiledIdx of compiledIndices) {
            for (const uncompiledIdx of uncompiledIndices) {
                // CRITICAL: Use effective values (compiling lane = 0)
                const score = playerEffectiveValues[uncompiledIdx] - playerEffectiveValues[compiledIdx];

                if (!bestSwap || score > bestSwap.score) {
                    bestSwap = { compiledIdx, uncompiledIdx, score };
                }
            }
        }

        // Check if source is forced effect (not Control Mechanic)
        // CRITICAL: Must check this BEFORE returning unchanged order!
        const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';

        // Only swap if it actually hurts the player (score > 0)
        if (bestSwap && bestSwap.score > 0) {
            const newOrder = [...playerState.protocols];
            [newOrder[bestSwap.compiledIdx], newOrder[bestSwap.uncompiledIdx]] =
                [newOrder[bestSwap.uncompiledIdx], newOrder[bestSwap.compiledIdx]];

            if (isValidArrangement(newOrder)) {
                return { type: 'rearrangeProtocols', newOrder };
            }
        }

        if (isForcedRearrange) {
            // FORCED rearrange (e.g., Psychic-2) - we MUST swap at least 2 protocols
            // Try to find ANY valid swap, prioritizing least harmful
            for (let i = 0; i < 3; i++) {
                for (let j = i + 1; j < 3; j++) {
                    const newOrder = [...playerState.protocols];
                    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
                    if (isValidArrangement(newOrder)) {
                        return { type: 'rearrangeProtocols', newOrder };
                    }
                }
            }
        }

        // Control Mechanic - no good disruption found, SKIP (only for voluntary rearrange)
        return { type: 'rearrangeProtocols', newOrder: [...playerState.protocols] };
    }

    // PRIORITY 2: If AI must rearrange its own protocols
    if (targetPlayerKey === 'opponent') {
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
            // No compiled/uncompiled distinction, but forced rearrange still requires a swap
            const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';
            if (isForcedRearrange) {
                // Must swap SOMETHING - just swap first two
                const newOrder = [...aiState.protocols];
                [newOrder[0], newOrder[1]] = [newOrder[1], newOrder[0]];
                if (isValidArrangement(newOrder)) {
                    return { type: 'rearrangeProtocols', newOrder };
                }
            }
            return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
        }

        // Find swap that minimizes distance to 10 using EFFECTIVE values
        let bestSwap: { compiledIdx: number; uncompiledIdx: number; distanceToWin: number } | null = null;

        for (const compiledIdx of compiledIndices) {
            for (const uncompiledIdx of uncompiledIndices) {
                // CRITICAL: Use effective values (compiling lane = 0)
                const valueAfterSwap = aiEffectiveValues[compiledIdx];
                const distanceToWin = 10 - valueAfterSwap;

                if (distanceToWin >= 0) {
                    if (!bestSwap || distanceToWin < bestSwap.distanceToWin) {
                        bestSwap = { compiledIdx, uncompiledIdx, distanceToWin };
                    }
                }
            }
        }

        // Check if source is forced effect (not Control Mechanic)
        // CRITICAL: Must check this BEFORE returning unchanged order!
        const isForcedRearrange = action.sourceCardId !== 'CONTROL_MECHANIC';

        // Only swap if it brings us significantly closer to victory (distance <= 3)
        // AND it's better than current state
        if (bestSwap && bestSwap.distanceToWin <= 3) {
            const currentUncompiledValue = aiEffectiveValues[bestSwap.uncompiledIdx];
            const currentDistance = 10 - currentUncompiledValue;

            if (bestSwap.distanceToWin < currentDistance) {
                const newOrder = [...aiState.protocols];
                [newOrder[bestSwap.compiledIdx], newOrder[bestSwap.uncompiledIdx]] =
                    [newOrder[bestSwap.uncompiledIdx], newOrder[bestSwap.compiledIdx]];

                if (isValidArrangement(newOrder)) {
                    return { type: 'rearrangeProtocols', newOrder };
                }
            }
        }

        if (isForcedRearrange) {
            // FORCED rearrange (e.g., Psychic-2) - we MUST swap at least 2 protocols
            // Try to find ANY valid swap
            for (let i = 0; i < 3; i++) {
                for (let j = i + 1; j < 3; j++) {
                    const newOrder = [...aiState.protocols];
                    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
                    if (isValidArrangement(newOrder)) {
                        return { type: 'rearrangeProtocols', newOrder };
                    }
                }
            }
        }

        // Control Mechanic - no good swap found, SKIP (only for voluntary rearrange)
        return { type: 'rearrangeProtocols', newOrder: [...aiState.protocols] };
    }

    // FALLBACK
    const fallbackOrder = targetPlayerKey === 'player' ? [...playerState.protocols] : [...aiState.protocols];

    if (isValidArrangement(fallbackOrder)) {
        return { type: 'rearrangeProtocols', newOrder: fallbackOrder };
    }

    // If even the current order is invalid, find ANY valid arrangement
    for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
            const testOrder = [...fallbackOrder];
            [testOrder[i], testOrder[j]] = [testOrder[j], testOrder[i]];
            if (isValidArrangement(testOrder)) {
                return { type: 'rearrangeProtocols', newOrder: testOrder };
            }
        }
    }

    return { type: 'rearrangeProtocols', newOrder: fallbackOrder };
}
