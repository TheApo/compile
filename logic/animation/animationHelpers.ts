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

import { GameState, Player, PlayedCard } from '../../types';
import {
    AnimationQueueItem,
    AnimationType,
    CardPosition,
    AnimatingCard,
    CompileAnimatingCard,
} from '../../types/animation';
import { createVisualSnapshot } from '../../utils/snapshotUtils';
import { ANIMATION_DURATIONS, COMPILE_STAGGER_DELAY, getCardStartDelay } from '../../constants/animationTiming';

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
 */
export function createPlayAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    toLaneIndex: number,
    fromHand: boolean = true,
    handIndex?: number,
    isFaceUp: boolean = true
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
        },
        laneIndex: toLaneIndex,
    };
}

/**
 * Creates a DELETE animation - card moves from lane to trash.
 */
export function createDeleteAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number
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
 */
export function createShiftAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    fromLaneIndex: number,
    fromCardIndex: number,
    toLaneIndex: number
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
        },
        laneIndex: fromLaneIndex,
    };
}

/**
 * Creates a RETURN animation - card moves from lane back to hand.
 */
export function createReturnAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    laneIndex: number,
    cardIndex: number
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
        },
        laneIndex,
    };
}

/**
 * Creates a DISCARD animation - card moves from hand to trash.
 */
export function createDiscardAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    handIndex: number
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
        },
    };
}

/**
 * Creates a DRAW animation - card moves from deck to hand.
 */
export function createDrawAnimation(
    state: GameState,
    card: PlayedCard,
    owner: Player,
    targetHandIndex: number
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
        duration: ANIMATION_DURATIONS.draw,
        animatingCard: {
            card,
            fromPosition,
            toPosition,
        },
    };
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
            },
            laneIndex: item.laneIndex,
        };
    });
}

/**
 * Creates animations for multiple discards.
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
            },
        };
    });
}
