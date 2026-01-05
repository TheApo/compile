/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard, PlayerState } from '../types';
import {
    VisualSnapshot,
    PlayerVisualState,
    CardPosition,
} from '../types/animation';

// =============================================================================
// SNAPSHOT CREATION
// =============================================================================

/**
 * Creates a lightweight visual snapshot from the current game state.
 * This snapshot contains only the data needed for rendering animations.
 *
 * @param state - The current game state
 * @param hiddenCardIds - Optional set of card IDs to exclude from the snapshot
 *                        Used for sequential animations where earlier cards should not appear
 * @returns A visual snapshot for animation rendering
 */
export function createVisualSnapshot(state: GameState, hiddenCardIds?: Set<string>): VisualSnapshot {
    return {
        player: createPlayerVisualState(state, 'player', hiddenCardIds),
        opponent: createPlayerVisualState(state, 'opponent', hiddenCardIds),
        controlCardHolder: state.controlCardHolder,
        turn: state.turn,
        phase: state.phase,
    };
}

/**
 * Creates visual state for a single player.
 *
 * @param state - The current game state
 * @param player - Which player to create state for
 * @param hiddenCardIds - Optional set of card IDs to exclude from lanes/hand
 * @returns Visual state for the player
 */
function createPlayerVisualState(state: GameState, player: Player, hiddenCardIds?: Set<string>): PlayerVisualState {
    const playerState = state[player];

    // Deep clone lanes, filtering out hidden cards if specified
    const lanes = playerState.lanes.map(lane =>
        lane
            .filter(card => !hiddenCardIds || !hiddenCardIds.has(card.id))
            .map(card => ({ ...card }))
    );

    // Deep clone hand, filtering out hidden cards if specified
    const hand = playerState.hand
        .filter(card => !hiddenCardIds || !hiddenCardIds.has(card.id))
        .map(card => ({ ...card }));

    // Get top trash card if exists
    const topTrashCard = playerState.discard.length > 0
        ? { ...playerState.discard[playerState.discard.length - 1] } as PlayedCard
        : undefined;

    return {
        protocols: [...playerState.protocols],
        compiled: [...playerState.compiled],
        laneValues: [...playerState.laneValues],
        lanes,
        hand,
        deckCount: playerState.deck.length,
        trashCount: playerState.discard.length,
        topTrashCard,
    };
}

// =============================================================================
// CARD LOCATION UTILITIES
// =============================================================================

/**
 * Result of finding a card in a snapshot.
 */
export interface CardLocation {
    card: PlayedCard;
    owner: Player;
    position: CardPosition;
}

/**
 * Finds a card in a visual snapshot by its ID.
 *
 * @param snapshot - The visual snapshot to search
 * @param cardId - The ID of the card to find
 * @returns The card location or null if not found
 */
export function findCardInSnapshot(snapshot: VisualSnapshot, cardId: string): CardLocation | null {
    // Search player's lanes
    for (let laneIndex = 0; laneIndex < snapshot.player.lanes.length; laneIndex++) {
        const lane = snapshot.player.lanes[laneIndex];
        for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
            if (lane[cardIndex].id === cardId) {
                return {
                    card: lane[cardIndex],
                    owner: 'player',
                    position: { type: 'lane', owner: 'player', laneIndex, cardIndex },
                };
            }
        }
    }

    // Search opponent's lanes
    for (let laneIndex = 0; laneIndex < snapshot.opponent.lanes.length; laneIndex++) {
        const lane = snapshot.opponent.lanes[laneIndex];
        for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
            if (lane[cardIndex].id === cardId) {
                return {
                    card: lane[cardIndex],
                    owner: 'opponent',
                    position: { type: 'lane', owner: 'opponent', laneIndex, cardIndex },
                };
            }
        }
    }

    // Search player's hand
    for (let handIndex = 0; handIndex < snapshot.player.hand.length; handIndex++) {
        if (snapshot.player.hand[handIndex].id === cardId) {
            return {
                card: snapshot.player.hand[handIndex],
                owner: 'player',
                position: { type: 'hand', owner: 'player', handIndex },
            };
        }
    }

    // Search opponent's hand
    for (let handIndex = 0; handIndex < snapshot.opponent.hand.length; handIndex++) {
        if (snapshot.opponent.hand[handIndex].id === cardId) {
            return {
                card: snapshot.opponent.hand[handIndex],
                owner: 'opponent',
                position: { type: 'hand', owner: 'opponent', handIndex },
            };
        }
    }

    return null;
}

/**
 * Finds a card in the actual game state by its ID.
 * Used to get current card data for animation helpers.
 *
 * @param state - The current game state
 * @param cardId - The ID of the card to find
 * @returns The card location or null if not found
 */
export function findCardInGameState(state: GameState, cardId: string): CardLocation | null {
    // Create a snapshot and search it
    const snapshot = createVisualSnapshot(state);
    return findCardInSnapshot(snapshot, cardId);
}

/**
 * Gets the position of a card that would be added to a lane.
 * Used to calculate the "to" position for play animations.
 *
 * @param snapshot - The visual snapshot
 * @param owner - The owner of the lane
 * @param laneIndex - The lane index
 * @returns The position where a new card would be placed
 */
export function getNextLanePosition(
    snapshot: VisualSnapshot,
    owner: Player,
    laneIndex: number
): CardPosition {
    const lane = snapshot[owner].lanes[laneIndex];
    return {
        type: 'lane',
        owner,
        laneIndex,
        cardIndex: lane.length, // New card goes at the end
    };
}

/**
 * Gets the position for a card in hand.
 *
 * @param snapshot - The visual snapshot
 * @param owner - The owner of the hand
 * @param handIndex - Optional specific index, otherwise uses end of hand
 * @returns The position in hand
 */
export function getHandPosition(
    snapshot: VisualSnapshot,
    owner: Player,
    handIndex?: number
): CardPosition {
    const hand = snapshot[owner].hand;
    return {
        type: 'hand',
        owner,
        handIndex: handIndex ?? hand.length,
    };
}

// =============================================================================
// SNAPSHOT COMPARISON (for debugging)
// =============================================================================

/**
 * Compares two snapshots and returns differences.
 * Useful for debugging animation generation.
 *
 * @param before - Snapshot before action
 * @param after - Snapshot after action
 * @returns Description of differences
 */
export function compareSnapshots(before: VisualSnapshot, after: VisualSnapshot): string[] {
    const differences: string[] = [];

    for (const player of ['player', 'opponent'] as const) {
        const beforeState = before[player];
        const afterState = after[player];

        // Check hand size
        if (beforeState.hand.length !== afterState.hand.length) {
            differences.push(
                `${player} hand: ${beforeState.hand.length} → ${afterState.hand.length}`
            );
        }

        // Check deck size
        if (beforeState.deckCount !== afterState.deckCount) {
            differences.push(
                `${player} deck: ${beforeState.deckCount} → ${afterState.deckCount}`
            );
        }

        // Check trash size
        if (beforeState.trashCount !== afterState.trashCount) {
            differences.push(
                `${player} trash: ${beforeState.trashCount} → ${afterState.trashCount}`
            );
        }

        // Check lane sizes
        for (let i = 0; i < 3; i++) {
            const beforeLane = beforeState.lanes[i] || [];
            const afterLane = afterState.lanes[i] || [];
            if (beforeLane.length !== afterLane.length) {
                differences.push(
                    `${player} lane ${i}: ${beforeLane.length} → ${afterLane.length} cards`
                );
            }
        }

        // Check compiled status
        for (let i = 0; i < 3; i++) {
            if (beforeState.compiled[i] !== afterState.compiled[i]) {
                differences.push(
                    `${player} protocol ${i}: ${beforeState.compiled[i] ? 'compiled' : 'not compiled'} → ${afterState.compiled[i] ? 'compiled' : 'not compiled'}`
                );
            }
        }
    }

    // Check control
    if (before.controlCardHolder !== after.controlCardHolder) {
        differences.push(
            `control: ${before.controlCardHolder || 'none'} → ${after.controlCardHolder || 'none'}`
        );
    }

    return differences;
}

// =============================================================================
// SNAPSHOT TO GAMESTATE CONVERSION
// =============================================================================

/**
 * Converts a VisualSnapshot to a minimal GameState object.
 *
 * This allows the SAME GameBoard component to render both real game state
 * and animation snapshots. The returned GameState has:
 * - All visual data from the snapshot
 * - Neutral/inactive values for interactive properties
 *
 * @param snapshot - The visual snapshot to convert
 * @param useControlMechanic - Whether control mechanic is enabled
 * @returns A minimal GameState suitable for rendering
 */
export function snapshotToGameState(
    snapshot: VisualSnapshot,
    useControlMechanic: boolean = false
): GameState {
    return {
        player: visualStateToPlayerState(snapshot.player),
        opponent: visualStateToPlayerState(snapshot.opponent),
        turn: snapshot.turn,
        phase: snapshot.phase,
        controlCardHolder: snapshot.controlCardHolder,
        useControlMechanic,
        winner: null,
        log: [],
        actionRequired: null,
        queuedActions: [],
        animationState: null,
        compilableLanes: [],
    };
}

/**
 * Converts PlayerVisualState to a minimal PlayerState.
 */
function visualStateToPlayerState(visualState: PlayerVisualState): PlayerState {
    // Create fake deck array with correct length (cards don't matter, just count)
    const fakeDeck = Array(visualState.deckCount).fill(null).map((_, i) => ({
        id: `fake-deck-${i}`,
        protocol: 'Unknown',
        value: 0,
        isFaceUp: false,
        bottomRule: '',
        middleRule: '',
    } as PlayedCard));

    // Create fake discard array with top card if it exists
    const fakeDiscard: PlayedCard[] = [];
    if (visualState.topTrashCard) {
        // Add placeholder cards for the count, with the real top card at the end
        for (let i = 0; i < visualState.trashCount - 1; i++) {
            fakeDiscard.push({
                id: `fake-discard-${i}`,
                protocol: 'Unknown',
                value: 0,
                isFaceUp: false,
                bottomRule: '',
                middleRule: '',
            } as PlayedCard);
        }
        fakeDiscard.push(visualState.topTrashCard);
    }

    return {
        protocols: visualState.protocols,
        deck: fakeDeck,
        hand: visualState.hand,
        lanes: visualState.lanes,
        discard: fakeDiscard,
        compiled: visualState.compiled,
        laneValues: visualState.laneValues,
        cannotCompile: false,
        stats: {
            cardsPlayed: 0,
            cardsDrawn: 0,
            cardsDeleted: 0,
            protocolsCompiled: 0,
            effectsTriggered: 0,
        },
    };
}
