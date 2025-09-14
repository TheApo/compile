/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player } from "../types";
import { effectRegistry } from "./effects/effectRegistry";
import { effectRegistryStart } from "./effects/effectRegistryStart";
import { effectRegistryEnd } from "./effects/effectRegistryEnd";
import { effectRegistryOnCover } from "./effects/effectRegistryOnCover";
import { recalculateAllLaneValues } from "./game/stateManager";

// --- ON-PLAY EFFECTS (MIDDLE BOX) ---

export function executeOnPlayEffect(card: PlayedCard, laneIndex: number, state: GameState, actor: Player): EffectResult {
    // Rule: A card's middle effect only triggers if it is uncovered.
    // This applies whether it was just played or just flipped face-up.
    const lane = state[actor].lanes[laneIndex];
    const cardInLane = lane.find(c => c.id === card.id);
    if (!cardInLane) {
        // This can happen if the card was deleted by a chained effect before its own effect could resolve.
        return { newState: state };
    }
    const isUncovered = lane.length > 0 && lane[lane.length - 1].id === card.id;

    if (!isUncovered) {
        return { newState: state }; // Card is covered, do not trigger middle effect.
    }
    
    // Check for Apathy-2 in the same line, which ignores middle effects for both players
    const opponent = actor === 'player' ? 'opponent' : 'player';
    const playerLaneHasApathy2 = state[actor].lanes[laneIndex].some(c => c.isFaceUp && c.protocol === 'Apathy' && c.value === 2 && c.id !== card.id);
    const opponentLaneHasApathy2 = state[opponent].lanes[laneIndex].some(c => c.isFaceUp && c.protocol === 'Apathy' && c.value === 2);

    if (playerLaneHasApathy2 || opponentLaneHasApathy2) {
        return { newState: state }; // Middle effects are ignored in this line
    }

    const effectKey = `${card.protocol}-${card.value}`;
    const execute = effectRegistry[effectKey];

    if (execute) {
        const result = execute(card, laneIndex, state, actor);
        const stateWithRecalculatedValues = recalculateAllLaneValues(result.newState);
        return {
            ...result,
            newState: stateWithRecalculatedValues,
        };
    }

    return { newState: state };
}

// --- TRIGGERED EFFECTS (BOTTOM BOX) ---

export function executeOnCoverEffect(coveredCard: PlayedCard, laneIndex: number, state: GameState): EffectResult {
    if (!coveredCard.isFaceUp) {
        return { newState: state };
    }

    const effectKey = `${coveredCard.protocol}-${coveredCard.value}`;
    const execute = effectRegistryOnCover[effectKey];

    if (execute) {
        const result = execute(coveredCard, laneIndex, state);
        const stateWithRecalculatedValues = recalculateAllLaneValues(result.newState);
        return {
            ...result,
            newState: stateWithRecalculatedValues,
        };
    }
    
    return { newState: state };
}

export function executeStartPhaseEffects(state: GameState): EffectResult {
    const player = state.turn;
    let newState = { ...state };
    const processedIds = newState.processedStartEffectIds || [];

    const startPhaseCards = newState[player].lanes
        .map(lane => lane.length > 0 ? lane[lane.length - 1] : null) // Get the top (uncovered) card of each lane
        .filter((card): card is PlayedCard =>
            card !== null &&
            card.isFaceUp &&
            (card.top.includes(`'emphasis'>Start:`) || card.bottom.includes(`'emphasis'>Start:`)) &&
            !processedIds.includes(card.id)
        );

    for (const card of startPhaseCards) {
        const effectKey = `${card.protocol}-${card.value}`;
        const execute = effectRegistryStart[effectKey];
        if (execute) {
            // Execute the effect on the current state.
            const result = execute(card, newState);
            // After the effect resolves, mark this card's ID as processed on the *resulting* state.
            // This prevents the state with the processed ID from being overwritten.
            newState = recalculateAllLaneValues(result.newState);
            newState.processedStartEffectIds = [...(newState.processedStartEffectIds || []), card.id];

            if (newState.actionRequired) {
                return { newState }; // Stop processing if an action is required
            }
        }
    }
    return { newState };
}

export function executeEndPhaseEffects(state: GameState): EffectResult {
    const player = state.turn;
    let newState = { ...state };
    const processedIds = newState.processedEndEffectIds || [];

    const endPhaseCards = newState[player].lanes
        .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
        .filter((card): card is PlayedCard => 
            card !== null && 
            card.isFaceUp && 
            card.bottom.includes(`'emphasis'>End:`) &&
            !processedIds.includes(card.id)
        );

    for (const card of endPhaseCards) {
        const effectKey = `${card.protocol}-${card.value}`;
        const execute = effectRegistryEnd[effectKey];
        if (execute) {
            // Execute the effect on the current state.
            const result = execute(card, newState);
            // After the effect resolves, mark this card's ID as processed on the *resulting* state.
            newState = recalculateAllLaneValues(result.newState);
            newState.processedEndEffectIds = [...(newState.processedEndEffectIds || []), card.id];
            
            if (newState.actionRequired) {
                return { newState }; // Stop processing if an action is required
            }
        }
    }
    return { newState };
}