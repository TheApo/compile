/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, LogEntry } from '../../types';

/**
 * Enhanced logging function that supports:
 * - Indentation for effect chains
 * - Source card tracking
 * - Phase context (start/middle/end/uncover/compile)
 */
export const log = (state: GameState, player: Player, message: string): GameState => {
    // CRITICAL FIX: Calculate indent level intelligently
    // If we have a phase context (start/middle/end/uncover), we're in an effect -> minimum indent 1
    // If we have a source card but no phase (e.g., on-cover effects), use explicit indent level
    let indentLevel = state._logIndentLevel || 0;
    if (state._currentPhaseContext && indentLevel === 0) {
        indentLevel = 1; // We're in a phase effect context, so minimum indent is 1
    }

    const entry: LogEntry = {
        player,
        message,
        indentLevel,
        sourceCard: state._currentEffectSource,
        phase: state._currentPhaseContext,
    };

    return { ...state, log: [...state.log, entry] };
};

/**
 * Helper to increase indentation level for nested effects
 */
export const increaseLogIndent = (state: GameState): GameState => {
    return { ...state, _logIndentLevel: (state._logIndentLevel || 0) + 1 };
};

/**
 * Helper to decrease indentation level
 */
export const decreaseLogIndent = (state: GameState): GameState => {
    return { ...state, _logIndentLevel: Math.max(0, (state._logIndentLevel || 0) - 1) };
};

/**
 * Helper to set the current effect source card
 */
export const setLogSource = (state: GameState, cardName: string | undefined): GameState => {
    return { ...state, _currentEffectSource: cardName };
};

/**
 * Helper to set the current phase context
 */
export const setLogPhase = (state: GameState, phase: 'start' | 'middle' | 'end' | 'uncover' | 'compile' | undefined): GameState => {
    return { ...state, _currentPhaseContext: phase };
};

/**
 * Helper to complete an action and decrease indent if it was caused by an effect.
 * Call this when setting actionRequired = null after completing an action.
 */
export const completeEffectAction = (state: GameState, hadSourceCardId: boolean): GameState => {
    let newState = { ...state, actionRequired: null };

    // Decrease indent if the action was caused by an effect (had sourceCardId)
    if (hadSourceCardId) {
        newState = decreaseLogIndent(newState);
    }

    return newState;
};
