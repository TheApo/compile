/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, PlayedCard } from '../../types';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { shuffleDeck } from '../../utils/gameLogic';

const getBestCardToPlay = (state: GameState): { cardId: string, laneIndex: number, isFaceUp: boolean } | null => {
    const { opponent, player } = state;
    if (opponent.hand.length === 0) return null;

    const isLaneBlockedByPlague0 = (laneIndex: number): boolean => {
        const playerLane = state.player.lanes[laneIndex];
        if (playerLane.length === 0) return false;
        const topCard = playerLane[playerLane.length - 1];
        return topCard.isFaceUp && topCard.protocol === 'Plague' && topCard.value === 0;
    };

    const canPlayerCompileLane = (laneIndex: number): boolean => {
        return state.player.laneValues[laneIndex] >= 10 && state.player.laneValues[laneIndex] > state.opponent.laneValues[laneIndex];
    };

    const playerHasPsychic1 = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);

    // 1. Super Simple Offensive Logic: If a lane is at 8 or 9, play any card face down to compile.
    for (let i = 0; i < 3; i++) {
        if (isLaneBlockedByPlague0(i)) continue;
        // Don't play in a lane the player will compile anyway, it's a waste
        if (canPlayerCompileLane(i)) continue;
        if (!opponent.compiled[i] && (opponent.laneValues[i] === 8 || opponent.laneValues[i] === 9)) {
            // Found a compile setup opportunity. Play the first available card face-down.
            return { cardId: opponent.hand[0].id, laneIndex: i, isFaceUp: false };
        }
    }

    // Filter out unplayable cards like Water-4 on an empty board
    const playableHand = opponent.hand.filter(card => {
        if (card.protocol === 'Water' && card.value === 4) {
            // Water-4 is only playable if the AI has other cards on the board to return.
            return opponent.lanes.flat().length > 0;
        }
        return true;
    });

    if (playableHand.length === 0) {
        return null; // No valid cards to play, AI must fill hand.
    }

    // 2. Default Dumb Logic: Play the highest value card face up if possible, otherwise face down.
    const sortedHand = [...playableHand].sort((a, b) => b.value - a.value);
    const cardToPlay = sortedHand[0];

    // Try to find a lane where it can be played face up.
    if (!playerHasPsychic1) {
        for (let i = 0; i < 3; i++) {
            if (isLaneBlockedByPlague0(i)) continue;
            // Avoid playing in a lane the player is guaranteed to compile.
            if (canPlayerCompileLane(i)) continue;
            if (cardToPlay.protocol === opponent.protocols[i]) {
                return { cardId: cardToPlay.id, laneIndex: i, isFaceUp: true };
            }
        }
    }

    // If not, just play it face down in a random playable lane.
    const playableLanes = [0, 1, 2].filter(i => !isLaneBlockedByPlague0(i) && !canPlayerCompileLane(i));
    if (playableLanes.length === 0) {
        return null; // No valid lanes to play in, will cause AI to fill hand.
    }
    const randomLane = playableLanes[Math.floor(Math.random() * playableLanes.length)];
    return { cardId: cardToPlay.id, laneIndex: randomLane, isFaceUp: false };
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    // Easy AI makes simple, often suboptimal or random choices.
    switch (action.type) {
        case 'prompt_use_control_mechanic':
            // Easy AI: 50% chance to skip, 50% to rearrange player's protocols.
            return { type: 'resolveControlMechanicPrompt', choice: Math.random() < 0.5 ? 'skip' : 'opponent' };

        case 'discard':
            // Discard the lowest value card(s).
            const sortedHand = [...state.opponent.hand].sort((a, b) => a.value - b.value);
            const cardsToDiscard = sortedHand.slice(0, action.count).map(c => c.id);
            return { type: 'discardCards', cardIds: cardsToDiscard };

        case 'select_opponent_card_to_flip': { // Darkness-1
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const opponentUncovered = getUncovered('player');
            if (opponentUncovered.length === 0) return { type: 'skip' };

            // Priority 1: Flip a face-down card to reveal it.
            const faceDownTargets = opponentUncovered.filter(c => !c.isFaceUp);
            if (faceDownTargets.length > 0) {
                return { type: 'flipCard', cardId: faceDownTargets[0].id };
            }

            // Priority 2: Flip the highest-value face-up card.
            const faceUpTargets = opponentUncovered.filter(c => c.isFaceUp).sort((a, b) => b.value - a.value);
            return { type: 'flipCard', cardId: faceUpTargets[0].id };
        }

        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete':
        case 'select_card_to_delete_for_death_1':
        case 'plague_4_opponent_delete': {
            const disallowedIds = ('disallowedIds' in action && action.disallowedIds) ? action.disallowedIds : [];
            // Prioritize player cards, but otherwise make a simple choice.
            // FIX: Only target uncovered cards.
            const getUncoveredCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);

            const allowedPlayerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
            if (allowedPlayerCards.length > 0) {
                return { type: 'deleteCard', cardId: allowedPlayerCards[0].id };
            }
            
            const allowedOpponentCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
            if (allowedOpponentCards.length > 0) {
                return { type: 'deleteCard', cardId: allowedOpponentCards[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_card_from_other_lanes_to_delete': {
            const { disallowedLaneIndex, lanesSelected } = action;
            const validTargets: PlayedCard[] = [];
            for (let i = 0; i < 3; i++) {
                if (i === disallowedLaneIndex || lanesSelected.includes(i)) continue;
                // Prefer player cards
                const playerLane = state.player.lanes[i];
                if (playerLane.length > 0) {
                    validTargets.push(playerLane[playerLane.length - 1]); // target top card
                    continue;
                }
                const opponentLane = state.opponent.lanes[i];
                if (opponentLane.length > 0) {
                    validTargets.push(opponentLane[opponentLane.length - 1]);
                }
            }
            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }
        
        case 'select_low_value_card_to_delete': {
            const uncoveredCards: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (const lane of state[p].lanes) {
                    if (lane.length > 0) {
                        uncoveredCards.push(lane[lane.length - 1]);
                    }
                }
            }
            const validTargets = uncoveredCards.filter(c => c.isFaceUp && (c.value === 0 || c.value === 1));

            if (validTargets.length > 0) {
                return { type: 'deleteCard', cardId: validTargets[0].id };
            }
            return { type: 'skip' };
        }

        case 'select_own_face_up_covered_card_to_flip':
            // Easy AI doesn't bother with this complex optional move.
            return { type: 'skip' };

        case 'select_face_down_card_to_reveal_for_light_2': {
            const getUncovered = (player: Player): PlayedCard[] => {
                return state[player].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null);
            };
            const allUncoveredPlayer = getUncovered('player');
            const allUncoveredOpponent = getUncovered('opponent');

            const opponentFaceDown = allUncoveredPlayer.filter(c => !c.isFaceUp);
            if (opponentFaceDown.length > 0) {
                // Easy AI: just pick the first one it finds.
                return { type: 'deleteCard', cardId: opponentFaceDown[0].id };
            }
            const ownFaceDown = allUncoveredOpponent.filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) {
                return { type: 'deleteCard', cardId: ownFaceDown[0].id };
            }
            return { type: 'skip' }; // Should not happen if effect generation is correct.
        }

        case 'select_opponent_face_up_card_to_flip': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);
            
            const opponentUncoveredFaceUp = getUncovered('player').filter(c => c.isFaceUp);
            
            if (opponentUncoveredFaceUp.length > 0) {
                // Easy AI: Pick the highest value one to flip down.
                opponentUncoveredFaceUp.sort((a, b) => b.value - a.value);
                return { type: 'flipCard', cardId: opponentUncoveredFaceUp[0].id };
            }
            
            // If no valid targets, which shouldn't happen if the action was generated correctly, skip.
            return { type: 'skip' };
        }

        case 'select_any_other_card_to_flip':
        case 'select_any_card_to_flip':
        case 'select_any_card_to_flip_optional':
        case 'select_card_to_flip_for_fire_3':
        case 'select_card_to_flip_for_light_0':
        case 'select_any_other_card_to_flip_for_water_0':
        case 'select_any_face_down_card_to_flip_optional':
        case 'select_covered_card_in_line_to_flip_optional': {
            const isOptional = 'optional' in action && action.optional;
            const cannotTargetSelfTypes: ActionRequired['type'][] = ['select_any_other_card_to_flip', 'select_any_other_card_to_flip_for_water_0'];
            const canTargetSelf = !cannotTargetSelfTypes.includes(action.type);
            const requiresFaceDown = action.type === 'select_any_face_down_card_to_flip_optional';

            // Special case for Darkness-2: "flip 1 covered card in this line."
            if (action.type === 'select_covered_card_in_line_to_flip_optional') {
                const { laneIndex } = action;
                const playerCovered = state.player.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (playerCovered.length > 0) return { type: 'flipCard', cardId: playerCovered[0].id };
                const opponentCovered = state.opponent.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (opponentCovered.length > 0) return { type: 'flipCard', cardId: opponentCovered[0].id };
                return { type: 'skip' }; // No covered cards to flip.
            }
            
            // FIX: Only target uncovered cards for standard flip effects.
            const getUncovered = (player: Player): PlayedCard[] => {
                return state[player].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null);
            };
            
            const allUncoveredPlayer = getUncovered('player');
            const allUncoveredOpponent = getUncovered('opponent');

            // Priority 1: Flip opponent's highest-value face-up card.
            if (!requiresFaceDown) {
                const opponentFaceUp = allUncoveredPlayer.filter(c => c.isFaceUp).sort((a,b) => b.value - a.value);
                if (opponentFaceUp.length > 0) return { type: 'flipCard', cardId: opponentFaceUp[0].id };
            }
            
            // Priority 2: Flip own face-down card to get points on the board.
            const ownFaceDown = allUncoveredOpponent.filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) return { type: 'flipCard', cardId: ownFaceDown[0].id };

            // Priority 3: Flip opponent's face-down card to see it.
            const opponentFaceDown = allUncoveredPlayer.filter(c => !c.isFaceUp);
            if (opponentFaceDown.length > 0) return { type: 'flipCard', cardId: opponentFaceDown[0].id };
            
            // Priority 4: Flip own face-up card (bad move, but mandatory actions must be resolved).
            if (!requiresFaceDown) {
                const ownFaceUp = allUncoveredOpponent.filter(c => {
                    if (!c.isFaceUp) return false;
                    if (!canTargetSelf && c.id === action.sourceCardId) return false;
                    return true;
                });
                if (ownFaceUp.length > 0) {
                    if (!isOptional) return { type: 'flipCard', cardId: ownFaceUp[0].id };
                }
            }

            // If we reach here, no valid targets were found or it was an optional bad move.
            return { type: 'skip' };
        }

        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) return { type: 'returnCard', cardId: allCards[0].id };
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }

        case 'select_own_card_to_return_for_water_4': {
            const ownCards = state.opponent.lanes.flat();
            if (ownCards.length > 0) {
                // Easy AI: Pick a random card to return.
                const randomCard = ownCards[Math.floor(Math.random() * ownCards.length)];
                return { type: 'returnCard', cardId: randomCard.id };
            }
            // This shouldn't happen if the action was generated correctly, but as a fallback:
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }
        
        case 'select_card_to_shift_for_gravity_1': {
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const playerCards = state.player.lanes.flat();
            if (playerCards.length > 0) {
                const randomCard = playerCards[Math.floor(Math.random() * playerCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_shift_for_gravity_4': {
            const { targetLaneIndex } = action;
            const validTargets: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as const) {
                for (let i = 0; i < state[p].lanes.length; i++) {
                    if (i === targetLaneIndex) continue; // Cannot shift from the target lane to itself.
                    for (const card of state[p].lanes[i]) {
                        if (!card.isFaceUp) {
                            validTargets.push(card);
                        }
                    }
                }
            }
            
            if (validTargets.length > 0) {
                // Easy AI: Pick a random valid target.
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                // Use 'deleteCard' as the vehicle type for the AIAction. It triggers the generic card resolver.
                return { type: 'deleteCard', cardId: randomTarget.id };
            }

            // If no valid targets, which shouldn't happen if the action was created correctly, skip.
            return { type: 'skip' };
        }

        case 'select_face_down_card_to_shift_for_darkness_4': {
            const uncoveredFaceDownCards: PlayedCard[] = [];
            for (const p of ['player', 'opponent'] as Player[]) {
                for (const lane of state[p].lanes) {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (!topCard.isFaceUp) {
                            uncoveredFaceDownCards.push(topCard);
                        }
                    }
                }
            }

            if (uncoveredFaceDownCards.length > 0) {
                const randomCard = uncoveredFaceDownCards[Math.floor(Math.random() * uncoveredFaceDownCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'shift_flipped_card_optional': {
            // Easy AI: just find any valid lane and shift it. If not, skip.
            const cardInfo = findCardOnBoard(state, action.cardId);
            if (!cardInfo) return { type: 'skip' };

            let originalLaneIndex = -1;
            const ownerState = state[cardInfo.owner];
            for (let i = 0; i < ownerState.lanes.length; i++) {
                if (ownerState.lanes[i].some(c => c.id === action.cardId)) {
                    originalLaneIndex = i;
                    break;
                }
            }

            if (originalLaneIndex === -1) return { type: 'skip' };

            const possibleLanes = [0, 1, 2].filter(l => l !== originalLaneIndex);
            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            
            return { type: 'skip' };
        }

        case 'select_lane_for_shift':
        case 'select_lane_for_play':
        case 'select_lane_for_death_2':
        case 'select_lane_for_life_3_play':
        case 'select_lane_to_shift_revealed_card_for_light_2':
        case 'select_lane_to_shift_cards_for_light_3':
        case 'select_lane_for_metal_3_delete': {
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }
            if ('originalLaneIndex' in action && action.originalLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.originalLaneIndex);
            }
            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }
        case 'select_lane_for_water_3': {
            const getWater3TargetLanes = (state: GameState): number[] => {
                const targetLanes: number[] = [];
                for (let i = 0; i < 3; i++) {
                    let hasTarget = false;
                    for (const p of ['player', 'opponent'] as Player[]) {
                        const lane = state[p].lanes[i];
                        const hasDarkness2 = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2);
                        const faceDownValue = hasDarkness2 ? 4 : 2;
                        
                        for (const card of lane) {
                            const value = card.isFaceUp ? card.value : faceDownValue;
                            if (value === 2) {
                                hasTarget = true;
                                break;
                            }
                        }
                        if (hasTarget) break;
                    }
                    if (hasTarget) {
                        targetLanes.push(i);
                    }
                }
                return targetLanes;
            };

            const targetLanes = getWater3TargetLanes(state);
            if (targetLanes.length > 0) {
                // Easy AI: Pick a random valid lane.
                const randomLane = targetLanes[Math.floor(Math.random() * targetLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            // If no valid targets, the action is mandatory, so just pick lane 0.
            return { type: 'selectLane', laneIndex: 0 };
        }
        
        case 'prompt_death_1_effect': return { type: 'resolveDeath1Prompt', accept: Math.random() > 0.7 }; // Rarely accepts
        case 'prompt_give_card_for_love_1': return { type: 'resolveLove1Prompt', accept: false };
        case 'plague_4_player_flip_optional': return { type: 'resolvePlague4Flip', accept: false };
        case 'prompt_fire_3_discard': return { type: 'resolveFire3Prompt', accept: false };
        case 'prompt_shift_for_speed_3': return { type: 'resolveSpeed3Prompt', accept: false };
        case 'prompt_shift_for_spirit_3': return { type: 'resolveSpirit3Prompt', accept: false };
        case 'prompt_return_for_psychic_4': return { type: 'resolvePsychic4Prompt', accept: false };
        case 'prompt_spirit_1_start': return { type: 'resolveSpirit1Prompt', choice: 'flip' };
        
        case 'prompt_shift_or_flip_for_light_2': {
            const { revealedCardId } = action;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'skip' };
            
            // Easy AI: flip its own cards, skip player's cards.
            if (cardInfo.owner === 'opponent') {
                return { type: 'resolveLight2Prompt', choice: 'flip' };
            }
            return { type: 'resolveLight2Prompt', choice: 'skip' };
        }

        case 'plague_2_opponent_discard':
            if (state.opponent.hand.length > 0) return { type: 'resolvePlague2Discard', cardIds: [state.opponent.hand[0].id] };
            return { type: 'skip' };
        case 'select_cards_from_hand_to_discard_for_fire_4':
            if (state.opponent.hand.length > 0) return { type: 'resolveFire4Discard', cardIds: [state.opponent.hand[0].id] };
            return { type: 'skip' };
        case 'select_cards_from_hand_to_discard_for_hate_1':
            if (state.opponent.hand.length > 0) return { type: 'resolveHate1Discard', cardIds: state.opponent.hand.slice(0, action.count).map(c => c.id) };
            return { type: 'skip' };

        case 'select_card_from_hand_to_play':
             if (state.opponent.hand.length > 0) {
                const cardToPlay = state.opponent.hand[0];
                const playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);
                return { type: 'playCard', cardId: cardToPlay.id, laneIndex: playableLanes[0], isFaceUp: false };
             }
             return { type: 'skip' };
        case 'select_card_from_hand_to_give':
            if (state.opponent.hand.length > 0) return { type: 'giveCard', cardId: state.opponent.hand[0].id };
            return { type: 'skip' };
        case 'select_card_from_hand_to_reveal':
            if (state.opponent.hand.length > 0) return { type: 'revealCard', cardId: state.opponent.hand[0].id };
            return { type: 'skip' };

        case 'prompt_rearrange_protocols': {
            const originalOrder = state[action.target].protocols;
            if (originalOrder.length <= 1) {
                return { type: 'rearrangeProtocols', newOrder: [...originalOrder] };
            }
            let newOrder;
            do {
                newOrder = shuffleDeck([...originalOrder]);
            } while (JSON.stringify(newOrder) === JSON.stringify(originalOrder));
            return { type: 'rearrangeProtocols', newOrder };
        }
        case 'prompt_swap_protocols': {
            // Easy AI: Pick two random, distinct indices to swap.
            const index1 = Math.floor(Math.random() * 3);
            let index2 = Math.floor(Math.random() * 3);
            while (index1 === index2) {
                index2 = Math.floor(Math.random() * 3);
            }
            return { type: 'resolveSwapProtocols', indices: [index1, index2] };
        }

        case 'select_opponent_face_down_card_to_shift': { // Speed-4
            const validTargets: PlayedCard[] = [];
            for (const lane of state.player.lanes) {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        validTargets.push(topCard);
                    }
                }
            }

            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                // Use 'deleteCard' as the action type to trigger resolveActionWithCard
                return { type: 'deleteCard', cardId: randomTarget.id };
            }

            return { type: 'skip' }; // Should not happen if action was generated correctly
        }
        case 'select_own_other_card_to_shift': {
            const cardToShift = state.opponent.lanes.flat().find(c => c.id !== action.sourceCardId);
            if (cardToShift) return { type: 'deleteCard', cardId: cardToShift.id }; // Typo but fine for easy
            return { type: 'skip' };
        }
        case 'select_own_card_to_shift_for_speed_3': {
            const ownCards = state.opponent.lanes.flat();
            // This action is mandatory and is only dispatched if the AI has at least one card.
            // Easy AI just picks the first card it finds.
            return { type: 'deleteCard', cardId: ownCards[0].id };
        }
        case 'select_opponent_covered_card_to_shift': {
            const validTargets: PlayedCard[] = [];
            for (const lane of state.player.lanes) {
                // A card is covered if it's not the last one.
                for (let i = 0; i < lane.length - 1; i++) {
                    validTargets.push(lane[i]);
                }
            }
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                // Using 'deleteCard' as the action type to trigger resolveActionWithCard
                return { type: 'deleteCard', cardId: randomTarget.id };
            }
            return { type: 'skip' };
        }
        case 'select_any_opponent_card_to_shift': {
            const validTargets = state.player.lanes.map(lane => lane.length > 0 ? lane[lane.length - 1] : null).filter((c): c is PlayedCard => c !== null);
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'deleteCard', cardId: randomTarget.id }; // 'deleteCard' is a proxy for selecting a card
            }
            return { type: 'skip' };
        }
    }
    return { type: 'skip' }; // Fallback for any unhandled action
}


export const easyAI = (state: GameState, action: ActionRequired | null): AIAction => {
    if (action) {
        return handleRequiredAction(state, action);
    }

    if (state.phase === 'compile' && state.compilableLanes.length > 0) {
        return { type: 'compile', laneIndex: state.compilableLanes[0] };
    }

    if (state.phase === 'action') {
        const bestPlay = getBestCardToPlay(state);
        if (bestPlay) {
            return { type: 'playCard', ...bestPlay };
        } else {
            return { type: 'fillHand' };
        }
    }

    return { type: 'fillHand' }; // Fallback
};
