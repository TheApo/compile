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
import { getPlayerLaneValue } from '../../game/stateManager';

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
    // Extract conditional info for "If you do" effects
    const conditional = params._conditional;
    const count = params.count || 1;
    const source = params.source || 'hand';
    // CRITICAL: Only set faceDown if explicitly defined in params
    // If undefined, the resolver will use normal game rules (face-down if not matching protocol)
    const faceDown = params.faceDown; // Can be true, false, or undefined
    const actor = params.actor === 'opponent' ? opponent : cardOwner;

    // Advanced Conditional Checks - skip effect if condition not met
    if (params.advancedConditional?.type === 'empty_hand') {
        if (state[cardOwner].hand.length > 0) {
            return { newState: state };
        }
    }
    if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
        const opp = cardOwner === 'player' ? 'opponent' : 'player';
        const ownValue = getPlayerLaneValue(state, cardOwner, laneIndex);
        const oppValue = getPlayerLaneValue(state, opp, laneIndex);
        if (oppValue <= ownValue) {
            return { newState: state };
        }
    }

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
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            let newState = log(state, cardOwner, `${actorName} has no cards in deck/discard - effect skipped.`);
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

        // Update detailed game stats for cards played from effect (face-down)
        if (newState.detailedGameStats && drawnCards.length > 0) {
            const fromEffectKey = actor === 'player' ? 'playerFromEffect' : 'aiFromEffect';
            const faceDownKey = actor === 'player' ? 'playerFaceDown' : 'aiFaceDown';
            newState = {
                ...newState,
                detailedGameStats: {
                    ...newState.detailedGameStats,
                    cardsPlayed: {
                        ...newState.detailedGameStats.cardsPlayed,
                        [fromEffectKey]: newState.detailedGameStats.cardsPlayed[fromEffectKey] + drawnCards.length,
                        [faceDownKey]: newState.detailedGameStats.cardsPlayed[faceDownKey] + drawnCards.length
                    }
                }
            };
        }

        // Generic log message (not card-specific!)
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down in other lines.`);
        return { newState };
    }

    // NEW: Life-0 logic - Automatic play from deck to "each line where you/opponent have a card"
    // Extended for Smoke-0: cardFilter to check for face-down cards specifically
    if (source === 'deck' && params.destinationRule?.type === 'each_line_with_card') {
        const ownerFilter = params.destinationRule.ownerFilter || 'any';
        const cardFilter = params.destinationRule.cardFilter;
        const playerToCheck = ownerFilter === 'own' ? actor :
                             ownerFilter === 'opponent' ? (actor === 'player' ? 'opponent' : 'player') :
                             null;

        // Helper to check if a lane has cards matching the filter
        const laneHasMatchingCards = (laneIdx: number): boolean => {
            const checkLane = (playerLanes: PlayedCard[]): boolean => {
                if (playerLanes.length === 0) return false;
                if (!cardFilter) return true; // No filter = any card matches

                // Check if any card in lane matches the faceState filter
                return playerLanes.some(c => {
                    if (cardFilter.faceState === 'face_down') return !c.isFaceUp;
                    if (cardFilter.faceState === 'face_up') return c.isFaceUp;
                    return true;
                });
            };

            if (playerToCheck) {
                return checkLane(state[playerToCheck].lanes[laneIdx]);
            } else {
                // Check both players' lanes
                return checkLane(state.player.lanes[laneIdx]) || checkLane(state.opponent.lanes[laneIdx]);
            }
        };

        // Find all lanes where the specified player has cards (with optional filter)
        const lanesWithCards: number[] = [];
        for (let i = 0; i < 3; i++) {
            if (laneHasMatchingCards(i)) {
                lanesWithCards.push(i);
            }
        }

        if (lanesWithCards.length === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has enough cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            let newState = log(state, cardOwner, `${actorName} has no cards in deck/discard - effect skipped.`);
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

        // Update detailed game stats for cards played from effect (face-down)
        if (newState.detailedGameStats && drawnCards.length > 0) {
            const fromEffectKey = actor === 'player' ? 'playerFromEffect' : 'aiFromEffect';
            const faceDownKey = actor === 'player' ? 'playerFaceDown' : 'aiFaceDown';
            newState = {
                ...newState,
                detailedGameStats: {
                    ...newState.detailedGameStats,
                    cardsPlayed: {
                        ...newState.detailedGameStats.cardsPlayed,
                        [fromEffectKey]: newState.detailedGameStats.cardsPlayed[fromEffectKey] + drawnCards.length,
                        [faceDownKey]: newState.detailedGameStats.cardsPlayed[faceDownKey] + drawnCards.length
                    }
                }
            };
        }

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        // Build description text based on filters
        let filterText = '';
        if (cardFilter?.faceState === 'face_down') {
            filterText = 'with a face-down card';
        } else if (cardFilter?.faceState === 'face_up') {
            filterText = 'with a face-up card';
        } else if (ownerFilter === 'own') {
            filterText = 'where you have a card';
        } else if (ownerFilter === 'opponent') {
            filterText = 'where opponent has a card';
        } else {
            filterText = 'with a card';
        }
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down in each line ${filterText}.`);

        // Combine all animations: on_cover animations first, then play animations
        const allAnimations = [...onCoverAnimations, ...playAnimations];

        return {
            newState,
            animationRequests: allAnimations.length > 0 ? allAnimations : undefined
        };
    }

    // NEW: Life-3/Luck-1 logic - Play from deck to "another line"
    // Step 1: Draw the card and show preview modal
    // Step 2: After confirmation, select lane
    if (source === 'deck' && params.destinationRule?.type === 'another_line') {
        const otherLaneIndices = [0, 1, 2].filter(i => i !== laneIndex);
        if (otherLaneIndices.length === 0) {
            return { newState: state };
        }

        const playerState = state[actor];

        // Check if deck has cards
        if (playerState.deck.length === 0 && playerState.discard.length === 0) {
            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            let newState = log(state, cardOwner, `${actorName} has no cards in deck/discard - effect skipped.`);
            return { newState };
        }

        // Draw ONE card from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(playerState.deck, playerState.discard, 1);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create the card that will be played
        const drawnCard = { ...drawnCards[0], id: uuidv4(), isFaceUp: true };

        // Update state with remaining deck
        let newState = {
            ...state,
            [actor]: {
                ...playerState,
                deck: remainingDeck,
                discard: newDiscard
            }
        };

        // Show preview modal first (before lane selection)
        newState.actionRequired = {
            type: 'confirm_deck_play_preview',
            sourceCardId: card.id,
            actor,
            drawnCard,  // The card that was drawn
            isFaceDown: params.faceDown,
            excludeCurrentLane: true,
            currentLaneIndex: laneIndex,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;

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

        // Update detailed game stats for cards played from effect (Gravity-0, face-down)
        if (newState.detailedGameStats && drawnCards.length > 0) {
            const fromEffectKey = actor === 'player' ? 'playerFromEffect' : 'aiFromEffect';
            const faceDownKey = actor === 'player' ? 'playerFaceDown' : 'aiFaceDown';
            newState = {
                ...newState,
                detailedGameStats: {
                    ...newState.detailedGameStats,
                    cardsPlayed: {
                        ...newState.detailedGameStats.cardsPlayed,
                        [fromEffectKey]: newState.detailedGameStats.cardsPlayed[fromEffectKey] + drawnCards.length,
                        [faceDownKey]: newState.detailedGameStats.cardsPlayed[faceDownKey] + drawnCards.length
                    }
                }
            };
        }

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        newState = log(newState, cardOwner, `${sourceCardName}: Plays ${drawnCards.length} card(s) face-down under itself.`);
        return { newState };
    }

    // NEW: Gravity-6 logic - Automatic play from deck to specific lane
    // Extended for Assimilation-2/6: sourceOwner and targetBoard parameters
    // Resolve laneIndex: 'current' to actual lane number
    if (source === 'deck' && params.destinationRule?.type === 'specific_lane') {
        const resolvedLaneIndex = params.destinationRule.laneIndex === 'current'
            ? laneIndex
            : params.destinationRule.laneIndex;

        if (resolvedLaneIndex === undefined || resolvedLaneIndex < 0 || resolvedLaneIndex > 2) {
            console.error(`[Play Effect] Invalid lane index: ${resolvedLaneIndex}`);
            return { newState: state };
        }

        // CRITICAL FIX: Use 'actor' as the base player for deck and lanes!
        // When Gravity-6 is played by opponent (AI), actor='player' means PLAYER draws and plays
        // sourceOwner/targetBoard override this if specified (for Assimilation effects)
        const sourceOwner = params.sourceOwner || 'own';
        const deckOwner = sourceOwner === 'opponent'
            ? (actor === 'player' ? 'opponent' : 'player')  // Opponent of actor
            : actor;  // Actor's own deck
        const deckOwnerState = state[deckOwner];

        // NEW: targetBoard determines which board the card is played on (Assimilation-6: opponent's board)
        const targetBoard = params.targetBoard || 'own';
        const targetPlayer = targetBoard === 'opponent'
            ? (actor === 'player' ? 'opponent' : 'player')  // Opponent of actor
            : actor;  // Actor's own board

        // Check if deck has enough cards
        if (deckOwnerState.deck.length === 0 && deckOwnerState.discard.length === 0) {
            const deckOwnerName = sourceOwner === 'opponent' ? "opponent's" : 'your';
            let newState = log(state, cardOwner, `No cards in ${deckOwnerName} deck/discard - effect skipped.`);
            return { newState };
        }

        // Draw cards from deck (with auto-reshuffle if needed)
        const { drawnCards, remainingDeck, newDiscard } = drawCards(deckOwnerState.deck, deckOwnerState.discard, count);

        if (drawnCards.length === 0) {
            return { newState: state };
        }

        // Create new cards to play
        const newCardsToPlay = drawnCards.map((c: any) => ({ ...c, id: uuidv4(), isFaceUp: !faceDown }));

        // Start building new state
        let newState = { ...state };

        // Update deck owner's state (deck/discard)
        newState[deckOwner] = {
            ...newState[deckOwner],
            deck: remainingDeck,
            discard: newDiscard
        };

        // Add cards to the target player's specific lane
        const targetPlayerLanes = [...newState[targetPlayer].lanes];
        targetPlayerLanes[resolvedLaneIndex] = [...targetPlayerLanes[resolvedLaneIndex], ...newCardsToPlay];
        newState[targetPlayer] = {
            ...newState[targetPlayer],
            lanes: targetPlayerLanes
        };

        // Update detailed game stats for cards played from effect
        if (newState.detailedGameStats && drawnCards.length > 0) {
            // Stats are based on who PLAYED the card (effect owner), not where it lands
            const fromEffectKey = cardOwner === 'player' ? 'playerFromEffect' : 'aiFromEffect';
            const faceKey = cardOwner === 'player'
                ? (faceDown ? 'playerFaceDown' : 'playerFaceUp')
                : (faceDown ? 'aiFaceDown' : 'aiFaceUp');
            newState = {
                ...newState,
                detailedGameStats: {
                    ...newState.detailedGameStats,
                    cardsPlayed: {
                        ...newState.detailedGameStats.cardsPlayed,
                        [fromEffectKey]: newState.detailedGameStats.cardsPlayed[fromEffectKey] + drawnCards.length,
                        [faceKey]: newState.detailedGameStats.cardsPlayed[faceKey] + drawnCards.length
                    }
                }
            };
        }

        // Generic log message
        const sourceCardInfo = findCardOnBoard(state, card.id);
        const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'a card effect';
        const faceText = faceDown ? 'face-down' : 'face-up';
        const protocolName = state.player.protocols[resolvedLaneIndex];

        // Build descriptive log based on sourceOwner and targetBoard
        let logText = `${sourceCardName}: Plays `;
        if (sourceOwner === 'opponent') {
            logText += `the top card of opponent's deck `;
        } else {
            logText += `${drawnCards.length} card(s) from deck `;
        }
        logText += `${faceText} `;
        if (targetBoard === 'opponent') {
            logText += `on opponent's ${protocolName} line.`;
        } else {
            logText += `in ${protocolName} line.`;
        }
        newState = log(newState, cardOwner, logText);

        return { newState };
    }

    // NEW: Smoke-3 logic - Play from hand to a lane with face-down cards
    // Flow: 1. Select card from hand → 2. Select lane (only lanes with face-down cards highlighted)
    if (source === 'hand' && params.destinationRule?.type === 'line_with_matching_cards') {
        const cardFilter = params.destinationRule.cardFilter;

        // Helper to check if a lane has cards matching the filter
        const laneHasMatchingCards = (laneIdx: number): boolean => {
            const checkLane = (playerLanes: PlayedCard[]): boolean => {
                if (playerLanes.length === 0) return false;
                if (!cardFilter) return true;

                return playerLanes.some(c => {
                    if (cardFilter.faceState === 'face_down') return !c.isFaceUp;
                    if (cardFilter.faceState === 'face_up') return c.isFaceUp;
                    return true;
                });
            };

            // Check both players' lanes
            return checkLane(state.player.lanes[laneIdx]) || checkLane(state.opponent.lanes[laneIdx]);
        };

        // Find valid lanes
        const validLanes: number[] = [];
        for (let i = 0; i < 3; i++) {
            if (laneHasMatchingCards(i)) {
                validLanes.push(i);
            }
        }

        if (validLanes.length === 0) {
            const sourceCardInfo = findCardOnBoard(state, card.id);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Effect';
            let newState = log(state, cardOwner, `${sourceCardName}: No valid lanes with face-down cards. Effect skipped.`);
            return { newState };
        }

        // Check if actor has any cards in hand to play
        if (state[actor].hand.length === 0) {
            return { newState: state };
        }

        // FIXED: First select card from hand, THEN select lane
        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_card_from_hand_to_play',
            sourceCardId: card.id,
            actor,
            count: params.count || 1,
            faceDown: params.faceDown,
            source: 'hand',
            validLanes,  // Pass to lane selection step
            cardFilter,  // Pass filter for UI/AI reference
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;

        return { newState };
    }

    // NEW: Clarity-2 logic - Play from hand with valueFilter (user selects card and lane)
    // "Play 1 card with a value of 1"
    if (source === 'hand' && params.valueFilter?.equals !== undefined && !params.destinationRule) {
        const targetValue = params.valueFilter.equals;

        // Find matching cards in hand
        const matchingCards = state[actor].hand.filter(c => c.value === targetValue);

        if (matchingCards.length === 0) {
            const sourceCardInfo = findCardOnBoard(state, card.id);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Effect';
            let newState = log(state, cardOwner, `${sourceCardName}: No cards with value ${targetValue} in hand. Effect skipped.`);
            return { newState };
        }

        // Prompt user to select a card from hand with the matching value, then a lane
        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_card_from_hand_to_play',
            sourceCardId: card.id,
            actor,
            count: params.count || 1,
            faceDown: params.faceDown,
            source: 'hand',
            valueFilter: targetValue,  // Pass the value filter to UI/AI
            selectableCardIds: matchingCards.map(c => c.id),  // Only these cards can be selected
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
        } as any;

        return { newState };
    }

    // NEW: Time-0 logic - Play from trash
    // Player selects a card from their trash to play
    if (source === 'trash') {
        const trashCards = state[actor].discard;

        // Check if trash has any cards
        if (trashCards.length === 0) {
            const sourceCardInfo = findCardOnBoard(state, card.id);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Effect';
            let newState = log(state, cardOwner, `${sourceCardName}: No cards in trash. Effect skipped.`);
            return { newState };
        }

        let newState = { ...state };
        newState.actionRequired = {
            type: 'select_card_from_trash_to_play',
            sourceCardId: card.id,
            actor,
            count: params.count || 1,
            faceDown: params.faceDown,
            destinationRule: params.destinationRule,
            // CRITICAL: Pass conditional info for "If you do" effects
            followUpEffect: conditional?.thenEffect,
            conditionalType: conditional?.type,
            sourceLaneIndex: laneIndex,
        } as any;

        return { newState };
    }

    // CRITICAL FIX: Check if actor has any cards in hand to play
    if (source === 'hand' && state[actor].hand.length === 0) {
        return { newState: state };
    }

    // NEW: excludeSourceProtocol - filter out cards with same protocol as source card
    let excludeProtocolCardIds: string[] | undefined = undefined;
    if (params.excludeSourceProtocol && source === 'hand') {
        const sourceProtocol = card.protocol;
        const nonMatchingCards = state[actor].hand.filter(c => c.protocol !== sourceProtocol);

        if (nonMatchingCards.length === 0) {
            // No non-matching cards in hand - skip effect
            const sourceCardInfo = findCardOnBoard(state, card.id);
            const sourceCardName = sourceCardInfo ? `${sourceCardInfo.card.protocol}-${sourceCardInfo.card.value}` : 'Effect';
            let newState = log(state, cardOwner, `${sourceCardName}: No non-${sourceProtocol} cards in hand. Effect skipped.`);
            return { newState };
        }

        excludeProtocolCardIds = nonMatchingCards.map(c => c.id);
    }

    let newState = { ...state };

    // Convert destinationRule to disallowedLaneIndex for compatibility with existing UI logic
    let disallowedLaneIndex: number | undefined = undefined;
    if (params.destinationRule?.excludeCurrentLane) {
        disallowedLaneIndex = laneIndex;
    }

    // CRITICAL: Handle useCardFromPreviousEffect for "may play" the revealed card
    // This restricts the playable cards to ONLY the revealed/target card
    let selectableCardIds: string[] | undefined = undefined;
    if (params.useCardFromPreviousEffect && source === 'hand') {
        const targetCardId = state.lastCustomEffectTargetCardId;
        if (targetCardId) {
            // Only allow playing the specific card that was revealed/targeted
            selectableCardIds = [targetCardId];
            // Verify the card is actually in the actor's hand
            const cardInHand = state[actor].hand.find(c => c.id === targetCardId);
            if (!cardInHand) {
                // Card is not in hand (somehow) - skip the effect
                return { newState: state };
            }
        }
    }

    // If excludeSourceProtocol was set, use those card IDs (overrides useCardFromPreviousEffect)
    if (excludeProtocolCardIds) {
        selectableCardIds = excludeProtocolCardIds;
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
        selectableCardIds, // CRITICAL: Restrict to specific card(s) for "may play" effects
        excludeSourceProtocol: params.excludeSourceProtocol, // Pass for UI/AI reference
        sourceProtocol: params.excludeSourceProtocol ? card.protocol : undefined, // Pass source protocol for display
        optional: params.optional, // NEW: For optional play effects
        // CRITICAL: Pass conditional info for "If you do" effects
        followUpEffect: conditional?.thenEffect,
        conditionalType: conditional?.type,
    } as any;

    return { newState };
}
