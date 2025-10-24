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
    const entry: LogEntry = {
        player,
        message,
        indentLevel: state._logIndentLevel || 0,
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
