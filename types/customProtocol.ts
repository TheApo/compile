/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom Protocol Creator - Type Definitions
 *
 * This file defines the schema for creating custom protocols by selecting
 * and parameterizing modular effects.
 */

export type EffectActionType =
    | 'draw'
    | 'flip'
    | 'shift'
    | 'delete'
    | 'discard'
    | 'return'
    | 'play'
    | 'rearrange_protocols'
    | 'swap_protocols'
    | 'reveal'
    | 'give';

export type EffectPosition = 'top' | 'middle' | 'bottom';
export type EffectTrigger = 'on_play' | 'start' | 'end' | 'on_cover';

export type TargetOwner = 'any' | 'own' | 'opponent';
export type TargetPosition = 'any' | 'covered' | 'uncovered' | 'covered_in_this_line';
export type TargetFaceState = 'any' | 'face_up' | 'face_down';

/**
 * Draw Effect Parameters
 */
export interface DrawEffectParams {
    action: 'draw';
    count: number;  // 1-6
    target: 'self' | 'opponent';
    source: 'own_deck' | 'opponent_deck';
    conditional?: {
        type: 'count_face_down' | 'is_covering' | 'non_matching_protocols';
    };
    preAction?: 'refresh';  // Refresh hand before drawing
}

/**
 * Flip Effect Parameters
 */
export interface FlipEffectParams {
    action: 'flip';
    count: number;  // 1-6
    targetFilter: {
        owner: TargetOwner;
        position: TargetPosition;
        faceState: TargetFaceState;
        excludeSelf: boolean;
    };
    optional: boolean;  // "may flip" vs "flip"
    selfFlipAfter?: boolean;  // Flip this card after target flip
}

/**
 * Shift Effect Parameters
 */
export interface ShiftEffectParams {
    action: 'shift';
    targetFilter: {
        owner: TargetOwner;
        position: 'uncovered' | 'covered' | 'any';
        faceState: TargetFaceState;
    };
    destinationRestriction?: {
        type: 'non_matching_protocol' | 'specific_lane' | 'any';
        laneIndex?: number;  // If type is 'specific_lane'
    };
    chainedFrom?: 'flip';  // If shift follows a flip
}

/**
 * Delete Effect Parameters
 */
export interface DeleteEffectParams {
    action: 'delete';
    count: number | 'all_in_lane';  // 1-6 or all
    targetFilter: {
        position: 'uncovered' | 'covered' | 'any';
        faceState: TargetFaceState;
        valueRange?: { min: number; max: number };  // e.g., values 0-1
        calculation?: 'highest_value' | 'lowest_value';
    };
    scope?: {
        type: 'anywhere' | 'other_lanes' | 'specific_lane' | 'this_line';
        laneRestriction?: number;
    };
    protocolMatching?: 'must_match' | 'must_not_match';
    excludeSelf: boolean;
}

/**
 * Discard Effect Parameters
 */
export interface DiscardEffectParams {
    action: 'discard';
    count: number;  // 1-6
    actor: 'self' | 'opponent';
    conditional?: boolean;  // If part of "if you do" chain
    choice?: {
        alternative: 'flip_self';  // Either discard or flip self
    };
}

/**
 * Return Effect Parameters
 */
export interface ReturnEffectParams {
    action: 'return';
    count: number | 'all';  // 1-6 or all
    targetFilter: {
        valueEquals?: number;  // Return all cards with value X
        position?: 'any';
    };
    scope: {
        type: 'any_card' | 'cards_in_lane';
        laneSelection?: 'prompt';
    };
}

/**
 * Play Effect Parameters
 */
export interface PlayEffectParams {
    action: 'play';
    source: 'hand' | 'deck';
    count: number;  // 1-6
    faceDown: boolean;
    destinationRule: {
        type: 'other_lines' | 'specific_lane' | 'each_line_with_card' | 'under_this_card';
        excludeCurrentLane?: boolean;
    };
}

/**
 * Protocol Rearrange/Swap Parameters
 */
export interface ProtocolEffectParams {
    action: 'rearrange_protocols' | 'swap_protocols';
    target: 'own' | 'opponent' | 'both_sequential';
    restriction?: {
        disallowedProtocol: string;  // e.g., "Anarchy"
        laneIndex: number;
    };
}

/**
 * Reveal/Give Effect Parameters
 */
export interface RevealEffectParams {
    action: 'reveal' | 'give';
    source: 'own_hand' | 'opponent_hand';
    count: number;  // 1-6
    followUpAction?: 'flip' | 'shift';
}

/**
 * Union of all effect parameter types
 */
export type EffectParams =
    | DrawEffectParams
    | FlipEffectParams
    | ShiftEffectParams
    | DeleteEffectParams
    | DiscardEffectParams
    | ReturnEffectParams
    | PlayEffectParams
    | ProtocolEffectParams
    | RevealEffectParams;

/**
 * Effect Definition - Single effect with parameters
 */
export interface EffectDefinition {
    id: string;  // Unique identifier for this effect instance
    params: EffectParams;
    position: EffectPosition;
    trigger: EffectTrigger;
    conditional?: {
        type: 'if_you_do';
        thenEffect: EffectDefinition;  // Chained effect
    };
}

/**
 * Custom Card Definition - One card in a custom protocol
 */
export interface CustomCardDefinition {
    value: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    topEffects: EffectDefinition[];     // Top box (passive, always active when face-up)
    middleEffects: EffectDefinition[];  // Middle box (on play / when uncovered)
    bottomEffects: EffectDefinition[];  // Bottom box (start/end/on-cover triggers)
}

/**
 * Card Pattern Types
 */
export type CardPattern = 'solid' | 'gradient' | 'diagonal' | 'dots';

/**
 * Custom Protocol Definition - Complete protocol set (6 cards)
 */
export interface CustomProtocolDefinition {
    id: string;  // Unique ID for this protocol
    name: string;  // Protocol name (e.g., "Lightning", "Shadow")
    description: string;
    author: string;
    createdAt: string;  // ISO date string
    color: string;  // Hex color (e.g., "#1976D2")
    pattern: CardPattern;  // Card background pattern
    cards: CustomCardDefinition[];  // Exactly 6 cards (values 0-5 or 1-6)
}

/**
 * Storage for custom protocols
 */
export interface CustomProtocolStorage {
    protocols: CustomProtocolDefinition[];
    version: number;  // For future schema migrations
}
