/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player, EffectContext } from "../types";
import { effectRegistry } from "./effects/effectRegistry";
import { effectRegistryStart } from "./effects/effectRegistryStart";
import { effectRegistryEnd } from "./effects/effectRegistryEnd";
import { effectRegistryOnCover } from "./effects/effectRegistryOnCover";
import { recalculateAllLaneValues } from "./game/stateManager";
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from "./utils/log";

// --- ON-PLAY EFFECTS (MIDDLE BOX) ---

export function executeOnPlayEffect(card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult {
    // Rule: A card's middle effect only triggers if it is uncovered.
    // This applies whether it was just played or just flipped face-up.
    const { cardOwner, opponent, triggerType } = context;
    const lane = state[cardOwner].lanes[laneIndex];
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
    const playerLaneHasApathy2 = state[cardOwner].lanes[laneIndex].some(c => c.isFaceUp && c.protocol === 'Apathy' && c.value === 2 && c.id !== card.id);
    const opponentLaneHasApathy2 = state[opponent].lanes[laneIndex].some(c => c.isFaceUp && c.protocol === 'Apathy' && c.value === 2);

    if (playerLaneHasApathy2 || opponentLaneHasApathy2) {
        return { newState: state }; // Middle effects are ignored in this line
    }

    const effectKey = `${card.protocol}-${card.value}`;
    const execute = effectRegistry[effectKey];

    if (execute) {
        // Set logging context: card name and phase
        const cardName = `${card.protocol}-${card.value}`;
        let stateWithContext = setLogSource(state, cardName);

        // Set phase context based on trigger type
        const phaseContext = triggerType === 'uncover' ? 'uncover' : 'middle';
        stateWithContext = setLogPhase(stateWithContext, phaseContext);

        // If this is a nested effect (indentLevel > 0), increase indent
        const isNestedEffect = triggerType === 'uncover' && stateWithContext._logIndentLevel && stateWithContext._logIndentLevel > 0;
        if (isNestedEffect) {
            stateWithContext = increaseLogIndent(stateWithContext);
        }

        const result = execute(card, laneIndex, stateWithContext, context);

        // Decrease indent if we increased it
        let finalState = result.newState;
        if (isNestedEffect) {
            finalState = decreaseLogIndent(finalState);
        }

        // NOTE: We don't clear context here because the effect might have queued actions
        // that still need the context. Context is cleared before non-effect logs (like "plays card")

        const stateWithRecalculatedValues = recalculateAllLaneValues(finalState);
        return {
            ...result,
            newState: stateWithRecalculatedValues,
        };
    }

    return { newState: state };
}

// --- TRIGGERED EFFECTS (BOTTOM BOX) ---

export function executeOnCoverEffect(coveredCard: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult {
    // Rule: Bottom box effects only trigger if the card is face-up AND uncovered.
    // This function is only called for cards that are about to be covered, so they are by definition uncovered.
    // We just need to check if it's face-up.
    if (!coveredCard.isFaceUp) {
        return { newState: state };
    }

    const effectKey = `${coveredCard.protocol}-${coveredCard.value}`;
    const execute = effectRegistryOnCover[effectKey];

    if (execute) {
        // Set logging context: card name and NO phase marker
        // On-cover effects are bottom box (triggered) effects, not middle effects
        const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
        let stateWithContext = setLogSource(state, cardName);
        stateWithContext = setLogPhase(stateWithContext, undefined); // No phase marker for on-cover
        stateWithContext = increaseLogIndent(stateWithContext); // Indent on-cover effects

        const result = execute(coveredCard, laneIndex, stateWithContext, context);

        // NOTE: We don't decrease indent here because on-cover effects might trigger
        // deletes/shifts that cause uncover events, which need to stay indented

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
    effectRegistry: Record<string, (card: PlayedCard, state: GameState, context: EffectContext) => EffectResult>
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
            // Set logging context: card name and phase
            const cardName = `${card.protocol}-${card.value}`;
            const phaseContext = effectKeyword === 'Start' ? 'start' : 'end';
            newState = setLogSource(newState, cardName);
            newState = setLogPhase(newState, phaseContext);

            // Log that the effect is triggering with Start/End marker
            newState = log(newState, player, `${effectKeyword} Effect: ${card.protocol}-${card.value} triggers.`);

            // Increase indent for effects triggered by Start/End
            newState = increaseLogIndent(newState);

            // Build context for the effect
            const opponent = player === 'player' ? 'opponent' : 'player';
            const context: EffectContext = {
                cardOwner: player,
                actor: player,
                currentTurn: state.turn,
                opponent,
                triggerType: effectKeyword === 'Start' ? 'start' : 'end'
            };

            // FIXED: Now calls execute with proper signature (card, state, context)
            const result = execute(card, newState, context);
            newState = recalculateAllLaneValues(result.newState);

            // Decrease indent after effect completes
            newState = decreaseLogIndent(newState);
            newState = setLogSource(newState, undefined);
            newState = setLogPhase(newState, undefined);

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