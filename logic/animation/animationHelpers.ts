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
    getCardStartDelay,
    TOTAL_DRAW_ANIMATION_DURATION,
    calculateDrawDuration,
    calculateDrawStagger,
    PHASE_TRANSITION_DURATION,
    calculateCompileDeleteDuration,
    BATCH_ANIMATION_INITIAL_DELAY,
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
 * @param hiddenCardIds - Optional set of card IDs to exclude from snapshot (for sequential animations)
 */
export function createDeleteAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number,
    isOpponentAction: boolean = false,
    hiddenCardIds?: Set<string>
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state, hiddenCardIds);

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
 *
 * @param isOpponentAction - Whether this is an opponent's action (triggers highlight phase)
 */
export function createFlipAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number,
    toFaceUp: boolean,
    isOpponentAction: boolean = false
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
            isOpponentAction,
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
 * @param hiddenCardIds - Optional set of card IDs to exclude from snapshot (for sequential animations)
 */
export function createReturnAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number,
    setFaceDown: boolean = true,
    isOpponentAction: boolean = false,
    hiddenCardIds?: Set<string>
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state, hiddenCardIds);

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
    startingHandIndex: number,
    sourceOwner?: Player  // Optional: owner of source deck (for drawing from opponent's deck)
): AnimationQueueItem[] {
    // Calculate per-card duration from total draw time
    // 5 cards = 1200ms total = 240ms per card
    const cardCount = cards.length;
    const SINGLE_CARD_DURATION = Math.max(100, Math.floor(TOTAL_DRAW_ANIMATION_DURATION / cardCount));

    // Default: draw from own deck. If sourceOwner is provided, draw from that player's deck
    const deckOwner = sourceOwner ?? owner;

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
                fromPosition: { type: 'deck' as const, owner: deckOwner },  // Use deckOwner for source
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
 * CRITICAL: Each animation has its own snapshot that excludes previously animated cards.
 *
 * @param state - Game state BEFORE the compile (for snapshot)
 * @param deletedCards - Array of cards that were deleted with their positions
 * @returns Array of AnimationQueueItems for sequential playback
 */
export function createCompileDeleteAnimations(
    state: GameState,
    deletedCards: { card: PlayedCard; owner: Player; laneIndex: number; cardIndex: number }[]
): AnimationQueueItem[] {
    // Track which cards should be hidden from lanes in each subsequent animation
    const hiddenCardIds = new Set<string>();

    // Track cards that have been "visually deleted" to trash (for subsequent snapshots)
    const deletedToTrash: { player: PlayedCard[]; opponent: PlayedCard[] } = {
        player: [],
        opponent: []
    };

    // Calculate duration per card based on total count
    // More cards = faster per-card animation, but total time stays ~constant
    const cardCount = deletedCards.length;
    const perCardDuration = calculateCompileDeleteDuration(cardCount);

    return deletedCards.map((item, index) => {
        // Create a modified state where previously deleted cards are in the trash
        // This ensures sequential animations show cards accumulating in trash
        const stateWithTrash: GameState = {
            ...state,
            player: {
                ...state.player,
                discard: [...state.player.discard, ...deletedToTrash.player]
            },
            opponent: {
                ...state.opponent,
                discard: [...state.opponent.discard, ...deletedToTrash.opponent]
            }
        };

        // Create snapshot that excludes previously animated cards from lanes
        // but includes them in the trash (via stateWithTrash)
        const snapshot = createVisualSnapshot(stateWithTrash, hiddenCardIds);

        // Add this card to hidden set for the NEXT animation's snapshot
        hiddenCardIds.add(item.card.id);

        // Add this card to the "deleted to trash" list for NEXT animation's snapshot
        // Strip the id and isFaceUp to match discard format, then add back for visual
        const { id, isFaceUp, ...cardData } = item.card;
        deletedToTrash[item.owner].push({ ...cardData, id, isFaceUp: true } as PlayedCard);

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
            duration: perCardDuration,
            animatingCard: {
                card: item.card,
                fromPosition,
                toPosition,
                targetRotation: 90,
                // Erste Animation: kurze Pause, damit nicht direkt nach vorherigem Effekt
                // Ab zweiter Animation: kein startDelay (Queue ist sequentiell)
                startDelay: index === 0 ? BATCH_ANIMATION_INITIAL_DELAY : 0,
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
 * Creates a DELAY animation - silent pause with no visual effect.
 * Used for AI "thinking" time before actions.
 *
 * @param state - Current game state (used for snapshot)
 * @param duration - Delay duration in milliseconds (default: 1000ms)
 * @param logMessage - Optional log message to display as toast when animation starts
 */
export function createDelayAnimation(
    state: GameState,
    duration: number = ANIMATION_DURATIONS.delay,
    logMessage?: { message: string; player: Player }
): AnimationQueueItem {
    const snapshot = createVisualSnapshot(state);

    return {
        id: generateAnimationId('delay'),
        type: 'delay',
        snapshot,
        duration,
        logMessage,
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
 * Uses trash accumulation pattern: each animation's snapshot shows previously
 * deleted cards in the trash for visual continuity.
 */
export function createBatchDeleteAnimations(
    state: GameState,
    cards: Array<{ card: PlayedCard; owner: Player; laneIndex: number; cardIndex: number }>
): AnimationQueueItem[] {
    // Track which cards should be hidden from lanes in each subsequent animation
    const hiddenCardIds = new Set<string>();

    // Track cards that have been "visually deleted" to trash (for subsequent snapshots)
    const deletedToTrash: { player: PlayedCard[]; opponent: PlayedCard[] } = {
        player: [],
        opponent: []
    };

    // Use same timing pattern as compile deletes for consistency
    const cardCount = cards.length;
    const perCardDuration = calculateCompileDeleteDuration(cardCount);

    return cards.map((item, index) => {
        // Create a modified state where previously deleted cards are in the trash
        // This ensures sequential animations show cards accumulating in trash
        const stateWithTrash: GameState = {
            ...state,
            player: {
                ...state.player,
                discard: [...state.player.discard, ...deletedToTrash.player]
            },
            opponent: {
                ...state.opponent,
                discard: [...state.opponent.discard, ...deletedToTrash.opponent]
            }
        };

        // Create snapshot that excludes previously animated cards from lanes
        // but includes them in the trash (via stateWithTrash)
        const snapshot = createVisualSnapshot(stateWithTrash, hiddenCardIds);

        // Add this card to hidden set for the NEXT animation's snapshot
        hiddenCardIds.add(item.card.id);

        // Add this card to the "deleted to trash" list for NEXT animation's snapshot
        const { id, isFaceUp, ...cardData } = item.card;
        deletedToTrash[item.owner].push({ ...cardData, id, isFaceUp: true } as PlayedCard);

        return {
            id: generateAnimationId('delete'),
            type: 'delete' as AnimationType,
            snapshot,
            duration: perCardDuration,
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
                // Erste Animation: kurze Pause, ab zweiter: kein startDelay (Queue ist sequentiell)
                startDelay: index === 0 ? BATCH_ANIMATION_INITIAL_DELAY : 0,
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
            // Use toFaceUp from request if provided (for post-flip state), otherwise calculate from current state
            const toFaceUp = request.toFaceUp !== undefined ? request.toFaceUp : !card.isFaceUp;
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
                // CRITICAL: Use prePlayLanes for correct snapshot (card shouldn't appear in lane yet)
                const prePlayLanes = (request as any).prePlayLanes;
                let stateForAnimation = state;
                if (prePlayLanes) {
                    stateForAnimation = {
                        ...state,
                        player: { ...state.player, lanes: prePlayLanes.player },
                        opponent: { ...state.opponent, lanes: prePlayLanes.opponent }
                    };
                }
                return createPlayAnimation(stateForAnimation, card, request.owner, request.toLane, false, undefined, request.isFaceUp ?? false, isOpponentAction);
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
            // Draw animations are handled directly in enqueueAnimationsFromRequests
            // because they need special handling (multiple cards, pre-draw state)
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

// =============================================================================
// SINGLE POINT OF TRUTH: ANIMATION REQUEST PROCESSING
// =============================================================================

/**
 * Process animation requests and enqueue them.
 * This is the SINGLE POINT OF TRUTH for converting AnimationRequests to animations.
 *
 * CRITICAL: The state parameter should be the state AFTER the effect (cards already moved).
 * Use cardSnapshot in the request for deleted/returned cards that no longer exist in state.
 *
 * @param state - Current game state (for card positions and log messages)
 * @param animationRequests - Array of animation requests to process
 * @param enqueueAnimation - Function to enqueue animations
 * @param lastProcessedLogIndex - Optional: Index of last processed log entry (for log message association)
 */
export function enqueueAnimationsFromRequests(
    state: GameState,
    animationRequests: AnimationRequest[],
    enqueueAnimation: (animation: Omit<AnimationQueueItem, 'id'>) => void,
    lastProcessedLogIndex?: number
): void {
    if (!animationRequests || animationRequests.length === 0) return;

    const animations: Omit<AnimationQueueItem, 'id'>[] = [];

    // Track log index for associating log messages with animations
    let logIndex = lastProcessedLogIndex ?? (state.log.length - animationRequests.length);
    if (logIndex < 0) logIndex = 0;

    // Track trash accumulation for sequential delete animations
    // This ensures cards deleted earlier appear in trash for subsequent animations
    const deleteHiddenCardIds = new Set<string>();
    const deletedToTrash: { player: PlayedCard[]; opponent: PlayedCard[] } = {
        player: [],
        opponent: []
    };

    // Count total delete requests for timing calculation
    const deleteRequestCount = animationRequests.filter(r => r.type === 'delete').length;
    let deleteIndex = 0;

    for (const request of animationRequests) {
        // Get the corresponding log message for this animation
        const logEntry = state.log[logIndex];
        const logMessage = logEntry ? { message: logEntry.message, player: logEntry.player } : undefined;
        logIndex++;

        if (request.type === 'play' && request.fromDeck && request.toLane !== undefined) {
            // Play from deck animation
            // CRITICAL: Card is already in the lane in current state - we need a pre-play snapshot
            const playCard = state[request.owner].lanes[request.toLane]?.find(c => c.id === request.cardId);
            const prePlayLanes = (request as any).prePlayLanes as { player: PlayedCard[][]; opponent: PlayedCard[][] } | undefined;
            const playIndex = (request as any).playIndex as number | undefined;

            if (playCard) {
                let prePlayState: GameState;

                // CRITICAL: Use prePlayLanes for correct sequential snapshot (DRY - like preDiscardHand)
                // For animation N, show lanes with cards from plays 0..N-1, but NOT the current card
                if (prePlayLanes && playIndex !== undefined) {
                    // Start from prePlayLanes, then add cards played before this one in this batch
                    const snapshotPlayerLanes = prePlayLanes.player.map((lane, laneIdx) => {
                        const previousCardsInThisLane = animationRequests
                            .filter(r => r.type === 'play' &&
                                        r.owner === 'player' &&
                                        r.toLane === laneIdx &&
                                        (r as any).playIndex !== undefined &&
                                        (r as any).playIndex < playIndex &&
                                        (r as any).prePlayLanes === prePlayLanes)
                            .map(r => state.player.lanes[laneIdx]?.find(c => c.id === r.cardId))
                            .filter(Boolean) as PlayedCard[];
                        return [...lane, ...previousCardsInThisLane];
                    });

                    const snapshotOpponentLanes = prePlayLanes.opponent.map((lane, laneIdx) => {
                        const previousCardsInThisLane = animationRequests
                            .filter(r => r.type === 'play' &&
                                        r.owner === 'opponent' &&
                                        r.toLane === laneIdx &&
                                        (r as any).playIndex !== undefined &&
                                        (r as any).playIndex < playIndex &&
                                        (r as any).prePlayLanes === prePlayLanes)
                            .map(r => state.opponent.lanes[laneIdx]?.find(c => c.id === r.cardId))
                            .filter(Boolean) as PlayedCard[];
                        return [...lane, ...previousCardsInThisLane];
                    });

                    prePlayState = {
                        ...state,
                        player: { ...state.player, lanes: snapshotPlayerLanes },
                        opponent: { ...state.opponent, lanes: snapshotOpponentLanes }
                    };
                } else {
                    // Fallback: Create pre-play state that excludes only this card from the target lane
                    prePlayState = {
                        ...state,
                        [request.owner]: {
                            ...state[request.owner],
                            lanes: state[request.owner].lanes.map((lane, idx) =>
                                idx === request.toLane
                                    ? lane.filter(c => c.id !== request.cardId)
                                    : lane
                            )
                        }
                    };
                }

                const animation = createPlayAnimation(
                    prePlayState,  // Use pre-play state for correct snapshot
                    playCard,
                    request.owner,
                    request.toLane,
                    false,  // fromHand = false (from deck)
                    undefined,  // no handIndex
                    request.isFaceUp ?? false,
                    request.owner === 'opponent'
                );
                animations.push({ ...animation, logMessage });
            }
        } else if (request.type === 'shift') {
            // CRITICAL: Use cardSnapshot and preShiftLanes if available - the card may already be shifted in state!
            const cardSnapshot = (request as any).cardSnapshot as PlayedCard | undefined;
            const fromCardIndex = (request as any).cardIndex as number | undefined;
            const preShiftLanes = (request as any).preShiftLanes as { player: PlayedCard[][]; opponent: PlayedCard[][] } | undefined;

            // Try to find the card in state, fallback to snapshot
            let shiftCard = state[request.owner].lanes[request.fromLane]?.find(c => c.id === request.cardId);
            let actualFromIndex = shiftCard
                ? state[request.owner].lanes[request.fromLane]?.findIndex(c => c.id === request.cardId)
                : fromCardIndex;

            // If card not found at fromLane (already shifted), use snapshot
            if (!shiftCard && cardSnapshot) {
                shiftCard = cardSnapshot;
                actualFromIndex = fromCardIndex ?? 0;
            }

            if (shiftCard && actualFromIndex !== undefined && actualFromIndex >= 0) {
                // CRITICAL: Use preShiftLanes for correct animation snapshot (DRY - like preDiscardHand)
                // This ensures the animation shows the card at its original position, not the target
                let stateForAnimation = state;
                if (preShiftLanes) {
                    stateForAnimation = {
                        ...state,
                        player: { ...state.player, lanes: preShiftLanes.player },
                        opponent: { ...state.opponent, lanes: preShiftLanes.opponent }
                    };
                }

                const animation = createShiftAnimation(
                    stateForAnimation,
                    shiftCard,
                    request.owner,
                    request.fromLane,
                    actualFromIndex,
                    request.toLane
                );
                animations.push({ ...animation, logMessage });
            }
        } else if (request.type === 'delete') {
            // CRITICAL: Use cardSnapshot if available - the card is already deleted from state!
            const cardSnapshot = (request as any).cardSnapshot as PlayedCard | undefined;
            const laneIndex = (request as any).laneIndex as number | undefined;
            const cardIndex = (request as any).cardIndex as number | undefined;

            let deleteCard: PlayedCard | undefined;
            let deleteLaneIndex: number | undefined;
            let deleteCardIndex: number | undefined;

            if (cardSnapshot && laneIndex !== undefined && cardIndex !== undefined) {
                deleteCard = cardSnapshot;
                deleteLaneIndex = laneIndex;
                deleteCardIndex = cardIndex;
            } else {
                // Fallback: Try to find card in current state
                deleteCard = state[request.owner].lanes.flat().find(c => c.id === request.cardId);
                const cardPosition = findCardInLanes(state, request.cardId, request.owner);
                if (cardPosition) {
                    deleteLaneIndex = cardPosition.laneIndex;
                    deleteCardIndex = cardPosition.cardIndex;
                }
            }

            if (deleteCard && deleteLaneIndex !== undefined && deleteCardIndex !== undefined) {
                // Create state with previously deleted cards in trash (for sequential animation snapshots)
                const stateWithTrash: GameState = {
                    ...state,
                    player: {
                        ...state.player,
                        discard: [...state.player.discard, ...deletedToTrash.player]
                    },
                    opponent: {
                        ...state.opponent,
                        discard: [...state.opponent.discard, ...deletedToTrash.opponent]
                    }
                };

                // Create snapshot that excludes previously animated cards from lanes
                const snapshot = createVisualSnapshot(stateWithTrash, deleteHiddenCardIds);

                // Calculate timing based on total delete count
                const perCardDuration = calculateCompileDeleteDuration(deleteRequestCount);

                // Create animation
                const animation: Omit<AnimationQueueItem, 'id'> = {
                    id: generateAnimationId('delete'),
                    type: 'delete' as AnimationType,
                    snapshot,
                    duration: perCardDuration,
                    animatingCard: {
                        card: deleteCard,
                        fromPosition: {
                            type: 'lane',
                            owner: request.owner,
                            laneIndex: deleteLaneIndex,
                            cardIndex: deleteCardIndex,
                        },
                        toPosition: {
                            type: 'trash',
                            owner: request.owner,
                        },
                        targetRotation: 90,
                        // Erste Animation: kurze Pause, ab zweiter: kein startDelay (Queue ist sequentiell)
                        startDelay: deleteIndex === 0 ? BATCH_ANIMATION_INITIAL_DELAY : 0,
                    },
                    laneIndex: deleteLaneIndex,
                };
                animations.push({ ...animation, logMessage });

                // Track this card for NEXT delete animation's snapshot
                deleteHiddenCardIds.add(deleteCard.id);
                const { id, isFaceUp, ...cardData } = deleteCard;
                deletedToTrash[request.owner].push({ ...cardData, id, isFaceUp: true } as PlayedCard);
                deleteIndex++;
            }
        } else if (request.type === 'draw') {
            // Draw animation using explicit cardIds for precision
            const hand = state[request.player].hand;
            const cardIdSet = new Set(request.cardIds);

            // Find the drawn cards in hand and preserve their order
            const drawnCards = hand.filter(c => cardIdSet.has(c.id));

            if (drawnCards.length > 0) {
                // Calculate starting index (first drawn card's position)
                const firstDrawnIndex = hand.findIndex(c => cardIdSet.has(c.id));
                const startIndex = firstDrawnIndex >= 0 ? firstDrawnIndex : hand.length - drawnCards.length;

                // Create pre-draw state for correct animation snapshot
                const preDrawHand = hand.filter(c => !cardIdSet.has(c.id));
                const preDrawState = {
                    ...state,
                    [request.player]: { ...state[request.player], hand: preDrawHand }
                };

                // Determine source deck owner (own deck or opponent's deck for re-compile reward)
                const sourceOwner = request.fromOpponentDeck
                    ? (request.player === 'player' ? 'opponent' : 'player')
                    : undefined;

                const drawAnimations = createSequentialDrawAnimations(
                    preDrawState,
                    drawnCards,
                    request.player,
                    preDrawHand.length,  // Cards start after existing hand
                    sourceOwner          // Pass source deck owner for animation
                );
                if (drawAnimations.length > 0) {
                    animations.push({ ...drawAnimations[0], logMessage });
                    animations.push(...drawAnimations.slice(1));
                }
            }
        } else if (request.type === 'return') {
            // CRITICAL: Use cardSnapshot if available - the card may already be returned to hand!
            const cardSnapshot = (request as any).cardSnapshot;
            const laneIndex = (request as any).laneIndex;
            const cardIndex = (request as any).cardIndex;

            if (cardSnapshot && laneIndex !== undefined && cardIndex !== undefined) {
                const animation = createReturnAnimation(
                    state,
                    cardSnapshot,
                    request.owner,
                    laneIndex,
                    cardIndex,
                    true  // setFaceDown
                );
                animations.push({ ...animation, logMessage });
            } else {
                // Fallback: Try to find card in current state
                const cardPosition = findCardInLanes(state, request.cardId, request.owner);
                const card = state[request.owner].lanes.flat().find(c => c.id === request.cardId);
                if (card && cardPosition) {
                    const animation = createReturnAnimation(
                        state,
                        card,
                        request.owner,
                        cardPosition.laneIndex,
                        cardPosition.cardIndex,
                        true  // setFaceDown
                    );
                    animations.push({ ...animation, logMessage });
                }
            }
        } else if (request.type === 'flip') {
            // NOTE: Flip animation is handled by CSS (rotateY transition on isFaceUp change)
            // We create a DELAY animation to give CSS time to run the flip transition.
            // The state already has the new isFaceUp value - React will render it,
            // and the CSS transition will animate the flip.
            const delayAnimation: Omit<AnimationQueueItem, 'id'> = {
                type: 'delay',
                snapshot: createVisualSnapshot(state),
                duration: ANIMATION_DURATIONS.flip,
                logMessage,
            };
            animations.push(delayAnimation);
        } else if (request.type === 'discard') {
            // Use stored data for sequential snapshots (card may already be discarded)
            const storedCard = (request as any).cardSnapshot as PlayedCard | undefined;
            const preDiscardHand = (request as any).preDiscardHand as PlayedCard[] | undefined;
            const discardIndex = (request as any).discardIndex as number | undefined;

            const card = storedCard ?? state[request.owner].hand.find(c => c.id === request.cardId);
            if (!card) continue;

            // Create sequential snapshot: show hand as it was BEFORE this discard
            // For animation N, exclude cards 0..N-1 from preDiscardHand
            let snapshotHand: PlayedCard[];
            if (preDiscardHand && discardIndex !== undefined && discardIndex > 0) {
                // Get IDs of cards discarded before this one (discardIndex 0..N-1)
                const previouslyDiscardedIds = new Set(
                    animationRequests
                        .filter(r => r.type === 'discard' &&
                                    (r as any).discardIndex !== undefined &&
                                    (r as any).discardIndex < discardIndex &&
                                    (r as any).preDiscardHand === preDiscardHand) // Same batch
                        .map(r => (r as any).cardSnapshot?.id)
                        .filter(Boolean)
                );
                snapshotHand = preDiscardHand.filter(c => !previouslyDiscardedIds.has(c.id));
            } else if (preDiscardHand) {
                // First discard in batch - show full hand
                snapshotHand = preDiscardHand;
            } else {
                // Fallback to current state
                snapshotHand = state[request.owner].hand;
            }

            // Find handIndex in the snapshot hand
            const handIndex = snapshotHand.findIndex(c => c.id === card.id);
            if (handIndex < 0) continue;

            // Create snapshot state with the sequential hand
            const snapshotState = {
                ...state,
                [request.owner]: {
                    ...state[request.owner],
                    hand: snapshotHand
                }
            };

            const animation = createDiscardAnimation(snapshotState, card, request.owner, handIndex);
            animations.push({ ...animation, logMessage });
        }
    }

    // Enqueue all animations
    animations.forEach(anim => enqueueAnimation(anim));
}
