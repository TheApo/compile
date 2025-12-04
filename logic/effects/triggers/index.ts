/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Effect Triggers - Index
 *
 * Central export for all trigger-related functionality.
 */

// Trigger Handler - Finding and categorizing triggers
export {
    type TriggerType,
    type EffectPosition,
    type TriggerableEffect,
    getEffectsForTrigger,
    findCardsWithTrigger,
    cardHasTrigger,
    isReactiveTrigger,
    isPassiveTrigger,
    createTriggerContext,
    sortTriggerableEffects
} from './triggerHandler';

// Trigger Processor - Executing triggered effects
export {
    type ProcessTriggerOptions,
    type ProcessTriggerResult,
    processTrigger,
    processStartPhaseEffects,
    processEndPhaseEffects,
    processOnPlayEffects,
    processOnFlipEffects,
    processOnCoverEffects
} from './triggerProcessor';
