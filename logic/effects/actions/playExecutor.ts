/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Play Effect Executor
 *
 * Handles all play-related effects (play cards from hand/deck to board).
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext, AnimationRequest } from '../../../types';
import { log } from '../../utils/log';
import { v4 as uuidv4 } from 'uuid';
import { findCardOnBoard } from '../../game/helpers/actionUtils';
import { drawCards } from '../../../utils/gameStateModifiers';
import { executeOnCoverEffect } from '../../effectExecutor';

/**
 * Execute PLAY effect
 */
export function executePlayEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner, opponent } = context;
    const count = params.count || 1;
    const source = params.source || 'hand';
    // CRITICAL: Only set faceDown if explicitly defined in params
    // If undefined, the resolver will use normal game rules (face-down if not matching protocol)
    const faceDown = params.faceDown; // Can be true, false, or undefined
    const actor = params.actor === 'opponent' ? opponent : cardOwner;

    // CRITICAL: Water-1 logic - Automatic play from deck to each other line
    // If playing from deck with each_other_line, play automatically WITHOUT user interaction
    if (source === 'deck' && params.destinationRule?.type === 'each_other_line') {
        const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
        if (otherLaneIndices.length === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            let newState = log(state, cardOwner, `[Custom Play effect] ${actor} has no cards in deck/discard - skipping.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, otherLaneIndices.length);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play (face-down)
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: false }));

        // Add cards to lanes
        const newPlayerLanes = [...playerState.lanes];
        for (let i = 0; i < newCardsToPlay.length; i++) {
            const targetLaneIndex = otherLaneIndices[i];
            newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCardsToPlay[i]];
        }

        const updatedPlayerState = {
            ...playerState,
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...state,
            [actor]: updatedPlayerState
        };

        // Generic log message (not card-specific!)
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down in other lines.`);
        return { newState };
    }

    // NEW: Life-0 logic - Automatic play from deck to "each line where you/opponent have a card"
    if (source === 'deck' && params.destinationRule?.type === 'each_line_with_card') {
        const ownerFilter = params.destinationRule.ownerFilter || 'any';
        const playerToCheck = ownerFilter === 'own' ? actor :
                             ownerFilter === 'opponent' ? (actor === 'player' ? 'opponent' : 'player') :
                             null;

        // Find all lanes where the specified player has cards
        const lanesWithCards: number[] = [];
        for (let i = 0; i < 3; i++) {
            if (playerToCheck) {
                // Check specific player's lanes
                if (state[playerToCheck].lanes[i].length > 0) {
                    lanesWithCards.push(i);
                }
            } else {
                // Check if ANY player has a card in this lane
                if (state.player.lanes[i].length > 0 || state.opponent.lanes[i].length > 0) {
                    lanesWithCards.push(i);
                }
            }
        }

        if (lanesWithCards.length === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            let newState = log(state, cardOwner, `[Custom Play effect] ${actor} has no cards in deck/discard - skipping.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, lanesWithCards.length);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play (face-down)
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: !faceDown }));

        // Execute on-cover effects for covered cards before playing
        let stateAfterOnCover = state;
        const onCoverAnimations: AnimationRequest[] = [];

        for (let i = 0; i < lanesWithCards.length; i++) {
            const targetLaneIndex = lanesWithCards[i];
            const lane = stateAfterOnCover[actor].lanes[targetLaneIndex];

            if (lane.length > 0) {
                const cardToBeCovered = lane[lane.length - 1];
                const coverContext: EffectContext = {
                    ...context,
                    triggerType: 'cover'
                };
                const onCoverResult = executeOnCoverEffect(cardToBeCovered, targetLaneIndex, stateAfterOnCover, coverContext);
                stateAfterOnCover = onCoverResult.newState;
                if (onCoverResult.animationRequests) {
                    onCoverAnimations.push(...onCoverResult.animationRequests);
                }
                if (stateAfterOnCover.actionRequired) {
                    break;
                }
            }
        }

        // Add cards to lanes
        const newPlayerLanes = [...stateAfterOnCover[actor].lanes];
        const playAnimations: AnimationRequest[] = [];

        for (let i = 0; i < newCardsToPlay.length; i++) {
            const targetLaneIndex = lanesWithCards[i];
            newPlayerLanes[targetLaneIndex] = [...newPlayerLanes[targetLaneIndex], newCardsToPlay[i]];

            // Add play animation for each card
            playAnimations.push({
                type: 'play',
                cardId: newCardsToPlay[i].id,
                owner: actor
            });
        }

        const updatedPlayerState = {
            ...stateAfterOnCover[actor],
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...stateAfterOnCover,
            [actor]: updatedPlayerState
        };

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        const ownerText = ownerFilter === 'own' ? 'where you have a card' :
                         ownerFilter === 'opponent' ? 'where opponent has a card' :
                         'with a card';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down in each line ${ownerText}.`);

        // Combine all animations: on_cover animations first, then play animations
        const allAnimations = [...onCoverAnimations, ...playAnimations];

        return {
            newState,
            animationRequests: allAnimations.length > 0 ? allAnimations : undefined
        };
    }

    // NEW: Life-3 logic - Prompt user to select "another line" to play from deck
    if (source === 'deck' && params.destinationRule?.type === 'another_line') {
        console.log(`[another_line] Life-3 triggered! laneIndex=${laneIndex}, source=${source}`);
        const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
        console.log(`[another_line] Other lane indices: ${otherLaneIndices}`);
        if (otherLaneIndices.length === 0) {
            console.log(`[another_line] No other lanes available!`);
            return { newState: state };
        }

        // CRITICAL: Prompt user to select a lane (not automatic!)
        let newState = log(state, cardOwner, `[Custom Play effect - select another line to play]`);
        newState.actionRequired = {
            type: 'select_lane_for_play',
            sourceCardId: card.id,
            actor,
            count: params.count || 1,
            isFaceDown: params.faceDown,  // CRITICAL: Must be isFaceDown, not faceDown!
            excludeCurrentLane: true,  // Life-3: Can't select the current lane
            currentLaneIndex: laneIndex,  // Track which lane to exclude
            source: params.source,  // 'deck'
        } as any;

        console.log(`[another_line] Created prompt for user to select lane`);
        return { newState };
    }

    // NEW: Gravity-0 logic - Conditional play "For every X cards in this line, play from deck under this card"
    if (source === 'deck' && params.destinationRule?.type === 'under_this_card' && params.condition?.type === 'per_x_cards_in_line') {
        const cardCount = params.condition.cardCount || 2;

        // Calculate total cards in this line (both players)
        const cardsInPlayerLane = state[cardOwner].lanes[laneIndex].length;
        const cardsInOpponentLane = state[opponent].lanes[laneIndex].length;
        const totalCardsInLine = cardsInPlayerLane + cardsInOpponentLane;

        // Calculate how many cards to play (totalCards / cardCount, rounded down)
        const cardsToPlayCount = Math.floor(totalCardsInLine / cardCount);

        if (cardsToPlayCount === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            return { newState: state };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, cardsToPlayCount);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play (face-down)
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: false }));

        // Add cards UNDER the source card (splice before the last card)
        const targetLane = [...playerState.lanes[laneIndex]];
        targetLane.splice(targetLane.length - 1, 0, ...newCardsToPlay);

        const newPlayerLanes = [...playerState.lanes];
        newPlayerLanes[laneIndex] = targetLane;

        const updatedPlayerState = {
            ...playerState,
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...state,
            [actor]: updatedPlayerState
        };

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down under itself.`);
        return { newState };
    }

    // NEW: Gravity-6 logic - Automatic play from deck to specific lane
    // Resolve laneIndex: 'current' to actual lane number
    if (source === 'deck' && params.destinationRule?.type === 'specific_lane') {
        const resolvedLaneIndex = params.destinationRule.laneIndex === 'current'
            ? laneIndex
            : params.destinationRule.laneIndex;

        if (resolvedLaneIndex === undefined || resolvedLaneIndex < 0 || resolvedLaneIndex > 2) {
            console.error(`[Play Effect] Invalid lane index: ${resolvedLaneIndex}`);
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            let newState = log(state, cardOwner, `[Custom Play effect] ${actor} has no cards in deck/discard - skipping.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, count);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: !faceDown }));

        // Add cards to the specific lane
        const newPlayerLanes = [...playerState.lanes];
        newPlayerLanes[resolvedLaneIndex] = [...newPlayerLanes[resolvedLaneIndex], ...newCardsToPlay];

        const updatedPlayerState = {
            ...playerState,
            lanes: newPlayerLanes,
            deck: remainingDeck,
            discard: newDiscard
        };

        let newState = {
            ...state,
            [actor]: updatedPlayerState
        };

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        const actorName = actor === 'player' ? 'Player' : 'Opponent';
        const faceText = faceDown ? 'face-down' : 'face-up';
        const protocolName = state.player.protocols[resolvedLaneIndex];
        newState = log(newState, cardOwner, `${sourceCardName}: ${actorName} plays ${drawnCards.length} card(s) ${faceText} in ${protocolName} line.`);
        return { newState };
    }

    // CRITICAL FIX: Check if actor has any cards in hand to play
    if (source === 'hand' && state[actor].hand.length === 0) {
        console.log(`[Play Effect] ${actor} has no cards in hand to play - skipping effect.`);
        return { newState: state };
    }

    let newState = log(state, cardOwner, `[Custom Play effect - playing ${count} card(s) ${faceDown ? 'face-down' : 'face-up'} from ${source}]`);

    // Convert destinationRule to disallowedLaneIndex for compatibility with existing UI logic
    let disallowedLaneIndex: number | undefined = undefined;
    if (params.destinationRule?.excludeCurrentLane) {
        disallowedLaneIndex = laneIndex;
    }

    newState.actionRequired = {
        type: 'select_card_from_hand_to_play',
        count,
        sourceCardId: card.id,
        actor,
        faceDown,
        source,
        disallowedLaneIndex, // Converted from destinationRule
        destinationRule: params.destinationRule, // Keep original for future use
        condition: params.condition, // For conditional play (Gravity-0, Life-0)
    } as any;

    return { newState };
}
