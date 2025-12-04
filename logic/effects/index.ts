/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Effect System - Main Entry Point
 *
 * Dieses Modul bietet eine saubere, modulare Struktur für das Effect-System.
 * Es ersetzt schrittweise die monolithische effectInterpreter.ts.
 */

// Types
export * from './types';

// Utils - target resolution, count calculation, chains, preconditions
export * from './utils';

// Triggers - when effects trigger (start, end, on_play, on_flip, on_cover, etc.)
export * from './triggers';

// Actions (TODO: Phase 4 - integrate action executors)
// export * from './actions';
