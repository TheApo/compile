/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlayedCard, Player, ActionRequired } from './index';

// =============================================================================
// ANIMATION TYPE DEFINITIONS
// =============================================================================

/**
 * All possible animation types in the game.
 * Each type corresponds to a specific visual transition.
 */
export type AnimationType =
    | 'play'      // Card moves from hand/deck to a lane
    | 'delete'    // Card moves to trash (deleted from board)
    | 'flip'      // Card flips face-up/face-down
    | 'shift'     // Card moves from one lane to another
    | 'return'    // Card returns from board to hand
    | 'discard'   // Card moves from hand to trash
    | 'draw'      // Card(s) move from deck to hand
    | 'compile'   // Lane compiles (multiple cards to trash + protocol glow)
    | 'give'      // Card moves from one player's hand to opponent's hand
    | 'reveal'    // Card is briefly shown (then flipped back or kept)
    | 'swap'      // Protocols swap positions
    | 'refresh';  // Hand is refilled (multiple draws)

// =============================================================================
// CARD POSITION TYPES
// =============================================================================

/**
 * Represents a card's position on the game board.
 * Used to calculate animation start/end points.
 */
export type CardPosition =
    | { type: 'lane'; owner: Player; laneIndex: number; cardIndex: number }
    | { type: 'hand'; owner: Player; handIndex: number }
    | { type: 'deck'; owner: Player }
    | { type: 'trash'; owner: Player }
    | { type: 'offscreen' };  // For cards entering/leaving the visible area

// =============================================================================
// ANIMATING CARD
// =============================================================================

/**
 * Represents a card that is being animated, with its movement data.
 */
export interface AnimatingCard {
    card: PlayedCard;              // The card being animated
    fromPosition: CardPosition;    // Starting position
    toPosition: CardPosition;      // Ending position
    flipDirection?: 'toFaceUp' | 'toFaceDown'; // For flip animations
    targetIsFaceUp?: boolean;      // For play animations: how the card should be displayed at destination
}

/**
 * For compile animations with multiple cards
 */
export interface CompileAnimatingCard {
    card: PlayedCard;
    owner: Player;
    startDelay: number;  // Staggered delay: 0, 75, 150, 225ms...
}

// =============================================================================
// VISUAL SNAPSHOT
// =============================================================================

/**
 * A lightweight snapshot of the game state for rendering animations.
 * Contains ONLY the data needed for visual representation.
 * Does NOT include: deck contents, log, processed effect IDs, etc.
 */
export interface VisualSnapshot {
    player: PlayerVisualState;
    opponent: PlayerVisualState;
    controlCardHolder: Player | null;
}

/**
 * Visual state for a single player.
 * Contains only what's needed to render the board.
 */
export interface PlayerVisualState {
    protocols: string[];           // Protocol names (for protocol bars)
    compiled: boolean[];           // Which protocols are compiled
    laneValues: number[];          // Lane values (for display)
    lanes: PlayedCard[][];         // Cards on the board (all lanes)
    hand: PlayedCard[];            // Cards in hand
    deckCount: number;             // Number of cards in deck (for deck display)
    trashCount: number;            // Number of cards in trash
    topTrashCard?: PlayedCard;     // Top card of trash (for animation targets)
}

// =============================================================================
// ANIMATION QUEUE ITEM
// =============================================================================

/**
 * A single item in the animation queue.
 * Contains all information needed to render one animation.
 */
export interface AnimationQueueItem {
    id: string;                    // Unique ID for debugging/tracking
    type: AnimationType;           // Type of animation
    snapshot: VisualSnapshot;      // Visual state BEFORE the animation
    duration: number;              // Animation duration in milliseconds

    // The card(s) being animated
    animatingCard?: AnimatingCard;           // For single-card animations
    animatingCards?: CompileAnimatingCard[]; // For multi-card animations (compile)

    // Optional: For complex scenarios
    pauseAfter?: boolean;                    // Queue pauses after this animation
    requiresUserInput?: ActionRequired;      // User input needed after animation

    // Additional data for specific animations
    laneIndex?: number;            // For compile: which lane is compiling
    protocolSwap?: {               // For swap: which protocols are swapping
        indices: [number, number];
        target: Player;
    };
}

// =============================================================================
// ANIMATION QUEUE CONTEXT
// =============================================================================

/**
 * The context value for the AnimationQueue.
 * Provides queue state and methods to enqueue/complete animations.
 */
export interface AnimationQueueContextValue {
    // Current state
    queue: AnimationQueueItem[];
    isAnimating: boolean;
    currentAnimation: AnimationQueueItem | null;

    // Methods for game logic to enqueue animations
    enqueueAnimation: (item: Omit<AnimationQueueItem, 'id'>) => void;
    enqueueAnimations: (items: Omit<AnimationQueueItem, 'id'>[]) => void;

    // Methods for animation renderer
    onAnimationComplete: () => void;

    // Debug/Testing methods
    skipCurrentAnimation: () => void;
    skipAllAnimations: () => void;
    clearQueue: () => void;
}

// =============================================================================
// ANIMATION TIMING
// =============================================================================

/**
 * Default animation durations in milliseconds.
 * Can be overridden per-animation if needed.
 */
export const DEFAULT_ANIMATION_DURATIONS: Record<AnimationType, number> = {
    play: 400,
    delete: 400,
    flip: 300,
    shift: 500,
    return: 400,
    discard: 300,
    draw: 300,
    compile: 800,
    give: 500,
    reveal: 600,
    swap: 400,
    refresh: 500,
};

/**
 * Stagger delay between cards in multi-card animations.
 */
export const STAGGER_DELAY = 75; // ms between cards
