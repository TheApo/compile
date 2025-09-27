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
import { log } from "./utils/log";

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
    // Rule: Bottom box effects only trigger if the card is face-up AND uncovered.
    // This function is only called for cards that are about to be covered, so they are by definition uncovered.
    // We just need to check if it's face-up.
    if (!coveredCard.isFaceUp) {
        return { newState: state };
    }

    const players: Player[] = ['player', 'opponent'];
    let owner: Player | null = null;
    for (const p of players) {
        if (state[p].lanes[laneIndex].some(c => c.id === coveredCard.id)) {
            owner = p;
            break;
        }
    }

    if (!owner) {
        console.error("Could not find owner for onCover effect card", coveredCard);
        return { newState: state };
    }

    const effectKey = `${coveredCard.protocol}-${coveredCard.value}`;
    const execute = effectRegistryOnCover[effectKey];

    if (execute) {
        const result = execute(coveredCard, laneIndex, state, owner);
        const stateWithRecalculatedValues = recalculateAllLaneValues(result.newState);
        return {
            ...result,
            newState: stateWithRecalculatedValues,
        };
    }
    
    return { newState: state };
}

function processTriggeredEffects(
    state: GameState,
    effectKeyword: 'Start' | 'End',
    effectRegistry: Record<string, (card: PlayedCard, state: GameState) => EffectResult>
): EffectResult {
    const player = state.turn;
    let newState = { ...state };
    const processedIds = effectKeyword === 'Start'
        ? newState.processedStartEffectIds || []
        : newState.processedEndEffectIds || [];

    const effectCardsToProcess: { card: PlayedCard, box: 'top' | 'bottom' }[] = [];
    const effectCardIds = new Set<string>();

    // Rule: Top box effects are active if the card is face-up, even if covered.
    newState[player].lanes.flat().forEach(card => {
        if (card.isFaceUp && card.top.includes(`'emphasis'>${effectKeyword}:`) && !processedIds.includes(card.id) && !effectCardIds.has(card.id)) {
            effectCardsToProcess.push({ card, box: 'top' });
            effectCardIds.add(card.id);
        }
    });

    // Rule: Bottom box effects are only active if the card is face-up AND uncovered.
    newState[player].lanes.forEach(lane => {
        if (lane.length > 0) {
            const uncoveredCard = lane[lane.length - 1];
            if (uncoveredCard.isFaceUp && uncoveredCard.bottom.includes(`'emphasis'>${effectKeyword}:`) && !processedIds.includes(uncoveredCard.id) && !effectCardIds.has(uncoveredCard.id)) {
                effectCardsToProcess.push({ card: uncoveredCard, box: 'bottom' });
                effectCardIds.add(uncoveredCard.id);
            }
        }
    });

    for (const { card, box } of effectCardsToProcess) {
        // Re-validate the card's state at the moment of execution.
        const currentLane = newState[player].lanes.find(l => l.some(c => c.id === card.id));
        if (!currentLane) continue; // Card was removed by a previous effect in the chain.

        const isStillFaceUp = currentLane.some(c => c.id === card.id && c.isFaceUp);
        if (!isStillFaceUp) continue; // Card was flipped by a previous effect.

        if (box === 'bottom') {
            const isStillUncovered = currentLane[currentLane.length - 1].id === card.id;
            if (!isStillUncovered) continue; // Card was covered by a previous effect.
        }

        const effectKey = `${card.protocol}-${card.value}`;
        const execute = effectRegistry[effectKey];
        if (execute) {
            const result = execute(card, newState);
            newState = recalculateAllLaneValues(result.newState);

            const processedKey = effectKeyword === 'Start' ? 'processedStartEffectIds' : 'processedEndEffectIds';
            newState[processedKey] = [...(newState[processedKey] || []), card.id];

            if (newState.actionRequired) {
                return { newState }; // Stop processing if an action is required
            }
        }
    }
    return { newState };
}


export function executeStartPhaseEffects(state: GameState): EffectResult {
    return processTriggeredEffects(state, 'Start', effectRegistryStart);
}

export function executeEndPhaseEffects(state: GameState): EffectResult {
    return processTriggeredEffects(state, 'End', effectRegistryEnd);
}