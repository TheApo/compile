/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, ActionRequired, AIAction, Player, PlayedCard } from '../../types';
import { findCardOnBoard } from '../game/helpers/actionUtils';
import { shuffleDeck } from '../../utils/gameLogic';
import { handleControlRearrange } from './controlMechanicLogic';
import { isFrost1Active } from '../game/passiveRuleChecker';
import {
    canPlayCard,
    hasAnyProtocolPlayRule,
    hasRequireNonMatchingProtocolRule,
    getActivePassiveRules
} from '../game/passiveRuleChecker';
import {
    hasRequireFaceDownPlayRule,
    hasDeleteSelfOnCoverEffect,
    hasReturnOwnCardEffect,
    hasDeleteHighestOwnCardEffect,
    hasShiftToFromLaneEffect,
    hasShiftToNonMatchingProtocolEffect,
    getLaneFaceDownValueBoost
} from './aiEffectUtils';

const getBestCardToPlay = (state: GameState): { cardId: string, laneIndex: number, isFaceUp: boolean } | null => {
    const { opponent, player } = state;
    if (opponent.hand.length === 0) return null;

    // Use generic passive rule checker instead of hardcoded protocol checks
    const canPlayInLane = (laneIndex: number, isFaceUp: boolean, cardProtocol: string): boolean => {
        const result = canPlayCard(state, 'opponent', laneIndex, isFaceUp, cardProtocol);
        return result.allowed;
    };

    const canPlayerCompileLane = (laneIndex: number): boolean => {
        return state.player.laneValues[laneIndex] >= 10 && state.player.laneValues[laneIndex] > state.opponent.laneValues[laneIndex];
    };

    // Check for passive rule that forces face-down play (like Psychic-1)
    const mustPlayFaceDown = hasRequireFaceDownPlayRule(state, 'opponent');

    // 1. Super Simple Offensive Logic: If a lane is at 8 or 9, play any card face down to compile.
    for (let i = 0; i < 3; i++) {
        if (!canPlayInLane(i, false, opponent.hand[0].protocol)) continue;
        // Don't play in a lane the player will compile anyway, it's a waste
        if (canPlayerCompileLane(i)) continue;
        if (!opponent.compiled[i] && (opponent.laneValues[i] === 8 || opponent.laneValues[i] === 9)) {
            // Found a compile setup opportunity. Play the first available card face-down.
            return { cardId: opponent.hand[0].id, laneIndex: i, isFaceUp: false };
        }
    }

    // Filter out unplayable cards using generic effect checks
    const playableHand = opponent.hand.filter(card => {
        // Check for cards that require returning own card (like Water-4)
        if (hasReturnOwnCardEffect(card)) {
            const cardsOnBoard = opponent.lanes.flat();
            // Must have cards of OTHER protocols to return
            const hasOtherProtocolCards = cardsOnBoard.some(c => c.protocol !== card.protocol);
            return hasOtherProtocolCards;
        }
        return true;
    });

    if (playableHand.length === 0) {
        return null; // No valid cards to play, AI must fill hand.
    }

    // 2. Default Dumb Logic: Play the highest value card face up if possible, otherwise face down.
    const sortedHand = [...playableHand].sort((a, b) => b.value - a.value);

    // CRITICAL: Avoid cards that delete themselves when covered unless they would reach compile
    const cardToPlay = sortedHand.find(card => {
        if (hasDeleteSelfOnCoverEffect(card)) {
            // Check all lanes to see if this card would reach 10+ in any lane
            for (let i = 0; i < 3; i++) {
                if (opponent.laneValues[i] + card.value >= 10) {
                    return true; // Card is playable in at least one lane
                }
            }
            return false; // Card would be wasted, skip it
        }
        return true; // All other cards are fine
    }) || sortedHand[0]; // Fallback to highest card if no valid card found

    // Check if card would delete itself (like Hate-2's "delete highest own card" effect)
    let wouldDeleteSelf = false;
    if (hasDeleteHighestOwnCardEffect(cardToPlay)) {
        // Find max value of all other uncovered cards
        let maxOtherValue = 0;
        for (let checkLane = 0; checkLane < 3; checkLane++) {
            const checkLaneCards = opponent.lanes[checkLane];
            if (checkLaneCards.length > 0) {
                const uncovered = checkLaneCards[checkLaneCards.length - 1];
                const uncoveredValue = uncovered.isFaceUp ? uncovered.value : 2;
                if (uncoveredValue > maxOtherValue) {
                    maxOtherValue = uncoveredValue;
                }
            }
        }
        // If this card's value would be highest or tied, it would delete itself
        if (cardToPlay.value >= maxOtherValue) {
            wouldDeleteSelf = true;
        }
    }

    // Try to find a lane where it can be played face up (but not if it would suicide).
    if (!mustPlayFaceDown && !wouldDeleteSelf) {
        // Use generic passive rule checker for protocol matching
        const canPlayAnyProtocol = hasAnyProtocolPlayRule(state, 'opponent');
        const requireNonMatching = hasRequireNonMatchingProtocolRule(state);

        for (let i = 0; i < 3; i++) {
            if (!canPlayInLane(i, true, cardToPlay.protocol)) continue;
            // Avoid playing in a lane the player is guaranteed to compile.
            if (canPlayerCompileLane(i)) continue;

            let canPlayFaceUp: boolean;
            if (requireNonMatching) {
                // Inverted rule: can only play if protocol does NOT match
                canPlayFaceUp = cardToPlay.protocol !== opponent.protocols[i] && cardToPlay.protocol !== player.protocols[i];
            } else {
                // Normal rule
                const protocolMatches = cardToPlay.protocol === opponent.protocols[i] || cardToPlay.protocol === player.protocols[i];
                canPlayFaceUp = protocolMatches || canPlayAnyProtocol;
            }

            if (canPlayFaceUp) {
                return { cardId: cardToPlay.id, laneIndex: i, isFaceUp: true };
            }
        }
    }

    // If not, just play it face down in a random playable lane.
    const playableLanes = [0, 1, 2].filter(i => {
        // Use generic checker for face-down play restrictions
        if (!canPlayInLane(i, false, cardToPlay.protocol)) return false;
        return !canPlayerCompileLane(i);
    });
    if (playableLanes.length === 0) {
        return null; // No valid lanes to play in, will cause AI to fill hand.
    }
    const randomLane = playableLanes[Math.floor(Math.random() * playableLanes.length)];
    return { cardId: cardToPlay.id, laneIndex: randomLane, isFaceUp: false };
};

const handleRequiredAction = (state: GameState, action: ActionRequired): AIAction => {
    // Easy AI makes simple, often suboptimal or random choices.
    switch (action.type) {
        case 'prompt_use_control_mechanic': {
            const { player } = state; // human player
            const playerHasCompiled = player.compiled.some(c => c);
            const uncompiledLaneCount = player.compiled.filter(c => !c).length;

            // Condition for strategic swap: player has at least one compiled and one uncompiled protocol.
            if (playerHasCompiled && uncompiledLaneCount > 0) {
                return { type: 'resolveControlMechanicPrompt', choice: 'player' };
            } else {
                // No strategic swap available, so skip.
                return { type: 'resolveControlMechanicPrompt', choice: 'skip' };
            }
        }

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

        case 'select_card_to_delete_for_anarchy_2': {
            // Anarchy-2: "Delete a covered or uncovered FACE-UP card in a line with a matching protocol"
            // CRITICAL: Only FACE-UP cards can be selected (covered or uncovered)
            // Card's protocol must match the lane protocol

            // Helper to check if card's protocol matches the lane protocol
            const hasMatchingProtocol = (card: PlayedCard, owner: Player, laneIndex: number): boolean => {
                const laneProtocol = state[owner].protocols[laneIndex];
                return card.protocol === laneProtocol;
            };

            // Get all face-up player cards with matching protocol
            const validPlayerCards: PlayedCard[] = [];
            state.player.lanes.forEach((lane, laneIndex) => {
                lane.forEach(card => {
                    if (card.isFaceUp && hasMatchingProtocol(card, 'player', laneIndex)) {
                        validPlayerCards.push(card);
                    }
                });
            });

            if (validPlayerCards.length > 0) {
                return { type: 'deleteCard', cardId: validPlayerCards[0].id };
            }

            // Fallback: Get all face-up opponent cards with matching protocol
            const validOpponentCards: PlayedCard[] = [];
            state.opponent.lanes.forEach((lane, laneIndex) => {
                lane.forEach(card => {
                    if (card.isFaceUp && hasMatchingProtocol(card, 'opponent', laneIndex)) {
                        validOpponentCards.push(card);
                    }
                });
            });

            if (validOpponentCards.length > 0) {
                return { type: 'deleteCard', cardId: validOpponentCards[0].id };
            }

            return { type: 'skip' };
        }

        case 'select_cards_to_delete':
        case 'select_face_down_card_to_delete':
        case 'select_card_to_delete_for_death_1': {
            const disallowedIds = ('disallowedIds' in action && action.disallowedIds) ? action.disallowedIds : [];
            const targetFilter = 'targetFilter' in action ? action.targetFilter as { owner?: string; faceState?: string; position?: string } : undefined;
            const actorChooses = 'actorChooses' in action ? action.actorChooses : 'effect_owner';

            // FLEXIBLE: Check if AI must select its OWN cards (actorChooses: 'card_owner' + targetFilter.owner: 'opponent')
            // This handles custom effects like "Your opponent deletes 1 of their face-down cards"
            if (actorChooses === 'card_owner' && targetFilter?.owner === 'opponent') {
                const ownValidCards: PlayedCard[] = [];
                state.opponent.lanes.forEach((lane) => {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1]; // Only uncovered
                        if (targetFilter?.faceState === 'face_down' && topCard.isFaceUp) return;
                        if (targetFilter?.faceState === 'face_up' && !topCard.isFaceUp) return;
                        ownValidCards.push(topCard);
                    }
                });

                if (ownValidCards.length > 0) {
                    return { type: 'deleteCard', cardId: ownValidCards[0].id };
                }
                return { type: 'skip' };
            }

            // Standard behavior: Respect targetFilter.owner
            const cardOwner = action.actor; // Who owns the source card
            const getUncoveredCards = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null)
                .filter(c => {
                    if (targetFilter?.faceState === 'face_down' && c.isFaceUp) return false;
                    if (targetFilter?.faceState === 'face_up' && !c.isFaceUp) return false;
                    return true;
                });

            // CRITICAL: owner filter is relative to cardOwner
            // 'own' = cards belonging to cardOwner (AI = opponent)
            // 'opponent' = cards belonging to the opponent OF cardOwner (AI's opponent = player)
            const ownerFilter = targetFilter?.owner;

            if (ownerFilter === 'own') {
                // Delete own cards only (AI = opponent)
                const allowedOwnCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
                if (allowedOwnCards.length > 0) {
                    return { type: 'deleteCard', cardId: allowedOwnCards[0].id };
                }
            } else if (ownerFilter === 'opponent') {
                // Delete opponent's cards only (AI's opponent = player)
                const allowedOpponentCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
                if (allowedOpponentCards.length > 0) {
                    return { type: 'deleteCard', cardId: allowedOpponentCards[0].id };
                }
            } else {
                // No filter: Prioritize player cards (more disruptive)
                const allowedPlayerCards = getUncoveredCards('player').filter(c => !disallowedIds.includes(c.id));
                if (allowedPlayerCards.length > 0) {
                    return { type: 'deleteCard', cardId: allowedPlayerCards[0].id };
                }

                const allowedOpponentCards = getUncoveredCards('opponent').filter(c => !disallowedIds.includes(c.id));
                if (allowedOpponentCards.length > 0) {
                    return { type: 'deleteCard', cardId: allowedOpponentCards[0].id };
                }
            }
            return { type: 'skip' };
        }

        case 'plague_4_opponent_delete': {
            // Original Plague-4: Opponent (AI) must delete their OWN uncovered face-down card
            const ownFaceDownUncovered: PlayedCard[] = [];
            state.opponent.lanes.forEach((lane) => {
                if (lane.length > 0) {
                    const topCard = lane[lane.length - 1];
                    if (!topCard.isFaceUp) {
                        ownFaceDownUncovered.push(topCard);
                    }
                }
            });

            if (ownFaceDownUncovered.length > 0) {
                return { type: 'deleteCard', cardId: ownFaceDownUncovered[0].id };
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

        case 'select_own_highest_card_to_delete_for_hate_2': {
            const actor = action.actor;
            const uncoveredCards: Array<{ card: PlayedCard; laneIndex: number; value: number }> = [];

            // Collect all uncovered cards for the actor
            state[actor].lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const uncovered = lane[lane.length - 1];
                    const value = uncovered.isFaceUp ? uncovered.value : 2;
                    uncoveredCards.push({ card: uncovered, laneIndex, value });
                }
            });

            if (uncoveredCards.length === 0) return { type: 'skip' };

            // Find the highest value
            const maxValue = Math.max(...uncoveredCards.map(c => c.value));
            const highestCards = uncoveredCards.filter(c => c.value === maxValue);

            // Easy AI: Just pick the first one (simple, no strategy)
            return { type: 'deleteCard', cardId: highestCards[0].card.id };
        }

        case 'select_opponent_highest_card_to_delete_for_hate_2': {
            const actor = action.actor;
            const opponent = actor === 'player' ? 'opponent' : 'player';
            const uncoveredCards: Array<{ card: PlayedCard; laneIndex: number; value: number }> = [];

            // Collect all uncovered cards for the opponent
            state[opponent].lanes.forEach((lane, laneIndex) => {
                if (lane.length > 0) {
                    const uncovered = lane[lane.length - 1];
                    const value = uncovered.isFaceUp ? uncovered.value : 2;
                    uncoveredCards.push({ card: uncovered, laneIndex, value });
                }
            });

            if (uncoveredCards.length === 0) return { type: 'skip' };

            // Find the highest value
            const maxValue = Math.max(...uncoveredCards.map(c => c.value));
            const highestCards = uncoveredCards.filter(c => c.value === maxValue);

            // Easy AI: Just pick the first one (simple, no strategy)
            return { type: 'deleteCard', cardId: highestCards[0].card.id };
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
        case 'select_covered_card_to_flip_for_chaos_0':
        case 'select_covered_card_in_line_to_flip_optional': {
            const frost1Active = isFrost1Active(state);
            const isOptional = 'optional' in action && action.optional;
            const sourceCardId = 'sourceCardId' in action ? action.sourceCardId : null;
            const requiresFaceDown = action.type === 'select_any_face_down_card_to_flip_optional';

            // Special case for Chaos-0: "In each line, flip 1 covered card."
            if (action.type === 'select_covered_card_to_flip_for_chaos_0') {
                const { laneIndex } = action;
                const playerCovered = state.player.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (playerCovered.length > 0) return { type: 'flipCard', cardId: playerCovered[0].id };
                const opponentCovered = state.opponent.lanes[laneIndex].filter((c, i, arr) => i < arr.length - 1);
                if (opponentCovered.length > 0) return { type: 'flipCard', cardId: opponentCovered[0].id };
                // Note: Chaos-0 should only create actions for lanes with covered cards, so this shouldn't happen.
                return { type: 'skip' };
            }

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
            // NEVER flip the source card (the card that triggered this effect)
            const getUncovered = (player: Player): PlayedCard[] => {
                return state[player].lanes
                    .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                    .filter((c): c is PlayedCard => c !== null)
                    .filter(c => !sourceCardId || c.id !== sourceCardId); // Exclude source card
            };

            const allUncoveredPlayer = getUncovered('player');
            const allUncoveredOpponent = getUncovered('opponent');

            // Priority 1: Flip PLAYER's (opponent's) highest-value face-up card to weaken them.
            // This is ALWAYS a good move - reduces their points.
            if (!requiresFaceDown) {
                const playerFaceUp = allUncoveredPlayer.filter(c => c.isFaceUp).sort((a,b) => b.value - a.value);
                if (playerFaceUp.length > 0) return { type: 'flipCard', cardId: playerFaceUp[0].id };
            }

            // Priority 2: Flip PLAYER's face-down card to face-up.
            // This reveals their card and might trigger bad effects for them.
            // But only if Frost-1 is NOT active
            if (!frost1Active && !requiresFaceDown) {
                const playerFaceDown = allUncoveredPlayer.filter(c => !c.isFaceUp);
                if (playerFaceDown.length > 0) return { type: 'flipCard', cardId: playerFaceDown[0].id };
            }

            // Priority 3: Flip OWN face-down card to face-up to get points on the board.
            // But only if Frost-1 is NOT active
            if (!frost1Active) {
                const ownFaceDown = allUncoveredOpponent.filter(c => !c.isFaceUp);
                if (ownFaceDown.length > 0) return { type: 'flipCard', cardId: ownFaceDown[0].id };
            }

            // Priority 4: Flip OWN face-up card (BAD move - only if mandatory and no other options).
            if (!requiresFaceDown && !isOptional) {
                const ownFaceUp = allUncoveredOpponent.filter(c => c.isFaceUp);

                // Prefer flipping in compiled lanes (minimal damage)
                const compiledOwnFaceUp = ownFaceUp.filter(c => {
                    const laneIndex = state.opponent.lanes.findIndex(lane =>
                        lane.length > 0 && lane[lane.length - 1].id === c.id
                    );
                    return laneIndex !== -1 && state.opponent.compiled[laneIndex];
                });

                if (compiledOwnFaceUp.length > 0) {
                    return { type: 'flipCard', cardId: compiledOwnFaceUp[0].id };
                }

                // Last resort: flip lowest value own face-up card
                if (ownFaceUp.length > 0) {
                    ownFaceUp.sort((a, b) => a.value - b.value);
                    return { type: 'flipCard', cardId: ownFaceUp[0].id };
                }
            }

            // If we reach here, no valid targets were found or it was an optional bad move.
            return { type: 'skip' };
        }

        case 'select_card_to_return':
        case 'select_opponent_card_to_return': {
            // Return card (only uncovered cards are valid)
            // CRITICAL: Check targetOwner to respect owner filter from custom protocols
            const targetOwner = (action as any).targetOwner;
            const cardOwner = action.actor; // Who owns the source card (the AI = 'opponent')

            const validCards: PlayedCard[] = [];

            // Determine which lanes to search based on targetOwner
            if (targetOwner === 'own') {
                // Return own card (like Water-4: "Return 1 of your cards")
                // AI is 'opponent', so search opponent's lanes
                state.opponent.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
            } else if (targetOwner === 'opponent') {
                // Return opponent's card (like Psychic-4: "Return 1 of opponent's cards")
                // AI's opponent is 'player', so search player's lanes
                state.player.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
            } else {
                // No filter or 'any' - search all (Easy AI tries player cards first for disruption)
                state.player.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
                state.opponent.lanes.forEach(lane => {
                    if (lane.length > 0) validCards.push(lane[lane.length - 1]);
                });
            }

            if (validCards.length > 0) return { type: 'returnCard', cardId: validCards[0].id };
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }

        case 'select_own_card_to_return_for_water_4': {
            // Water-4: Return own card (only uncovered cards are valid)
            const validOwnCards: PlayedCard[] = [];
            state.opponent.lanes.forEach(lane => {
                if (lane.length > 0) {
                    // Only the top card (uncovered) is targetable
                    validOwnCards.push(lane[lane.length - 1]);
                }
            });

            if (validOwnCards.length > 0) {
                // Easy AI: Pick a random uncovered card to return
                const randomCard = validOwnCards[Math.floor(Math.random() * validOwnCards.length)];
                return { type: 'returnCard', cardId: randomCard.id };
            }
            // This shouldn't happen if the action was generated correctly, but as a fallback:
            if ('optional' in action && action.optional) return { type: 'skip' };
            return { type: 'skip' };
        }
        
        case 'select_card_to_shift_for_anarchy_0': {
            // Anarchy-0: "Shift 1 card" - NO restrictions
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'shiftCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_shift_for_anarchy_1': {
            // Anarchy-1: "Shift 1 other card to a line without a matching protocol"
            // RESTRICTION: Cannot shift the Anarchy-1 card itself, and must shift to non-matching lane
            const { sourceCardId } = action;
            const allOtherCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()]
                .filter(c => c.id !== sourceCardId);

            if (allOtherCards.length > 0) {
                // Easy AI: Just pick a random card and let laneResolver validate destination
                const randomCard = allOtherCards[Math.floor(Math.random() * allOtherCards.length)];
                return { type: 'shiftCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_shift_for_gravity_1': {
            // Gravity-1: "Shift 1 card either to or from this line"
            // RESTRICTION: The shift must involve the Gravity-1's lane
            // Easy AI doesn't understand restrictions, just picks random (laneResolver validates)
            const allCards = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()];
            if (allCards.length > 0) {
                const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
                return { type: 'shiftCard', cardId: randomCard.id };
            }
            return { type: 'skip' };
        }

        case 'select_card_to_flip_and_shift_for_gravity_2': {
            const getUncovered = (p: Player) => state[p].lanes
                .map(lane => lane.length > 0 ? lane[lane.length - 1] : null)
                .filter((c): c is PlayedCard => c !== null);
            
            const playerCards = getUncovered('player');
            if (playerCards.length > 0) {
                const randomCard = playerCards[Math.floor(Math.random() * playerCards.length)];
                return { type: 'deleteCard', cardId: randomCard.id };
            }
            
            const opponentCards = getUncovered('opponent');
            if (opponentCards.length > 0) {
                const randomCard = opponentCards[Math.floor(Math.random() * opponentCards.length)];
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

        case 'select_lane_for_play': {
            // FIX: Filter out lanes blocked by Plague-0 or Metal-2
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }

            // Filter out blocked lanes using generic passive rule checker
            possibleLanes = possibleLanes.filter(laneIndex => {
                // Use generic canPlayCard checker instead of hardcoded protocol checks
                const result = canPlayCard(state, 'opponent', laneIndex, !action.isFaceDown, '');
                return result.allowed;
            });

            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            return { type: 'skip' };
        }
        case 'select_lane_for_shift': {
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }
            if ('originalLaneIndex' in action && action.originalLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.originalLaneIndex);
            }

            // Check for special shift restrictions from source card effects
            if ('sourceCardId' in action) {
                const sourceCard = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].find(c => c.id === action.sourceCardId);

                // Check for "shift to/from this lane" restriction (like Gravity-1)
                if (sourceCard && hasShiftToFromLaneEffect(sourceCard)) {
                    // Find which lane has the source card
                    let sourceLaneIndex: number | null = null;
                    for (let i = 0; i < 3; i++) {
                        const allLanes = [...state.player.lanes[i], ...state.opponent.lanes[i]];
                        if (allLanes.some(c => c.id === action.sourceCardId)) {
                            sourceLaneIndex = i;
                            break;
                        }
                    }

                    if (sourceLaneIndex !== null && 'originalLaneIndex' in action) {
                        if (action.originalLaneIndex === sourceLaneIndex) {
                            // Shifting FROM source lane - already filtered correctly
                        } else {
                            // Shifting TO source lane - MUST go to source lane only
                            possibleLanes = [sourceLaneIndex];
                        }
                    }
                }

                // Check for "shift to non-matching protocol" restriction (like Anarchy-1)
                if (sourceCard && hasShiftToNonMatchingProtocolEffect(sourceCard)) {
                    // Get the card being shifted
                    const cardToShiftId = 'cardToShiftId' in action ? action.cardToShiftId : null;
                    if (cardToShiftId) {
                        const cardToShift = [...state.player.lanes.flat(), ...state.opponent.lanes.flat()].find(c => c.id === cardToShiftId);
                        if (cardToShift) {
                            // Filter out lanes where the card's protocol matches
                            possibleLanes = possibleLanes.filter(laneIndex => {
                                const playerProtocol = state.player.protocols[laneIndex];
                                const opponentProtocol = state.opponent.protocols[laneIndex];
                                const cardProtocol = cardToShift.protocol;
                                return cardProtocol !== playerProtocol && cardProtocol !== opponentProtocol;
                            });
                        }
                    }
                }
            }

            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }
        case 'select_lane_for_death_2':
        case 'select_lane_for_life_3_play':
        case 'select_lane_to_shift_revealed_card_for_light_2':
        case 'select_lane_to_shift_cards_for_light_3': {
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
        case 'select_lane_for_metal_3_delete': {
            // FIX: Metal-3 can only delete lanes with 8 or more cards
            let possibleLanes = [0, 1, 2];
            if ('disallowedLaneIndex' in action && action.disallowedLaneIndex !== undefined) {
                possibleLanes = possibleLanes.filter(l => l !== action.disallowedLaneIndex);
            }
            // Filter to only lanes with >= 8 cards
            possibleLanes = possibleLanes.filter(laneIndex => {
                const totalCards = state.player.lanes[laneIndex].length + state.opponent.lanes[laneIndex].length;
                return totalCards >= 8;
            });
            if (possibleLanes.length > 0) {
                const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            // If no valid lanes, skip
            return { type: 'skip' };
        }
        case 'select_lane_for_delete_all': {
            // Generic handler for delete all in lane (custom protocols)
            const validLanes = 'validLanes' in action ? action.validLanes : [0, 1, 2];
            if (validLanes.length > 0) {
                const randomLane = validLanes[Math.floor(Math.random() * validLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            return { type: 'skip' };
        }
        case 'select_lane_for_water_3': {
            // Find lanes with value-2 cards (Water-3 deletes all value-2 cards in a lane)
            const getTargetLanes = (state: GameState): number[] => {
                const targetLanes: number[] = [];
                for (let i = 0; i < 3; i++) {
                    let hasTarget = false;
                    // Use generic face-down value boost check instead of hardcoded Darkness-2
                    const faceDownBoost = getLaneFaceDownValueBoost(state, i);
                    const faceDownValue = 2 + faceDownBoost;

                    for (const p of ['player', 'opponent'] as Player[]) {
                        const lane = state[p].lanes[i];
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

            const targetLanes = getTargetLanes(state);
            if (targetLanes.length > 0) {
                // Easy AI: Pick a random valid lane.
                const randomLane = targetLanes[Math.floor(Math.random() * targetLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            // If no valid targets, the action is mandatory, so just pick lane 0.
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_return': {
            // Generic lane selection for return effects (e.g., "Return all cards with value X in 1 line")
            const targetFilter = (action as any).targetFilter || {};
            const valueFilter = (action as any).valueFilter;

            // Find lanes with matching cards
            const getTargetLanes = (): number[] => {
                const validLanes: number[] = [];
                for (let i = 0; i < 3; i++) {
                    let hasTarget = false;
                    const faceDownBoost = getLaneFaceDownValueBoost(state, i);

                    for (const p of ['player', 'opponent'] as Player[]) {
                        // Check owner filter
                        const cardOwner = action.actor;
                        if (targetFilter.owner === 'own' && p !== cardOwner) continue;
                        if (targetFilter.owner === 'opponent' && p === cardOwner) continue;

                        const lane = state[p].lanes[i];
                        for (let cardIdx = 0; cardIdx < lane.length; cardIdx++) {
                            const card = lane[cardIdx];
                            const isUncovered = cardIdx === lane.length - 1;

                            // Check position filter
                            if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                            if (targetFilter.position === 'covered' && isUncovered) continue;

                            // Check value filter
                            if (valueFilter !== undefined) {
                                const cardValue = card.isFaceUp ? card.value : (2 + faceDownBoost);
                                if (cardValue !== valueFilter) continue;
                            }

                            hasTarget = true;
                            break;
                        }
                        if (hasTarget) break;
                    }
                    if (hasTarget) validLanes.push(i);
                }
                return validLanes;
            };

            const validLanes = getTargetLanes();
            if (validLanes.length > 0) {
                // Easy AI: Pick random valid lane
                const randomLane = validLanes[Math.floor(Math.random() * validLanes.length)];
                return { type: 'selectLane', laneIndex: randomLane };
            }
            // Fallback
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
        // Generic optional effect prompt for custom protocols - Easy AI rarely accepts
        case 'prompt_optional_effect': return { type: 'resolveOptionalEffectPrompt', accept: false };
        
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

        case 'plague_2_opponent_discard': {
            // Plague-2: Forced to discard 1 card - pick first one
            if (state.opponent.hand.length > 0) return { type: 'resolvePlague2Discard', cardIds: [state.opponent.hand[0].id] };
            return { type: 'skip' };
        }

        case 'select_cards_from_hand_to_discard_for_fire_4': {
            // Fire-4: Discard up to 3 to draw more - just pick first cards
            const maxDiscard = Math.min(3, state.opponent.hand.length);
            if (maxDiscard === 0) return { type: 'skip' };
            const toDiscard = state.opponent.hand.slice(0, maxDiscard).map(c => c.id);
            return { type: 'resolveFire4Discard', cardIds: toDiscard };
        }
        case 'select_cards_from_hand_to_discard_for_hate_1':
            if (state.opponent.hand.length > 0) return { type: 'resolveHate1Discard', cardIds: state.opponent.hand.slice(0, action.count).map(c => c.id) };
            return { type: 'skip' };

        case 'select_card_from_hand_to_play':
             if (state.opponent.hand.length > 0) {
                const cardToPlay = state.opponent.hand[0];
                // Filter out blocked lanes using generic passive rule checker
                let playableLanes = [0, 1, 2].filter(i => i !== action.disallowedLaneIndex);

                playableLanes = playableLanes.filter(laneIndex => {
                    // Use generic canPlayCard checker instead of hardcoded protocol checks
                    const result = canPlayCard(state, 'opponent', laneIndex, !action.isFaceDown, cardToPlay.protocol);
                    return result.allowed;
                });

                if (playableLanes.length > 0) {
                    return { type: 'playCard', cardId: cardToPlay.id, laneIndex: playableLanes[0], isFaceUp: false };
                }
             }
             return { type: 'skip' };
        case 'select_card_from_hand_to_give':
            if (state.opponent.hand.length > 0) return { type: 'giveCard', cardId: state.opponent.hand[0].id };
            return { type: 'skip' };
        case 'select_card_from_hand_to_reveal':
            if (state.opponent.hand.length > 0) return { type: 'revealCard', cardId: state.opponent.hand[0].id };
            return { type: 'skip' };

        case 'prompt_rearrange_protocols':
            return handleControlRearrange(state, action);
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
        case 'select_own_covered_card_to_shift': {
            const validTargets: PlayedCard[] = [];
            for (const lane of state.opponent.lanes) {
                // A card is covered if it's not the last one.
                for (let i = 0; i < lane.length - 1; i++) {
                    validTargets.push(lane[i]);
                }
            }
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
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

        case 'flip_self_for_water_0': {
            // Water-0: Flip self after playing
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        case 'plague_2_player_discard': {
            // Player is forced to discard - AI doesn't need to do anything
            return { type: 'skip' };
        }

        case 'reveal_opponent_hand': {
            // This action doesn't require a response from the AI
            return { type: 'skip' };
        }

        // ========== GENERIC HANDLERS FOR CUSTOM PROTOCOLS ==========

        case 'select_card_to_flip': {
            // Generic flip handler for custom protocols
            // Uses targetFilter from action to determine valid targets
            const targetFilter = (action as any).targetFilter || {};
            const currentLaneIndex = (action as any).currentLaneIndex; // Optional: restricts to specific lane
            const cardOwner = action.actor; // Who owns the source card (whose "opponent" we target)
            const validTargets: PlayedCard[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                // CRITICAL: owner filter is relative to cardOwner, NOT hardcoded to 'opponent'
                // 'own' = cards belonging to cardOwner
                // 'opponent' = cards belonging to the opponent OF cardOwner
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    // If currentLaneIndex is set, only check that lane
                    if (currentLaneIndex !== undefined && laneIdx !== currentLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];
                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];
                        const isTopCard = i === lane.length - 1;

                        // Check position filter
                        if (targetFilter.position === 'uncovered' && !isTopCard) continue;
                        if (targetFilter.position === 'covered' && isTopCard) continue;
                        if (targetFilter.position === 'covered_in_this_line' && isTopCard) continue;

                        // Check face state filter
                        if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                        if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;

                        // Check excludeSelf
                        if (targetFilter.excludeSelf && card.id === action.sourceCardId) continue;

                        validTargets.push(card);
                    }
                }
            }

            if (validTargets.length === 0) return { type: 'skip' };

            // Easy AI: Pick strategically, not randomly
            // 1. First, exclude the source card (never flip the card that triggered this)
            const sourceCardId = action.sourceCardId;
            const nonSourceTargets = validTargets.filter(c => c.id !== sourceCardId);
            const targets = nonSourceTargets.length > 0 ? nonSourceTargets : validTargets;

            // 2. Categorize targets by owner and face state
            const playerCards = targets.filter(c =>
                state.player.lanes.some(lane => lane.some(lc => lc.id === c.id))
            );
            const ownCards = targets.filter(c =>
                state.opponent.lanes.some(lane => lane.some(lc => lc.id === c.id))
            );

            // Priority: Flip player's face-up cards (reduces their points)
            const playerFaceUp = playerCards.filter(c => c.isFaceUp);
            if (playerFaceUp.length > 0) {
                playerFaceUp.sort((a, b) => b.value - a.value);
                return { type: 'flipCard', cardId: playerFaceUp[0].id };
            }

            // Then: Flip player's face-down cards (reveals and might hurt them)
            const playerFaceDown = playerCards.filter(c => !c.isFaceUp);
            if (playerFaceDown.length > 0) {
                return { type: 'flipCard', cardId: playerFaceDown[0].id };
            }

            // Then: Flip own face-down cards (gains points)
            const ownFaceDown = ownCards.filter(c => !c.isFaceUp);
            if (ownFaceDown.length > 0) {
                return { type: 'flipCard', cardId: ownFaceDown[0].id };
            }

            // Last resort: Flip own face-up cards (bad, but might be mandatory)
            const ownFaceUp = ownCards.filter(c => c.isFaceUp);
            if (ownFaceUp.length > 0) {
                ownFaceUp.sort((a, b) => a.value - b.value); // Pick lowest value
                return { type: 'flipCard', cardId: ownFaceUp[0].id };
            }

            // Fallback to first valid target
            return { type: 'flipCard', cardId: targets[0].id };
        }

        case 'select_card_to_shift': {
            // Generic shift handler for custom protocols
            // Uses targetFilter from action to determine valid targets
            const targetFilter = (action as any).targetFilter || {};
            const currentLaneIndex = (action as any).currentLaneIndex; // Optional: restricts to specific lane
            const cardOwner = action.actor; // Who owns the source card (whose "opponent" we target)
            const validTargets: PlayedCard[] = [];

            for (const playerKey of ['player', 'opponent'] as const) {
                // CRITICAL: owner filter is relative to cardOwner, NOT hardcoded to 'opponent'
                // 'own' = cards belonging to cardOwner
                // 'opponent' = cards belonging to the opponent OF cardOwner
                if (targetFilter.owner === 'own' && playerKey !== cardOwner) continue;
                if (targetFilter.owner === 'opponent' && playerKey === cardOwner) continue;

                for (let laneIdx = 0; laneIdx < state[playerKey].lanes.length; laneIdx++) {
                    // If currentLaneIndex is set, only check that lane
                    if (currentLaneIndex !== undefined && laneIdx !== currentLaneIndex) continue;

                    const lane = state[playerKey].lanes[laneIdx];
                    for (let i = 0; i < lane.length; i++) {
                        const card = lane[i];
                        const isTopCard = i === lane.length - 1;

                        // Check position filter
                        if (targetFilter.position === 'uncovered' && !isTopCard) continue;
                        if (targetFilter.position === 'covered' && isTopCard) continue;

                        // Check face state filter
                        if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                        if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;

                        // Check excludeSelf
                        if (targetFilter.excludeSelf && card.id === action.sourceCardId) continue;

                        validTargets.push(card);
                    }
                }
            }

            if (validTargets.length > 0) {
                // Easy AI: just pick random
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'deleteCard', cardId: randomTarget.id }; // 'deleteCard' is proxy for card selection
            }
            return { type: 'skip' };
        }

        // Custom Protocol: Board card reveal (similar to Light-2)
        case 'select_board_card_to_reveal_custom': {
            // Find face-down uncovered cards
            const validTargets: PlayedCard[] = [];
            for (const playerKey of ['player', 'opponent'] as const) {
                for (const lane of state[playerKey].lanes) {
                    if (lane.length > 0) {
                        const topCard = lane[lane.length - 1];
                        if (!topCard.isFaceUp) {
                            validTargets.push(topCard);
                        }
                    }
                }
            }
            if (validTargets.length > 0) {
                const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                return { type: 'deleteCard', cardId: randomTarget.id };
            }
            return { type: 'skip' };
        }

        case 'prompt_shift_or_flip_board_card_custom': {
            // Easy AI: flip own cards, skip opponent's
            const { revealedCardId } = action as any;
            const cardInfo = findCardOnBoard(state, revealedCardId);
            if (!cardInfo) return { type: 'skip' };
            if (cardInfo.owner === 'opponent') {
                return { type: 'resolveLight2Prompt', choice: 'flip' };
            }
            return { type: 'resolveLight2Prompt', choice: 'skip' };
        }

        case 'select_lane_to_shift_revealed_board_card_custom': {
            // Easy AI: pick random lane
            const possibleLanes = [0, 1, 2];
            const randomLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
            return { type: 'selectLane', laneIndex: randomLane };
        }

        case 'gravity_2_shift_after_flip': {
            // Gravity-2: Shift the flipped card to target lane
            const { targetLaneIndex } = action as any;
            return { type: 'selectLane', laneIndex: targetLaneIndex };
        }

        case 'flip_self_for_psychic_4': {
            // Psychic-4: Flip self after returning opponent card
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        case 'anarchy_0_conditional_draw': {
            // Anarchy-0: This is automatic, no AI decision needed
            return { type: 'skip' };
        }

        case 'speed_3_self_flip_after_shift': {
            // Speed-3: Flip self after shifting
            if (action.sourceCardId) {
                return { type: 'flipCard', cardId: action.sourceCardId };
            }
            return { type: 'skip' };
        }

        // ========== MISSING HANDLERS FOR CUSTOM PROTOCOLS ==========

        case 'select_lane_for_delete': {
            // Generic lane selection for delete effects
            const validLanes = (action as any).validLanes || [0, 1, 2];
            if (validLanes.length > 0) {
                return { type: 'selectLane', laneIndex: validLanes[Math.floor(Math.random() * validLanes.length)] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'select_lane_for_shift_all': {
            // Generic lane selection for shift all effects
            const validLanes = (action as any).validLanes || [0, 1, 2];
            const disallowedLane = (action as any).disallowedLaneIndex;
            const filteredLanes = validLanes.filter((i: number) => i !== disallowedLane);
            if (filteredLanes.length > 0) {
                return { type: 'selectLane', laneIndex: filteredLanes[Math.floor(Math.random() * filteredLanes.length)] };
            }
            return { type: 'selectLane', laneIndex: 0 };
        }

        case 'prompt_optional_draw': {
            // Optional draw effect - Easy AI accepts sometimes
            return { type: 'resolveOptionalEffectPrompt', accept: Math.random() > 0.5 };
        }

        case 'prompt_optional_discard_custom': {
            // Optional discard - Easy AI declines
            return { type: 'resolveOptionalEffectPrompt', accept: false };
        }

        case 'execute_remaining_custom_effects': {
            // This is automatic, no AI decision needed
            return { type: 'skip' };
        }

        case 'discard_completed': {
            // This is automatic, no AI decision needed
            return { type: 'skip' };
        }

        case 'custom_choice': {
            // Custom protocol choice between two options
            // Easy AI: randomly pick one
            return { type: 'resolveCustomChoice', choiceIndex: Math.floor(Math.random() * 2) };
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