/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, Player, EffectContext } from "../types";
import { recalculateAllLaneValues } from "./game/stateManager";

// NOTE: All protocols now use custom effects defined in JSON
// These empty registries are kept for compatibility - they will never match any cards
const effectRegistry: Record<string, any> = {};
const effectRegistryStart: Record<string, any> = {};
const effectRegistryEnd: Record<string, any> = {};
const effectRegistryOnCover: Record<string, any> = {};
import { log, setLogSource, setLogPhase, increaseLogIndent, decreaseLogIndent } from "./utils/log";
import { executeCustomEffect } from "./customProtocols/effectInterpreter";
import { getMiddleCommandBlocker } from "./game/passiveRuleChecker";

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
    // CRITICAL FIX: For 'uncover' triggerType, handleUncoverEffect has already verified
    // the card is uncovered using isCardUncovered() which handles _committedCardId correctly.
    // We skip this check for uncover to prevent false negatives.
    const isUncovered = triggerType === 'uncover' || (lane.length > 0 && lane[lane.length - 1].id === card.id);

    if (!isUncovered) {
        return { newState: state }; // Card is covered, do not trigger middle effect.
    }

    // Check passive rules for ignore middle command
    // Pass cardOwner so rules like "opponent's cards do not have middle commands" work correctly
    const blockingCard = getMiddleCommandBlocker(state, laneIndex, cardOwner);
    if (blockingCard) {
        // Log that the effect was blocked by a passive rule
        const cardName = `${card.protocol}-${card.value}`;
        const blockerName = `${blockingCard.protocol}-${blockingCard.value}`;
        let newState = log(state, cardOwner, `${cardName}: Effect blocked by ${blockerName}.`);
        return { newState }; // Middle effects are ignored in this line
    }

    // Check if this is a custom protocol card with custom effects
    const customCard = card as any;

    if (customCard.customEffects && customCard.customEffects.middleEffects && customCard.customEffects.middleEffects.length > 0) {
        // Execute custom effects
        // Always increase indent - effects triggered by other effects should be nested
        let stateWithContext = increaseLogIndent(state);

        const cardName = `${card.protocol}-${card.value}`;
        stateWithContext = setLogSource(stateWithContext, cardName);
        stateWithContext = setLogPhase(stateWithContext, 'middle');

        let currentState = stateWithContext;


        // CRITICAL: If there are pending effects from a DIFFERENT card (e.g., Darkness-1's shift effect
        // still pending while Spirit-2 is being uncovered), we must queue them to execute AFTER this card
        // finishes. We must do this BEFORE clearing lastCustomEffectTargetCardId!
        const existingPendingEffects = (currentState as any)._pendingCustomEffects;
        if (existingPendingEffects && existingPendingEffects.sourceCardId !== card.id) {

            // CRITICAL: Preserve the lastCustomEffectTargetCardId for "Flip X. Shift THAT card" chains
            // When Darkness-1 flips Fire-2, the shift should target Fire-2
            // We capture this BEFORE clearing it below!
            const savedTargetCardId = currentState.lastCustomEffectTargetCardId;

            const pendingAction: any = {
                type: 'execute_remaining_custom_effects',
                sourceCardId: existingPendingEffects.sourceCardId,
                laneIndex: existingPendingEffects.laneIndex,
                effects: existingPendingEffects.effects,
                context: existingPendingEffects.context,
                actor: existingPendingEffects.context.cardOwner,
                // CRITICAL: Pass the target card ID for "shift THAT card" effects
                selectedCardFromPreviousEffect: savedTargetCardId || existingPendingEffects.selectedCardFromPreviousEffect,
                // Log-Kontext weitergeben für korrekte Einrückung/Quellkarte nach Interrupts
                logSource: existingPendingEffects.logSource,
                logPhase: existingPendingEffects.logPhase,
                logIndentLevel: existingPendingEffects.logIndentLevel
            };

            currentState = {
                ...currentState,
                queuedActions: [...(currentState.queuedActions || []), pendingAction]
            };
            delete (currentState as any)._pendingCustomEffects;
        }

        // CRITICAL: Clear lastCustomEffectTargetCardId when a new card starts executing its effects
        // This prevents stale values from previous effect chains (e.g., Spirit-3 shift) from being
        // incorrectly picked up by effects that use useCardFromPreviousEffect (e.g., Darkness-1 shift)
        // NOTE: This must happen AFTER we've saved pending effects above!
        if (currentState.lastCustomEffectTargetCardId) {
            currentState = { ...currentState, lastCustomEffectTargetCardId: null };
        }

        // Execute all middle effects sequentially
        for (let i = 0; i < customCard.customEffects.middleEffects.length; i++) {
            const effectDef = customCard.customEffects.middleEffects[i];

            // CRITICAL: Store remaining effects BEFORE executing the current effect
            // This ensures that if a reactive effect (like Spirit-3 after_draw) interrupts,
            // the remaining effects are already saved and can be queued
            const remainingEffects = customCard.customEffects.middleEffects.slice(i + 1);
            if (remainingEffects.length > 0) {
                (currentState as any)._pendingCustomEffects = {
                    sourceCardId: card.id,
                    laneIndex,
                    context,
                    effects: remainingEffects,
                    // Log-Kontext mitspeichern für korrekte Einrückung/Quellkarte nach Interrupts
                    logSource: currentState._currentEffectSource,
                    logPhase: currentState._currentPhaseContext,
                    logIndentLevel: currentState._logIndentLevel || 0
                };
            }

            const result = executeCustomEffect(card, laneIndex, currentState, context, effectDef);
            currentState = result.newState;

            // If an action is required, the remaining effects are already stored, just return
            if (currentState.actionRequired) {
                return { newState: recalculateAllLaneValues(currentState) };
            }

            // Effect completed without actionRequired - clear pending effects if this was the last effect
            // (they'll be re-stored at the start of the next iteration if there are more effects)
            if ((currentState as any)._pendingCustomEffects) {
                delete (currentState as any)._pendingCustomEffects;
            }
        }

        const stateWithRecalculatedValues = recalculateAllLaneValues(currentState);
        return { newState: stateWithRecalculatedValues };
    }

    // Standard card - use registry
    const effectKey = `${card.protocol}-${card.value}`;
    const execute = effectRegistry[effectKey];

    if (execute) {
        // IMPORTANT: Always increase indent FIRST so that ALL logs from the effect are indented
        // Effects triggered by other effects should be nested
        let stateWithContext = increaseLogIndent(state);

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
    // CRITICAL: Check ALL effect positions (top, middle, bottom) for on_cover or on_cover_or_flip triggers
    // Metal-6 has on_cover_or_flip in topEffects!
    const customCard = coveredCard as any;
    if (customCard.customEffects) {
        const allEffects = [
            ...(customCard.customEffects.topEffects || []),
            ...(customCard.customEffects.middleEffects || []),
            ...(customCard.customEffects.bottomEffects || [])
        ];
        const onCoverEffects = allEffects.filter((e: any) =>
            e.trigger === 'on_cover' || e.trigger === 'on_cover_or_flip'
        );

        if (onCoverEffects.length > 0) {
            const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
            let stateWithContext = setLogSource(state, cardName);
            // Phase 'oncover' setzen für [OnCover] Label im GameLog
            stateWithContext = setLogPhase(stateWithContext, 'oncover');

            let currentState = stateWithContext;
            const allAnimationRequests: any[] = [];

            // Execute all on-cover effects sequentially
            for (const effectDef of onCoverEffects) {
                const result = executeCustomEffect(coveredCard, laneIndex, currentState, context, effectDef);
                currentState = result.newState;

                // CRITICAL: Collect animation requests (Hate-4: delete animation)
                if (result.animationRequests) {
                    allAnimationRequests.push(...result.animationRequests);
                }

                // If an action is required, stop and return
                // NOTE: Indent wird in playResolver.ts gesteuert, nicht hier
                if (currentState.actionRequired) {
                    return {
                        newState: recalculateAllLaneValues(currentState),
                        animationRequests: allAnimationRequests.length > 0 ? allAnimationRequests : undefined
                    };
                }
            }

            // NOTE: Indent wird in playResolver.ts gesteuert, nicht hier
            const stateWithRecalculatedValues = recalculateAllLaneValues(currentState);
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
        // Set logging context: card name and phase 'oncover' for [OnCover] label
        const cardName = `${coveredCard.protocol}-${coveredCard.value}`;
        let stateWithContext = setLogSource(state, cardName);
        stateWithContext = setLogPhase(stateWithContext, 'oncover');

        // NOTE: Indent wird in playResolver.ts gesteuert, nicht hier
        const result = execute(coveredCard, laneIndex, stateWithContext, context);

        const stateWithRecalculatedValues = recalculateAllLaneValues(result.newState);
        return {
            ...result,
            newState: stateWithRecalculatedValues,
        };
    }

    return { newState: state };
}

/**
 * Type for phase effect snapshot entries
 */
type PhaseEffectSnapshotEntry = {
    cardId: string;
    box: 'top' | 'bottom';
    effectIds: string[];
};

/**
 * Creates a snapshot of all cards with Start/End triggers at the beginning of a phase.
 * Only cards in this snapshot will have their phase effects executed - cards that become
 * uncovered DURING the phase will NOT trigger their phase effects.
 *
 * This implements the official rule: "When entering the Start phase on your turn, note all
 * visible commands in your stacks that have a 'Start:' trigger. If a 'Start:' command is
 * added to the field after the beginning of the Start phase when commands were noted,
 * it doesn't do anything."
 */
function createPhaseEffectSnapshot(
    state: GameState,
    player: Player,
    effectKeyword: 'Start' | 'End'
): PhaseEffectSnapshotEntry[] {
    const snapshot: PhaseEffectSnapshotEntry[] = [];
    const seenCardIds = new Set<string>();
    const triggerType = effectKeyword === 'Start' ? 'start' : 'end';

    // Top-Box Effekte (face-up, auch wenn covered)
    state[player].lanes.flat().forEach(card => {
        if (!card.isFaceUp || seenCardIds.has(card.id)) return;

        const customCard = card as any;
        if (customCard.customEffects?.topEffects) {
            const matchingEffects = customCard.customEffects.topEffects
                .filter((e: any) => e.trigger === triggerType);
            if (matchingEffects.length > 0) {
                snapshot.push({
                    cardId: card.id,
                    box: 'top',
                    effectIds: matchingEffects.map((e: any) => e.id)
                });
                seenCardIds.add(card.id);
            }
        }

        // Legacy: HTML-basierte Erkennung für alte Karten
        if (card.top.includes(`'emphasis'>${effectKeyword}:`)) {
            if (!seenCardIds.has(card.id)) {
                snapshot.push({ cardId: card.id, box: 'top', effectIds: [] });
                seenCardIds.add(card.id);
            }
        }
    });

    // Bottom-Box Effekte (NUR uncovered + face-up)
    state[player].lanes.forEach(lane => {
        if (lane.length === 0) return;
        const uncoveredCard = lane[lane.length - 1];
        if (!uncoveredCard.isFaceUp || seenCardIds.has(uncoveredCard.id)) return;

        const customCard = uncoveredCard as any;
        if (customCard.customEffects?.bottomEffects) {
            const matchingEffects = customCard.customEffects.bottomEffects
                .filter((e: any) => e.trigger === triggerType);
            if (matchingEffects.length > 0) {
                snapshot.push({
                    cardId: uncoveredCard.id,
                    box: 'bottom',
                    effectIds: matchingEffects.map((e: any) => e.id)
                });
                seenCardIds.add(uncoveredCard.id);
            }
        }

        // Legacy: HTML-basierte Erkennung
        if (uncoveredCard.bottom.includes(`'emphasis'>${effectKeyword}:`)) {
            if (!seenCardIds.has(uncoveredCard.id)) {
                snapshot.push({ cardId: uncoveredCard.id, box: 'bottom', effectIds: [] });
                seenCardIds.add(uncoveredCard.id);
            }
        }
    });

    return snapshot;
}

/**
 * Validates a snapshot entry and returns card info if valid
 */
function validateSnapshotEntry(
    state: GameState,
    player: Player,
    entry: PhaseEffectSnapshotEntry
): { card: PlayedCard; laneIndex: number } | null {
    // Find the card in the current state
    for (let laneIdx = 0; laneIdx < state[player].lanes.length; laneIdx++) {
        const lane = state[player].lanes[laneIdx];
        const foundCard = lane.find(c => c.id === entry.cardId);
        if (foundCard) {
            // VALIDATION 1: Card must still be face-up
            if (!foundCard.isFaceUp) {
                return null;
            }

            // VALIDATION 2: For bottom-box effects, card must still be uncovered
            if (entry.box === 'bottom') {
                const isStillUncovered = lane.length > 0 && lane[lane.length - 1].id === foundCard.id;
                if (!isStillUncovered) {
                    return null;
                }
            }

            return { card: foundCard, laneIndex: laneIdx };
        }
    }

    return null;
}

/**
 * Gets the effect description for a card's phase effect
 */
function getPhaseEffectDescription(card: PlayedCard, box: 'top' | 'bottom', effectKeyword: 'Start' | 'End'): string {
    const customCard = card as any;
    const triggerType = effectKeyword === 'Start' ? 'start' : 'end';

    if (customCard.customEffects) {
        const effectsSource = box === 'top' ? customCard.customEffects.topEffects : customCard.customEffects.bottomEffects;
        const matchingEffects = effectsSource?.filter((e: any) => e.trigger === triggerType) || [];

        if (matchingEffects.length > 0) {
            // Get the action descriptions
            const actions = matchingEffects.map((e: any) => {
                const action = e.params?.action || 'effect';
                const count = e.params?.count;
                if (count) return `${action} ${count}`;
                return action;
            });
            return actions.join(', ');
        }
    }

    // Fallback to HTML text parsing
    const text = box === 'top' ? card.top : card.bottom;
    // Extract text after "Start:" or "End:"
    const match = text.match(new RegExp(`${effectKeyword}:\\s*</span>\\s*([^<]+)`, 'i'));
    if (match) {
        return match[1].trim();
    }

    return effectKeyword + ' effect';
}

function processTriggeredEffects(
    state: GameState,
    effectKeyword: 'Start' | 'End',
    effectRegistry: Record<string, (card: PlayedCard, state: GameState, context: EffectContext) => EffectResult>
): EffectResult {
    const player = state.turn;
    // CRITICAL: Reset indent to 0 at the start of processing triggered effects
    // This ensures "Start/End effect triggers" messages are always at top level
    let newState: GameState = { ...state, _logIndentLevel: 0 };

    const isStartPhase = effectKeyword === 'Start';

    const snapshotKey = isStartPhase ? '_startPhaseEffectSnapshot' : '_endPhaseEffectSnapshot';
    const selectedEffectIdKey = isStartPhase ? '_selectedStartEffectId' : '_selectedEndEffectId';

    // Check if there's a selected effect waiting to be executed
    // This is set by the cardResolver when the player chooses which effect to run first
    const selectedEffectId = (newState as any)[selectedEffectIdKey] as string | undefined;

    // CRITICAL: Get existing snapshot and VALIDATE it
    // If snapshot exists but NO cards from it exist anymore, it's from an old session → delete it
    let snapshot = (newState as any)[snapshotKey] as PhaseEffectSnapshotEntry[] | undefined;

    if (snapshot && snapshot.length > 0) {
        // Check if at least ONE card from the snapshot still exists on the field
        const anyCardExists = snapshot.some(entry => {
            return newState[player].lanes.flat().some(c => c.id === entry.cardId);
        });
        if (!anyCardExists) {
            // Snapshot is completely invalid (old session) → delete it
            snapshot = undefined;
            (newState as any)[snapshotKey] = undefined;
        }
    }

    // Create new snapshot if none exists (or was just cleared)
    if (!snapshot) {
        snapshot = createPhaseEffectSnapshot(newState, player, effectKeyword);
        (newState as any)[snapshotKey] = snapshot;
    }

    const processedIds = isStartPhase
        ? (newState.processedStartEffectIds || [])
        : (newState.processedEndEffectIds || []);


    // Get all VALID unprocessed effects from the snapshot
    const validUnprocessedEffects: Array<{
        entry: PhaseEffectSnapshotEntry;
        card: PlayedCard;
        laneIndex: number;
    }> = [];

    for (const entry of snapshot) {
        const isProcessed = processedIds.includes(entry.cardId);
        if (isProcessed) continue;

        const validationResult = validateSnapshotEntry(newState, player, entry);
        if (validationResult) {
            validUnprocessedEffects.push({
                entry,
                card: validationResult.card,
                laneIndex: validationResult.laneIndex
            });
        }
    }

    // If no valid effects remaining, we're done
    if (validUnprocessedEffects.length === 0) {
        // Clear the snapshot and selected effect ID - phase is complete
        (newState as any)[snapshotKey] = undefined;
        (newState as any)[selectedEffectIdKey] = undefined;
        return { newState };
    }

    // Check if player already selected which effect to execute
    let effectToExecute: typeof validUnprocessedEffects[0] | undefined;

    if (selectedEffectId) {
        // Player selected an effect - find it and execute it
        effectToExecute = validUnprocessedEffects.find(e => e.entry.cardId === selectedEffectId);
        if (effectToExecute) {
            // Clear the selected effect ID - we're about to execute it
            (newState as any)[selectedEffectIdKey] = undefined;
        } else {
            console.warn(`[processTriggeredEffects] Selected effect ${selectedEffectId} not found in valid effects!`);
            (newState as any)[selectedEffectIdKey] = undefined;
        }
    }

    // If no pre-selected effect, check if we need to prompt for selection
    if (!effectToExecute) {
        if (validUnprocessedEffects.length > 1) {
            // MORE THAN ONE valid effect - prompt the player to choose which to execute first
            const availableEffects = validUnprocessedEffects.map(({ entry, card }) => ({
                cardId: entry.cardId,
                cardName: `${card.protocol}-${card.value}`,
                box: entry.box,
                effectDescription: getPhaseEffectDescription(card, entry.box, effectKeyword)
            }));

            newState.actionRequired = {
                type: 'select_phase_effect',
                actor: player,
                phase: effectKeyword,
                availableEffects
            };

            return { newState };
        }

        // Only ONE effect - execute it directly (no choice needed)
        effectToExecute = validUnprocessedEffects[0];
    }

    // Execute the selected/only effect
    const { entry, card, laneIndex: cardLaneIndex } = effectToExecute;

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
        const effectsSource = entry.box === 'top' ? customCard.customEffects.topEffects : customCard.customEffects.bottomEffects;
        const matchingEffects = effectsSource?.filter((e: any) => e.trigger === triggerType) || [];

        if (matchingEffects.length > 0) {
            const cardName = `${card.protocol}-${card.value}`;
            const phaseContext = effectKeyword === 'Start' ? 'start' : 'end';

            // Log the "triggers" message at indent level 0 WITHOUT phase context
            // (phase context forces indent >= 1, but "triggers" should be at indent 0)
            newState = setLogSource(newState, cardName);
            newState = setLogPhase(newState, phaseContext);
            // Temporarily clear phase context for this log entry
            const tempState = { ...newState, _currentPhaseContext: undefined };
            const loggedState = log(tempState, player, `${effectKeyword} effect triggers.`);
            // Restore phase context and copy the log
            newState = { ...newState, log: loggedState.log };

            // IMPORTANT: Increase indent for effect details (now at level 1)
            newState = increaseLogIndent(newState);

            // Execute all matching effects sequentially
            for (let effectIdx = 0; effectIdx < matchingEffects.length; effectIdx++) {
                const effectDef = matchingEffects[effectIdx];
                const result = executeCustomEffect(card, cardLaneIndex, newState, context, effectDef);
                newState = recalculateAllLaneValues(result.newState);

                if (newState.actionRequired) {
                    // Store remaining effects to execute after this action resolves
                    const remainingEffects = matchingEffects.slice(effectIdx + 1);
                    if (remainingEffects.length > 0) {
                        // CRITICAL: Use _pendingCustomEffects pattern (same as middleEffects)
                        (newState as any)._pendingCustomEffects = {
                            sourceCardId: card.id,
                            laneIndex: cardLaneIndex,
                            context,
                            effects: remainingEffects,
                            // Log-Kontext mitspeichern für korrekte Einrückung/Quellkarte nach Interrupts
                            logSource: newState._currentEffectSource,
                            logPhase: newState._currentPhaseContext,
                            logIndentLevel: newState._logIndentLevel || 0
                        };
                    }
                    // Mark as processed before returning
                    if (isStartPhase) {
                        newState.processedStartEffectIds = [...(newState.processedStartEffectIds || []), card.id];
                    } else {
                        newState.processedEndEffectIds = [...(newState.processedEndEffectIds || []), card.id];
                    }
                    return { newState };
                }
            }

            // Mark as processed
            if (isStartPhase) {
                newState.processedStartEffectIds = [...(newState.processedStartEffectIds || []), card.id];
            } else {
                newState.processedEndEffectIds = [...(newState.processedEndEffectIds || []), card.id];
            }

            // Decrease indent after effect completes
            newState = decreaseLogIndent(newState);
            newState = setLogSource(newState, undefined);
            newState = setLogPhase(newState, undefined);

            // CRITICAL: Recursively call processTriggeredEffects to handle remaining effects
            // This ensures all phase effects are processed before moving to the next phase
            return processTriggeredEffects(newState, effectKeyword, effectRegistry);
        }
    }

    // Standard card - use registry (legacy support)
    const effectKey = `${card.protocol}-${card.value}`;
    const execute = effectRegistry[effectKey];
    if (execute) {
        // Set logging context: card name and phase
        const cardName = `${card.protocol}-${card.value}`;
        const phaseContext = effectKeyword === 'Start' ? 'start' : 'end';

        // Log the "triggers" message at indent level 0 WITHOUT phase context
        // (phase context forces indent >= 1, but "triggers" should be at indent 0)
        newState = setLogSource(newState, cardName);
        newState = setLogPhase(newState, phaseContext);
        // Temporarily clear phase context for this log entry
        const tempState = { ...newState, _currentPhaseContext: undefined };
        const loggedState = log(tempState, player, `${effectKeyword} effect triggers.`);
        // Restore phase context and copy the log
        newState = { ...newState, log: loggedState.log };

        // IMPORTANT: Increase indent for effect details (now at level 1)
        newState = increaseLogIndent(newState);

        // FIXED: Now calls execute with proper signature (card, state, context)
        const result = execute(card, newState, context);
        newState = recalculateAllLaneValues(result.newState);

        if (isStartPhase) {
            newState.processedStartEffectIds = [...(newState.processedStartEffectIds || []), card.id];
        } else {
            newState.processedEndEffectIds = [...(newState.processedEndEffectIds || []), card.id];
        }

        if (newState.actionRequired) {
            // If an action is required, keep indent and context active
            // They will be cleared when the action is resolved
            return { newState }; // Stop processing if an action is required
        }

        // Decrease indent after effect completes (only if no action is pending)
        newState = decreaseLogIndent(newState);
        newState = setLogSource(newState, undefined);
        newState = setLogPhase(newState, undefined);

        // CRITICAL: Recursively call processTriggeredEffects to handle remaining effects
        // This ensures all phase effects are processed before moving to the next phase
        return processTriggeredEffects(newState, effectKeyword, effectRegistry);
    }

    return { newState };
}


export function executeStartPhaseEffects(state: GameState): EffectResult {
    return processTriggeredEffects(state, 'Start', effectRegistryStart);
}

export function executeEndPhaseEffects(state: GameState): EffectResult {
    return processTriggeredEffects(state, 'End', effectRegistryEnd);
}