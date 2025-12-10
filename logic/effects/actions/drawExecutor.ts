/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Draw Effect Executor
 *
 * Handles all draw-related effects.
 * Extracted 1:1 from effectInterpreter.ts for modularity.
 */

import { GameState, Player, PlayedCard, EffectResult, EffectContext } from '../../../types';
import { log } from '../../utils/log';
import { v4 as uuidv4 } from 'uuid';
import { processReactiveEffects } from '../../game/reactiveEffectProcessor';
import { findCardOnBoard } from '../../game/helpers/actionUtils';
import { getEffectiveCardValue, getPlayerLaneValue } from '../../game/stateManager';

/**
 * Helper function to draw cards from deck
 */
function drawCardsUtil(
    deck: any[],
    hand: any[],
    count: number
): { drawnCards: any[]; remainingDeck: any[]; newCards: any[] } {
    const actualDrawCount = Math.min(count, deck.length);
    // Convert deck cards to PlayedCard objects with unique IDs
    const newCards = deck.slice(0, actualDrawCount).map(c => ({
        ...c,
        id: uuidv4(),
        isFaceUp: true
    }));
    const drawnCards = [...hand, ...newCards];
    const remainingDeck = deck.slice(actualDrawCount);
    return { drawnCards, remainingDeck, newCards };
}

/**
 * Execute DRAW effect
 */
export function executeDrawEffect(
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext,
    params: any
): EffectResult {
    const { cardOwner } = context;
    const target = params.target || 'self';
    const drawingPlayer = target === 'opponent' ? context.opponent : cardOwner;

    // NEW: Calculate draw count based on conditional (Anarchy-0)
    if (params.conditional) {
        let dynamicCount = 0;

        switch (params.conditional.type) {
            case 'non_matching_protocols': {
                // Anarchy-0: "For each line that contains a face-up card without matching protocol, draw 1 card"
                for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
                    const playerProtocol = state.player.protocols[laneIdx];
                    const opponentProtocol = state.opponent.protocols[laneIdx];

                    // Get all face-up cards in this line (both players' stacks)
                    const playerCardsInLane = state.player.lanes[laneIdx].filter(c => c.isFaceUp);
                    const opponentCardsInLane = state.opponent.lanes[laneIdx].filter(c => c.isFaceUp);
                    const allFaceUpCardsInLane = [...playerCardsInLane, ...opponentCardsInLane];

                    // Check if ANY face-up card in this line doesn't match EITHER protocol
                    const hasNonMatchingCard = allFaceUpCardsInLane.some(c =>
                        c.protocol !== playerProtocol && c.protocol !== opponentProtocol
                    );

                    if (hasNonMatchingCard) {
                        dynamicCount++;
                    }
                }
                console.log(`[Draw Effect] non_matching_protocols: ${dynamicCount} lanes have non-matching face-up cards`);
                break;
            }

            case 'count_face_down': {
                // Count ALL face-down cards on the entire board (both players, all lanes)
                let totalFaceDown = 0;
                for (const player of ['player', 'opponent'] as Player[]) {
                    for (const lane of state[player].lanes) {
                        totalFaceDown += lane.filter(c => !c.isFaceUp).length;
                    }
                }
                dynamicCount = totalFaceDown;
                console.log(`[Draw Effect] count_face_down: ${dynamicCount} face-down cards on entire board`);
                break;
            }

            case 'is_covering': {
                // Life-4: Check if this card is covering another card
                // The card has already been played and added to the lane
                // If lane has > 1 card, then this card is covering something
                const lane = state[cardOwner].lanes[laneIndex];
                const isCovering = lane.length > 1;
                dynamicCount = isCovering ? (params.count || 1) : 0;
                console.log(`[Draw Effect] is_covering: ${isCovering ? 'yes' : 'no'} (lane has ${lane.length} cards)`);
                break;
            }
        }

        // Use dynamic count from conditional
        let count = dynamicCount;

        if (count <= 0) {
            console.log(`[Draw Effect] Conditional count is ${count}, skipping draw`);
            return { newState: state };
        }

        // Jump to draw execution
        const { drawnCards, remainingDeck, newCards } = drawCardsUtil(
            state[drawingPlayer].deck,
            state[drawingPlayer].hand,
            count
        );

        let newState = { ...state };
        newState[drawingPlayer] = {
            ...newState[drawingPlayer],
            deck: remainingDeck,
            hand: drawnCards,
        };

        const playerName = drawingPlayer === 'player' ? 'Player' : 'Opponent';
        // Generate log text based on conditional type
        let reasonText = '';
        switch (params.conditional.type) {
            case 'non_matching_protocols':
                reasonText = ' from non-matching protocols';
                break;
            case 'is_covering':
                reasonText = ' (this card is covering another)';
                break;
            case 'count_face_down':
                reasonText = ' (for face-down cards)';
                break;
            default:
                reasonText = '';
        }
        // Format the drawn card names for log - only show to player who drew them
        const drawnCardsText = (newCards.length > 0 && drawingPlayer === 'player')
            ? ` (${newCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
            : '';
        newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''}${reasonText}${drawnCardsText}.`);

        // CRITICAL: Trigger reactive effects after draw (Spirit-3)
        if (count > 0) {
            const reactiveResult = processReactiveEffects(newState, 'after_draw', { player: drawingPlayer, count });
            newState = reactiveResult.newState;
        }

        // Add draw animation request
        const animationRequests = count > 0 ? [{ type: 'draw' as const, player: drawingPlayer, count }] : undefined;

        return { newState, animationRequests };
    }

    // NEW: Calculate draw count based on countType
    let count = params.count || 1;
    const countType = params.countType || 'fixed';

    switch (countType) {
        case 'equal_to_card_value': {
            // Light-0: "Flip 1 card. Draw cards equal to that card's value"
            // Use lastCustomEffectTargetCardId from state (set by previous effect)
            const targetCardId = state.lastCustomEffectTargetCardId;
            console.log(`[Draw Effect - Light-0 DEBUG] Starting equal_to_card_value check`);
            console.log(`[Draw Effect - Light-0 DEBUG] lastCustomEffectTargetCardId: ${targetCardId}`);
            console.log(`[Draw Effect - Light-0 DEBUG] Full state keys:`, Object.keys(state));
            console.log(`[Draw Effect - Light-0 DEBUG] actionRequired:`, state.actionRequired?.type);

            if (targetCardId) {
                const targetCardInfo = findCardOnBoard(state, targetCardId);
                console.log(`[Draw Effect - Light-0 DEBUG] findCardOnBoard result:`, targetCardInfo ? `${targetCardInfo.card.protocol}-${targetCardInfo.card.value}` : 'null');

                if (targetCardInfo) {
                    const targetOwner = targetCardInfo.owner;
                    const laneContext = state[targetOwner].lanes.find(l => l.some(c => c.id === targetCardId)) || [];
                    count = getEffectiveCardValue(targetCardInfo.card, laneContext);
                    console.log(`[Draw Effect] Using referenced card value: ${count} from card ${targetCardInfo.card.protocol}-${targetCardInfo.card.value}`);
                } else {
                    // Card was removed from board (e.g., Water-4 returned to hand after flip)
                    count = 0;
                    let newState = log(state, cardOwner, `Cannot draw cards - referenced card is no longer on board (was returned/deleted).`);
                    console.log(`[Draw Effect] Referenced card not found on board - was likely returned/deleted by its own effect. Skipping draw.`);
                    return { newState };
                }
            } else {
                count = context.referencedCardValue || 0;
                console.log(`[Draw Effect - Light-0 DEBUG] No lastCustomEffectTargetCardId, using context.referencedCardValue: ${count}`);
            }
            break;
        }

        case 'equal_to_discarded':
            // Fire-4: "Discard 1 or more cards. Draw the amount discarded plus 1"
            count = (context.discardedCount || 0) + (params.countOffset || 0);
            console.log(`[Draw Effect] Using discarded count: ${context.discardedCount} + offset ${params.countOffset} = ${count}`);
            break;

        case 'hand_size':
        case 'previous_hand_size':
            // Chaos-4 End: "Discard your hand. Draw the same amount of cards"
            // Use previousHandSize from the discard action if available
            count = (context as any).previousHandSize || context.handSize || 0;
            console.log(`[Draw Effect] Using previous hand size: ${count}`);
            break;

        case 'count_face_down': {
            // Frost_custom-0: "Draw 1 card for each face-down card"
            // Count ALL face-down cards on the entire board (both players, all lanes)
            let totalFaceDown = 0;
            for (const player of ['player', 'opponent'] as Player[]) {
                for (const lane of state[player].lanes) {
                    totalFaceDown += lane.filter(c => !c.isFaceUp).length;
                }
            }
            count = totalFaceDown * (params.count || 1);
            console.log(`[Draw Effect] count_face_down: ${totalFaceDown} face-down cards on board, drawing ${count} cards`);
            break;
        }

        case 'all_matching': {
            // Clarity-2/3: "Draw all cards with a value of X"
            // This draws ALL matching cards from deck, not a fixed count
            if (params.valueFilter?.equals !== undefined) {
                const targetValue = params.valueFilter.equals;
                const matchingCardsInDeck = state[drawingPlayer].deck.filter(c => c.value === targetValue);
                count = matchingCardsInDeck.length;
                console.log(`[Draw Effect] all_matching: ${count} cards with value ${targetValue} in deck`);
            } else {
                console.log(`[Draw Effect] all_matching: No valueFilter specified, defaulting to 0`);
                count = 0;
            }
            break;
        }

        case 'fixed':
        default:
            // Standard fixed count
            count = params.count || 1;
            break;
    }

    // Prevent drawing 0 or negative cards
    if (count <= 0) {
        console.log(`[Draw Effect] Count is ${count}, skipping draw`);
        console.log(`[Draw Effect DEBUG] Returning state - turn: ${state.turn}, phase: ${state.phase}, actionRequired: ${state.actionRequired?.type || 'null'}`);
        return { newState: state };
    }

    // NEW: Advanced Conditional - Protocol Matching (Anarchy-6)
    if (params.advancedConditional?.type === 'protocol_match') {
        const requiredProtocol = params.advancedConditional.protocol;
        const cardProtocol = state[cardOwner].protocols[laneIndex];

        if (cardProtocol !== requiredProtocol) {
            console.log(`[Draw Effect] Protocol match failed: card is in ${cardProtocol} lane, requires ${requiredProtocol}. Skipping draw.`);
            return { newState: state };
        }
        console.log(`[Draw Effect] Protocol match success: card is in ${cardProtocol} lane (requires ${requiredProtocol}).`);
    }

    // NEW: Advanced Conditional - Empty Hand (Courage-0)
    if (params.advancedConditional?.type === 'empty_hand') {
        if (state[drawingPlayer].hand.length > 0) {
            console.log(`[Draw Effect] Empty hand check failed: ${state[drawingPlayer].hand.length} cards in hand. Skipping draw.`);
            return { newState: state };
        }
        console.log(`[Draw Effect] Empty hand check passed: hand is empty.`);
    }

    // NEW: Advanced Conditional - Opponent Higher Value in Lane (Courage-2)
    if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';
        const ownValue = getPlayerLaneValue(state, cardOwner, laneIndex);
        const oppValue = getPlayerLaneValue(state, opponent, laneIndex);

        if (oppValue <= ownValue) {
            console.log(`[Draw Effect] Opponent higher value check failed: own=${ownValue}, opponent=${oppValue}. Skipping draw.`);
            return { newState: state };
        }
        console.log(`[Draw Effect] Opponent higher value check passed: own=${ownValue}, opponent=${oppValue}.`);
    }

    // NEW: Advanced Conditional - Compile Block (Metal-1)
    let newState = { ...state };
    if (params.advancedConditional?.type === 'compile_block') {
        const duration = params.advancedConditional.turnDuration || 1;
        const opponent = cardOwner === 'player' ? 'opponent' : 'player';

        // Set compile block flag on opponent
        newState = {
            ...newState,
            compileBlockedUntilTurn: ((newState as any).turnNumber || 0) + duration,
            compileBlockedPlayer: opponent,
        } as any;

        console.log(`[Draw Effect] Opponent's compile blocked for ${duration} turn(s).`);
        newState = log(newState, cardOwner, `Opponent can't compile for ${duration} turn${duration !== 1 ? 's' : ''}.`);
    }

    // NEW: Handle optional draw (Death-1: "You may draw 1 card")
    if (params.optional) {
        console.log('[Draw Effect] Creating prompt_optional_draw for optional draw, card:', card.protocol, '-', card.value);
        newState.actionRequired = {
            type: 'prompt_optional_draw',
            sourceCardId: card.id,
            actor: cardOwner,
            count,
            drawingPlayer,
        } as any;

        return { newState };
    }

    // NEW: Handle source = 'opponent_deck' (Love-1: "Draw the top card of your opponent's deck")
    const source = params.source || 'own_deck';
    const sourcePlayer = source === 'opponent_deck' ? context.opponent : drawingPlayer;

    // NEW: Handle all_matching with valueFilter - draw SPECIFIC cards from deck
    let drawnCards: any[];
    let remainingDeck: any[];
    let newCards: any[] = [];

    if (countType === 'all_matching' && params.valueFilter?.equals !== undefined) {
        // Draw all cards matching the value filter
        const targetValue = params.valueFilter.equals;
        const deck = newState[sourcePlayer].deck;

        // Find and extract matching cards
        const matchingCards = deck.filter(c => c.value === targetValue);
        const nonMatchingCards = deck.filter(c => c.value !== targetValue);

        // Convert to PlayedCards with IDs
        newCards = matchingCards.map(c => ({
            ...c,
            id: uuidv4(),
            isFaceUp: true
        }));

        drawnCards = [...newState[drawingPlayer].hand, ...newCards];
        remainingDeck = nonMatchingCards;

        console.log(`[Draw Effect] all_matching: Extracted ${newCards.length} cards with value ${targetValue}`);
    } else if (params.valueFilter?.equals !== undefined && params.fromRevealed) {
        // Clarity-2/3: "Draw 1 card with a value of X revealed this way."
        // Player must SELECT from the revealed deck - ALWAYS show modal so player can see the deck
        const targetValue = params.valueFilter.equals;
        const deck = newState[sourcePlayer].deck;

        // Find all matching cards in deck that player can choose from
        const matchingCards = deck.filter(c => c.value === targetValue);

        if (matchingCards.length === 0) {
            // No matching cards - log message but DON'T return, let subsequent effects (shuffle, play) continue
            const cardName = `${card.protocol}-${card.value}`;
            newState = log(newState, drawingPlayer, `${cardName}: No cards with value ${targetValue} in deck.`);
            // Don't return - fall through to let the effect chain continue
            console.log(`[Draw Effect] fromRevealed: No matching cards, continuing with effect chain`);
        } else {
            // 1 or more options - ALWAYS show modal so player can see the revealed deck
            newState.actionRequired = {
                type: 'select_card_from_revealed_deck',
                sourceCardId: card.id,
                actor: drawingPlayer,
                count: count,
                valueFilter: targetValue,
                revealedCards: deck, // Show all deck cards
                selectableCardIds: matchingCards.map((c: any) => c.id || `deck-${deck.indexOf(c)}`), // IDs of selectable cards
            } as any;

            console.log(`[Draw Effect] fromRevealed: Prompting player to select ${count} card(s) with value ${targetValue} from ${matchingCards.length} options`);
            return { newState };
        }
    } else if (params.valueFilter?.equals !== undefined) {
        // Auto-draw cards with specific value (non-interactive)
        const targetValue = params.valueFilter.equals;
        const deck = [...newState[sourcePlayer].deck];

        // Find matching cards in deck
        const matchingIndices: number[] = [];
        for (let i = 0; i < deck.length && matchingIndices.length < count; i++) {
            if (deck[i].value === targetValue) {
                matchingIndices.push(i);
            }
        }

        // Extract the matching cards (take from front to back)
        const matchingCards = matchingIndices.map(i => deck[i]);
        const remainingCards = deck.filter((_, i) => !matchingIndices.includes(i));

        // Convert to PlayedCards with IDs
        newCards = matchingCards.map(c => ({
            ...c,
            id: uuidv4(),
            isFaceUp: true
        }));

        drawnCards = [...newState[drawingPlayer].hand, ...newCards];
        remainingDeck = remainingCards;

        console.log(`[Draw Effect] valueFilter: Drew ${newCards.length} of ${count} requested cards with value ${targetValue}`);
    } else {
        // Simple draw without conditionals for now
        const result = drawCardsUtil(
            newState[sourcePlayer].deck,
            newState[drawingPlayer].hand,
            count
        );
        drawnCards = result.drawnCards;
        remainingDeck = result.remainingDeck;
        newCards = result.newCards;
    }

    // Update the source player's deck (might be opponent's deck!)
    newState[sourcePlayer] = {
        ...newState[sourcePlayer],
        deck: remainingDeck,
    };

    // Update the drawing player's hand
    newState[drawingPlayer] = {
        ...newState[drawingPlayer],
        hand: drawnCards,
    };

    const playerName = drawingPlayer === 'player' ? 'Player' : 'Opponent';

    // Format the drawn card names for log - only show to player who drew them
    const drawnCardsText = (newCards.length > 0 && drawingPlayer === 'player')
        ? ` (${newCards.map(c => `${c.protocol}-${c.value}`).join(', ')})`
        : '';

    if (source === 'opponent_deck') {
        const opponentName = sourcePlayer === 'player' ? "Player's" : "Opponent's";
        newState = log(newState, drawingPlayer, `${playerName} draws the top ${count === 1 ? 'card' : `${count} cards`} of ${opponentName} deck${drawnCardsText}.`);
    } else {
        newState = log(newState, drawingPlayer, `${playerName} draws ${count} card${count !== 1 ? 's' : ''}${drawnCardsText}.`);
    }

    // CRITICAL: Trigger reactive effects after draw (Spirit-3)
    if (drawnCards.length > 0) {
        const reactiveResult = processReactiveEffects(newState, 'after_draw', { player: drawingPlayer, count: drawnCards.length });
        newState = reactiveResult.newState;
    }

    // TEMPORARY FIX: Don't return animation for custom protocol draws to avoid blocking hand interactions
    // The animation causes a race condition where Check Cache runs while animation is still playing
    // TODO: Fix the async timing properly
    // const animationRequests = drawnCards.length > 0 ? [{ type: 'draw' as const, player: drawingPlayer, count: drawnCards.length }] : undefined;

    return { newState };
}
