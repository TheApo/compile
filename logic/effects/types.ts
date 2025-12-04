/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Effect System Types
 *
 * Zentrale Type-Definitionen für das Effect-System.
 * Diese Datei re-exportiert relevante Types aus types/index.ts
 * und definiert zusätzliche interne Types.
 */

import { GameState, Player, PlayedCard, TargetFilter, EffectScope, DestinationRestriction } from '../../types';
import { EffectDefinition } from '../../types/customProtocol';

// Re-export commonly used types
export { GameState, Player, PlayedCard, TargetFilter, EffectScope, DestinationRestriction };
export { EffectDefinition };

// =============================================================================
// EFFECT EXECUTION TYPES
// =============================================================================

/**
 * Result of checking if an effect can be executed
 */
export interface PreconditionResult {
    /** Whether the effect can be executed */
    canExecute: boolean;
    /** Reason why the effect cannot be executed (if canExecute is false) */
    skipReason?: string;
    /** Valid targets found (for target-requiring effects) */
    validTargets?: CardLocation[];
}

/**
 * Location of a card on the board
 */
export interface CardLocation {
    card: PlayedCard;
    owner: Player;
    laneIndex: number;
    cardIndex: number;
    isUncovered: boolean;
}

/**
 * Context for effect execution
 * Extends the base EffectContext with additional data needed during execution
 */
export interface EffectExecutionContext {
    /** Owner of the card that triggered the effect */
    cardOwner: Player;
    /** Who is performing the action (for prompts) */
    actor: Player;
    /** Whose turn is it */
    currentTurn: Player;
    /** Opponent of card owner */
    opponent: Player;
    /** How the effect was triggered */
    triggerType?: 'play' | 'flip' | 'uncover' | 'start' | 'end' | 'cover' | 'middle';
    /** The card that owns this effect */
    sourceCard: PlayedCard;
    /** Lane where the source card is located */
    laneIndex: number;
    /** Card selected by previous effect in chain (for useCardFromPreviousEffect) */
    referencedCard?: PlayedCard;
    /** Value of referenced card (for dynamic draw) */
    referencedCardValue?: number;
    /** Number of cards discarded (for "Discard X. Draw X" effects) */
    discardedCount?: number;
    /** Size of hand before action (for Chaos-4 End) */
    previousHandSize?: number;
}

/**
 * Result of effect execution
 */
export interface EffectExecutionResult {
    /** Updated game state */
    newState: GameState;
    /** Whether the effect was successfully executed */
    executed: boolean;
    /** Cards affected by the effect */
    affectedCards?: CardLocation[];
    /** Animation requests */
    animationRequests?: any[];
}

// =============================================================================
// TARGET RESOLUTION TYPES
// =============================================================================

/**
 * Callback function for custom target validation
 */
export type TargetValidationFn = (
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number
) => boolean;

/**
 * Options for finding targets
 */
export interface FindTargetsOptions {
    /** The game state */
    state: GameState;
    /** Target filter from effect definition */
    filter: TargetFilter;
    /** ID of the source card (for excludeSelf) */
    sourceCardId?: string;
    /** Owner who is executing the effect (for 'own'/'opponent' resolution) */
    actor?: Player;
    /** Lane restriction (for 'this_lane' scope) */
    scopeLaneIndex?: number;
    /** Additional custom validation function */
    customValidation?: TargetValidationFn;
}

// =============================================================================
// COUNT RESOLUTION TYPES
// =============================================================================

/**
 * Dynamic count definition from effect params
 */
export interface CountDefinition {
    /** Fixed count value */
    fixed?: number;
    /** Dynamic count type */
    type?: 'equal_to_card_value' | 'equal_to_discarded' | 'hand_size' | 'previous_hand_size' | 'count_face_down';
    /** Card ID for value-based counts */
    cardId?: string;
    /** Lane index for lane-based counts */
    laneIndex?: number;
}

/**
 * Context for resolving dynamic counts
 */
export interface CountResolutionContext {
    state: GameState;
    actor: Player;
    referencedCardValue?: number;
    discardedCount?: number;
    previousHandSize?: number;
}

// =============================================================================
// KEYWORD TYPES
// =============================================================================

/**
 * All supported effect keywords/actions
 */
export type EffectKeyword =
    | 'draw'
    | 'discard'
    | 'flip'
    | 'shift'
    | 'delete'
    | 'return'
    | 'play'
    | 'reveal'
    | 'refresh'
    | 'mutual_draw'
    | 'rearrange_protocols'
    | 'swap_protocols'
    | 'give'
    | 'take'
    | 'choice'
    | 'block_compile'
    | 'delete_all_in_lane'
    | 'value_modifier';

/**
 * Params structure for effects (from EffectDefinition)
 */
export interface EffectParams {
    action: EffectKeyword;
    count?: number | CountDefinition;
    actor?: 'self' | 'opponent';
    targetFilter?: TargetFilter;
    scope?: EffectScope;
    destination?: DestinationRestriction;
    optional?: boolean;
    deleteSelf?: boolean;
    useCardFromPreviousEffect?: boolean;
    source?: 'deck' | 'hand' | 'board' | 'discard';
    // ... weitere spezifische Params
    [key: string]: any;
}
