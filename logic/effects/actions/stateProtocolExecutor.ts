/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * State Protocol Effect Executor
 *
 * Handles the "state a protocol" effect (Luck-3).
 * Player chooses a protocol from opponent's cards which is stored for subsequent effects.
 */

import { GameState, PlayedCard, EffectResult, EffectContext, Player } from '../../../types';
import { log } from '../../utils/log';

/**
 * Get unique protocols from all of a player's cards (deck, hand, lanes, discard)
 * Returns protocols in lane order first (matching game board display), then others
 */
function getUniqueProtocolsFromPlayer(state: GameState, player: Player): string[] {
    const allProtocols = new Set<string>();

    // Collect all unique protocols
    state[player].deck.forEach(card => allProtocols.add(card.protocol));
    state[player].hand.forEach(card => allProtocols.add(card.protocol));
    state[player].lanes.forEach(lane => {
        lane.forEach(card => allProtocols.add(card.protocol));
    });
    state[player].discard.forEach(card => allProtocols.add(card.protocol));

    // Build result: lane protocols first (in lane order), then remaining protocols
    const result: string[] = [];
    const laneProtocols = state[player].protocols;

    // Add lane protocols in order (lane 0, 1, 2) if they exist in allProtocols
    for (const protocol of laneProtocols) {
        if (allProtocols.has(protocol) && !result.includes(protocol)) {
            result.push(protocol);
        }
    }

    // Add remaining protocols (sorted for consistency)
    const remaining = Array.from(allProtocols)
        .filter(p => !result.includes(p))
        .sort();
    result.push(...remaining);

    return result;
}

/**
 * Execute STATE_PROTOCOL effect
 * Sets up actionRequired for player to choose a protocol
 */
export function executeStateProtocolEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;

    // Get available protocols based on source
    let availableProtocols: string[] = [];
    if (params.protocolSource === 'opponent_cards') {
        availableProtocols = getUniqueProtocolsFromPlayer(state, opponent);
    }

    // If no protocols available, skip the effect
    if (availableProtocols.length === 0) {
        let newState = log(state, cardOwner, `No protocols available to state - effect skipped.`);
        (newState as any)._effectSkippedNoTargets = true;
        return { newState };
    }

    let newState = { ...state };

    // Set actionRequired for player to choose a protocol
    newState.actionRequired = {
        type: 'state_protocol',
        actor: cardOwner,
        sourceCardId: card.id,
        protocolSource: params.protocolSource || 'opponent_cards',
        availableProtocols,
    } as any;

    return { newState };
}

/**
 * Resolve the state_protocol action when player selects a protocol
 * Called from miscResolver when player chooses
 */
export function resolveStateProtocol(
    state: GameState,
    actor: string,
    selectedProtocol: string
): GameState {
    let newState = { ...state };

    // Store the stated protocol for subsequent effects
    newState.lastStatedProtocol = selectedProtocol;

    // Log the action
    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, actor as any, `${actorName} states the protocol "${selectedProtocol}".`);

    // Clear actionRequired
    newState.actionRequired = null;

    return newState;
}
