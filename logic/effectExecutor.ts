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
import { executeCustomEffect } from "./customProtocols/effectInterpreter";
import { shouldIgnoreMiddleCommand } from "./game/passiveRuleChecker";

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

    // NEW: Check passive rules for ignore middle command (Apathy-2, custom cards)
    if (shouldIgnoreMiddleCommand(state, laneIndex)) {
        return { newState: state }; // Middle effects are ignored in this line
    }

    // Check if this is a custom protocol card with custom effects
    const customCard = card as any;
    if (customCard.customEffects && customCard.customEffects.middleEffects && customCard.customEffects.middleEffects.length > 0) {
        // Execute custom effects
        let stateWithContext = state;
        if (triggerType === 'middle' || triggerType === 'play') {
            stateWithContext = increaseLogIndent(stateWithContext);
        }

        const cardName = `${card.protocol}-${card.value}`;
        stateWithContext = setLogSource(stateWithContext, cardName);
        stateWithContext = setLogPhase(stateWithContext, 'middle');

        let currentState = stateWithContext;

        // Execute all middle effects sequentially
        for (let i = 0; i < customCard.customEffects.middleEffects.length; i++) {
            const effectDef = customCard.customEffects.middleEffects[i];
            const result = executeCustomEffect(card, laneIndex, currentState, context, effectDef);
            currentState = result.newState;

            // If an action is required, save remaining effects and return
            if (currentState.actionRequired) {
                const remainingEffects = customCard.customEffects.middleEffects.slice(i + 1);
                if (remainingEffects.length > 0) {
                    // CRITICAL: Store in state, not in actionRequired (which gets deleted)
                    (currentState as any)._pendingCustomEffects = {
                        sourceCardId: card.id,
                        laneIndex,
                        context,
                        effects: remainingEffects
                    };
                }
                return { newState: recalculateAllLaneValues(currentState) };
            }
        }

        const stateWithRecalculatedValues = recalculateAllLaneValues(currentState);
        return { newState: stateWithRecalculatedValues };
    }

    // Standard card - use registry
    const effectKey = `${card.protocol}-${card.value}`;
    const execute = effectRegistry[effectKey];

    if (execute) {
        // IMPORTANT: For middle effects (triggered by playing a card), increase indent FIRST
        // so that ALL logs from the effect (including the first one) are indented
        let stateWithContext = state;
        if (triggerType === 'middle' || triggerType === 'play') {
            stateWithContext = increaseLogIndent(stateWithContext);
        }

        // Set logging context: card name and phase
        const cardName = `${card.protocol}-${card.value}`;
        stateWithContext = setLogSource(stateWithContext, cardName);

        // Set phase context: Always 'middle' for on-play effects
        // (even when triggered by uncover, the effect itself is a middle effect)
        stateWithContext = setLogPhase(stateWithContext, 'middle');

        const result = execute(card, laneIndex, stateWithContext, context);

        // IMPORTANT: Do NOT decrease indent here for middle effects!
        // The indent stays active until the entire effect chain (including all actionRequired) completes
        let finalState = result.newState;

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

    // Check if this is a custom protocol card with custom on-cover effects
    const customCard = coveredCard as any;
    if (customCard.customEffects && customCard.customEffects.bottomEffects) {
        const onCoverEffects = customCard.customEffects.bottomEffects.filter((e: any) => e.trigger === 'on_cover');

        if (onCoverEffects.length > 0) {
            console.log('[DEBUG executeOnCoverEffect] Found', onCoverEffects.length, 'on-cover effects for', `${coveredCard.protocol}-${coveredCard.value}`);
            const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
            let stateWithContext = setLogSource(state, cardName);
            stateWithContext = setLogPhase(stateWithContext, undefined);

            let currentState = stateWithContext;
            const allAnimationRequests: any[] = [];

            // Execute all on-cover effects sequentially
            for (const effectDef of onCoverEffects) {
                console.log('[DEBUG executeOnCoverEffect] Executing effect:', JSON.stringify(effectDef.params));
                const result = executeCustomEffect(coveredCard, laneIndex, currentState, context, effectDef);
                console.log('[DEBUG executeOnCoverEffect] After executeCustomEffect, actionRequired:', result.newState.actionRequired?.type || 'null');
                currentState = result.newState;

                // CRITICAL: Collect animation requests (Hate-4: delete animation)
                if (result.animationRequests) {
                    allAnimationRequests.push(...result.animationRequests);
                }

                // If an action is required, stop and return
                if (currentState.actionRequired) {
                    let finalState = increaseLogIndent(currentState);
                    return {
                        newState: recalculateAllLaneValues(finalState),
                        animationRequests: allAnimationRequests.length > 0 ? allAnimationRequests : undefined
                    };
                }
            }

            let finalState = increaseLogIndent(currentState);
            const stateWithRecalculatedValues = recalculateAllLaneValues(finalState);
            return {
                newState: stateWithRecalculatedValues,
                animationRequests: allAnimationRequests.length > 0 ? allAnimationRequests : undefined
            };
        }
    }

    // Standard card - use registry
    const effectKey = `${coveredCard.protocol}-${coveredCard.value}`;
    const execute = effectRegistryOnCover[effectKey];

    if (execute) {
        // Set logging context: card name and NO phase marker
        // On-cover effects are bottom box (triggered) effects, not middle effects
        const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
        let stateWithContext = setLogSource(state, cardName);
        stateWithContext = setLogPhase(stateWithContext, undefined); // No phase marker for on-cover

        // NOTE: Do NOT increase indent before executing the on-cover effect itself
        // The effect's first log should be at the current level
        const result = execute(coveredCard, laneIndex, stateWithContext, context);

        // IMPORTANT: Increase indent AFTER the on-cover effect for any subsequent effects (like uncover)
        let finalState = increaseLogIndent(result.newState);

        // NOTE: We don't decrease indent here because on-cover effects might trigger
        // deletes/shifts that cause uncover events, which need to stay indented

        const stateWithRecalculatedValues = recalculateAllLaneValues(finalState);
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

        // Build context for the effect
        const opponent = player === 'player' ? 'opponent' : 'player';
        const context: EffectContext = {
            cardOwner: player,
            actor: player,
            currentTurn: state.turn,
            opponent,
            triggerType: effectKeyword === 'Start' ? 'start' : 'end'
        };

        // Check if this is a custom protocol card with custom effects
        const customCard = card as any;
        const triggerType = effectKeyword === 'Start' ? 'start' : 'end';

        if (customCard.customEffects) {
            const effectsSource = box === 'top' ? customCard.customEffects.topEffects : customCard.customEffects.bottomEffects;
            const matchingEffects = effectsSource?.filter((e: any) => e.trigger === triggerType) || [];

            if (matchingEffects.length > 0) {
                // IMPORTANT: Increase indent FIRST
                newState = increaseLogIndent(newState);

                const cardName = `${card.protocol}-${card.value}`;
                const phaseContext = effectKeyword === 'Start' ? 'start' : 'end';
                newState = setLogSource(newState, cardName);
                newState = setLogPhase(newState, phaseContext);

                // Find lane index
                const laneIndex = newState[player].lanes.findIndex(l => l.some(c => c.id === card.id));

                // Execute all matching effects sequentially
                for (let effectIdx = 0; effectIdx < matchingEffects.length; effectIdx++) {
                    const effectDef = matchingEffects[effectIdx];
                    const result = executeCustomEffect(card, laneIndex, newState, context, effectDef);
                    newState = recalculateAllLaneValues(result.newState);

                    if (newState.actionRequired) {
                        // Store remaining effects to execute after this action resolves
                        const remainingEffects = matchingEffects.slice(effectIdx + 1);
                        if (remainingEffects.length > 0) {
                            // CRITICAL: Use _pendingCustomEffects pattern (same as middleEffects)
                            (newState as any)._pendingCustomEffects = {
                                sourceCardId: card.id,
                                laneIndex,
                                context,
                                effects: remainingEffects
                            };
                        }
                        // Mark as processed before returning
                        const processedKey = effectKeyword === 'Start' ? 'processedStartEffectIds' : 'processedEndEffectIds';
                        newState[processedKey] = [...(newState[processedKey] || []), card.id];
                        return { newState };
                    }
                }

                // Mark as processed
                const processedKey = effectKeyword === 'Start' ? 'processedStartEffectIds' : 'processedEndEffectIds';
                newState[processedKey] = [...(newState[processedKey] || []), card.id];

                // Decrease indent after effect completes
                newState = decreaseLogIndent(newState);
                newState = setLogSource(newState, undefined);
                newState = setLogPhase(newState, undefined);

                continue; // Skip standard registry check
            }
        }

        // Standard card - use registry
        const effectKey = `${card.protocol}-${card.value}`;
        const execute = effectRegistry[effectKey];
        if (execute) {
            // IMPORTANT: Increase indent FIRST so that the trigger log and all subsequent logs are indented
            newState = increaseLogIndent(newState);

            // Set logging context: card name and phase
            const cardName = `${card.protocol}-${card.value}`;
            const phaseContext = effectKeyword === 'Start' ? 'start' : 'end';
            newState = setLogSource(newState, cardName);
            newState = setLogPhase(newState, phaseContext);

            // FIXED: Now calls execute with proper signature (card, state, context)
            const result = execute(card, newState, context);
            newState = recalculateAllLaneValues(result.newState);

            const processedKey = effectKeyword === 'Start' ? 'processedStartEffectIds' : 'processedEndEffectIds';
            newState[processedKey] = [...(newState[processedKey] || []), card.id];

            if (newState.actionRequired) {
                // If an action is required, keep indent and context active
                // They will be cleared when the action is resolved
                return { newState }; // Stop processing if an action is required
            }

            // Decrease indent after effect completes (only if no action is pending)
            newState = decreaseLogIndent(newState);
            newState = setLogSource(newState, undefined);
            newState = setLogPhase(newState, undefined);
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