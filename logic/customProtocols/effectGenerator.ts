/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../types";
import {
    EffectParams,
    DrawEffectParams,
    FlipEffectParams,
    ShiftEffectParams,
    DeleteEffectParams,
    DiscardEffectParams,
    ReturnEffectParams,
    PlayEffectParams,
    ProtocolEffectParams,
    RevealEffectParams
} from "../../types/customProtocol";
import { drawForPlayer, drawFromOpponentDeck, refreshHandForPlayer } from "../../utils/gameStateModifiers";
import { log } from "../utils/log";
import { isFrost1Active, isFrost1BottomActive } from "../game/passiveRuleChecker";

/**
 * Effect Generator - Converts custom effect definitions into executable effect functions
 *
 * This module allows the Custom Protocol Creator to generate effects dynamically
 * by selecting action types and configuring parameters.
 */

/**
 * Generate an executable effect function from effect parameters
 */
export const generateEffect = (params: EffectParams) => {
    return (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
        switch (params.action) {
            case 'draw':
                return executeDrawEffect(params, card, laneIndex, state, context);
            case 'flip':
                return executeFlipEffect(params, card, laneIndex, state, context);
            case 'shift':
                return executeShiftEffect(params, card, laneIndex, state, context);
            case 'delete':
                return executeDeleteEffect(params, card, laneIndex, state, context);
            case 'discard':
                return executeDiscardEffect(params, card, laneIndex, state, context);
            case 'return':
                return executeReturnEffect(params, card, laneIndex, state, context);
            case 'play':
                return executePlayEffect(params, card, laneIndex, state, context);
            case 'rearrange_protocols':
            case 'swap_protocols':
                return executeProtocolEffect(params, card, laneIndex, state, context);
            case 'reveal':
            case 'give':
                return executeRevealEffect(params, card, laneIndex, state, context);
            default:
                console.error('Unknown effect action:', params);
                return { newState: state };
        }
    };
};

/**
 * Draw Effect Implementation
 */
const executeDrawEffect = (
    params: DrawEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };
    let drawCount = params.count;

    // Handle conditional draw count
    if (params.conditional) {
        switch (params.conditional.type) {
            case 'count_face_down':
                // Count all face-down cards on board
                drawCount = 0;
                for (const player of ['player', 'opponent'] as const) {
                    for (const lane of newState[player].lanes) {
                        for (const c of lane) {
                            if (!c.isFaceUp) drawCount++;
                        }
                    }
                }
                break;

            case 'is_covering':
                // Draw 1 if this card is covering another
                const lane = newState[cardOwner].lanes[laneIndex];
                drawCount = lane.length > 1 && lane[lane.length - 1].id === card.id ? params.count : 0;
                break;

            case 'non_matching_protocols':
                // Draw 1 for each line with non-matching protocol
                drawCount = 0;
                for (let i = 0; i < 3; i++) {
                    const playerProtocol = newState[cardOwner].protocols[i];
                    const opponentProtocol = newState[context.opponent].protocols[i];

                    const allFaceUpInLane = [
                        ...newState[cardOwner].lanes[i].filter(c => c.isFaceUp),
                        ...newState[context.opponent].lanes[i].filter(c => c.isFaceUp)
                    ];

                    const hasNonMatching = allFaceUpInLane.some(c =>
                        c.protocol !== playerProtocol && c.protocol !== opponentProtocol
                    );

                    if (hasNonMatching) drawCount++;
                }
                break;
        }
    }

    // Handle refresh before drawing
    if (params.preAction === 'refresh') {
        newState = refreshHandForPlayer(newState, cardOwner);
        newState = log(newState, cardOwner, "Refresh hand.");
    }

    // Execute draw
    if (params.source === 'opponent_deck') {
        newState = drawFromOpponentDeck(newState, cardOwner, drawCount);
        newState = log(newState, cardOwner, `Draw ${drawCount} card${drawCount !== 1 ? 's' : ''} from opponent's deck.`);
    } else {
        const target = params.target === 'opponent' ? context.opponent : cardOwner;
        newState = drawForPlayer(newState, target, drawCount);
        const targetName = params.target === 'opponent' ? 'Opponent' : cardOwner === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, cardOwner, `${targetName} draw${params.target === 'self' ? 's' : ''} ${drawCount} card${drawCount !== 1 ? 's' : ''}.`);
    }

    return { newState };
};

/**
 * Flip Effect Implementation
 */
const executeFlipEffect = (
    params: FlipEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // Check Frost-1
    const frost1Active = isFrost1Active(newState);

    // Build target list
    let validTargets: PlayedCard[] = [];

    for (const player of ['player', 'opponent'] as const) {
        // Owner filter
        if (params.targetFilter.owner === 'own' && player !== cardOwner) continue;
        if (params.targetFilter.owner === 'opponent' && player === cardOwner) continue;

        for (let i = 0; i < 3; i++) {
            const lane = newState[player].lanes[i];

            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                const c = lane[cardIndex];

                // Exclude self
                if (params.targetFilter.excludeSelf && c.id === card.id) continue;

                // Position filter
                const isUncovered = cardIndex === lane.length - 1;
                if (params.targetFilter.position === 'covered' && isUncovered) continue;
                if (params.targetFilter.position === 'uncovered' && !isUncovered) continue;
                if (params.targetFilter.position === 'covered_in_this_line' && (isUncovered || i !== laneIndex)) continue;

                // Face state filter
                if (params.targetFilter.faceState === 'face_up' && !c.isFaceUp) continue;
                if (params.targetFilter.faceState === 'face_down' && c.isFaceUp) continue;

                // Frost-1 restriction
                if (frost1Active && !c.isFaceUp) continue;  // Can't flip to face-up

                validTargets.push(c);
            }
        }
    }

    if (validTargets.length === 0) {
        newState = log(newState, cardOwner, "No valid flip targets.");
        return { newState };
    }

    // Create action
    const actionType = params.optional ? 'select_any_card_to_flip_optional' : 'select_any_card_to_flip';
    newState.actionRequired = {
        type: actionType as any,
        count: params.count,
        sourceCardId: card.id,
        actor: cardOwner,
    };

    // Handle self-flip after
    if (params.selfFlipAfter) {
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            {
                type: 'flip_source_card',
                sourceCardId: card.id,
                actor: cardOwner,
            }
        ];
    }

    return { newState };
};

/**
 * Shift Effect Implementation
 */
const executeShiftEffect = (
    params: ShiftEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    newState.actionRequired = {
        type: 'select_card_to_shift' as any,
        sourceCardId: card.id,
        actor: cardOwner,
        destinationRestriction: params.destinationRestriction,
    };

    return { newState };
};

/**
 * Delete Effect Implementation
 */
const executeDeleteEffect = (
    params: DeleteEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    const count = typeof params.count === 'number' ? params.count : 999;

    newState.actionRequired = {
        type: 'select_cards_to_delete' as any,
        count,
        sourceCardId: card.id,
        actor: cardOwner,
        disallowedIds: params.excludeSelf ? [card.id] : [],
        targetFilter: params.targetFilter,
        scope: params.scope,
    };

    return { newState };
};

/**
 * Discard Effect Implementation
 */
const executeDiscardEffect = (
    params: DiscardEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    const actor = params.actor === 'opponent' ? context.opponent : cardOwner;

    if (newState[actor].hand.length === 0) {
        newState = log(newState, cardOwner, `${actor === cardOwner ? 'You have' : 'Opponent has'} no cards to discard.`);
        return { newState };
    }

    newState.actionRequired = {
        type: 'discard' as any,
        actor,
        count: params.count,
        sourceCardId: card.id,
        conditional: params.conditional,
    };

    return { newState };
};

/**
 * Return Effect Implementation
 */
const executeReturnEffect = (
    params: ReturnEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    newState.actionRequired = {
        type: 'select_cards_to_return' as any,
        count: params.count,
        sourceCardId: card.id,
        actor: cardOwner,
        targetFilter: params.targetFilter,
    };

    return { newState };
};

/**
 * Play Effect Implementation
 */
const executePlayEffect = (
    params: PlayEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    if (params.source === 'hand') {
        if (newState[cardOwner].hand.length === 0) {
            newState = log(newState, cardOwner, "No cards in hand to play.");
            return { newState };
        }

        newState.actionRequired = {
            type: 'select_card_from_hand_to_play' as any,
            sourceCardId: card.id,
            actor: cardOwner,
            isFaceDown: params.faceDown,
            destinationRule: params.destinationRule,
        };
    } else {
        // Play from deck - implementation would be more complex
        newState = log(newState, cardOwner, "Play from deck not yet implemented in custom effects.");
    }

    return { newState };
};

/**
 * Protocol Rearrange/Swap Effect Implementation
 */
const executeProtocolEffect = (
    params: ProtocolEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // Check Frost-1 Bottom
    if (isFrost1BottomActive(newState)) {
        newState = log(newState, cardOwner, "Frost-1 blocks protocol rearrangement.");
        return { newState };
    }

    const actionType = params.action === 'swap_protocols' ? 'prompt_swap_protocols' : 'prompt_rearrange_protocols';
    const target = params.target === 'opponent' ? context.opponent : cardOwner;

    newState.actionRequired = {
        type: actionType as any,
        sourceCardId: card.id,
        actor: cardOwner,
        target,
        disallowedProtocolForLane: params.restriction,
    };

    // Handle both_sequential
    if (params.target === 'both_sequential') {
        newState.queuedActions = [
            ...(newState.queuedActions || []),
            {
                type: actionType as any,
                sourceCardId: card.id,
                actor: cardOwner,
                target: context.opponent,
            }
        ];
    }

    return { newState };
};

/**
 * Reveal/Give Effect Implementation
 */
const executeRevealEffect = (
    params: RevealEffectParams,
    card: PlayedCard,
    laneIndex: number,
    state: GameState,
    context: EffectContext
): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    if (params.action === 'reveal') {
        newState.actionRequired = {
            type: 'select_card_from_hand_to_reveal' as any,
            sourceCardId: card.id,
            actor: cardOwner,
        };

        if (params.followUpAction === 'flip') {
            newState.queuedActions = [
                ...(newState.queuedActions || []),
                {
                    type: 'select_any_card_to_flip',
                    count: 1,
                    sourceCardId: card.id,
                    actor: cardOwner,
                }
            ];
        }
    } else {
        // Give implementation
        newState.actionRequired = {
            type: 'select_card_from_hand_to_give' as any,
            sourceCardId: card.id,
            actor: cardOwner,
        };
    }

    return { newState };
};
