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
    | 'refresh'
    | 'mutual_draw'
    | 'flip'
    | 'shift'
    | 'delete'
    | 'discard'
    | 'return'
    | 'play'
    | 'rearrange_protocols'
    | 'swap_protocols'
    | 'reveal'
    | 'give'
    | 'take'
    | 'choice'
    | 'passive_rule'
    | 'value_modifier'
    | 'block_compile'
    | 'delete_all_in_lane';

export type EffectPosition = 'top' | 'middle' | 'bottom';

// Expanded trigger types to support all card effects
export type EffectTrigger =
    // Immediate triggers (Middle Box)
    | 'on_play'              // When played or uncovered
    // Turn phase triggers (Bottom Box)
    | 'start'                // Start of turn
    | 'end'                  // End of turn
    | 'on_cover'             // When this card would be covered
    // Passive (Top Box)
    | 'passive'              // Always active when face-up
    // Reactive triggers (Top Box)
    | 'after_delete'         // After you delete cards (Hate-3)
    | 'after_opponent_discard' // After opponent discards (Plague-1)
    | 'after_draw'           // After you draw cards (Spirit-3)
    | 'after_clear_cache'    // After you clear cache (Speed-1)
    | 'before_compile_delete' // Before this card deleted by compile (Speed-2)
    | 'after_flip'           // After cards are flipped
    | 'after_shift'          // After cards are shifted
    | 'after_play'           // After cards are played
    | 'on_flip'              // When this card would be flipped (Metal-6)
    | 'on_cover_or_flip';    // When this card would be covered OR flipped (Metal-6)

export type TargetOwner = 'any' | 'own' | 'opponent';
export type TargetPosition = 'any' | 'covered' | 'uncovered' | 'covered_in_this_line';
export type TargetFaceState = 'any' | 'face_up' | 'face_down';

/**
 * Draw Effect Parameters
 */
export interface DrawEffectParams {
    action: 'draw';
    count: number;  // 1-6 (only used if countType is 'fixed')
    target: 'self' | 'opponent';
    source: 'own_deck' | 'opponent_deck';
    // NEW: Dynamic draw count types
    countType?: 'fixed' | 'equal_to_card_value' | 'equal_to_discarded' | 'hand_size';
    countOffset?: number;  // For Fire-4: "discard count + 1" → offset = 1
    conditional?: {
        type: 'count_face_down' | 'is_covering' | 'non_matching_protocols';
    };
    preAction?: 'refresh';  // Refresh hand before drawing
    // NEW: Advanced conditionals
    advancedConditional?: {
        type: 'protocol_match' | 'compile_block';  // Anarchy-6, Metal-1
        protocol?: string;  // For 'protocol_match'
        turnDuration?: number;  // For 'compile_block'
    };
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
    flipSelf?: boolean;  // NEW: Flip this card instead of selecting target (for Anarchy-6)
    scope?: 'any' | 'this_lane' | 'each_lane';  // NEW: 'each_lane' = execute once per lane (Chaos-0)
    // NEW: Advanced conditionals
    advancedConditional?: {
        type: 'protocol_match';  // Anarchy-6: "if this card is in line with Anarchy protocol"
        protocol?: string;  // For 'protocol_match'
    };
}

/**
 * Shift Effect Parameters
 */
export interface ShiftEffectParams {
    action: 'shift';
    optional?: boolean;  // "may shift" vs "shift"
    count?: number | 'all';  // NEW: For Light-3 "shift all face-down cards"
    targetFilter: {
        owner: TargetOwner;
        position: 'uncovered' | 'covered' | 'any';
        faceState: TargetFaceState;
        excludeSelf?: boolean;  // NEW: For Anarchy-1 "shift 1 other card"
    };
    destinationRestriction?: {
        type: 'non_matching_protocol' | 'specific_lane' | 'to_another_line' | 'to_this_lane' | 'to_or_from_this_lane' | 'any';
        laneIndex?: number | 'current';  // If type is 'specific_lane', 'to_this_lane', or 'to_or_from_this_lane', 'current' = this card's lane (Gravity-1, Gravity-2, Gravity-4)
    };
    chainedFrom?: 'flip';  // If shift follows a flip
    scope?: 'any' | 'this_lane' | 'each_lane';  // NEW: 'each_lane' = execute once per lane
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
        owner?: 'own' | 'opponent';  // NEW: which player's cards
    };
    scope?: {
        type: 'anywhere' | 'other_lanes' | 'specific_lane' | 'this_line' | 'each_lane';
        laneRestriction?: number;
        minCardsInLane?: number;  // NEW: Metal-3 - "8 or more cards in line"
    };
    protocolMatching?: 'must_match' | 'must_not_match';
    excludeSelf: boolean;
    // NEW: Who chooses which card to delete?
    actorChooses?: 'effect_owner' | 'card_owner';  // Plague-4: opponent chooses their own card
}

/**
 * Discard Effect Parameters
 */
export interface DiscardEffectParams {
    action: 'discard';
    count: number;  // 1-6 (only used if countType is 'fixed')
    actor: 'self' | 'opponent';
    variableCount?: boolean;  // "Discard 1 or more cards" (Fire-4, Plague-2)
    conditional?: boolean;  // If part of "if you do" chain
    choice?: {
        alternative: 'flip_self';  // Either discard or flip self
    };
    // NEW: Dynamic discard count (Plague-2)
    countType?: 'fixed' | 'equal_to_discarded';
    countOffset?: number;  // For Plague-2: "discard count + 1" → offset = 1
}

/**
 * Return Effect Parameters
 */
export interface ReturnEffectParams {
    action: 'return';
    count: number | 'all';  // 1-6 or all
    targetFilter?: {
        valueEquals?: number;  // Return all cards with value X
        position?: 'any';
        owner?: 'own' | 'opponent' | 'any';  // NEW: whose cards to return (default: 'any')
    };
    scope?: {
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
        type: 'other_lines' | 'specific_lane' | 'each_line_with_card' | 'under_this_card' | 'each_other_line' | 'line_with_matching_cards';
        excludeCurrentLane?: boolean;
        laneIndex?: number | 'current';  // NEW: For Gravity-6 "opponent plays in this line", 'current' = this card's lane
        ownerFilter?: 'own' | 'opponent' | 'any';  // Whose cards to check
        // NEW: Filter cards in lane by face state (Smoke-0, Smoke-3)
        cardFilter?: {
            faceState: 'face_down' | 'face_up';
        };
    };
    // NEW: Conditional play
    condition?: {
        type: 'per_x_cards_in_line' | 'only_in_lines_with_cards' | 'per_x_face_down_cards';
        cardCount?: number;  // For 'per_x_cards_in_line' and 'per_x_face_down_cards' (e.g., 2 for "every 2 cards")
    };
    actor?: 'self' | 'opponent';  // Who plays (default: self)
}

/**
 * Protocol Rearrange/Swap Parameters
 */
export interface ProtocolEffectParams {
    action: 'rearrange_protocols' | 'swap_protocols';
    target: 'own' | 'opponent' | 'both_sequential';
    restriction?: {
        disallowedProtocol: string;  // e.g., "Anarchy"
        laneIndex: number | 'current';  // NEW: 'current' = lane where this card is located (Anarchy-3)
    };
}

/**
 * Reveal/Give Effect Parameters
 */
export interface RevealEffectParams {
    action: 'reveal' | 'give';
    source: 'own_hand' | 'opponent_hand' | 'board';  // NEW: 'board' for Light-2
    count: number;  // 1-6 (or -1 for "entire hand")
    followUpAction?: 'flip' | 'shift';
    // NEW: For board card reveal (Light-2: "Reveal 1 face-down card. You may shift or flip that card.")
    targetFilter?: {
        owner?: TargetOwner;
        position?: TargetPosition;
        faceState?: TargetFaceState;
    };
    optional?: boolean;  // "You may shift or flip" = optional follow-up
}

/**
 * Take Effect Parameters
 */
export interface TakeEffectParams {
    action: 'take';
    source: 'opponent_hand';
    count: number;  // 1-6
    random: boolean;  // true = random, false = choose
}

/**
 * Choice Effect Parameters (Either/Or)
 */
export interface ChoiceEffectParams {
    action: 'choice';
    options: EffectDefinition[];  // Array of 2 effect options
}

/**
 * Passive Rule Effect Parameters
 * These modify game rules while the card is face-up
 */
export interface PassiveRuleParams {
    action: 'passive_rule';
    rule: {
        type: 'block_face_down_play'        // Metal-2: Opponent can't play face-down
            | 'block_face_up_play'           // (Not used currently)
            | 'block_all_play'               // Plague-0: Opponent can't play in this lane
            | 'require_face_down_play'       // Psychic-1: Opponent can only play face-down
            | 'allow_any_protocol_play'      // Spirit-1, Chaos-3: Play anywhere without matching
            | 'require_non_matching_protocol' // Anarchy-1: Can only play non-matching
            | 'block_flips'                  // Frost-1: Cards can't be flipped face-up
            | 'block_protocol_rearrange'     // Frost-1: Protocols can't be rearranged
            | 'block_shifts_from_lane'       // Can't shift FROM this lane
            | 'block_shifts_to_lane'         // Can't shift TO this lane
            | 'block_shifts_from_and_to_lane' // Frost-3: Can't shift FROM or TO this lane
            | 'ignore_middle_commands'       // Apathy-2: Ignore middle effects in this lane
            | 'skip_check_cache_phase';      // Spirit-0: Skip check cache phase
        target: 'self' | 'opponent' | 'all';  // Who is affected
        scope: 'this_lane' | 'global';        // Where it applies
    };
}

/**
 * Value Modifier Effect Parameters
 * These modify card values or lane totals while face-up
 */
export interface ValueModifierParams {
    action: 'value_modifier';
    modifier: {
        type: 'add_per_condition'         // Apathy-0: +1 per face-down card
            | 'set_to_fixed'              // Darkness-2: set face-down cards to 4
            | 'add_to_total';             // Metal-0: opponent total -2
        value: number;                    // The modifier value (+1, 4, -2, etc.)
        condition?: 'per_face_down_card'  // For add_per_condition type
                  | 'per_face_up_card'
                  | 'per_card';
        target: 'own_cards'               // Which cards/totals to modify
              | 'opponent_cards'
              | 'all_cards'
              | 'own_total'               // Modify final total
              | 'opponent_total';
        scope: 'this_lane' | 'global';
        filter?: {                        // Filter which cards (for card modifiers)
            faceState?: 'face_up' | 'face_down' | 'any';
            position?: 'covered' | 'uncovered' | 'any';
        };
    };
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
    | RevealEffectParams
    | TakeEffectParams
    | ChoiceEffectParams
    | PassiveRuleParams
    | ValueModifierParams;

/**
 * Effect Definition - Single effect with parameters
 */
export interface EffectDefinition {
    id: string;  // Unique identifier for this effect instance
    params: EffectParams;
    position: EffectPosition;
    trigger: EffectTrigger;
    conditional?: {
        type: 'if_you_do' | 'if_executed' | 'then';
        thenEffect: EffectDefinition;  // Chained effect
    };
    // NEW: Reference card from previous effect in chain
    // Enables: "Flip 1 card. Shift THAT card" or "Flip 1 card. Draw cards equal to THAT card's value"
    useCardFromPreviousEffect?: boolean;
    // NEW: For reactive triggers (after_delete, after_draw, etc.) - who triggers it?
    // - 'self': Only when card owner performs the action (default for Hate-3, Spirit-3)
    // - 'opponent': Only when opponent performs the action
    // - 'any': When anyone performs the action
    reactiveTriggerActor?: 'self' | 'opponent' | 'any';
}

/**
 * Custom Card Definition - One card in a custom protocol
 */
export interface CustomCardDefinition {
    value: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;
    topEffects: EffectDefinition[];     // Top box (passive, always active when face-up)
    middleEffects: EffectDefinition[];  // Middle box (on play / when uncovered)
    bottomEffects: EffectDefinition[];  // Bottom box (start/end/on-cover triggers)
}

/**
 * Card Pattern Types
 */
export type CardPattern =
    | 'solid'
    | 'radial'
    | 'dual-radial'
    | 'multi-radial'
    | 'chaos'
    | 'grid'
    | 'diagonal-lines'
    | 'cross-diagonal'
    | 'horizontal-lines'
    | 'vertical-lines'
    | 'cross'
    | 'hexagons'
    | 'stripes'
    | 'frost';

/**
 * Custom Protocol Definition - Complete protocol set (6 cards)
 */
export type ProtocolCategory = 'Main 1' | 'Main 2' | 'Aux 1' | 'Aux 2' | 'Fan-Content' | 'Custom';

export interface CustomProtocolDefinition {
    id: string;  // Unique ID for this protocol
    name: string;  // Protocol name (e.g., "Lightning", "Shadow")
    description: string;
    author?: string;
    createdAt?: string;  // ISO date string
    color: string;  // Hex color (e.g., "#1976D2")
    pattern: CardPattern;  // Card background pattern
    cards: CustomCardDefinition[];  // Exactly 6 cards (values 0-5 or 1-6)
    category?: ProtocolCategory;  // Category for protocol selection (Main 1, Main 2, Aux 1, Aux 2, Fan-Content, Custom)
}

/**
 * Storage for custom protocols
 */
export interface CustomProtocolStorage {
    protocols: CustomProtocolDefinition[];
    version: number;  // For future schema migrations
}
