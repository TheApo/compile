/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Effect Actions - Index
 *
 * Central export for all effect action executors.
 */

// Draw effects
export {
    executeDrawEffect
} from './drawExecutor';

// Flip effects
export {
    executeFlipEffect,
    executeFlipAllInLane,
    type FlipEffectParams
} from './flipExecutor';

// Delete effects
export {
    executeDeleteEffect,
    countValidDeleteTargets,
    type DeleteEffectParams
} from './deleteExecutor';

// Shift effects
export {
    executeShiftEffect,
    performShift,
    type ShiftEffectParams
} from './shiftExecutor';

// Return effects
export {
    executeReturnEffect,
    performReturn,
    type ReturnEffectParams
} from './returnExecutor';

// Play effects
export {
    executePlayEffect,
    type PlayEffectParams
} from './playExecutor';
