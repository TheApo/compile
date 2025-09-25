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

    // If AI is rearranging its own protocols, use optimal sorting to strengthen its position.
    if (targetPlayerKey === 'opponent') {
        const targetState = state.opponent;
        const otherPlayerKey = 'player';
        const laneData = targetState.protocols.map((p, i) => ({
            protocol: p,
            lead: targetState.laneValues[i] - state[otherPlayerKey].laneValues[i]
        })).sort((a, b) => b.lead - a.lead); // Sort by biggest lead first
        const newOrder = laneData.map(d => d.protocol);
        return { type: 'rearrangeProtocols', newOrder };
    }
    
    // Logic for rearranging the human player's protocols as per user request.
    const humanPlayerState = state.player;

    const playerHasCompiled = humanPlayerState.compiled.some(c => c);
    if (!playerHasCompiled) {
        // Fallback if player has no compiled protocols: Disrupt by moving their weakest lanes forward.
        const laneData = humanPlayerState.protocols.map((p, i) => ({
            protocol: p,
            lead: humanPlayerState.laneValues[i] - state.opponent.laneValues[i]
        })).sort((a, b) => a.lead - b.lead); // Sort by weakest lead first
        const newOrder = laneData.map(d => d.protocol);
        return { type: 'rearrangeProtocols', newOrder };
    }

    const compiledIndex = humanPlayerState.compiled.findIndex(c => c);
    if (compiledIndex === -1) {
        return { type: 'rearrangeProtocols', newOrder: [...humanPlayerState.protocols] };
    }

    let strongestUncompiledIndex = -1;
    let maxScore = -1;

    for (let i = 0; i < humanPlayerState.protocols.length; i++) {
        if (!humanPlayerState.compiled[i]) {
            if (humanPlayerState.laneValues[i] > maxScore) {
                maxScore = humanPlayerState.laneValues[i];
                strongestUncompiledIndex = i;
            }
        }
    }
    
    // If a valid swap target is found, create the new protocol order.
    if (strongestUncompiledIndex !== -1 && strongestUncompiledIndex !== compiledIndex) {
        const newOrder = [...humanPlayerState.protocols];
        [newOrder[compiledIndex], newOrder[strongestUncompiledIndex]] = 
            [newOrder[strongestUncompiledIndex], newOrder[compiledIndex]];
        return { type: 'rearrangeProtocols', newOrder };
    } else {
        // Fallback if swap is not possible (e.g., player has 2 compiled protocols).
        return { type: 'rearrangeProtocols', newOrder: [...humanPlayerState.protocols] };
    }
}
