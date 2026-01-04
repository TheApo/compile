/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Animation Helper Functions
 *
 * Factory functions for creating AnimationQueueItems.
 * Each helper takes the current game state and relevant parameters,
 * then creates a properly structured animation item with snapshot.
 */

import { GameState, Player, PlayedCard, GamePhase, AnimationRequest } from '../../types';
import {
    AnimationQueueItem,
    AnimationType,
    CardPosition,
    AnimatingCard,
    CompileAnimatingCard,
    MultiAnimatingCard,
    PhaseTransitionData,
} from '../../types/animation';
import { createVisualSnapshot } from '../../utils/snapshotUtils';
import {
    ANIMATION_DURATIONS,
    COMPILE_STAGGER_DELAY,
    COMPILE_DELETE_DURATION,
    getCardStartDelay,
    TOTAL_DRAW_ANIMATION_DURATION,
    calculateDrawDuration,
    calculateDrawStagger,
    PHASE_TRANSITION_DURATION,
} from '../../constants/animationTiming';

// =============================================================================
// UNIQUE ID GENERATOR
// =============================================================================

let animationIdCounter = 0;

function generateAnimationId(type: AnimationType): string {
    return `${type}-${Date.now()}-${++animationIdCounter}`;
}

// =============================================================================
// CARD LOCATION HELPERS
// =============================================================================

/**
 * Finds a card's position in a player's lanes.
 * Returns null if not found.
 */
export function findCardInLanes(
    state: GameState,
    cardId: string,
    owner: Player
): { laneIndex: number; cardIndex: number } | null {
    const playerState = state[owner];

    for (let laneIndex = 0; laneIndex < playerState.lanes.length; laneIndex++) {
        const lane = playerState.lanes[laneIndex];
        const cardIndex = lane.findIndex(c => c.id === cardId);
        if (cardIndex !== -1) {
            return { laneIndex, cardIndex };
        }
    }

    return null;
}

/**
 * Finds a card's position in a player's hand.
 * Returns the index or -1 if not found.
 */
export function findCardInHand(
    state: GameState,
    cardId: string,
    owner: Player
): number {
    return state[owner].hand.findIndex(c => c.id === cardId);
}

/**
 * Gets the card object by ID from any location in the game state.
 */
export function getCardById(
    state: GameState,
    cardId: string
): { card: PlayedCard; owner: Player; location: 'hand' | 'lane' | 'deck' | 'discard' } | null {
    // Check player's areas
    for (const owner of ['player', 'opponent'] as Player[]) {
        const playerState = state[owner];

        // Check hand
        const handCard = playerState.hand.find(c => c.id === cardId);
        if (handCard) return { card: handCard, owner, location: 'hand' };

        // Check lanes
        for (const lane of playerState.lanes) {
            const laneCard = lane.find(c => c.id === cardId);
            if (laneCard) return { card: laneCard, owner, location: 'lane' };
        }

        // Note: deck and discard use Card[] type without IDs, so we can't search them by ID
        // Cards only get IDs when they become PlayedCards (in hand or on lanes)
    }

    return null;
}

// =============================================================================
// ANIMATION FACTORY FUNCTIONS
// =============================================================================

/**
 * Creates a PLAY animation - card moves from hand or deck to a lane.
 *
 * @param state - Current game state (used for snapshot)
 * @param card - The card being played
 * @param owner - Who is playing the card ('player' or 'opponent')
 * @param toLaneIndex - Which lane the card is being played to
 * @param fromHand - Whether the card comes from hand (true) or deck (false)
 * @param handIndex - The card's position in hand (required if fromHand is true)
 * @param isFaceUp - Whether the card is played face-up (default: true)
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createPlayAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    toLaneIndex: number,
    fromHand: boolean = true,
    handIndex?: number,
    isFaceUp: boolean = true,
    isOpponentAction: boolean = false
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    // Calculate destination position (top of lane)
    const toCardIndex = state[owner].lanes[toLaneIndex].length;

    const fromPosition: CardPosition = fromHand
        ? { type: 'hand', owner, handIndex: handIndex ?? 0 }
        : { type: 'deck', owner };

    const toPosition: CardPosition = {
        type: 'lane',
        owner,
        laneIndex: toLaneIndex,
        cardIndex: toCardIndex,
    };

    return {
        id: generateAnimationId('play'),
        type: 'play',
        snapshot,
        duration: ANIMATION_DURATIONS.play,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
            targetIsFaceUp: isFaceUp,  // Pass through the face-up state
            isOpponentAction,
        },
        laneIndex: toLaneIndex,
    };
}

/**
 * Creates a DELETE animation - card moves from lane to trash.
 *
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createDeleteAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number,
    isOpponentAction: boolean = false
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    const fromPosition: CardPosition = {
        type: 'lane',
        owner,
        laneIndex,
        cardIndex,
    };

    const toPosition: CardPosition = {
        type: 'trash',
        owner,
    };

    return {
        id: generateAnimationId('delete'),
        type: 'delete',
        snapshot,
        duration: ANIMATION_DURATIONS.delete,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
            targetRotation: 90,  // Both: player ends at 90°, opponent ends at 270° (=-90°) because baseRotation=180
            isOpponentAction,
        },
        laneIndex,
    };
}

/**
 * Creates a FLIP animation - card flips to reveal or hide.
 */
export function createFlipAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number,
    toFaceUp: boolean
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    const position: CardPosition = {
        type: 'lane',
        owner,
        laneIndex,
        cardIndex,
    };

    return {
        id: generateAnimationId('flip'),
        type: 'flip',
        snapshot,
        duration: ANIMATION_DURATIONS.flip,
        animatingCard: {
            card,
            fromPosition: position,
            toPosition: position,
            flipDirection: toFaceUp ? 'toFaceUp' : 'toFaceDown',
        },
        laneIndex,
    };
}

/**
 * Creates a SHIFT animation - card moves from one lane to another.
 *
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createShiftAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    fromLaneIndex: number,
    fromCardIndex: number,
    toLaneIndex: number,
    isOpponentAction: boolean = false
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    // Calculate destination card index (top of target lane)
    const toCardIndex = state[owner].lanes[toLaneIndex].length;

    const fromPosition: CardPosition = {
        type: 'lane',
        owner,
        laneIndex: fromLaneIndex,
        cardIndex: fromCardIndex,
    };

    const toPosition: CardPosition = {
        type: 'lane',
        owner,
        laneIndex: toLaneIndex,
        cardIndex: toCardIndex,
    };

    return {
        id: generateAnimationId('shift'),
        type: 'shift',
        snapshot,
        duration: ANIMATION_DURATIONS.shift,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
            isOpponentAction,
        },
        laneIndex: fromLaneIndex,
    };
}

/**
 * Creates a RETURN animation - card moves from lane back to hand.
 *
 * @param state - Current game state (used for snapshot)
 * @param card - The card being returned
 * @param owner - Who owns the card ('player' or 'opponent')
 * @param laneIndex - The lane the card is returning from
 * @param cardIndex - The card's position in the lane
 * @param setFaceDown - Whether to flip the card face-down (default: true)
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createReturnAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number,
    setFaceDown: boolean = true,
    isOpponentAction: boolean = false
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    const fromPosition: CardPosition = {
        type: 'lane',
        owner,
        laneIndex,
        cardIndex,
    };

    // Return to end of hand
    const toPosition: CardPosition = {
        type: 'hand',
        owner,
        handIndex: state[owner].hand.length,
    };

    return {
        id: generateAnimationId('return'),
        type: 'return',
        snapshot,
        duration: ANIMATION_DURATIONS.return,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
            // NO flipDirection - card stays as it was on the field during animation
            // The card's isFaceUp property already reflects its state on the board
            // The actual face-down state on hand is handled by the game state update
            targetIsFaceUp: card.isFaceUp,
            isOpponentAction,
        },
        laneIndex,
    };
}

/**
 * Creates a DISCARD animation - card moves from hand to trash.
 *
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createDiscardAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    handIndex: number,
    isOpponentAction: boolean = false
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    const fromPosition: CardPosition = {
        type: 'hand',
        owner,
        handIndex,
    };

    const toPosition: CardPosition = {
        type: 'trash',
        owner,
    };

    return {
        id: generateAnimationId('discard'),
        type: 'discard',
        snapshot,
        duration: ANIMATION_DURATIONS.discard,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
            targetRotation: 90,  // Both: player ends at 90°, opponent ends at 270° (=-90°) because baseRotation=180
            isOpponentAction,
        },
    };
}

/**
 * Creates a DRAW animation - card moves from deck to hand.
 *
 * @param state - Current game state (used for snapshot)
 * @param card - The card being drawn
 * @param owner - Who is drawing the card ('player' or 'opponent')
 * @param targetHandIndex - The card's target position in hand
 * @param customDuration - Optional custom duration (for dynamic timing with multiple draws)
 * @param startDelay - Optional start delay (for staggered multi-card draws)
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createDrawAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    targetHandIndex: number,
    customDuration?: number,
    startDelay?: number,
    isOpponentAction: boolean = false
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    const fromPosition: CardPosition = {
        type: 'deck',
        owner,
    };

    const toPosition: CardPosition = {
        type: 'hand',
        owner,
        handIndex: targetHandIndex,
    };

    return {
        id: generateAnimationId('draw'),
        type: 'draw',
        snapshot,
        duration: customDuration ?? ANIMATION_DURATIONS.draw,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
            startDelay: startDelay ?? 0,
            isOpponentAction,
        },
    };
}

/**
 * Creates a MULTI-DRAW animation - multiple cards fly from deck to hand SEQUENTIALLY.
 * Each card has its own animation with a snapshot showing previously landed cards.
 * This creates a visual effect of cards appearing one by one on the hand.
 *
 * @param state - Current game state BEFORE drawing (used for initial snapshot)
 * @param cards - Array of cards being drawn
 * @param owner - Who is drawing the cards ('player' or 'opponent')
 * @param startingHandIndex - The first card's target position in hand
 * @returns Array of animations to be enqueued sequentially
 */
export function createMultiDrawAnimation(
    state: GameState,
    cards: PlayedCard[],
    owner: Player,
    startingHandIndex: number
): AnimationQueueItem {
    // For backwards compatibility, return the first card's animation
    // The caller should use createSequentialDrawAnimations for proper one-by-one effect
    const animations = createSequentialDrawAnimations(state, cards, owner, startingHandIndex);
    return animations[0] || createDrawAnimation(state, cards[0], owner, startingHandIndex);
}

/**
 * Creates SEQUENTIAL draw animations - each card gets its own animation with proper snapshot.
 * Each animation shows only the cards that have already landed on the hand.
 *
 * @param state - Current game state BEFORE drawing
 * @param cards - Array of cards being drawn
 * @param owner - Who is drawing the cards ('player' or 'opponent')
 * @param startingHandIndex - The first card's target position in hand
 * @returns Array of animations to be enqueued
 */
export function createSequentialDrawAnimations(
    state: GameState,
    cards: PlayedCard[],
    owner: Player,
    startingHandIndex: number
): AnimationQueueItem[] {
    // Calculate per-card duration from total draw time
    // 5 cards = 1200ms total = 240ms per card
    const cardCount = cards.length;
    const SINGLE_CARD_DURATION = Math.max(100, Math.floor(TOTAL_DRAW_ANIMATION_DURATION / cardCount));

    return cards.map((card, index) => {
        // Create a snapshot that includes cards that have already "landed"
        // For card 0: snapshot = original state (0 new cards on hand)
        // For card 1: snapshot = state + card 0 on hand
        // etc.
        const previousCards = cards.slice(0, index);
        const snapshotState = {
            ...state,
            [owner]: {
                ...state[owner],
                hand: [...state[owner].hand, ...previousCards],
            },
        };
        const snapshot = createVisualSnapshot(snapshotState);

        return {
            id: generateAnimationId('draw'),
            type: 'draw' as AnimationType,
            snapshot,
            duration: SINGLE_CARD_DURATION,
            animatingCard: {
                card,
                fromPosition: { type: 'deck' as const, owner },
                toPosition: { type: 'hand' as const, owner, handIndex: startingHandIndex + index },
            },
        };
    });
}

/**
 * Creates a COMPILE animation - all cards in a lane go to trash with glow effect.
 */
export function createCompileAnimation(
    state: GameState,
    owner: Player,
    laneIndex: number
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    const lane = state[owner].lanes[laneIndex];

    // Create staggered animation for each card in the lane
    const animatingCards: CompileAnimatingCard[] = lane.map((card, index) => ({
        card,
        owner,
        startDelay: getCardStartDelay(index, COMPILE_STAGGER_DELAY),
    }));

    return {
        id: generateAnimationId('compile'),
        type: 'compile',
        snapshot,
        duration: ANIMATION_DURATIONS.compile,
        laneIndex,
        animatingCards,
    };
}

/**
 * Creates sequential DELETE animations for compile.
 * Each card gets its own delete animation with staggered timing.
 *
 * @param state - Game state BEFORE the compile (for snapshot)
 * @param deletedCards - Array of cards that were deleted with their positions
 * @returns Array of AnimationQueueItems for sequential playback
 */
export function createCompileDeleteAnimations(
    state: GameState,
    deletedCards: { card: PlayedCard; owner: Player; laneIndex: number; cardIndex: number }[]
): AnimationQueueItem[] {
    const snapshot = createVisualSnapshot(state);

    return deletedCards.map((item, index) => {
        const fromPosition: CardPosition = {
            type: 'lane',
            owner: item.owner,
            laneIndex: item.laneIndex,
            cardIndex: item.cardIndex,
        };

        const toPosition: CardPosition = {
            type: 'trash',
            owner: item.owner,
        };

        return {
            id: generateAnimationId('delete'),
            type: 'delete' as AnimationType,
            snapshot,
            duration: COMPILE_DELETE_DURATION,
            animatingCard: {
                card: item.card,
                fromPosition,
                toPosition,
                targetRotation: 90,
                startDelay: index * COMPILE_DELETE_DURATION,
            },
            laneIndex: item.laneIndex,
        };
    });
}

/**
 * Creates a GIVE animation - card moves from own hand to opponent's hand.
 */
export function createGiveAnimation(
    state: GameState,
    card: PlayedCard,
    fromOwner: Player,
    handIndex: number
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);
    const toOwner: Player = fromOwner === 'player' ? 'opponent' : 'player';

    const fromPosition: CardPosition = {
        type: 'hand',
        owner: fromOwner,
        handIndex,
    };

    const toPosition: CardPosition = {
        type: 'hand',
        owner: toOwner,
        handIndex: state[toOwner].hand.length,
    };

    return {
        id: generateAnimationId('give'),
        type: 'give',
        snapshot,
        duration: ANIMATION_DURATIONS.give,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
        },
    };
}

/**
 * Creates a REVEAL animation - card is briefly shown (e.g., from hand).
 */
export function createRevealAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    location: 'hand' | 'lane',
    handIndexOrLaneInfo: number | { laneIndex: number; cardIndex: number }
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    let position: CardPosition;

    if (location === 'hand') {
        position = {
            type: 'hand',
            owner,
            handIndex: handIndexOrLaneInfo as number,
        };
    } else {
        const info = handIndexOrLaneInfo as { laneIndex: number; cardIndex: number };
        position = {
            type: 'lane',
            owner,
            laneIndex: info.laneIndex,
            cardIndex: info.cardIndex,
        };
    }

    return {
        id: generateAnimationId('reveal'),
        type: 'reveal',
        snapshot,
        duration: ANIMATION_DURATIONS.reveal,
        animatingCard: {
            card,
            fromPosition: position,
            toPosition: position,
            flipDirection: 'toFaceUp',
        },
    };
}

/**
 * Creates a SWAP animation - protocols swap positions (visual indicator).
 */
export function createSwapAnimation(
    state: GameState,
    owner: Player,
    laneIndex1: number,
    laneIndex2: number
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    return {
        id: generateAnimationId('swap'),
        type: 'swap',
        snapshot,
        duration: ANIMATION_DURATIONS.swap,
        // Swap animations don't have a single animating card
        // The snapshot renderer will handle showing the swap
    };
}

/**
 * Creates multiple DRAW animations for a REFRESH action (hand refill).
 * Returns an array of draw animations with staggered delays.
 */
export function createRefreshAnimations(
    state: GameState,
    drawnCards: PlayedCard[],
    owner: Player
): AnimationQueueItem[] {
    const animations: AnimationQueueItem[] = [];

    for (let i = 0; i < drawnCards.length; i++) {
        const snapshot = createVisualSnapshot(state);

        animations.push({
            id: generateAnimationId('refresh'),
            type: 'refresh',
            snapshot,
            duration: ANIMATION_DURATIONS.refresh,
            animatingCard: {
                card: drawnCards[i],
                fromPosition: { type: 'deck', owner },
                toPosition: {
                    type: 'hand',
                    owner,
                    handIndex: state[owner].hand.length + i,
                },
            },
        });
    }

    return animations;
}

// =============================================================================
// BATCH ANIMATION HELPERS
// =============================================================================

/**
 * Creates animations for multiple deletes (e.g., from a lane clear effect).
 */
export function createBatchDeleteAnimations(
    state: GameState,
    cards: Array<{ card: PlayedCard; owner: Player; laneIndex: number; cardIndex: number }>
): AnimationQueueItem[] {
    return cards.map((item, index) => {
        const snapshot = createVisualSnapshot(state);

        return {
            id: generateAnimationId('delete'),
            type: 'delete' as AnimationType,
            snapshot,
            duration: ANIMATION_DURATIONS.delete,
            animatingCard: {
                card: item.card,
                fromPosition: {
                    type: 'lane',
                    owner: item.owner,
                    laneIndex: item.laneIndex,
                    cardIndex: item.cardIndex,
                },
                toPosition: {
                    type: 'trash',
                    owner: item.owner,
                },
                targetRotation: 90,  // Both: player ends at 90°, opponent ends at 270° (=-90°) because baseRotation=180
            },
            laneIndex: item.laneIndex,
        };
    });
}

/**
 * Creates animations for multiple discards (old batch style - same snapshot for all).
 * @deprecated Use createSequentialDiscardAnimations for proper one-by-one effect
 */
export function createBatchDiscardAnimations(
    state: GameState,
    cards: Array<{ card: PlayedCard; owner: Player; handIndex: number }>
): AnimationQueueItem[] {
    return cards.map((item) => {
        const snapshot = createVisualSnapshot(state);

        return {
            id: generateAnimationId('discard'),
            type: 'discard' as AnimationType,
            snapshot,
            duration: ANIMATION_DURATIONS.discard,
            animatingCard: {
                card: item.card,
                fromPosition: {
                    type: 'hand',
                    owner: item.owner,
                    handIndex: item.handIndex,
                },
                toPosition: {
                    type: 'trash',
                    owner: item.owner,
                },
                targetRotation: 90,  // Both: player ends at 90°, opponent ends at 270° (=-90°) because baseRotation=180
            },
        };
    });
}

/**
 * Creates SEQUENTIAL discard animations - each card gets its own animation with proper snapshot.
 * Each animation shows the hand state BEFORE that card was discarded.
 * Total animation time is the same as a single discard (cards animate quickly in sequence).
 *
 * @param state - Current game state BEFORE discarding
 * @param cards - Array of cards to discard (in order)
 * @param owner - Who is discarding the cards ('player' or 'opponent')
 * @returns Array of animations to be enqueued
 */
export function createSequentialDiscardAnimations(
    state: GameState,
    cards: PlayedCard[],
    owner: Player
): AnimationQueueItem[] {
    const cardCount = cards.length;
    // Fast per-card duration so total time ≈ single discard time
    const SINGLE_CARD_DURATION = Math.max(100, Math.floor(ANIMATION_DURATIONS.discard / cardCount));

    return cards.map((card, index) => {
        // Create a snapshot that excludes cards already discarded (previous cards in array)
        const previouslyDiscardedIds = new Set(cards.slice(0, index).map(c => c.id));
        const handAfterPreviousDiscards = state[owner].hand.filter(c => !previouslyDiscardedIds.has(c.id));

        // Find handIndex of this card in the current (filtered) hand
        const handIndex = handAfterPreviousDiscards.findIndex(c => c.id === card.id);

        const snapshotState = {
            ...state,
            [owner]: {
                ...state[owner],
                hand: handAfterPreviousDiscards,
            },
        };
        const snapshot = createVisualSnapshot(snapshotState);

        return {
            id: generateAnimationId('discard'),
            type: 'discard' as AnimationType,
            snapshot,
            duration: SINGLE_CARD_DURATION,
            animatingCard: {
                card,
                fromPosition: {
                    type: 'hand' as const,
                    owner,
                    handIndex: handIndex >= 0 ? handIndex : 0,
                },
                toPosition: {
                    type: 'trash' as const,
                    owner,
                },
                targetRotation: 90,
            },
        };
    });
}

// =============================================================================
// PHASE TRANSITION ANIMATION
// =============================================================================

/**
 * All phases in order for phase transition animations.
 */
const ALL_PHASES: GamePhase[] = ['start', 'control', 'compile', 'action', 'hand_limit', 'end'];

/**
 * Creates a phase transition animation for turn changes.
 * Animates through all remaining phases of the old turn, then to 'start' of the new turn.
 *
 * @param prevState - The game state BEFORE the turn change (used for snapshot)
 * @param fromPhase - The phase where the previous turn was (before turn change)
 * @param fromTurn - The player whose turn is ending
 * @param toTurn - The player whose turn is starting
 * @returns AnimationQueueItem for the phase transition
 */
export function createPhaseTransitionAnimation(
    prevState: GameState,
    fromPhase: GamePhase,
    fromTurn: Player,
    toTurn: Player,
    toPhase?: GamePhase  // Optional: target phase (defaults to actual game phase)
): AnimationQueueItem {
    // Create snapshot from the current state (board is correct after turn change)
    const snapshot = createVisualSnapshot(prevState);

    // Build phase sequence
    const sequence: Array<{ phase: GamePhase; turn: Player }> = [];
    const currentPhaseIndex = ALL_PHASES.indexOf(fromPhase);

    // Determine target phase - use provided toPhase or default to current game phase
    const targetPhase = toPhase || (prevState.phase as GamePhase);
    const targetPhaseIndex = ALL_PHASES.indexOf(targetPhase);

    if (fromTurn === toTurn) {
        // Same turn - animate from fromPhase to toPhase within same turn
        for (let i = currentPhaseIndex + 1; i <= targetPhaseIndex; i++) {
            sequence.push({ phase: ALL_PHASES[i], turn: fromTurn });
        }
    } else {
        // Turn change - animate remaining phases of old turn, then phases of new turn
        // Add remaining phases of current turn (excluding current phase since it's already displayed)
        for (let i = currentPhaseIndex + 1; i < ALL_PHASES.length; i++) {
            sequence.push({ phase: ALL_PHASES[i], turn: fromTurn });
        }

        // Add phases of new turn from 'start' up to and including target phase
        for (let i = 0; i <= targetPhaseIndex; i++) {
            sequence.push({ phase: ALL_PHASES[i], turn: toTurn });
        }
    }

    // Calculate total duration based on number of phase steps
    const duration = sequence.length * PHASE_TRANSITION_DURATION;

    return {
        id: generateAnimationId('phaseTransition'),
        type: 'phaseTransition',
        snapshot,
        duration,
        phaseTransitionData: {
            fromPhase,
            toPhase: targetPhase,
            fromTurn,
            toTurn,
            phaseSequence: sequence,
        },
    };
}

// =============================================================================
// ANIMATION REQUEST CONVERTER
// =============================================================================

/**
 * Converts an AnimationRequest to a complete AnimationQueueItem.
 *
 * CRITICAL: The state parameter MUST be the state BEFORE the animation effect is applied.
 * This ensures the snapshot captures the card in its original position.
 *
 * This is the central function for converting all AnimationRequest types to
 * proper AnimationQueueItems with snapshots and positioning data.
 *
 * @param state - The game state BEFORE the effect (card still in original position)
 * @param request - The animation request to convert
 * @param isOpponentAction - Whether this is an opponent action (for highlight phase)
 * @returns Complete AnimationQueueItem, or null if card not found
 */
export function convertAnimationRequestToQueueItem(
    state: GameState,
    request: AnimationRequest,
    isOpponentAction: boolean = false
): AnimationQueueItem | null {
    switch (request.type) {
        case 'delete': {
            const position = findCardInLanes(state, request.cardId, request.owner);
            if (!position) {
                console.warn('[convertAnimationRequest] delete: Card not found in lanes:', request.cardId);
                return null;
            }
            const card = state[request.owner].lanes[position.laneIndex][position.cardIndex];
            if (!card) {
                console.warn('[convertAnimationRequest] delete: Card object not found:', request.cardId);
                return null;
            }
            return createDeleteAnimation(state, card, request.owner, position.laneIndex, position.cardIndex, isOpponentAction);
        }

        case 'flip': {
            const owner = request.owner || (state.player.lanes.flat().some(c => c.id === request.cardId) ? 'player' : 'opponent');
            const position = findCardInLanes(state, request.cardId, owner);
            if (!position) {
                console.warn('[convertAnimationRequest] flip: Card not found in lanes:', request.cardId);
                return null;
            }
            const card = state[owner].lanes[position.laneIndex][position.cardIndex];
            if (!card) {
                console.warn('[convertAnimationRequest] flip: Card object not found:', request.cardId);
                return null;
            }
            // Flip animation: card is currently faceUp, so flip to faceDown, and vice versa
            const toFaceUp = !card.isFaceUp;
            return createFlipAnimation(state, card, owner, position.laneIndex, position.cardIndex, toFaceUp);
        }

        case 'shift': {
            const fromPosition = findCardInLanes(state, request.cardId, request.owner);
            if (!fromPosition) {
                console.warn('[convertAnimationRequest] shift: Card not found in lanes:', request.cardId);
                return null;
            }
            const card = state[request.owner].lanes[fromPosition.laneIndex][fromPosition.cardIndex];
            if (!card) {
                console.warn('[convertAnimationRequest] shift: Card object not found:', request.cardId);
                return null;
            }
            return createShiftAnimation(state, card, request.owner, request.fromLane, fromPosition.cardIndex, request.toLane, isOpponentAction);
        }

        case 'return': {
            const position = findCardInLanes(state, request.cardId, request.owner);
            if (!position) {
                console.warn('[convertAnimationRequest] return: Card not found in lanes:', request.cardId);
                return null;
            }
            const card = state[request.owner].lanes[position.laneIndex][position.cardIndex];
            if (!card) {
                console.warn('[convertAnimationRequest] return: Card object not found:', request.cardId);
                return null;
            }
            return createReturnAnimation(state, card, request.owner, position.laneIndex, position.cardIndex, isOpponentAction);
        }

        case 'discard': {
            const handIndex = findCardInHand(state, request.cardId, request.owner);
            if (handIndex < 0) {
                console.warn('[convertAnimationRequest] discard: Card not found in hand:', request.cardId);
                return null;
            }
            const card = state[request.owner].hand[handIndex];
            if (!card) {
                console.warn('[convertAnimationRequest] discard: Card object not found:', request.cardId);
                return null;
            }
            return createDiscardAnimation(state, card, request.owner, handIndex, isOpponentAction);
        }

        case 'play': {
            // Play can be from hand or from deck
            if (request.fromDeck && request.toLane !== undefined) {
                // From deck - card is already in the lane after the effect
                const position = findCardInLanes(state, request.cardId, request.owner);
                if (!position) {
                    console.warn('[convertAnimationRequest] play (from deck): Card not found in lanes:', request.cardId);
                    return null;
                }
                const card = state[request.owner].lanes[position.laneIndex][position.cardIndex];
                if (!card) {
                    console.warn('[convertAnimationRequest] play (from deck): Card object not found:', request.cardId);
                    return null;
                }
                return createPlayAnimation(state, card, request.owner, request.toLane, false, undefined, request.isFaceUp ?? false, isOpponentAction);
            } else {
                // From hand
                const handIndex = findCardInHand(state, request.cardId, request.owner);
                const toLane = request.toLane ?? 0;
                if (handIndex >= 0) {
                    const card = state[request.owner].hand[handIndex];
                    return createPlayAnimation(state, card, request.owner, toLane, true, handIndex, request.isFaceUp ?? true, isOpponentAction);
                }
                // Card might already be in lane (after effect applied)
                const position = findCardInLanes(state, request.cardId, request.owner);
                if (position) {
                    const card = state[request.owner].lanes[position.laneIndex][position.cardIndex];
                    return createPlayAnimation(state, card, request.owner, toLane, true, 0, request.isFaceUp ?? true, isOpponentAction);
                }
                console.warn('[convertAnimationRequest] play: Card not found:', request.cardId);
                return null;
            }
        }

        case 'draw': {
            // Draw animations require actual card objects, which aren't in the AnimationRequest
            // These should be handled at the effect level where cards are available
            console.warn('[convertAnimationRequest] draw: Cannot convert - need actual card objects');
            return null;
        }

        case 'compile_delete': {
            // Convert the request format to the expected format
            const deletedCardsData: { card: PlayedCard; owner: Player; laneIndex: number; cardIndex: number }[] = [];
            for (const item of request.deletedCards) {
                const position = findCardInLanes(state, item.cardId, item.owner);
                if (position) {
                    const card = state[item.owner].lanes[position.laneIndex][position.cardIndex];
                    if (card) {
                        deletedCardsData.push({
                            card,
                            owner: item.owner,
                            laneIndex: position.laneIndex,
                            cardIndex: position.cardIndex
                        });
                    }
                }
            }
            if (deletedCardsData.length === 0) {
                console.warn('[convertAnimationRequest] compile_delete: No cards found');
                return null;
            }
            const animations = createCompileDeleteAnimations(state, deletedCardsData);
            return animations.length > 0 ? animations[0] : null;
        }

        default:
            console.warn('[convertAnimationRequest] Unknown animation type:', (request as any).type);
            return null;
    }
}

/**
 * Converts an array of AnimationRequests to AnimationQueueItems.
 * Filters out any null results (cards not found).
 *
 * CRITICAL: The state parameter MUST be the state BEFORE any effects are applied.
 *
 * @param state - The game state BEFORE effects (cards in original positions)
 * @param requests - Array of animation requests to convert
 * @param isOpponentAction - Whether these are opponent actions
 * @returns Array of complete AnimationQueueItems
 */
export function convertAnimationRequestsToQueueItems(
    state: GameState,
    requests: AnimationRequest[],
    isOpponentAction: boolean = false
): AnimationQueueItem[] {
    const items: AnimationQueueItem[] = [];

    for (const request of requests) {
        const item = convertAnimationRequestToQueueItem(state, request, isOpponentAction);
        if (item) {
            items.push(item);
        }
    }

    return items;
}
