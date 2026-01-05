/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized log message generation for game actions.
 *
 * This module provides a single source of truth for all log message formats.
 * Used by both:
 * - Resolvers (for GameLog entries)
 * - Animation system (for Toast synchronization)
 *
 * Benefits:
 * - DRY (Don't Repeat Yourself)
 * - Consistent message formats
 * - Easy to update message templates
 */

import { Player, PlayedCard } from '../../types';

// Helper to get player display name
const getPlayerName = (player: Player): string =>
    player === 'player' ? 'Player' : 'Opponent';

// Helper to format card name
const getCardName = (card: PlayedCard, showHidden = false): string => {
    if (!card.isFaceUp && !showHidden) {
        return 'a face-down card';
    }
    return `${card.protocol}-${card.value}`;
};

/**
 * Generate log message for playing a card
 */
export function playCardMessage(
    player: Player,
    card: PlayedCard,
    protocolName: string,
    isFaceUp: boolean,
    targetOwner?: Player
): string {
    const playerName = getPlayerName(player);
    const cardName = `${card.protocol}-${card.value}`;

    let msg = `${playerName} plays ${cardName}`;
    if (!isFaceUp) msg += ' face-down';

    if (targetOwner && targetOwner !== player) {
        const targetSideName = targetOwner === 'player' ? "Player's" : "Opponent's";
        msg += ` into ${targetSideName} Protocol ${protocolName}.`;
    } else {
        msg += ` into Protocol ${protocolName}.`;
    }

    return msg;
}

/**
 * Generate log message for shifting a card
 */
export function shiftCardMessage(
    player: Player,
    card: PlayedCard,
    fromProtocol: string,
    toProtocol: string
): string {
    const playerName = getPlayerName(player);
    const cardName = getCardName(card, true);
    return `${playerName} shifts ${cardName} from ${fromProtocol} to ${toProtocol}.`;
}

/**
 * Generate log message for shifting all cards in a lane
 */
export function shiftAllCardsMessage(
    fromProtocol: string,
    toProtocol: string
): string {
    return `Shifting all cards from ${fromProtocol} to ${toProtocol}.`;
}

/**
 * Generate log message for deleting a card
 */
export function deleteCardMessage(card: PlayedCard): string {
    const cardName = getCardName(card, true);
    return `Deleting ${cardName}.`;
}

/**
 * Generate log message for returning a card to hand
 */
export function returnCardMessage(card: PlayedCard): string {
    const cardName = getCardName(card, true);
    return `Returning ${cardName} to hand.`;
}

/**
 * Generate log message for returning all cards from a lane to hand
 */
export function returnAllCardsMessage(
    player: Player,
    protocolName: string
): string {
    const playerName = getPlayerName(player);
    return `${playerName} returns all cards from ${protocolName} to hand.`;
}

/**
 * Generate log message for flipping a card
 */
export function flipCardMessage(
    card: PlayedCard,
    toFaceUp: boolean
): string {
    const cardName = `${card.protocol}-${card.value}`;
    const direction = toFaceUp ? 'face-up' : 'face-down';
    return `Flipping ${cardName} ${direction}.`;
}

/**
 * Generate log message for drawing cards
 */
export function drawCardsMessage(
    player: Player,
    count: number
): string {
    const playerName = getPlayerName(player);
    const cardWord = count === 1 ? 'card' : 'cards';
    return `${playerName} draws ${count} ${cardWord}.`;
}

/**
 * Generate log message for discarding a card
 */
export function discardCardMessage(
    player: Player,
    card: { protocol: string; value: number }
): string {
    const playerName = getPlayerName(player);
    const cardName = `${card.protocol}-${card.value}`;
    return `${playerName} discards ${cardName}.`;
}

/**
 * Generate log message for refreshing hand (fill hand)
 */
export function refreshHandMessage(
    player: Player,
    count: number
): string {
    const playerName = getPlayerName(player);
    const cardWord = count === 1 ? 'card' : 'cards';
    return `${playerName} refreshes hand (draws ${count} ${cardWord}).`;
}

/**
 * Generate log message for compiling a protocol
 */
export function compileProtocolMessage(
    player: Player,
    protocolName: string
): string {
    const playerName = getPlayerName(player);
    return `${playerName} compiles Protocol ${protocolName}!`;
}
