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
    | 'delete_all_in_lane'
    | 'shuffle_trash'  // Clarity-4: Shuffle trash into deck
    | 'shuffle_deck'   // Clarity-2/3: Shuffle deck after reveal
    | 'state_number'   // Luck-0: Player states a number (0-5)
    | 'state_protocol'  // Luck-3: Player states a protocol
    | 'swap_stacks'     // Mirror-2: Swap cards between own lanes
    | 'copy_opponent_middle'  // Mirror-1: Copy opponent's middle effect
    | 'auto_compile';  // Diversity-0: Mark lane as compiled (cards stay on board)

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
    | 'after_discard'        // After you discard cards (Corruption-2)
    | 'after_opponent_discard' // After opponent discards (Plague-1)
    | 'after_draw'           // After you draw cards (Spirit-3)
    | 'after_opponent_draw'  // After opponent draws cards (Mirror-4)
    | 'after_clear_cache'    // After you clear cache (Speed-1)
    | 'before_compile_delete' // Before this card deleted by compile (Speed-2)
    | 'after_flip'           // After cards are flipped
    | 'after_shift'          // After cards are shifted
    | 'after_play'           // After cards are played
    | 'on_flip'              // When this card would be flipped (Metal-6)
    | 'on_cover_or_flip'     // When this card would be covered OR flipped (Metal-6)
    | 'when_card_returned'   // When a card would be returned to a player's hand
    | 'after_refresh'        // After you refresh (War-0)
    | 'after_opponent_refresh'  // After opponent refreshes (War-1)
    | 'after_compile'        // After you compile
    | 'after_opponent_compile' // After opponent compiles (War-2)
    | 'after_shuffle';        // After shuffle_trash or shuffle_deck (Time-2)

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
    countType?: 'fixed' | 'equal_to_card_value' | 'equal_to_discarded' | 'hand_size' | 'all_matching' | 'equal_to_unique_protocols_in_lane' | 'count_own_protocol_cards_on_field';  // 'all_matching' for Clarity-2/3, 'equal_to_unique_protocols_in_lane' for Diversity-1, 'count_own_protocol_cards_on_field' for Unity-2
    countOffset?: number;  // For Fire-4: "discard count + 1" → offset = 1
    conditional?: {
        type: 'count_face_down' | 'is_covering' | 'non_matching_protocols' | 'same_protocol_on_field';  // 'same_protocol_on_field' for Unity-0/Unity-3
    };
    preAction?: 'refresh';  // Refresh hand before drawing
    // NEW: Advanced conditionals
    advancedConditional?: {
        type: 'protocol_match' | 'compile_block' | 'empty_hand' | 'opponent_higher_value_in_lane' | 'same_protocol_on_field';  // Anarchy-6, Metal-1, Courage-0, Courage-2, Unity-0/Unity-3
        protocol?: string;  // For 'protocol_match'
        turnDuration?: number;  // For 'compile_block'
    };
    // NEW: Value filter for drawing specific cards (Clarity-2: "Draw all cards with a value of 1")
    valueFilter?: {
        equals: number;  // Draw only cards with this value
    };
    // NEW: Protocol filter for drawing all cards of same protocol (Unity-4)
    protocolFilter?: {
        type: 'same_as_source';  // Draw all cards matching source card's protocol
    };
    // NEW: If true, player must SELECT from revealed deck (Clarity-2/3: "revealed this way")
    fromRevealed?: boolean;
    optional?: boolean;  // "You may draw..."
    // Reveal from drawn cards with optional value filter and follow-up action
    revealFromDrawn?: {
        count?: number | 'all';  // How many cards to reveal (default: 1, 'all' = all matching)
        valueSource?: 'stated_number' | 'any';  // Filter: 'stated_number' = only matching, 'any' = no filter
        thenAction?: 'may_play';  // After reveal: optionally play the card
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
        valueMinGreaterThanHandSize?: boolean;  // Peace-3: Target must have value > hand size
        valueLessThanUniqueProtocolsOnField?: boolean;  // Diversity-4: Target must have value < unique protocols count
    };
    optional: boolean;  // "may flip" vs "flip"
    selfFlipAfter?: boolean;  // Flip this card after target flip
    flipSelf?: boolean;  // NEW: Flip this card instead of selecting target (for Anarchy-6)
    scope?: 'any' | 'this_lane' | 'each_lane';  // NEW: 'each_lane' = execute once per lane (Chaos-0)
    // NEW: Advanced conditionals
    advancedConditional?: {
        type: 'protocol_match' | 'opponent_higher_value_in_lane' | 'hand_size_greater_than' | 'same_protocol_on_field' | 'this_card_is_covered';  // Anarchy-6, Courage-6, Peace-6, Unity-0/Unity-3, Life-0
        protocol?: string;  // For 'protocol_match'
        threshold?: number;  // For 'hand_size_greater_than' - effect only if hand size > threshold
    };
    // NEW: Luck-1 - Flip the card but ignore its middle command (one-time skip, not passive rule)
    skipMiddleCommand?: boolean;
    // NEW: Mirror-3 - Follow-up flip must be in same lane as first flip
    sameLaneAsFirst?: boolean;
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
        type: 'non_matching_protocol' | 'specific_lane' | 'to_another_line' | 'to_this_lane' | 'to_or_from_this_lane' | 'any' | 'opponent_highest_value_lane';
        laneIndex?: number | 'current';  // If type is 'specific_lane', 'to_this_lane', or 'to_or_from_this_lane', 'current' = this card's lane
    };
    shiftSelf?: boolean;  // Shift this card itself
    chainedFrom?: 'flip';  // If shift follows a flip
    scope?: 'any' | 'this_lane' | 'each_lane';  // 'each_lane' = execute once per lane
    // Advanced conditionals - effect only executes if condition is met
    advancedConditional?: {
        type: 'empty_hand' | 'opponent_higher_value_in_lane' | 'this_card_is_covered';  // Ice-3: only if this card is covered
    };
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
        owner?: 'own' | 'opponent';  // which player's cards
        // NEW: Luck-4 - Dynamic value filter based on previous effect's card value
        valueSource?: 'previous_effect_card';  // Delete cards with same value as discarded card
    };
    scope?: {
        type: 'anywhere' | 'other_lanes' | 'specific_lane' | 'this_line' | 'each_lane';
        laneRestriction?: number;
        minCardsInLane?: number;  // Metal-3 - "8 or more cards in line"
    };
    protocolMatching?: 'must_match' | 'must_not_match';
    excludeSelf: boolean;
    // Who chooses which card to delete?
    actorChooses?: 'effect_owner' | 'card_owner';  // Plague-4: opponent chooses their own card
    // Lane-based conditions for targeting
    laneCondition?: {
        type: 'opponent_higher_value';  // Only lanes where opponent has higher total value
    };
    // Select lane first, then card
    selectLane?: boolean;
    // Delete this card itself
    deleteSelf?: boolean;
    // Advanced conditionals - effect only executes if condition is met
    advancedConditional?: {
        type: 'empty_hand' | 'opponent_higher_value_in_lane' | 'this_card_is_covered';
    };
    // Conditional self-delete based on protocol count (Diversity-6)
    protocolCountConditional?: {
        type: 'unique_protocols_on_field_below';
        threshold: number;  // Delete if count < threshold
    };
}

/**
 * Discard Effect Parameters
 */
export interface DiscardEffectParams {
    action: 'discard';
    count: number | 'all';  // 1-6 or 'all' for entire hand
    actor: 'self' | 'opponent' | 'both';  // 'both' = both players discard
    variableCount?: boolean;  // "Discard 1 or more cards" (Fire-4, Plague-2)
    conditional?: boolean;  // If part of "if you do" chain
    choice?: {
        alternative: 'flip_self';  // Either discard or flip self
    };
    // NEW: Dynamic discard count (Plague-2)
    countType?: 'fixed' | 'equal_to_discarded';
    countOffset?: number;  // For Plague-2: "discard count + 1" → offset = 1
    // NEW: Random selection - opponent can't choose which card to discard (Fear-4)
    random?: boolean;
    // NEW: Luck - Source of the card to discard (default: 'hand')
    source?: 'hand' | 'top_deck_own' | 'top_deck_opponent' | 'entire_deck';  // 'entire_deck' for Time-1
    // NEW: Destination trash - where discarded cards go (default: 'own_trash')
    discardTo?: 'own_trash' | 'opponent_trash';  // 'opponent_trash' for Assimilation-1
}

/**
 * Return Effect Parameters
 */
export interface ReturnEffectParams {
    action: 'return';
    count: number | 'all';  // 1-6 or all
    targetFilter?: {
        valueEquals?: number;  // Return all cards with value X
        position?: 'any' | 'covered' | 'uncovered';  // Position filter (default: 'uncovered')
        owner?: 'own' | 'opponent' | 'any';  // whose cards to return (default: 'any')
        faceState?: 'face_up' | 'face_down';  // Face state filter
    };
    scope?: {
        type: 'any_card' | 'cards_in_lane';
        laneSelection?: 'prompt';
    };
    // NEW: Destination - where the card goes (default: 'owner_hand')
    destination?: 'owner_hand' | 'actor_hand';  // 'actor_hand' for stealing (Assimilation-0)
    // Return this card itself
    returnSelf?: boolean;
    optional?: boolean;  // "You may return" vs "Return"
    // Advanced conditionals - effect only executes if condition is met
    advancedConditional?: {
        type: 'empty_hand' | 'opponent_higher_value_in_lane' | 'this_card_is_covered';
    };
}

/**
 * Redirect Return to Deck Effect Parameters
 * When a card would be returned to a player's hand, put it on their deck instead
 */
export interface RedirectReturnToDeckParams {
    action: 'redirect_return_to_deck';
    faceDown?: boolean;  // Put on deck face-down (default: true)
    targetOwner?: 'own' | 'opponent';  // Whose returned cards to intercept (default: opponent)
}

/**
 * Play Effect Parameters
 */
export interface PlayEffectParams {
    action: 'play';
    source: 'hand' | 'deck' | 'trash';  // 'trash' for Time-0
    count: number;  // 1-6
    faceDown: boolean;
    excludeSourceProtocol?: boolean;  // Diversity-0: Can only play cards that are NOT this card's protocol
    optional?: boolean;  // "You may play..."
    destinationRule: {
        type: 'other_lines' | 'specific_lane' | 'each_line_with_card' | 'under_this_card' | 'each_other_line' | 'line_with_matching_cards';
        excludeCurrentLane?: boolean;
        laneIndex?: number | 'current';  // For Gravity-6 "opponent plays in this line", 'current' = this card's lane
        ownerFilter?: 'own' | 'opponent' | 'any';  // Whose cards to check
        // Filter cards in lane by face state
        cardFilter?: {
            faceState: 'face_down' | 'face_up';
        };
    };
    // Conditional play
    condition?: {
        type: 'per_x_cards_in_line' | 'only_in_lines_with_cards' | 'per_x_face_down_cards';
        cardCount?: number;  // For 'per_x_cards_in_line' and 'per_x_face_down_cards' (e.g., 2 for "every 2 cards")
    };
    actor?: 'self' | 'opponent';  // Who plays (default: self)
    // NEW: Source owner - whose deck/trash to play from (default: 'own')
    sourceOwner?: 'own' | 'opponent';  // 'opponent' for Assimilation-2 (play from opponent's deck)
    // NEW: Target board - which board to play to (default: 'own')
    targetBoard?: 'own' | 'opponent';  // 'opponent' for Assimilation-6 (play on opponent's side)
    // Value filter for playing specific cards
    valueFilter?: {
        equals: number;  // Play only cards with this value
    };
    // Advanced conditionals - effect only executes if condition is met
    advancedConditional?: {
        type: 'empty_hand' | 'opponent_higher_value_in_lane';
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
        laneIndex: number | 'current';  // NEW: 'current' = lane where this card is located (Anarchy-3)
    };
}

/**
 * Reveal/Give Effect Parameters
 */
export interface RevealEffectParams {
    action: 'reveal' | 'give';
    source: 'own_hand' | 'opponent_hand' | 'board' | 'own_deck_top' | 'own_deck' | 'own_trash';  // 'own_trash' for Time-3
    count: number;  // 1-6 (or -1 for "entire hand" or "entire deck")
    followUpAction?: 'flip' | 'shift' | 'may_discard';  // NEW: 'may_discard' for Clarity-1 deck top reveal
    // NEW: For board card reveal (Light-2: "Reveal 1 face-down card. You may shift or flip that card.")
    targetFilter?: {
        owner?: TargetOwner;
        position?: TargetPosition;
        faceState?: TargetFaceState;
    };
    optional?: boolean;  // "You may shift or flip" = optional follow-up
    // NEW: Protocol filter for revealing all cards of same protocol (Unity-0 Bottom)
    protocolFilter?: {
        type: 'same_as_source';  // Reveal all cards matching source card's protocol
    };
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
            | 'allow_play_on_opponent_side'  // Corruption-0: Play on either player's side
            | 'require_non_matching_protocol' // Anarchy-1: Can only play non-matching
            | 'block_flips'                  // Frost-1: Cards can't be flipped face-up
            | 'block_protocol_rearrange'     // Frost-1: Protocols can't be rearranged
            | 'block_shifts_from_lane'       // Can't shift FROM this lane
            | 'block_shifts_to_lane'         // Can't shift TO this lane
            | 'block_shifts_from_and_to_lane' // Frost-3: Can't shift FROM or TO this lane
            | 'ignore_middle_commands'       // Apathy-2: Ignore middle effects in this lane
            | 'skip_check_cache_phase'       // Spirit-0: Skip check cache phase
            | 'block_flip_this_card'         // Ice-4: This card cannot be flipped
            | 'block_draw_conditional'       // Ice-6: Conditional draw blocking
            | 'allow_same_protocol_face_up_play';  // Unity-1 Bottom: Same-protocol cards may be played face-up
        target: 'self' | 'opponent' | 'all' | 'this_card';  // Who is affected (this_card = only this card)
        scope: 'this_lane' | 'global' | 'this_card';        // Where it applies (this_card = only this card)
        // NEW: Only active during card owner's turn (Fear-0: "During your turn...")
        onlyDuringYourTurn?: boolean;
        // NEW: For block_draw_conditional - flexible condition and target (Ice-6)
        conditionTarget?: 'self' | 'opponent';  // Who must have cards in hand?
        blockTarget?: 'self' | 'opponent' | 'all';  // Who cannot draw?
        // NEW: For allow_same_protocol_face_up_play - rule only applies to same-protocol cards (Unity-1)
        protocolScope?: 'same_as_source';  // Rule applies only to cards matching source card's protocol
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
                  | 'per_card'
                  | 'per_card_in_hand'    // Clarity-0: +1 per card in your hand
                  | 'per_opponent_card_in_lane'  // Mirror-0: +1 per opponent's card in this lane
                  | 'has_non_own_protocol_face_up';  // Diversity-3: Only if there are non-own-protocol face-up cards in this stack
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
 * Shuffle Trash Effect Parameters (Clarity-4)
 */
export interface ShuffleTrashEffectParams {
    action: 'shuffle_trash';
    optional: boolean;  // "You may shuffle" vs "Shuffle"
    // Advanced conditionals - effect only executes if condition is met
    advancedConditional?: {
        type: 'trash_not_empty';  // Time-2: Only if trash is not empty
    };
}

/**
 * Shuffle Deck Effect Parameters (Clarity-2/3)
 */
export interface ShuffleDeckEffectParams {
    action: 'shuffle_deck';
}

/**
 * State a Number Effect Parameters (Luck-0)
 * Player states a number (0-5) which can be used by subsequent effects
 */
export interface StateNumberEffectParams {
    action: 'state_number';
    numberSource: 'own_protocol_values';  // Flexibel: Zahlen aus eigenen Protokoll-Karten (0-5)
}

/**
 * State a Protocol Effect Parameters (Luck-3)
 * Player states a protocol which can be used by subsequent effects
 */
export interface StateProtocolEffectParams {
    action: 'state_protocol';
    protocolSource: 'opponent_cards';  // Flexibel: unique Protokolle aus Gegner-Karten
}

/**
 * Swap Stacks Effect Parameters (Mirror-2)
 * Swaps all cards between two of your own lanes
 */
export interface SwapStacksEffectParams {
    action: 'swap_stacks';
    target: 'own';  // Currently only supports own lanes (could be extended)
}

/**
 * Copy Opponent Middle Effect Parameters (Mirror-1)
 * Copies and executes an opponent's card's middle effects
 */
export interface CopyOpponentMiddleEffectParams {
    action: 'copy_opponent_middle';
    optional: boolean;  // "You may resolve..." vs "Resolve..."
}

/**
 * Auto Compile Effect Parameters (Diversity-0)
 * Marks the lane as compiled WITHOUT deleting cards - they stay on the board.
 * Used for conditional compile effects based on protocol diversity.
 */
export interface AutoCompileEffectParams {
    action: 'auto_compile';
    // Conditional: only compile if unique protocols >= threshold OR same-protocol count >= threshold
    protocolCountConditional?: {
        type: 'unique_protocols_on_field' | 'same_protocol_count_on_field';  // Unity-1: count same-protocol face-up cards
        threshold: number;  // Compile if count >= threshold
        faceState?: 'face_up';  // CRITICAL: For 'same_protocol_count_on_field' - only count face-up cards
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
    | ValueModifierParams
    | ShuffleTrashEffectParams
    | ShuffleDeckEffectParams
    | StateNumberEffectParams
    | StateProtocolEffectParams
    | SwapStacksEffectParams
    | CopyOpponentMiddleEffectParams
    | AutoCompileEffectParams;

/**
 * Effect Definition - Single effect with parameters
 */
export interface EffectDefinition {
    id: string;  // Unique identifier for this effect instance
    params: EffectParams;
    position: EffectPosition;
    trigger: EffectTrigger;
    conditional?: {
        type: 'if_you_do' | 'if_executed' | 'then' | 'if_protocol_matches_stated';  // Luck-3: conditional on protocol match
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
    // NEW: For reactive triggers - scope of the trigger (Ice-1 Bottom)
    // - 'global': Trigger regardless of which lane the action happened in (default)
    // - 'this_lane': Only trigger if the action happened in this card's lane
    reactiveScope?: 'global' | 'this_lane';
    // NEW: For reactive triggers - only trigger during opponent's turn (Peace-4)
    onlyDuringOpponentTurn?: boolean;
    // NEW: For on_cover triggers - only trigger if covered by same protocol (Unity-0 Bottom)
    onCoverProtocolRestriction?: 'same_protocol';  // Only trigger if covering card has same protocol
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
