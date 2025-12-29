/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Card } from "../data/cards";
// FIX: Export the Card type so it can be imported by other modules.
export type { Card };

export type Player = 'player' | 'opponent';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PlayedCard extends Card {
    id: string;
    isFaceUp: boolean;
    isRevealed?: boolean;
}

/**
 * EffectContext provides clear semantic context for card effects.
 * This helps distinguish between:
 * - cardOwner: Who owns the card (the "you" in card text)
 * - actor: Who is performing the current action (can differ during interrupts)
 * - currentTurn: Whose turn it is
 * - opponent: The opponent of the card owner
 *
 * Example: Psychic-3 (opponent's card) gets uncovered during player's turn
 * - cardOwner: 'opponent' (Psychic-3 belongs to opponent)
 * - actor: 'player' (player must discard because card text says "Your opponent discards...")
 * - currentTurn: 'player' (it's player's turn)
 * - opponent: 'player' (opponent of card owner)
 */
export type EffectContext = {
    cardOwner: Player;           // Wem gehört die Karte? (the "you" in card text)
    actor: Player;               // Wer führt die Aktion aus? (für Prompts und Queue)
    currentTurn: Player;         // Wessen Zug ist es?
    opponent: Player;            // Gegner des Kartenbesitzers
    triggerType?: 'play' | 'flip' | 'uncover' | 'start' | 'end' | 'cover' | 'middle' | 'on_cover' | 'compile' | 'oncover' | 'after'; // Wie wurde der Effekt ausgelöst?
    sourceCardId?: string;       // ID of the card that triggered this effect
    laneIndex?: number;          // Lane where the source card is located
    // NEW: For follow-up actions (useCardFromPreviousEffect)
    referencedCard?: PlayedCard; // Card selected by previous effect in chain
    referencedCardValue?: number; // Value of referenced card (for dynamic draw)
    // NEW: For dynamic draw counts
    discardedCount?: number;     // Number of cards discarded (for Fire-4, Plague-2)
    handSize?: number;           // Size of hand before action (for Chaos-4 End)
};

export interface PlayerStats {
    cardsPlayed: number;
    cardsDiscarded: number;
    cardsDeleted: number;
    cardsFlipped: number;
    cardsShifted: number;
    cardsDrawn: number;
    cardsReturned: number;  // NEW: Track returned cards
    handsRefreshed: number;
    protocolsCompiled?: number;  // Track protocols compiled via auto_compile
}

/** Detailed game statistics tracked during gameplay for permanent storage */
export interface DetailedGameStats {
    cardsPlayed: {
        playerFromHand: number;
        playerFromEffect: number;
        aiFromHand: number;
        aiFromEffect: number;
        playerFaceUp: number;
        playerFaceDown: number;
        aiFaceUp: number;
        aiFaceDown: number;
    };
    cardsDrawn: {
        playerFromRefresh: number;
        playerFromEffect: number;
        aiFromRefresh: number;
        aiFromEffect: number;
    };
    compiles: {
        playerFirstCompile: number;
        playerRecompile: number;
        aiFirstCompile: number;
        aiRecompile: number;
    };
    refreshes: {
        playerCardsDrawn: number;   // Sum of all cards drawn in player refreshes
        aiCardsDrawn: number;       // Sum of all cards drawn in AI refreshes
    };
}

export interface PlayerState {
    protocols: string[];
    deck: Card[];
    hand: PlayedCard[];
    lanes: PlayedCard[][];
    discard: Card[];  // Also serves as trash for deleted cards (Clarity-4: "shuffle your trash")
    compiled: boolean[];
    laneValues: number[];
    cannotCompile: boolean;
    stats: PlayerStats;
    deckRevealed?: boolean;  // Clarity-2/3: Deck is currently revealed
}

export type GamePhase = 'start' | 'control' | 'compile' | 'action' | 'hand_limit' | 'end';

// =============================================================================
// GENERIC TARGET FILTER - Used by all selection actions
// =============================================================================

/**
 * Generic target filter for card selection.
 * All selection actions use this to define valid targets.
 * AI and resolvers read these parameters directly.
 */
export interface TargetFilter {
    owner?: 'own' | 'opponent' | 'any';
    position?: 'covered' | 'uncovered' | 'any';
    faceState?: 'face_up' | 'face_down' | 'any';
    excludeSelf?: boolean;
    valueRange?: { min: number; max: number };
    valueEquals?: number;
    calculation?: 'highest_value' | 'lowest_value';
    valueMinGreaterThanHandSize?: boolean;  // Target must have value > hand size
}

/**
 * Scope definition for effects
 */
export interface EffectScope {
    type: 'anywhere' | 'this_lane' | 'other_lanes' | 'each_lane' | 'each_other_line';
    laneIndex?: number;
    minCardsInLane?: number;
}

/**
 * Destination restriction for shift effects
 */
export interface DestinationRestriction {
    type: 'any' | 'to_this_lane' | 'to_another_lane' | 'to_or_from_this_lane' | 'non_matching_protocol';
    laneIndex?: number | 'current';
}

// =============================================================================
// GENERIC ACTION REQUIRED TYPES
// =============================================================================

/**
 * ActionRequired - FULLY GENERIC
 *
 * All types use parameters from the effect definition.
 * NO card-specific types like 'select_card_to_delete_for_death_1'.
 * AI and resolvers read targetFilter, scope, destinationRestriction etc.
 */
export type ActionRequired =
// -----------------------------------------------------------------------------
// DISCARD ACTIONS
// -----------------------------------------------------------------------------
| {
    type: 'discard';
    actor: Player;
    count: number;
    sourceCardId?: string;
    variableCount?: boolean;  // "Discard 1 or more" (Fire-4, Plague-2)
    upTo?: boolean;           // "Discard up to X" (Hate-1)
    context?: EffectContext;
    sourceEffect?: string;    // Legacy: track which effect triggered discard
}

// -----------------------------------------------------------------------------
// GENERIC CARD SELECTION ACTIONS (with targetFilter)
// -----------------------------------------------------------------------------
| {
    type: 'select_cards_to_delete';
    actor: Player;
    sourceCardId: string;
    count: number;
    targetFilter?: TargetFilter;
    scope?: EffectScope;
    disallowedIds?: string[];  // Cards that cannot be selected
    laneIndex?: number;        // Source card's lane
    deleteSelf?: boolean;      // Delete source card after
    autoSelectHighest?: boolean;  // Auto-select highest value (Hate-2)
    autoSelectLowest?: boolean;   // Auto-select lowest value
}
| {
    type: 'select_card_to_flip';
    actor: Player;
    sourceCardId: string;
    count?: number;
    targetFilter?: TargetFilter;
    scope?: EffectScope;
    optional?: boolean;
    currentLaneIndex?: number;   // For scope: 'each_lane'
    remainingLanes?: number[];   // Lanes to process after
    draws?: number;              // Draw cards after flip
    followUpEffect?: any;        // Follow-up effect after flip
    params?: any;                // Store params for continuation
}
| {
    type: 'select_card_to_shift';
    actor: Player;
    sourceCardId: string;
    count?: number;
    targetFilter?: TargetFilter;
    destinationRestriction?: DestinationRestriction;
    scope?: EffectScope;
    optional?: boolean;
    currentLaneIndex?: number;
    remainingLanes?: number[];
    laneIndex?: number;          // Source card's lane
    params?: any;
}
| {
    type: 'select_card_to_return';
    actor: Player;
    sourceCardId: string;
    count?: number;
    targetFilter?: TargetFilter;
    scope?: EffectScope;
    optional?: boolean;
    laneIndex?: number;
}

// -----------------------------------------------------------------------------
// GENERIC LANE SELECTION ACTIONS (with parameters)
// -----------------------------------------------------------------------------
| {
    type: 'select_lane_for_shift';
    actor: Player;
    sourceCardId: string;
    cardToShiftId: string;
    cardOwner: Player;
    originalLaneIndex: number;
    destinationRestriction?: DestinationRestriction;
    sourceEffect?: string;    // Legacy: track which effect triggered shift
}
| {
    type: 'select_lane_for_shift_all';
    actor: Player;
    sourceCardId: string;
    sourceLaneIndex: number;
    targetFilter?: TargetFilter;  // Which cards to shift
    validLanes?: number[];
    cardsToShift?: string[];      // Legacy: pre-selected card IDs to shift
    validDestinationLanes?: number[];  // Legacy: allowed destination lanes
}
| {
    type: 'select_lane_for_delete';
    actor: Player;
    sourceCardId: string;
    deleteFilter?: {
        valueRange?: { min: number; max: number };
        faceState?: 'face_up' | 'face_down' | 'any';
        count?: number | 'all';
    };
    laneIndex?: number;          // Source lane (for exclusion)
    excludeSourceLane?: boolean;
}
| {
    type: 'select_lane_for_delete_all';
    actor: Player;
    sourceCardId: string;
    validLanes: number[];
    minCards: number;
    deleteFilter?: {
        calculation?: 'highest_value' | 'lowest_value';
    };
}
| {
    type: 'select_lane_for_play';
    actor: Player;
    sourceCardId: string;
    cardInHandId?: string;
    playFromSource?: 'hand' | 'deck';
    isFaceDown?: boolean;
    disallowedLaneIndex?: number;
    validLanes?: number[];
}
| {
    type: 'select_lane_for_return';
    actor: Player;
    sourceCardId: string;
    returnFilter?: {
        valueEquals?: number;
        count?: number | 'all';
    };
}
| {
    // Mirror-2: Swap stacks - select two lanes to swap cards between
    type: 'select_lanes_for_swap_stacks';
    actor: Player;
    sourceCardId: string;
    validLanes: number[];         // Lanes with cards (at least 2 required)
    selectedFirstLane?: number;   // First lane selected (undefined until first selection)
}
| {
    // Mirror-1: Select opponent's card to copy its middle effect
    type: 'select_card_for_copy_middle';
    actor: Player;
    sourceCardId: string;
    validTargetIds: string[];     // Opponent's face-up uncovered cards with middle effects
    optional: boolean;
}

// -----------------------------------------------------------------------------
// GENERIC PROMPT ACTIONS
// -----------------------------------------------------------------------------
| {
    type: 'prompt_optional_effect';
    actor: Player;
    sourceCardId: string;
    effectDef: any;
    context: EffectContext;
    optional?: boolean;
}
| {
    type: 'prompt_optional_discard_custom';
    actor: Player;
    sourceCardId: string;
    count: number;
    context?: EffectContext;
}
| {
    type: 'custom_choice';
    actor: Player;
    sourceCardId: string;
    options: any[];  // Array of effect options
    context?: EffectContext;
}

// -----------------------------------------------------------------------------
// STATE NUMBER/PROTOCOL (Luck Protocol)
// -----------------------------------------------------------------------------
| {
    type: 'state_number';
    actor: Player;
    sourceCardId: string;
    numberSource: 'own_protocol_values';  // Flexibel: Zahlen 0-5
}
| {
    type: 'state_protocol';
    actor: Player;
    sourceCardId: string;
    protocolSource: 'opponent_cards';  // Flexibel: Protokolle aus Gegner-Karten
    availableProtocols: string[];      // Vorberechnete Liste der wählbaren Protokolle
}
| {
    type: 'select_from_drawn_to_reveal';
    actor: Player;
    sourceCardId: string;
    drawnCardIds: string[];            // IDs der gezogenen Karten die den stated number Wert haben
    statedNumber: number;              // Der angesagte Wert
    thenAction?: 'may_play';           // Nach Reveal: optional spielen
}

// -----------------------------------------------------------------------------
// FLIP SELF (generic - no card-specific naming)
// -----------------------------------------------------------------------------
| {
    type: 'flip_self';
    actor: Player;
    sourceCardId: string;
}

// -----------------------------------------------------------------------------
// PROTOCOL MANIPULATION
// -----------------------------------------------------------------------------
| {
    type: 'prompt_rearrange_protocols';
    actor: Player;
    sourceCardId: string;
    target: Player;
    originalAction?: { type: 'compile'; laneIndex: number } | { type: 'fill_hand' } | { type: 'continue_turn', queuedSpeed2Actions?: ActionRequired[] } | { type: 'resume_interrupted_turn', interruptedTurn: Player, interruptedPhase: GamePhase, queuedSpeed2Actions?: ActionRequired[] };
    disallowedProtocolForLane?: { laneIndex: number; protocol: string };
}
| {
    type: 'prompt_swap_protocols';
    actor: Player;
    sourceCardId: string;
    target: Player;
    originalAction?: { type: 'compile'; laneIndex: number } | { type: 'fill_hand' };
}

// -----------------------------------------------------------------------------
// CONTROL MECHANIC
// -----------------------------------------------------------------------------
| {
    type: 'prompt_use_control_mechanic';
    actor: Player;
    sourceCardId: 'CONTROL_MECHANIC';
    originalAction: { type: 'compile'; laneIndex: number } | { type: 'fill_hand' } | { type: 'continue_turn', queuedSpeed2Actions?: ActionRequired[] } | { type: 'resume_interrupted_turn', interruptedTurn: Player, interruptedPhase: GamePhase, queuedSpeed2Actions?: ActionRequired[] };
}

// -----------------------------------------------------------------------------
// HAND CARD SELECTION (give, reveal, play from hand)
// -----------------------------------------------------------------------------
| {
    type: 'select_card_from_hand_to_play';
    actor: Player;
    sourceCardId: string;
    disallowedLaneIndex?: number;
    isFaceDown?: boolean;
}
| {
    type: 'select_card_from_hand_to_give';
    actor: Player;
    sourceCardId: string;
    sourceEffect?: string;  // Legacy: track which effect triggered this
}
| {
    type: 'select_card_from_hand_to_reveal';
    actor: Player;
    sourceCardId: string;
}

// -----------------------------------------------------------------------------
// REVEAL ACTIONS
// -----------------------------------------------------------------------------
| {
    type: 'reveal_opponent_hand';
    actor: Player;
    sourceCardId: string;
}
| {
    type: 'select_board_card_to_reveal';
    actor: Player;
    sourceCardId: string;
    targetFilter?: TargetFilter;
    followUpAction?: 'flip' | 'shift';
    optional?: boolean;
}
| {
    type: 'prompt_shift_or_flip_revealed_card';
    actor: Player;
    sourceCardId: string;
    revealedCardId: string;
    optional: boolean;
}
| {
    type: 'select_lane_to_shift_revealed_card';
    actor: Player;
    sourceCardId: string;
    revealedCardId: string;
}

// -----------------------------------------------------------------------------
// LEGACY COMPATIBILITY (to be removed after migration)
// These allow old card-specific types to work during transition
// -----------------------------------------------------------------------------
| {
    type: 'select_card_to_delete_for_death_1' | 'select_card_to_delete_for_anarchy_2' |
          'select_own_highest_card_to_delete_for_hate_2' | 'select_opponent_highest_card_to_delete_for_hate_2' |
          'select_face_down_card_to_reveal_for_light_2' | 'select_card_to_flip_for_fire_3' |
          'select_card_to_flip_for_light_0' | 'select_any_other_card_to_flip_for_water_0' |
          'select_covered_card_to_flip_for_chaos_0' | 'select_own_card_to_return_for_water_4' |
          'select_card_to_shift_for_anarchy_0' | 'select_card_to_shift_for_anarchy_1' |
          'select_card_to_shift_for_gravity_1' | 'select_card_to_flip_and_shift_for_gravity_2' |
          'select_face_down_card_to_shift_for_gravity_4' | 'select_face_down_card_to_shift_for_darkness_4' |
          'select_lane_for_death_2' | 'select_lane_for_life_3_play' |
          'select_lane_to_shift_revealed_card_for_light_2' | 'select_lane_to_shift_cards_for_light_3' |
          'select_lane_for_metal_3_delete' | 'flip_self_for_water_0' | 'flip_self_for_psychic_4' |
          'select_opponent_card_to_flip' | 'select_any_other_card_to_flip' |
          'select_opponent_face_up_card_to_flip' | 'select_own_face_up_covered_card_to_flip' |
          'select_covered_card_in_line_to_flip_optional' | 'select_any_card_to_flip_optional' |
          'select_any_face_down_card_to_flip_optional' | 'shift_flipped_card_optional' |
          'select_opponent_covered_card_to_shift' | 'select_own_covered_card_to_shift' |
          'select_any_opponent_card_to_shift' | 'select_own_other_card_to_shift' |
          'select_opponent_face_down_card_to_shift' | 'select_own_card_to_shift_for_speed_3' |
          'gravity_2_shift_after_flip' | 'speed_3_self_flip_after_shift' |
          'anarchy_0_conditional_draw' | 'execute_remaining_custom_effects' |
          'prompt_death_1_effect' | 'prompt_give_card_for_love_1' | 'prompt_fire_3_discard' |
          'prompt_shift_for_speed_3' | 'prompt_return_for_psychic_4' | 'prompt_spirit_1_start' |
          'prompt_shift_for_spirit_3' | 'plague_2_opponent_discard' | 'plague_4_player_flip_optional' |
          'select_cards_from_hand_to_discard_for_fire_4' | 'select_cards_from_hand_to_discard_for_hate_1' |
          'prompt_shift_or_flip_board_card_custom' | 'discard_completed' |
          'delete_self' | 'select_face_down_card_to_delete' | 'select_low_value_card_to_delete' |
          'select_card_from_other_lanes_to_delete' | 'plague_4_opponent_delete' |
          'select_opponent_card_to_return' | 'select_any_card_to_flip' |
          'prompt_shift_or_flip_for_light_2' | 'select_board_card_to_reveal_custom' |
          'plague_2_player_discard' | 'select_lane_to_shift_revealed_board_card_custom' |
          'select_lane_for_water_3' | 'prompt_optional_draw';
    actor: Player;
    sourceCardId?: string;
    [key: string]: any;  // Allow any additional properties for legacy compatibility
}

// -----------------------------------------------------------------------------
// PHASE EFFECT SELECTION (when multiple Start/End effects are available)
// -----------------------------------------------------------------------------
| {
    type: 'select_phase_effect';
    actor: Player;
    phase: 'Start' | 'End';
    availableEffects: Array<{
        cardId: string;
        cardName: string;
        box: 'top' | 'bottom';
        effectDescription: string;
    }>;
}

// -----------------------------------------------------------------------------
// CLARITY PROTOCOL - Deck reveal and selection
// -----------------------------------------------------------------------------
| {
    type: 'select_card_from_revealed_deck';
    actor: Player;
    sourceCardId: string;
    revealedCardIds: string[];
    selectAction: 'play' | 'discard' | 'return_to_deck';
    optional?: boolean;
}
| {
    type: 'confirm_deck_discard';
    actor: Player;
    sourceCardId: string;
    cardToDiscard: { id: string; protocol: string; value: number };
}
| {
    type: 'confirm_deck_play_preview';
    actor: Player;
    sourceCardId: string;
    cardToPlay: { id: string; protocol: string; value: number };
    laneIndex: number;
}
| {
    type: 'prompt_optional_shuffle_trash';
    actor: Player;
    sourceCardId: string;
}

// -----------------------------------------------------------------------------
// TIME PROTOCOL - Trash selection
// -----------------------------------------------------------------------------
| {
    type: 'select_card_from_trash_to_play';
    actor: Player;
    sourceCardId: string;
    trashOwner?: 'own' | 'opponent' | 'any';
    laneIndex?: number;
    validCardIndices?: number[];
}
| {
    type: 'select_card_from_trash_to_reveal';
    actor: Player;
    sourceCardId: string;
    trashOwner?: 'own' | 'opponent' | 'any';
    validCardIndices?: number[];
}

// -----------------------------------------------------------------------------
// INTERNAL EFFECT EXECUTION TYPES
// -----------------------------------------------------------------------------
| {
    type: 'execute_follow_up_effect';
    actor: Player;
    sourceCardId: string;
    effect: any;
    context: EffectContext;
}
| {
    type: 'execute_conditional_followup';
    actor: Player;
    sourceCardId: string;
    effect: any;
    context: EffectContext;
}
| {
    type: 'pending_uncover_effect';
    actor: Player;
    sourceCardId: string;
    card: PlayedCard;
    laneIndex: number;
}

// -----------------------------------------------------------------------------
// NULL (no action required)
// -----------------------------------------------------------------------------
| null;

// =============================================================================
// ANIMATION TYPES
// =============================================================================

export type AnimationState =
    | { type: 'playCard', cardId: string; owner: Player }
    | { type: 'compile', laneIndex: number }
    | { type: 'flipCard', cardId: string }
    | { type: 'deleteCard', cardId: string, owner: Player }
    | { type: 'drawCard', owner: Player, cardIds: string[] }
    | { type: 'discardCard', owner: Player, cardIds: string[], originalAction?: ActionRequired }
    | null;

// Card reference for log preview
export interface LogCardRef {
    protocol: string;
    value: number;
    owner: Player;
    isFaceUp: boolean;
}

export interface LogEntry {
    player: Player;
    message: string;
    indentLevel?: number;
    sourceCard?: string;
    phase?: 'start' | 'middle' | 'end' | 'uncover' | 'compile' | 'oncover';
    sourceCardRef?: LogCardRef;
    targetCardRefs?: LogCardRef[];
}

export interface GameState {
    player: PlayerState;
    opponent: PlayerState;
    turn: Player;
    phase: GamePhase;
    controlCardHolder: Player | null;
    useControlMechanic: boolean;
    winner: Player | null;
    log: LogEntry[];
    actionRequired: ActionRequired;
    queuedActions: ActionRequired[];
    queuedEffect?: { card: PlayedCard; laneIndex: number };
    animationState: AnimationState;
    compilableLanes: number[];
    processedStartEffectIds?: string[];
    processedEndEffectIds?: string[];
    // Phase Effect Snapshots - capture cards with Start/End triggers at phase begin
    // Only cards in these snapshots will have their phase effects executed
    _startPhaseEffectSnapshot?: Array<{
        cardId: string;
        box: 'top' | 'bottom';
        effectIds: string[];
    }>;
    _endPhaseEffectSnapshot?: Array<{
        cardId: string;
        box: 'top' | 'bottom';
        effectIds: string[];
    }>;
    // Selected phase effect ID - set by cardResolver when player chooses which effect to execute first
    _selectedStartEffectId?: string;
    _selectedEndEffectId?: string;
    processedSpeed1TriggerThisTurn?: boolean;
    processedUncoverEventIds?: string[];
    lastPlayedCardId?: string;
    lastCustomEffectTargetCardId?: string | null;
    /** Luck Protocol: Value of the last effect's target card (for dynamic value filters) */
    lastCustomEffectTargetValue?: number;
    /** Luck Protocol: The number stated by the player (0-5) */
    lastStatedNumber?: number;
    /** Luck Protocol: The protocol stated by the player */
    lastStatedProtocol?: string;
    /** Mirror Protocol: Lane index of the last flipped card (for sameLaneAsFirst constraint) */
    lastFlipLaneIndex?: number;
    /** Luck Protocol: Skip middle command for the next flip of this card ID */
    skipNextMiddleCommand?: string;
    _interruptedTurn?: Player;
    _interruptedPhase?: GamePhase;
    _logIndentLevel?: number;
    _currentEffectSource?: string;
    _currentPhaseContext?: 'start' | 'middle' | 'end' | 'uncover' | 'compile' | 'oncover' | 'after';
    /** Clean effect chain management - replaces scattered followUpEffect/outerSourceCardId/etc. */
    effectChain?: import('../logic/effectChain').EffectChain;
    stats: {
        player: PlayerStats,
        opponent: PlayerStats,
    };
    /** Detailed stats tracked during gameplay for breakdown (player vs AI, source, etc.) */
    detailedGameStats?: DetailedGameStats;
    /** Card that is currently committed (being played, not yet landed) - for rules compliance */
    _committedCardId?: string;
    /** AI Double-Play Prevention - set when AI plays a card, cleared when phase changes */
    _cardPlayedThisActionPhase?: boolean;
    /** Deferred parent effects stack - stores parent effects when child effects are executing
     *  This ensures correct effect chain order: Child completes ALL effects → Parent resumes
     *  Example: Smoke-1 (flip + shift) flips Test-1 (delete + delete + flip)
     *  Smoke-1's shift is deferred until Test-1's ALL effects complete */
    _deferredParentEffects?: any[];
    /** Custom protocol effects pending execution */
    _pendingCustomEffects?: any[];
    /** Suspended queued actions during effect execution */
    _suspendedQueuedActions?: ActionRequired[];
    /**
     * AI Card Memory - Tracks known values of face-down cards
     * Key: cardId, Value: known card value (0-6)
     * Updated when:
     * - AI plays a card face-down (AI knows its own cards)
     * - A face-up card is flipped to face-down (value is remembered)
     * - A card is revealed (value is learned)
     */
    aiCardMemory?: Record<string, number>;
}

// =============================================================================
// AI ACTION TYPES (generic - no card-specific actions)
// =============================================================================

export type AIAction =
    | { type: 'playCard'; cardId: string; laneIndex: number; isFaceUp: boolean; }
    | { type: 'fillHand'; }
    | { type: 'discardCards'; cardIds: string[]; }
    | { type: 'compile', laneIndex: number; }
    | { type: 'deleteCard', cardId: string }
    | { type: 'flipCard', cardId: string }
    | { type: 'returnCard', cardId: string }
    | { type: 'shiftCard', cardId: string }
    | { type: 'selectLane', laneIndex: number }
    | { type: 'skip' }
    | { type: 'giveCard', cardId: string }
    | { type: 'revealCard', cardId: string }
    | { type: 'rearrangeProtocols', newOrder: string[] }
    | { type: 'resolveSwapProtocols', indices: [number, number] }
    | { type: 'resolveControlMechanicPrompt', choice: 'player' | 'opponent' | 'skip' }
    | { type: 'resolveOptionalEffectPrompt', accept: boolean }
    | { type: 'resolveOptionalDiscardCustomPrompt', accept: boolean }
    | { type: 'resolveCustomChoice', optionIndex: number }
    | { type: 'resolveRevealBoardCardPrompt', choice: 'shift' | 'flip' | 'skip' }
    | { type: 'resolvePrompt', accept: boolean }  // Generic prompt resolution
    // Generic card selection
    | { type: 'selectCard', cardId: string }  // Generic card selection for various prompts
    // Luck Protocol actions
    | { type: 'stateNumber', number: number }
    | { type: 'stateProtocol', protocol: string }
    | { type: 'selectFromDrawnToReveal', cardId: string }
    | { type: 'confirmDeckDiscard' }
    | { type: 'confirmDeckPlayPreview' }
    // Clarity Protocol actions
    | { type: 'selectRevealedDeckCard', cardId: string }
    // Time Protocol actions
    | { type: 'selectTrashCard', cardIndex: number }
    // Shuffle trash prompt
    | { type: 'resolveShuffleTrashPrompt', accept: boolean };

// =============================================================================
// ANIMATION REQUEST TYPES
// =============================================================================

export type AnimationRequest =
    | { type: 'delete'; cardId: string; owner: Player }
    | { type: 'flip'; cardId: string; owner?: Player; laneIndex?: number }
    | { type: 'shift'; cardId: string; fromLane: number; toLane: number; owner: Player }
    | { type: 'return'; cardId: string; owner: Player }
    | { type: 'discard'; cardId: string; owner: Player }
    | { type: 'play'; cardId: string; owner: Player; toLane?: number; fromDeck?: boolean; isFaceUp?: boolean }
    | { type: 'draw'; player: Player; count: number }
    | {
        type: 'compile_delete';
        laneIndex: number;
        deletedCards: Array<{cardId: string; owner: Player}>
    };

export type EffectResult = {
    newState: GameState;
    animationRequests?: AnimationRequest[];
};
