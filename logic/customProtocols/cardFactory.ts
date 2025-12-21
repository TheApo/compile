/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card } from '../../data/cards';
import { CustomProtocolDefinition, CustomCardDefinition, EffectDefinition } from '../../types/customProtocol';

/**
 * Helper function to build target description text from params
 * Used by conditional branches to include targetFilter information
 */
function buildTargetDescription(params: any, defaultCount: number = 1): string {
    const count = params.count ?? defaultCount;
    const owner = params.targetFilter?.owner || 'any';
    const position = params.targetFilter?.position || 'uncovered';
    const faceState = params.targetFilter?.faceState;

    // Position text: 'uncovered' is default (no text), 'covered' adds "covered ", 'any' adds "covered or uncovered "
    let positionText = '';
    if (position === 'any') positionText = 'covered or uncovered ';
    else if (position === 'covered') positionText = 'covered ';

    // Face state text
    let faceStateText = '';
    if (faceState === 'face_down') faceStateText = 'face-down ';
    else if (faceState === 'face_up') faceStateText = 'face-up ';

    // Build with proper grammar
    const cardWord = count === 1 ? 'card' : 'cards';

    if (owner === 'own') {
        return `${count} of your ${positionText}${faceStateText}${cardWord}`;
    } else if (owner === 'opponent') {
        return `${count} of your opponent's ${positionText}${faceStateText}${cardWord}`;
    } else {
        // No owner specified
        if (count === 'all') {
            return `all ${positionText}${faceStateText}cards`;
        }
        return `${count} ${positionText}${faceStateText}${cardWord}`;
    }
}

/**
 * Generates human-readable text for an effect
 * IMPORTANT: This is the single source of truth for effect text generation
 * Used by both the game engine AND the card editor preview
 */
export const getEffectSummary = (effect: EffectDefinition, context?: { protocolName?: string }): string => {
    const params = effect.params as any;
    const protocolName = context?.protocolName || '[protocol]';
    let mainText = '';

    switch (params.action) {
        case 'refresh': {
            // Spirit-0: Refresh (fill hand to 5 cards)
            if (params.target === 'opponent') {
                mainText = 'Your opponent refreshes their hand.';
            } else {
                mainText = 'Refresh.';
            }
            break;
        }

        case 'mutual_draw': {
            // Chaos-0: Both players draw from each other's decks
            const count = params.count || 1;
            mainText = `Draw the top card${count !== 1 ? 's' : ''} of your opponent's deck. Your opponent draws the top card${count !== 1 ? 's' : ''} of your deck.`;
            break;
        }

        case 'draw': {
            // If referencing card from previous effect, draw based on that card's value
            if (effect.useCardFromPreviousEffect) {
                if (params.target === 'opponent') {
                    mainText = "Opponent draws cards equal to that card's value.";
                } else {
                    mainText = "Draw cards equal to that card's value.";
                }
                break;
            }

            // Handle revealFromDrawn - generic text generation based on parameters
            if (params.revealFromDrawn) {
                const drawCount = params.count || 3;
                const drawCardWord = drawCount === 1 ? 'card' : 'cards';
                let text = `Draw ${drawCount} ${drawCardWord}.`;

                // Reveal count
                const revealCount = params.revealFromDrawn.count || 1;
                const revealCountText = revealCount === 'all' ? 'all cards' :
                    (revealCount === 1 ? '1 card' : `${revealCount} cards`);

                // Value filter
                const valueSource = params.revealFromDrawn.valueSource || 'stated_number';
                if (valueSource === 'stated_number') {
                    text += ` Reveal ${revealCountText} drawn with the face-up value of your stated number.`;
                } else {
                    // 'any' - no filter, just reveal from drawn
                    text += ` Reveal ${revealCountText} drawn.`;
                }

                if (params.revealFromDrawn.thenAction === 'may_play') {
                    text += ' You may play it.';
                }

                mainText = text;
                break;
            }

            // NEW: Handle countType (Frost-0: count_face_down)
            if (params.countType === 'count_face_down') {
                mainText = 'Draw 1 card for each face-down card.';
                break;
            }

            if (params.conditional) {
                switch (params.conditional.type) {
                    case 'count_face_down':
                        mainText = 'Draw 1 card for each face-down card.';
                        break;
                    case 'is_covering':
                        mainText = `Draw ${params.count} card${params.count !== 1 ? 's' : ''} if this card is covering another.`;
                        break;
                    case 'non_matching_protocols':
                        mainText = 'Draw 1 card for each line with a non-matching protocol.';
                        break;
                }
                break;
            }

            let text = '';

            // NEW: Handle dynamic count types (Fire-4, Chaos-4)
            if (params.countType === 'equal_to_discarded') {
                const offset = params.countOffset || 0;
                if (offset === 1) {
                    text += 'Draw 1 more card than the amount discarded.';
                } else if (offset === 0) {
                    // Chaos-4: "Draw the same amount of cards"
                    text += 'Draw the same amount of cards.';
                } else {
                    text += `Draw the amount discarded plus ${offset}.`;
                }
                mainText = text;
                break;
            } else if (params.countType === 'equal_to_card_value') {
                text += "Draw cards equal to that card's value.";
                mainText = text;
                break;
            } else if (params.countType === 'hand_size') {
                text += 'Draw the same amount of cards.';
                mainText = text;
                break;
            } else if (params.countType === 'all_matching' && params.valueFilter?.equals !== undefined) {
                // "Draw all cards with a value of X"
                const targetValue = params.valueFilter.equals;
                text += `Draw all cards with a value of ${targetValue}.`;
                mainText = text;
                break;
            } else if (params.countType === 'equal_to_unique_protocols_in_lane') {
                // Diversity-1: "Draw cards equal to the number of different protocols in this line"
                text += 'Draw cards equal to the number of different protocols in this line.';
                mainText = text;
                break;
            } else if (params.countType === 'count_own_protocol_cards_on_field') {
                // Unity-2: "Draw cards equal to the number of face-up Unity cards in the field"
                text += `Draw cards equal to the number of face-up ${protocolName} cards in the field.`;
                mainText = text;
                break;
            } else if (params.valueFilter?.equals !== undefined && params.count) {
                // Clarity-2/3: "Draw 1 card with a value of X revealed this way."
                const targetValue = params.valueFilter.equals;
                const cardWord = params.count === 1 ? 'card' : 'cards';
                const revealedSuffix = params.fromRevealed ? ' revealed this way' : '';
                text += `Draw ${params.count} ${cardWord} with a value of ${targetValue}${revealedSuffix}.`;
                mainText = text;
                break;
            }

            // NEW: Protocol Filter for Draw (Unity-4: "If your hand is empty, reveal your deck, draw all Unity cards from it, and shuffle your deck.")
            // CRITICAL: This check must come BEFORE the generic empty_hand check below!
            if (params.protocolFilter?.type === 'same_as_source') {
                if (params.advancedConditional?.type === 'empty_hand') {
                    mainText = `If your hand is empty, reveal your deck, draw all ${protocolName} cards from it, and shuffle your deck.`;
                } else {
                    mainText = `Reveal your deck and draw all ${protocolName} cards.`;
                }
                break;
            }

            // NEW: Advanced Conditional - Empty Hand (Courage-0)
            if (params.advancedConditional?.type === 'empty_hand') {
                mainText = `If you have no cards in hand, draw ${buildTargetDescription(params)}.`;
                break;
            }

            // NEW: Advanced Conditional - Opponent Higher Value in Lane (Courage-2)
            if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
                mainText = `If your opponent has a higher total value than you do in this line, draw ${buildTargetDescription(params)}.`;
                break;
            }

            // NEW: Advanced Conditional - Same Protocol on Field (Unity-0, Unity-3)
            if (params.advancedConditional?.type === 'same_protocol_on_field') {
                mainText = `If there is another face-up ${protocolName} card in the field, draw ${buildTargetDescription(params)}.`;
                break;
            }

            // NEW: Handle optional draw (Death-1: "You may draw...")
            const optionalPrefix = params.optional ? 'You may ' : '';

            if (params.source === 'opponent_deck') {
                // Love-1: "Draw the top card of your opponent's deck"
                const cardWord = params.count === 1 ? 'the top card' : `the top ${params.count} cards`;
                text += `${optionalPrefix}Draw ${cardWord} of your opponent's deck.`;
            } else if (params.target === 'opponent') {
                // Opponent draws - check which deck they draw from
                if (params.source === 'own_deck') {
                    // Assimilation-4: "Your opponent draws the top card of your deck."
                    const cardWord = params.count === 1 ? 'the top card' : `the top ${params.count} cards`;
                    text += `Your opponent draws ${cardWord} of your deck.`;
                } else {
                    // Default: opponent draws from their own deck
                    text += `Opponent draws ${params.count} card${params.count !== 1 ? 's' : ''}.`;
                }
            } else {
                const drawVerb = params.optional ? 'draw' : 'Draw';
                text += `${optionalPrefix}${drawVerb} ${params.count} card${params.count !== 1 ? 's' : ''}.`;
            }

            mainText = text;
            break;
        }

        case 'flip': {
            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                const mayFlip = params.optional ? 'May flip' : 'Flip';
                const skipMiddle = params.skipMiddleCommand ? ', ignoring its middle commands' : '';
                mainText = `${mayFlip} that card${skipMiddle}.`;
                break;
            }

            // NEW: Handle flipSelf mode (Anarchy-6, Courage-6, Peace-6)
            if (params.flipSelf) {
                // NEW: Courage-6 - Opponent higher value conditional
                if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
                    mainText = 'If your opponent has a higher value in this line than you do, flip this card.';
                    break;
                }

                // NEW: Peace-6 - Hand size conditional
                if (params.advancedConditional?.type === 'hand_size_greater_than') {
                    const threshold = params.advancedConditional.threshold ?? 0;
                    const cardWord = threshold === 1 ? 'card' : 'cards';
                    mainText = `If you have more than ${threshold} ${cardWord} in your hand, flip this card.`;
                    break;
                }

                // NEW: Unity-3 - Same protocol on field conditional for flipSelf
                if (params.advancedConditional?.type === 'same_protocol_on_field') {
                    mainText = `If there is another face-up ${protocolName} card in the field, you may flip this card.`;
                    break;
                }

                // NEW: this_card_is_covered conditional for flipSelf
                if (params.advancedConditional?.type === 'this_card_is_covered') {
                    mainText = params.optional ? 'If this card is covered, you may flip this card.' : 'If this card is covered, flip this card.';
                    break;
                }

                let text = params.optional ? 'You may flip this card' : 'Flip this card';

                // NEW: Add conditional text (Anarchy-6)
                if (params.advancedConditional?.type === 'protocol_match') {
                    text += `, if this card is in the line with the ${params.advancedConditional.protocol || '[Protocol]'} protocol`;
                }

                mainText = text + '.';
                break;
            }

            // NEW: Unity-3 - Same protocol on field conditional for non-flipSelf
            if (params.advancedConditional?.type === 'same_protocol_on_field') {
                const count = params.count || 1;
                const faceState = params.targetFilter?.faceState === 'face_up' ? 'face-up ' : '';
                mainText = `If there is another face-up ${protocolName} card in the field, you may flip ${count} ${faceState}card${count !== 1 ? 's' : ''}.`;
                break;
            }

            const may = params.optional ? 'You may flip' : 'Flip';
            const isOwn = params.targetFilter?.owner === 'own';
            const isOpponent = params.targetFilter?.owner === 'opponent';
            const excludeSelf = params.targetFilter?.excludeSelf;

            // Build target description in correct grammatical order:
            // [of your/opponent's] [other] [covered/uncovered] [face-state] card(s)
            let targetDesc = '';
            // Use "of your" for "Flip 1 of your cards" phrasing
            if (isOwn && excludeSelf) targetDesc += 'of your other ';
            else if (isOwn) targetDesc += 'of your ';
            else if (isOpponent) targetDesc += "of your opponent's ";
            else if (excludeSelf) targetDesc += 'other ';
            // Handle position filter: 'any' = "covered or uncovered", 'covered' = "covered", default (uncovered) = nothing
            if (params.targetFilter?.position === 'any') targetDesc += 'covered or uncovered ';
            else if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';

            let countText = '';
            if (params.count === 'all') {
                countText = 'all';
            } else if (params.count === 'each') {
                const eachScope = params.eachLineScope;
                if (eachScope === 'each_line') {
                    countText = '1';
                    targetDesc = targetDesc + '(in each line) ';
                } else {
                    countText = 'each';
                }
            } else {
                countText = params.count.toString();
            }

            // Use plural "cards" for "of your/opponent's" phrasing (e.g., "Flip 1 of your cards")
            const usePluralCards = isOwn || isOpponent;
            const cardWord = usePluralCards ? 'cards' : ((params.count === 1) ? 'card' : 'cards');

            // Build text differently for "of your" phrasing (Apathy-4)
            let text = '';
            if (isOwn && params.targetFilter?.position === 'covered' && params.targetFilter?.faceState === 'face_up' && params.optional) {
                // Special case: "You may flip 1 of your face-up covered cards" (always plural "cards")
                text = `${may} ${countText} of your ${params.targetFilter.faceState.replace('_', '-')} ${params.targetFilter.position} cards`;
            } else {
                text = `${may} ${countText} ${targetDesc}${cardWord}`;
            }

            // NEW: Add scope text
            // "this_lane" + "own" = "this stack" (only own side of lane)
            // "this_lane" + "any/opponent" = "this line" (both sides)
            if (params.scope === 'this_lane') {
                const isOwnOnly = params.targetFilter?.owner === 'own';
                text += isOwnOnly ? ' in this stack' : ' in this line';
            } else if (params.scope === 'each_lane') {
                // Chaos-0: "In each line, flip 1 covered card."
                text = `In each line, ${text.charAt(0).toLowerCase() + text.slice(1)}`;
            }

            // NEW: Mirror-3 - sameLaneAsFirst constraint for follow-up flips
            if (params.sameLaneAsFirst) {
                text += ' in the same line';
            }

            // NEW: valueMinGreaterThanHandSize - target must have value > hand size
            if (params.targetFilter?.valueMinGreaterThanHandSize) {
                text += ' that has a value greater than the number of cards in your hand';
            }

            // NEW: valueLessThanUniqueProtocolsOnField - target must have value < unique protocols
            if (params.targetFilter?.valueLessThanUniqueProtocolsOnField) {
                text += ' with a value less than the number of different protocols on cards in the field';
            }

            text += '.';

            if (params.selfFlipAfter) {
                text += ' Then flip this card.';
            }

            mainText = text;
            break;
        }

        case 'shift': {
            const mayShift = params.optional ? 'You may shift' : 'Shift';

            // Advanced Conditional prefix for shift
            if (params.advancedConditional?.type === 'empty_hand') {
                mainText = `If you have no cards in hand, ${mayShift.toLowerCase()} ${buildTargetDescription(params)}.`;
                break;
            }
            if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
                mainText = `If your opponent has a higher total value than you do in this line, ${mayShift.toLowerCase()} ${buildTargetDescription(params)}.`;
                break;
            }
            // NEW: this_card_is_covered conditional (Ice-3) - refers to "this card" so keep "it"
            if (params.advancedConditional?.type === 'this_card_is_covered') {
                mainText = `If this card is covered, ${mayShift.toLowerCase()} it.`;
                break;
            }

            // Handle explicit shiftSelf parameter
            if (params.shiftSelf) {
                // Shift to opponent's highest value lane
                if (params.destinationRestriction?.type === 'opponent_highest_value_lane') {
                    mainText = `${mayShift} this card to the line where your opponent has their highest total value.`;
                    break;
                }

                let text = `${mayShift} this card`;
                if (params.allowCoveredSelf) {
                    text += ', even if this card is covered';
                }
                mainText = text + '.';
                break;
            }

            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                let text = `${mayShift} that card`;

                // Add destination restriction (Gravity-2: "to this line")
                if (params.destinationRestriction?.type === 'to_this_lane') {
                    text += ' to this line';
                } else if (params.destinationRestriction?.type === 'to_another_line') {
                    text += ' to another line';
                } else if (params.destinationRestriction?.type === 'non_matching_protocol') {
                    text += ' to a line without a matching protocol';
                } else if (params.destinationRestriction?.type === 'specific_lane') {
                    text += ' within this line';
                }

                mainText = text + '.';
                break;
            }

            const count = params.count || 1;

            // NEW: Special formatting for "of your" phrasing (Chaos-2: "Shift 1 of your covered cards")
            const isOwn = params.targetFilter?.owner === 'own';
            const isCovered = params.targetFilter?.position === 'covered';

            if (isOwn && isCovered && count === 1) {
                // Chaos-2 format: "Shift 1 of your covered cards" (always plural)
                let text = `${mayShift} 1 of your covered cards`;

                // Add destination text
                if (params.destinationRestriction?.type === 'non_matching_protocol') {
                    text += ' to a line without a matching protocol';
                } else if (params.destinationRestriction?.type === 'specific_lane') {
                    text += ' within this line';
                } else if (params.destinationRestriction?.type === 'to_another_line') {
                    text += ' to another line';
                }

                mainText = text + '.';
                break;
            }

            // CRITICAL: Spirit-3 special case - "shift this card"
            // This is ONLY for cards that shift themselves, with POSITION = 'any' (even if covered)
            // - owner MUST be "own"
            // - position MUST be "any" (this is the key differentiator!)
            // - NO excludeSelf
            // Example: Spirit-3 "You may shift this card, even if this card is covered"
            //
            // DIFFERENCE from "shift 1 of your cards" (Speed-3 End):
            // - Speed-3 has position: 'uncovered' (default) = normal card selection
            // - Spirit-3 has position: 'any' = shift THIS card specifically
            const isShiftThisCard = params.targetFilter?.owner === 'own' &&
                                    params.targetFilter?.position === 'any' &&
                                    !params.targetFilter?.excludeSelf &&
                                    count === 1;

            if (isShiftThisCard) {
                let text = `${mayShift} this card, even if this card is covered`;
                mainText = text + '.';
                break;
            }

            // "Shift 1 of your cards" - normal selection from own uncovered cards (Speed-3 End)
            if (isOwn && !isCovered && !params.targetFilter?.excludeSelf && count === 1) {
                let text = `${mayShift} 1 of your cards`;
                mainText = text + '.';
                break;
            }

            let targetDesc = '';
            const isOpponent = params.targetFilter?.owner === 'opponent';
            const excludeSelf = params.targetFilter?.excludeSelf;
            const positionAny = params.targetFilter?.position === 'any';

            // CRITICAL: Handle "of your" phrasing for own/opponent
            // Speed-3: "Shift 1 of your other cards"
            // Darkness-0: "Shift 1 of your opponent's covered cards"
            if (isOwn && excludeSelf) {
                targetDesc += "of your other ";
            } else if (isOpponent) {
                targetDesc += "of your opponent's ";
            } else if (excludeSelf) {
                targetDesc += 'other ';
            }

            // Handle position filter: 'any' = "covered or uncovered", 'covered' = "covered", default (uncovered) = nothing
            if (positionAny) targetDesc += 'covered or uncovered ';
            else if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';

            const countText = params.count === 'all' ? 'all' : '1';
            // Use plural "cards" for "of your other/opponent's" phrasing
            const usePluralCards = (isOwn && excludeSelf) || isOpponent;
            const cardWord = usePluralCards ? 'cards' : (countText === '1' ? 'card' : 'cards');
            let text = `${mayShift} ${countText} ${targetDesc}${cardWord}`;

            // NEW: Source scope text (Fear-3: "in this line" = where to select from)
            if (params.scope === 'this_lane') {
                text += ' in this line';
            }

            // NEW: Better destination text (Anarchy-1, Gravity-1, Gravity-2, Gravity-4)
            if (params.destinationRestriction?.type === 'non_matching_protocol') {
                text += ' to a line without a matching protocol';
            } else if (params.destinationRestriction?.type === 'specific_lane') {
                text += ' within this line';
            } else if (params.destinationRestriction?.type === 'to_another_line') {
                text += ' to another line';
            } else if (params.destinationRestriction?.type === 'to_this_lane') {
                text += ' to this line';
            } else if (params.destinationRestriction?.type === 'to_or_from_this_lane') {
                // Gravity-1: "Shift 1 card either to or from this line"
                text += ' either to or from this line';
            }

            mainText = text + '.';
            break;
        }

        case 'delete': {
            // Advanced Conditional prefix for delete
            if (params.advancedConditional?.type === 'empty_hand') {
                const count = params.count || 1;
                mainText = `If you have no cards in hand, delete ${count} card${count !== 1 ? 's' : ''}.`;
                break;
            }
            if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
                const count = params.count || 1;
                mainText = `If your opponent has a higher total value than you do in this line, delete ${count} card${count !== 1 ? 's' : ''}.`;
                break;
            }

            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                mainText = 'Delete that card.';
                break;
            }

            // Handle deleteSelf
            if (params.deleteSelf) {
                // NEW: protocolCountConditional for deleteSelf (Diversity-6)
                if (params.protocolCountConditional?.type === 'unique_protocols_on_field_below') {
                    const threshold = params.protocolCountConditional.threshold;
                    mainText = `If there are not at least ${threshold} different protocols on cards in the field, delete this card.`;
                } else if (params.advancedConditional?.type === 'this_card_is_covered') {
                    // Life-0: "If this card is covered, delete this card."
                    mainText = 'If this card is covered, delete this card.';
                } else {
                    mainText = 'Delete this card.';
                }
                break;
            }

            // Handle laneCondition
            if (params.laneCondition?.type === 'opponent_higher_value') {
                const count = params.count || 1;
                const ownerText = params.targetFilter?.owner === 'opponent' ? "of your opponent's " : '';
                const cardWord = count === 1 ? 'card' : 'cards';
                mainText = `Delete ${count} ${ownerText}${cardWord} in a line where they have a higher total value than you do.`;
                break;
            }

            let text = params.optional ? 'You may delete ' : 'Delete ';

            // NEW: Special handling for Anarchy-2 style (covered or uncovered)
            const isCoveredOrUncovered = params.targetFilter?.position === 'any';

            // NEW: For better English grammar
            // Hate-2: "Delete your highest value uncovered card" (owner + calculation)
            // Hate-4: "Delete the lowest value covered card" (no owner + calculation)
            const hasCalculation = params.targetFilter?.calculation === 'highest_value' || params.targetFilter?.calculation === 'lowest_value';
            const hasOwner = params.targetFilter?.owner === 'own' || params.targetFilter?.owner === 'opponent';
            const useNaturalOrderWithOwner = params.count === 1 && hasCalculation && hasOwner;
            const useTheWithCalculation = params.count === 1 && hasCalculation && !hasOwner;

            // Add count (skip if using natural order, or use "the" for calculation without owner)
            if (params.count === 'all_in_lane') {
                text += 'all ';
            } else if (useNaturalOrderWithOwner) {
                // Skip count, owner comes first
            } else if (useTheWithCalculation) {
                text += 'the ';
            } else {
                text += isCoveredOrUncovered ? 'a ' : `${params.count} `;
            }

            // Add owner FIRST if using natural order (Hate-2 style)
            if (useNaturalOrderWithOwner) {
                if (params.targetFilter?.owner === 'own') {
                    text += 'your ';
                } else if (params.targetFilter?.owner === 'opponent') {
                    text += "opponent's ";
                }
            }

            // Add calculation
            if (params.targetFilter?.calculation === 'highest_value') {
                text += 'highest value ';
            } else if (params.targetFilter?.calculation === 'lowest_value') {
                text += 'lowest value ';
            }

            // Add value range
            if (params.targetFilter?.valueRange) {
                const { min, max } = params.targetFilter.valueRange;
                const values = [];
                for (let i = min; i <= max; i++) {
                    values.push(i);
                }
                const valueText = values.join(' or ');
                text += `value ${valueText} `;
            }

            // Add owner if NOT using natural order (normal style)
            if (!useNaturalOrderWithOwner) {
                if (params.targetFilter?.owner === 'own') {
                    text += 'your ';
                } else if (params.targetFilter?.owner === 'opponent') {
                    text += "opponent's ";
                }
            }

            // Handle excludeSelf BEFORE position (correct order: "other covered or uncovered")
            if (params.excludeSelf) {
                text += 'other ';
            }

            // Handle "covered or uncovered" case (Anarchy-2)
            if (isCoveredOrUncovered) {
                text += 'covered or uncovered ';
            } else {
                // Only add "covered" explicitly - "uncovered" is the default and should NOT appear in text
                // covered_by_context also means covered cards (Hate-4)
                if (params.targetFilter?.position === 'covered' || params.targetFilter?.position === 'covered_by_context') {
                    text += 'covered ';
                }
            }

            if (params.targetFilter?.faceState === 'face_down') {
                text += 'face-down ';
            } else if (params.targetFilter?.faceState === 'face_up') {
                text += 'face-up ';
            }

            const cardWord = params.count === 1 ? 'card' : 'cards';
            text += cardWord;

            // NEW: Handle selectLane (Death-2: "in 1 line")
            if (params.selectLane) {
                text += ' in 1 line';
            }

            // NEW: Handle protocol matching (Anarchy-2: "in a line with a matching protocol")
            if (params.protocolMatching === 'must_match') {
                text += ' in a line with a matching protocol';
            } else if (params.protocolMatching === 'must_not_match') {
                text += ' in a line without a matching protocol';
            }

            if (params.scope?.type === 'this_line') {
                text += ' in this line';
            } else if (params.scope?.type === 'other_lanes') {
                text += ' in other lanes';
            } else if (params.scope?.type === 'each_other_line') {
                text += ' from each other line';
            }

            // NEW: Handle valueSource (Luck-4: "that shares a value with the discarded card")
            if (params.targetFilter?.valueSource === 'previous_effect_card') {
                text += ' that shares a value with the discarded card';
            }

            mainText = text + '.';
            break;
        }

        case 'discard': {
            // NEW: Handle discard from top of deck (Luck-2, Luck-3, Luck-4)
            if (params.source === 'top_deck_own') {
                mainText = 'Discard the top card of your deck.';
                break;
            }
            if (params.source === 'top_deck_opponent') {
                mainText = "Discard the top card of your opponent's deck.";
                break;
            }
            // NEW: Time-1 - Discard entire deck
            if (params.source === 'entire_deck') {
                mainText = 'Discard your entire deck.';
                break;
            }

            // If referencing card from previous effect, use "that card"
            if (params.useCardFromPreviousEffect) {
                if (params.actor === 'opponent') {
                    mainText = 'Opponent discards that card.';
                } else {
                    mainText = 'discard that card.';  // lowercase for "You may discard..."
                }
                break;
            }

            // Plague-2: "Your opponent discards the amount of cards discarded plus 1."
            if (params.countType === 'equal_to_discarded') {
                const offset = params.countOffset || 0;
                if (params.actor === 'opponent') {
                    if (offset === 1) {
                        mainText = 'Your opponent discards the amount of cards discarded plus 1.';
                    } else if (offset === 0) {
                        mainText = 'Your opponent discards the same amount of cards.';
                    } else {
                        mainText = `Your opponent discards the amount discarded plus ${offset}.`;
                    }
                } else {
                    if (offset === 1) {
                        mainText = 'Discard 1 more card than the amount discarded.';
                    } else if (offset === 0) {
                        mainText = 'Discard the same amount of cards.';
                    } else {
                        mainText = `Discard the amount discarded plus ${offset}.`;
                    }
                }
                break;
            }

            const isVariable = params.variableCount;
            let countText = '';

            if (isVariable) {
                countText = '1 or more cards';
            } else if (params.count === 'all') {
                // Chaos-4: "Discard your hand" instead of "You discard all cards"
                countText = 'your hand';
            } else {
                const cardWord = params.count === 1 ? 'card' : 'cards';
                countText = `${params.count} ${cardWord}`;
            }

            // NEW: Handle optional discard (Fire-3: "You may discard 1 card")
            // Plague-2: variableCount uses "Discard" without "You" prefix
            const mayPrefix = params.optional ? 'You may discard' :
                              (params.count === 'all' || isVariable) ? 'Discard' : 'You discard';

            // NEW: Handle 'both' actor (Peace-1: "Both players discard their hand")
            if (params.actor === 'both') {
                if (params.count === 'all') {
                    mainText = 'Both players discard their hand.';
                } else {
                    const cardWord = params.count === 1 ? 'card' : 'cards';
                    mainText = `Both players discard ${params.count} ${cardWord}.`;
                }
                break;
            }

            // Handle discardTo (into their trash)
            const discardTo = params.discardTo || 'own_trash';
            const intoTheirTrash = discardTo === 'opponent_trash' ? ' into their trash' : '';

            if (params.actor === 'opponent') {
                if (params.count === 'all') {
                    mainText = `Opponent discards their hand${intoTheirTrash}.`;
                } else if (params.random) {
                    const cardWord = params.count === 1 ? 'card' : 'cards';
                    mainText = `Your opponent discards ${params.count} random ${cardWord}${intoTheirTrash}.`;
                } else {
                    mainText = `Your opponent discards ${countText}${intoTheirTrash}.`;
                }
            } else {
                mainText = `${mayPrefix} ${countText}${intoTheirTrash}.`;
            }
            break;
        }

        case 'return': {
            // Advanced Conditional prefix for return
            if (params.advancedConditional?.type === 'empty_hand') {
                mainText = `If you have no cards in hand, return ${buildTargetDescription(params)}.`;
                break;
            }
            if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
                mainText = `If your opponent has a higher total value than you do in this line, return ${buildTargetDescription(params)}.`;
                break;
            }

            // Handle returnSelf
            if (params.returnSelf) {
                if (params.advancedConditional?.type === 'this_card_is_covered') {
                    mainText = params.optional ? 'If this card is covered, you may return this card to hand.' : 'If this card is covered, return this card to hand.';
                } else {
                    mainText = params.optional ? 'You may return this card to hand.' : 'Return this card to hand.';
                }
                break;
            }

            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                mainText = 'Return that card to hand.';
                break;
            }

            // Handle selectLane (Water-3: "Return all cards with a value of 2 in 1 line")
            const selectLane = (params as any).selectLane || false;
            const laneText = selectLane ? ' in 1 line' : '';

            if (params.targetFilter?.valueEquals !== undefined) {
                mainText = `Return all cards with a value of ${params.targetFilter.valueEquals}${laneText}.`;
                break;
            }

            const owner = params.targetFilter?.owner || 'any';
            const position = params.targetFilter?.position || 'uncovered';
            const faceState = params.targetFilter?.faceState;
            const destination = params.destination || 'owner_hand';

            // Build position text: 'any' = "covered or uncovered ", 'covered' = "covered ", default (uncovered) = ""
            let positionText = '';
            if (position === 'any') {
                positionText = 'covered or uncovered ';
            } else if (position === 'covered') {
                positionText = 'covered ';
            }

            // Build face state text
            let faceStateText = '';
            if (faceState === 'face_down') {
                faceStateText = 'face-down ';
            } else if (faceState === 'face_up') {
                faceStateText = 'face-up ';
            }

            // Build count and cards text with proper grammar
            // "1 of your cards" vs "1 card" (when no owner specified)
            // "all of your opponent's cards" vs "all cards"
            const count = params.count;
            const cardWord = count === 1 ? 'card' : 'cards';

            let countAndCardsText = '';
            if (owner === 'own') {
                // "1 of your cards", "all of your face-down cards"
                const countPart = count === 'all' ? 'all' : count;
                countAndCardsText = `${countPart} of your ${positionText}${faceStateText}${cardWord}`;
            } else if (owner === 'opponent') {
                // "1 of your opponent's cards", "all of your opponent's covered cards"
                const countPart = count === 'all' ? 'all' : count;
                countAndCardsText = `${countPart} of your opponent's ${positionText}${faceStateText}${cardWord}`;
            } else {
                // No owner specified: "1 card", "all covered cards"
                countAndCardsText = count === 'all' ? `all ${positionText}${faceStateText}cards` : `${count} ${positionText}${faceStateText}${cardWord}`;
            }

            // Handle steal (destination: 'actor_hand') - "Put X into your hand" instead of "Return X"
            if (destination === 'actor_hand' && owner === 'opponent') {
                const optionalPrefix = params.optional ? 'You may p' : 'P';
                mainText = `${optionalPrefix}ut ${countAndCardsText}${laneText} into your hand.`;
                break;
            }

            // Handle optional return
            const optionalPrefix = params.optional ? 'You may r' : 'R';
            mainText = `${optionalPrefix}eturn ${countAndCardsText}${laneText}.`;
            break;
        }

        case 'play': {
            // Advanced Conditional prefix for play
            if (params.advancedConditional?.type === 'empty_hand') {
                mainText = `If you have no cards in hand, play ${buildTargetDescription(params)}.`;
                break;
            }
            if (params.advancedConditional?.type === 'opponent_higher_value_in_lane') {
                mainText = `If your opponent has a higher total value than you do in this line, play ${buildTargetDescription(params)}.`;
                break;
            }

            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                const faceState = params.faceDown === true ? 'face-down' : params.faceDown === false ? 'face-up' : '';
                // Check destination rule for "in another line"
                let destText = '';
                if (params.destinationRule?.type === 'other_lines') {
                    destText = ' in another line';
                }
                mainText = faceState ? `Play that card ${faceState}${destText}.` : `Play that card${destText}.`;
                break;
            }

            // NEW: Time-0 - Play from trash
            if (params.source === 'trash') {
                const count = params.count || 1;
                const cardWord = count === 1 ? 'card' : 'cards';
                const sourceOwner = params.sourceOwner || 'own';
                const sourceText = sourceOwner === 'opponent' ? "your opponent's trash" : 'your trash';
                mainText = `Play ${count} ${cardWord} from ${sourceText}.`;
                break;
            }

            const actor = params.actor;
            const count = params.count || 1;
            // Only specify face state if explicitly set; undefined means player chooses
            const faceState = params.faceDown === true ? ' face-down' : params.faceDown === false ? ' face-up' : '';
            // NEW: sourceOwner determines whose deck/trash to use
            const sourceOwner = params.sourceOwner || 'own';
            // NEW: targetBoard determines on which board the card lands
            const targetBoard = params.targetBoard || 'own';

            let actorText = '';
            let cardPart = '';

            // NEW: Handle valueFilter ("Play 1 card with a value of 1")
            const valueFilterText = params.valueFilter?.equals !== undefined
                ? ` with a value of ${params.valueFilter.equals}`
                : '';

            if (actor === 'opponent') {
                actorText = 'Your opponent plays';
                if (params.source === 'deck') {
                    // Handle sourceOwner for opponent actor
                    if (sourceOwner === 'opponent') {
                        cardPart = count === 1 ? 'the top card of your deck' : `${count} cards from your deck`;
                    } else {
                        cardPart = count === 1 ? 'the top card of their deck' : `${count} cards from their deck`;
                    }
                } else {
                    cardPart = count === 1 ? `a card${valueFilterText} from their hand` : `${count} cards${valueFilterText} from their hand`;
                }
            } else {
                actorText = params.optional ? 'You may play' : 'Play';
                if (params.source === 'deck') {
                    // Handle sourceOwner for self actor
                    if (sourceOwner === 'opponent') {
                        cardPart = count === 1 ? "the top card of your opponent's deck" : `${count} cards from your opponent's deck`;
                    } else {
                        cardPart = count === 1 ? 'the top card of your deck' : `${count} cards from your deck`;
                    }
                } else {
                    // Simple "Play 1 card" without "from your hand"
                    cardPart = count === 1 ? `1 card${valueFilterText}` : `${count} cards${valueFilterText}`;
                }
            }

            // NEW: Handle conditional play prefix (Gravity-0)
            let conditionalPrefix = '';
            if (params.condition?.type === 'per_x_cards_in_line') {
                const cardCount = params.condition.cardCount || 2;
                conditionalPrefix = `For every ${cardCount} cards in this line, `;
                // Lowercase the actor text when used in conditional
                actorText = actorText.toLowerCase();
            }

            let text = `${conditionalPrefix}${actorText} ${cardPart}${faceState}`;

            if (params.destinationRule?.type === 'other_lines') {
                text += ' to other lines';
            } else if (params.destinationRule?.type === 'another_line') {
                // Life-3: "in another line" (singular - one random other line)
                text += ' in another line';
            } else if (params.destinationRule?.type === 'each_other_line') {
                text += ' in each other line';
            } else if (params.destinationRule?.type === 'under_this_card') {
                text += ' under this card';
            } else if (params.destinationRule?.type === 'each_line_with_card') {
                // Life-0: "in each line where you have a card" vs generic "to each line with a card"
                // Smoke-0: "in each line with a face-down card"
                const ownerFilter = params.destinationRule.ownerFilter;
                const cardFilter = params.destinationRule.cardFilter;
                if (cardFilter?.faceState === 'face_down') {
                    text += ' in each line with a face-down card';
                } else if (cardFilter?.faceState === 'face_up') {
                    text += ' in each line with a face-up card';
                } else if (ownerFilter === 'own') {
                    text += ' in each line where you have a card';
                } else if (ownerFilter === 'opponent') {
                    text += ' in each line where opponent has a card';
                } else {
                    text += ' to each line with a card';
                }
            } else if (params.destinationRule?.type === 'line_with_matching_cards') {
                // Smoke-3: "in a line with a face-down card"
                const cardFilter = params.destinationRule.cardFilter;
                if (cardFilter?.faceState === 'face_down') {
                    text += ' in a line with a face-down card';
                } else if (cardFilter?.faceState === 'face_up') {
                    text += ' in a line with a face-up card';
                } else {
                    text += ' in a line with a card';
                }
            } else if (params.destinationRule?.type === 'specific_lane') {
                text += ' in this line';
            }

            // Handle targetBoard (on opponent's side)
            if (targetBoard === 'opponent') {
                text += " on your opponent's side";
            }

            // NEW: excludeSourceProtocol - "non-X card" (Diversity-0)
            // This modifies the text to indicate "non-[protocol]" restriction
            // Applied when excludeSourceProtocol is true
            if (params.excludeSourceProtocol) {
                // Replace "1 card" with "1 non-[protocol] card"
                text = text.replace(/(\d+) card/, `$1 non-${protocolName} card`);
            }

            mainText = text + '.';
            break;
        }

        case 'rearrange_protocols':
        case 'swap_protocols': {
            const targetText =
                params.target === 'opponent'
                    ? "your opponent's"
                    : params.target === 'both_sequential'
                    ? "both players'"
                    : 'your';

            let text = '';
            if (params.action === 'rearrange_protocols') {
                text = `Rearrange ${targetText} protocols`;
            } else {
                text = `Swap the positions of 2 of ${targetText} protocols`;
            }

            // NEW: Add restriction text (Anarchy-3)
            if (params.restriction && params.restriction.disallowedProtocol) {
                text += `. ${params.restriction.disallowedProtocol} cannot be on this line`;
            }

            mainText = text + '.';
            break;
        }

        case 'reveal':
        case 'give': {
            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                const actionText = params.action === 'give' ? 'Give' : 'Reveal';
                mainText = `${actionText} that card.`;
                break;
            }

            const actionText = params.action === 'give' ? 'Give' : 'Reveal';

            // NEW: Handle board card reveal (Light-2)
            if (params.source === 'board') {
                const targetDesc = params.targetFilter?.faceState === 'face_down' ? 'face-down ' : '';
                const count = params.count || 1;
                const cardWord = count === 1 ? 'card' : 'cards';
                let text = `Reveal ${count} ${targetDesc}${cardWord}`;

                if (params.optional) {
                    text += '. You may shift or flip that card';
                } else if (params.followUpAction === 'flip') {
                    text += '. Then flip it';
                } else if (params.followUpAction === 'shift') {
                    text += '. Then shift it';
                }

                mainText = text + '.';
                break;
            }

            // NEW: Handle deck top reveal (Clarity-1 Start)
            if (params.source === 'own_deck_top') {
                let text = 'Reveal the top card of your deck';
                if (params.followUpAction === 'may_discard') {
                    text += '. You may discard it';
                }
                mainText = text + '.';
                break;
            }

            // NEW: Handle full deck reveal (Clarity-2/3)
            if (params.source === 'own_deck') {
                mainText = 'Reveal your deck.';
                break;
            }

            // NEW: Time-3 - Reveal from trash
            if (params.source === 'own_trash') {
                const count = params.count || 1;
                const cardWord = count === 1 ? 'card' : 'cards';
                mainText = `Reveal ${count} ${cardWord} from your trash.`;
                break;
            }

            // NEW: Unity-0 - Protocol filter for reveal (reveal all same-protocol cards in hand)
            if (params.protocolFilter?.type === 'same_as_source') {
                mainText = `Reveal all ${protocolName} cards in your hand.`;
                break;
            }

            // NEW: Handle count=-1 for "reveal/give entire hand"
            if (params.count === -1) {
                if (params.source === 'opponent_hand') {
                    mainText = params.action === 'reveal'
                        ? 'Your opponent reveals their hand.'
                        : 'Give your entire hand to your opponent.';
                } else {
                    // own_hand (or default)
                    mainText = params.action === 'reveal'
                        ? 'Reveal your hand.'
                        : 'Give your entire hand.';
                }
                break;
            }

            const cardWord = params.count === 1 ? 'card' : 'cards';
            const sourceText = params.source === 'opponent_hand' ? "opponent's hand" : 'your hand';

            // NEW: Handle optional give (Love-1 End: "You may give 1 card...")
            const mayText = params.optional ? 'You may ' : '';
            const actionTextLower = params.action === 'give' ? 'give' : 'reveal';
            const actionTextCapitalized = params.action === 'give' ? 'Give' : 'Reveal';

            let text: string;
            if (params.optional) {
                text = `${mayText}${actionTextLower} ${params.count} ${cardWord} from ${sourceText}`;
            } else {
                text = `${actionTextCapitalized} ${params.count} ${cardWord} from ${sourceText}`;
            }

            // Add destination for 'give' action
            if (params.action === 'give' && params.source !== 'opponent_hand') {
                text += ' to your opponent';
            }

            if (params.followUpAction === 'flip') {
                text += '. Then flip it.';
            } else if (params.followUpAction === 'shift') {
                text += '. Then shift it.';
            } else {
                text += '.';
            }

            mainText = text;
            break;
        }

        case 'take': {
            const cardWord = params.count === 1 ? 'card' : 'cards';
            const randomText = params.random !== false ? 'random ' : '';

            mainText = `Take ${params.count} ${randomText}${cardWord} from your opponent's hand.`;
            break;
        }

        case 'choice': {
            // Spirit-1: Choice effect - "Either X or Y."
            const options = params.options || [];
            if (options.length === 0) {
                mainText = 'Effect';
                break;
            }

            if (options.length === 2) {
                // Generate text for each option
                const optionTexts = options.map((opt: any) => {
                    const optEffect = { trigger: 'on_play', params: opt.params, position: 'bottom' } as EffectDefinition;
                    let optText = getEffectSummary(optEffect);
                    // Remove trailing period for embedding
                    if (optText.endsWith('.')) {
                        optText = optText.slice(0, -1);
                    }
                    // Lowercase first letter for embedding
                    optText = optText.charAt(0).toLowerCase() + optText.slice(1);
                    return optText;
                });

                // Check for advancedConditional prefix (Unity-0)
                if (params.advancedConditional?.type === 'same_protocol_on_field') {
                    mainText = `If there is another ${protocolName} card in the field, either ${optionTexts[0]} or ${optionTexts[1]}.`;
                } else {
                    mainText = `Either ${optionTexts[0]} or ${optionTexts[1]}.`;
                }
            } else {
                // More than 2 options - just say "Effect" for now
                mainText = 'Effect';
            }
            break;
        }

        case 'passive_rule': {
            const rule = params.rule;
            switch (rule?.type) {
                case 'require_non_matching_protocol':
                    mainText = 'Cards can only be played without matching protocols.';
                    break;
                case 'block_all_play':
                    if (rule.target === 'opponent') {
                        mainText = 'Your opponent cannot play cards in this line.';
                    } else if (rule.target === 'self') {
                        mainText = 'You cannot play cards in this line.';
                    } else {
                        mainText = 'Cards cannot be played in this line.';
                    }
                    break;
                case 'ignore_middle_commands':
                    if (rule.onlyDuringYourTurn && rule.target === 'opponent' && rule.scope === 'global') {
                        mainText = "During your turn, your opponent's cards do not have middle commands.";
                    } else if (rule.onlyDuringYourTurn) {
                        const targetText = rule.target === 'opponent' ? "your opponent's " : rule.target === 'self' ? 'your ' : '';
                        const scopeText = rule.scope === 'global' ? '' : ' in this line';
                        mainText = `During your turn, ignore all middle commands of ${targetText}cards${scopeText}.`;
                    } else {
                        mainText = 'Ignore all middle commands of cards in this line.';
                    }
                    break;
                case 'block_face_down_play':
                    mainText = "Opponent can't play cards face-down in this line.";
                    break;
                case 'require_face_down_play':
                    // Psychic-1: "Your opponent can only play cards face-down." (global)
                    mainText = rule.scope === 'global'
                        ? 'Your opponent can only play cards face-down.'
                        : 'Opponent can only play cards face-down in this line.';
                    break;
                case 'allow_any_protocol_play':
                    // Spirit-1: Global effect - all cards can be played without matching
                    mainText = 'You may play cards without matching protocols.';
                    break;
                case 'allow_play_on_opponent_side':
                    mainText = "You may play this card in any line on either player's side.";
                    break;
                case 'block_flips':
                    // Frost-1: scope is global, so no "in this line"
                    mainText = rule.scope === 'global' ? "Cards cannot be flipped face-up." : "Cards can't be flipped face-up in this line.";
                    break;
                case 'block_protocol_rearrange':
                    mainText = "Protocols can't be rearranged.";
                    break;
                case 'block_shifts_from_lane':
                    mainText = "Cards can't shift from this line.";
                    break;
                case 'block_shifts_to_lane':
                    mainText = "Cards can't shift to this line.";
                    break;
                case 'block_shifts_from_and_to_lane':
                    mainText = "Cards cannot shift from or to this line.";
                    break;
                case 'skip_check_cache_phase':
                    mainText = 'Skip check cache phase.';
                    break;
                // NEW: Ice-4 - This card cannot be flipped
                case 'block_flip_this_card':
                    mainText = 'This card cannot be flipped.';
                    break;
                // NEW: Unity-1 - Allow same protocol face-up play
                case 'allow_same_protocol_face_up_play':
                    mainText = `${protocolName} cards may be played face-up in this line.`;
                    break;
                // NEW: Ice-6 - Conditional draw blocking (flexible)
                case 'block_draw_conditional': {
                    const conditionTarget = (rule as any).conditionTarget || 'self';
                    const blockTarget = (rule as any).blockTarget || 'self';

                    const conditionText = conditionTarget === 'self' ? 'you have' : 'your opponent has';
                    let blockText: string;
                    if (blockTarget === 'self') {
                        blockText = 'you cannot draw';
                    } else if (blockTarget === 'opponent') {
                        blockText = 'your opponent cannot draw';
                    } else {
                        blockText = 'neither player can draw';
                    }
                    mainText = `If ${conditionText} any cards in hand, ${blockText} cards.`;
                    break;
                }
                default:
                    mainText = 'Passive rule effect.';
            }
            break;
        }

        case 'value_modifier': {
            const mod = params.modifier;
            switch (mod?.type) {
                case 'add_per_condition': {
                    const scopeText = mod.scope === 'this_lane' ? 'in this line' : '';
                    const targetText = mod.target === 'own_total' ? 'Your total value' :
                                      mod.target === 'opponent_total' ? "Your opponent's total value" :
                                      'Total value';

                    let conditionText = '';
                    let conditionScopeText = '';  // Extra scope text for certain conditions
                    if (mod.condition === 'per_face_down_card') {
                        conditionText = 'for each face-down card';
                        conditionScopeText = scopeText;
                    } else if (mod.condition === 'per_face_up_card') {
                        conditionText = 'for each face-up card';
                        conditionScopeText = scopeText;
                    } else if (mod.condition === 'per_card') {
                        conditionText = 'for each card';
                        conditionScopeText = scopeText;
                    } else if (mod.condition === 'per_card_in_hand') {
                        conditionText = 'for each card in your hand';
                        // No extra scope - hand is already specified
                    } else if (mod.condition === 'per_opponent_card_in_lane') {
                        conditionText = "for each of your opponent's cards";
                        conditionScopeText = scopeText;
                    }

                    const absValue = Math.abs(mod.value);
                    const changeText = mod.value >= 0 ? 'increased' : 'reduced';
                    mainText = `${targetText} ${scopeText} is ${changeText} by ${absValue} ${conditionText} ${conditionScopeText}.`.replace(/\s+/g, ' ').trim();
                    break;
                }
                case 'set_to_fixed': {
                    // Build description based on target/scope/filter
                    let targetDesc = '';
                    if (mod.target === 'own_cards') {
                        targetDesc = 'your';
                    } else if (mod.target === 'opponent_cards') {
                        targetDesc = "opponent's";
                    } else {
                        targetDesc = 'all';
                    }

                    let faceDesc = '';
                    if (mod.filter?.faceState === 'face_down') {
                        faceDesc = ' face-down';
                    } else if (mod.filter?.faceState === 'face_up') {
                        faceDesc = ' face-up';
                    }

                    let scopeDesc = '';
                    if (mod.scope === 'this_lane') {
                        scopeDesc = ' in this stack';
                    }

                    mainText = `All ${targetDesc}${faceDesc} cards${scopeDesc} have a value of ${mod.value}.`;
                    break;
                }
                case 'add_to_total': {
                    const scopeText = mod.scope === 'this_lane' ? ' in this line' : '';

                    // NEW: has_non_own_protocol_face_up condition (Diversity-3)
                    const conditionText = mod.condition === 'has_non_own_protocol_face_up'
                        ? ` if there are any non-${protocolName} face-up cards in this stack`
                        : '';

                    if (mod.target === 'opponent_total') {
                        if (mod.value < 0) {
                            mainText = `Your opponent's total value${scopeText} is reduced by ${Math.abs(mod.value)}${conditionText}.`;
                        } else {
                            mainText = `Your opponent's total value${scopeText} is increased by ${mod.value}${conditionText}.`;
                        }
                    } else {
                        if (mod.value < 0) {
                            mainText = `Your total value${scopeText} is reduced by ${Math.abs(mod.value)}${conditionText}.`;
                        } else {
                            mainText = `Your total value${scopeText} is increased by ${mod.value}${conditionText}.`;
                        }
                    }
                    break;
                }
                default:
                    mainText = 'Value modifier effect.';
            }
            break;
        }

        case 'block_compile': {
            // Metal-1: Your opponent cannot compile next turn
            const targetText = params.target === 'opponent' ? 'Your opponent' : 'You';
            mainText = `${targetText} cannot compile next turn.`;
            break;
        }

        case 'delete_all_in_lane': {
            // Metal-3: Delete all cards in 1 other line with 8 or more cards
            const minCards = params.laneCondition?.count || 8;
            const excludeText = params.excludeCurrentLane ? '1 other line' : '1 line';
            mainText = `Delete all cards in ${excludeText} with ${minCards} or more cards.`;
            break;
        }

        case 'modify_value': {
            // Metal-0: Your opponent's total value in this line is reduced by X
            const modifier = params.modifier || 0;
            const targetText = params.target === 'opponent' ? "Your opponent's" : 'Your';
            const changeText = modifier < 0 ? `reduced by ${Math.abs(modifier)}` : `increased by ${modifier}`;
            mainText = `${targetText} total value in this line is ${changeText}.`;
            break;
        }

        case 'block_play_face_down': {
            // Metal-2: Your opponent cannot play cards face-down in this line
            mainText = 'Your opponent cannot play cards face-down in this line.';
            break;
        }

        case 'shuffle_trash': {
            // Clarity-4: "You may shuffle your trash into your deck"
            // Time-2: "If there are any cards in your trash, you may shuffle your trash into your deck."
            const optionalText = params.optional !== false ? 'You may shuffle' : 'Shuffle';
            let text = `${optionalText} your trash into your deck.`;

            // Add conditional prefix if trash_not_empty
            if (params.advancedConditional?.type === 'trash_not_empty') {
                text = `If there are any cards in your trash, ${text.charAt(0).toLowerCase() + text.slice(1)}`;
            }

            mainText = text;
            break;
        }

        case 'shuffle_deck': {
            // Clarity-2/3: "Shuffle your deck"
            mainText = 'Shuffle your deck.';
            break;
        }

        case 'redirect_return_to_deck': {
            const faceDown = params.faceDown !== false;
            mainText = `Put that card on top of their deck ${faceDown ? 'face-down ' : ''}instead.`;
            break;
        }

        case 'state_number': {
            // Luck-0: "State a number"
            mainText = 'State a number.';
            break;
        }

        case 'state_protocol': {
            // Luck-3: "State a protocol"
            mainText = 'State a protocol.';
            break;
        }

        case 'swap_stacks': {
            // Mirror-2: Swap cards between own lanes
            mainText = 'Swap all of your cards in one of your stacks with another one of your stacks.';
            break;
        }

        case 'copy_opponent_middle': {
            // Mirror-1: Copy opponent's middle effect
            const optText = params.optional ? 'You may resolve' : 'Resolve';
            mainText = `${optText} the middle command of 1 of your opponent's cards as if it were on this card.`;
            break;
        }

        case 'auto_compile': {
            // Diversity-0: Compile without deleting cards
            if (params.protocolCountConditional?.type === 'unique_protocols_on_field') {
                const threshold = params.protocolCountConditional.threshold;
                mainText = `If there are ${threshold} different protocols on cards in the field, compile this protocol.`;
            } else if (params.protocolCountConditional?.type === 'same_protocol_count_on_field') {
                // Unity-1: If 5+ face-up Unity cards, compile and delete all in lane
                const threshold = params.protocolCountConditional.threshold;
                const faceStateText = params.protocolCountConditional.faceState === 'face_up' ? 'face-up ' : '';
                const deleteText = params.deleteAllInLane ? ' and delete all cards in this line' : '';
                mainText = `If there are ${threshold} or more ${faceStateText}${protocolName} cards in the field, compile this protocol${deleteText}.`;
            } else {
                mainText = 'Compile this protocol.';
            }
            break;
        }

        case 'card_property': {
            // Chaos-3: Card properties that affect how this card is played
            if (params.property === 'ignore_protocol_matching') {
                mainText = 'This card may be played without matching protocols.';
            } else {
                mainText = 'Card property.';
            }
            break;
        }

        default:
            mainText = 'Effect';
            break;
    }

    // Handle conditional follow-up effects
    if (effect.conditional && effect.conditional.thenEffect) {
        let followUpText = getEffectSummary(effect.conditional.thenEffect);

        // If the follow-up uses useCardFromPreviousEffect, replace "1 card" with "that card"
        const thenParams = effect.conditional.thenEffect.params as any;
        if (thenParams?.useCardFromPreviousEffect) {
            followUpText = followUpText.replace(/\d+ cards?/i, 'that card');
        }

        if (effect.conditional.type === 'then') {
            // Death-1: "delete 1 other card, then delete this card."
            // Remove period from first part and add "then" before follow-up (lowercase)
            const firstPart = mainText.endsWith('.') ? mainText.slice(0, -1) : mainText;
            mainText = `${firstPart}, then ${followUpText.toLowerCase()}`;
        } else if (effect.conditional.type === 'optional') {
            // Clarity-1: "Reveal the top card of your deck. You may discard that card."
            const firstPart = mainText.endsWith('.') ? mainText.slice(0, -1) : mainText;
            mainText = `${firstPart}. You may ${followUpText.toLowerCase()}`;
        } else if (effect.conditional.type === 'if_protocol_matches_stated') {
            // Luck-3: "If the discarded card matches the stated protocol, delete 1 card."
            mainText = `${mainText} If the discarded card matches the stated protocol, ${followUpText.toLowerCase()}`;
        } else {
            // "If you do" format (if_executed)
            mainText = `${mainText} If you do, ${followUpText.toLowerCase()}`;
        }
    }

    return mainText;
};

/**
 * Generate keywords from effect definitions for AI understanding
 */
const extractKeywords = (effects: EffectDefinition[]): Record<string, boolean> => {
    const keywords: Record<string, boolean> = {};

    for (const effect of effects) {
        const params = effect.params as any;
        const action = params.action;

        // Map actions to keywords
        if (action === 'draw') keywords.draw = true;
        if (action === 'flip') keywords.flip = true;
        if (action === 'shift') keywords.shift = true;
        if (action === 'delete') keywords.delete = true;
        if (action === 'discard') keywords.discard = true;
        if (action === 'return') keywords.return = true;
        if (action === 'play') keywords.play = true;
        if (action === 'reveal') keywords.reveal = true;
        if (action === 'give') keywords.give = true;
        if (action === 'take') keywords.take = true;
    }

    return keywords;
};

/**
 * Generate text for a card's effects section
 * IMPORTANT: This is the single source of truth for full effect text (trigger + effect)
 * Used by both the game engine AND the card editor preview
 */
export const generateEffectText = (effects: EffectDefinition[], context?: { protocolName?: string }): string => {
    if (effects.length === 0) return '';

    return effects.map(effect => {
        const summary = getEffectSummary(effect, context);
        const trigger = effect.trigger;

        if (trigger === 'start') return `<div><span class='emphasis'>Start:</span> ${summary}</div>`;
        if (trigger === 'end') return `<div><span class='emphasis'>End:</span> ${summary}</div>`;
        if (trigger === 'on_cover') {
            // NEW: Unity-0 Bottom - Protocol restriction for on_cover
            if ((effect as any).onCoverProtocolRestriction === 'same_protocol') {
                return `<div><span class='emphasis'>When this card would be covered by another ${context?.protocolName || '[protocol]'} card:</span> First, ${summary.toLowerCase()}</div>`;
            }
            return `<div><span class='emphasis'>When this card would be covered:</span> First, ${summary.toLowerCase()}</div>`;
        }
        if (trigger === 'on_flip') return `<div><span class='emphasis'>When this card would be flipped:</span> First, ${summary.toLowerCase()}</div>`;
        if (trigger === 'on_cover_or_flip') return `<div><span class='emphasis'>When this card would be covered or flipped:</span> First, ${summary.toLowerCase()}</div>`;

        // NEW: Reactive triggers - text depends on reactiveTriggerActor
        if (trigger === 'after_draw' || trigger === 'after_delete' || trigger === 'after_discard' || trigger === 'after_shift' || trigger === 'after_flip' || trigger === 'after_clear_cache') {
            const triggerActor = effect.reactiveTriggerActor || 'self';
            const actorText = triggerActor === 'self' ? 'you' :
                             triggerActor === 'opponent' ? 'opponent' :
                             'a card is';

            let actionText = '';
            if (trigger === 'after_draw') {
                actionText = triggerActor === 'any' ? 'drawn' : 'draw cards';
            } else if (trigger === 'after_delete') {
                actionText = triggerActor === 'any' ? 'deleted' : 'delete cards';
            } else if (trigger === 'after_discard') {
                actionText = triggerActor === 'any' ? 'discarded' : 'discard cards';
            } else if (trigger === 'after_shift') {
                actionText = triggerActor === 'any' ? 'shifted' : 'shift cards';
            } else if (trigger === 'after_flip') {
                actionText = triggerActor === 'any' ? 'flipped' : 'flip cards';
            } else if (trigger === 'after_clear_cache') {
                actionText = 'clear cache';
            }

            // NEW: Peace-4 - "during your opponent's turn" modifier
            const turnModifier = (effect as any).onlyDuringOpponentTurn ? " during your opponent's turn" : '';
            const prefixText = `After ${actorText} ${actionText}${turnModifier}`;
            return `<div><span class='emphasis'>${prefixText}:</span> ${summary}</div>`;
        }

        // Plague-1: "After your opponent discards cards: Draw 1 card."
        if (trigger === 'after_opponent_discard') {
            return `<div><span class='emphasis'>After your opponent discards cards:</span> ${summary}</div>`;
        }

        // Mirror-4: "After your opponent draws cards: Draw 1 card."
        if (trigger === 'after_opponent_draw') {
            return `<div><span class='emphasis'>After your opponent draws cards:</span> ${summary}</div>`;
        }

        // After refresh triggers - support reactiveTriggerActor: self/opponent/any
        if (trigger === 'after_refresh') {
            const triggerActor = effect.reactiveTriggerActor || 'self';
            let prefix = 'After you refresh:';
            if (triggerActor === 'opponent') {
                prefix = 'After your opponent refreshes:';
            } else if (triggerActor === 'any') {
                prefix = 'After a player refreshes:';
            }
            return `<div><span class='emphasis'>${prefix}</span> ${summary}</div>`;
        }

        // War-1: "After your opponent refreshes: Discard any number of cards. Refresh."
        if (trigger === 'after_opponent_refresh') {
            return `<div><span class='emphasis'>After your opponent refreshes:</span> ${summary}</div>`;
        }

        // "After you compile:" (for symmetry)
        if (trigger === 'after_compile') {
            return `<div><span class='emphasis'>After you compile:</span> ${summary}</div>`;
        }

        // War-2: "After your opponent compiles: Your opponent discards their hand."
        if (trigger === 'after_opponent_compile') {
            return `<div><span class='emphasis'>After your opponent compiles:</span> ${summary}</div>`;
        }

        // NEW: Time-2 - After shuffle trigger (supports reactiveTriggerActor: self/opponent/any)
        if (trigger === 'after_shuffle') {
            const triggerActor = effect.reactiveTriggerActor || 'self';
            let prefix = 'After you shuffle your deck:';
            if (triggerActor === 'opponent') {
                prefix = 'After your opponent shuffles their deck:';
            } else if (triggerActor === 'any') {
                prefix = 'After any player shuffles their deck:';
            }
            return `<div><span class='emphasis'>${prefix}</span> ${summary}</div>`;
        }

        // NEW: after_play with reactiveScope (Ice-1 Bottom)
        if (trigger === 'after_play') {
            const triggerActor = effect.reactiveTriggerActor || 'self';
            const reactiveScope = (effect as any).reactiveScope || 'global';

            if (triggerActor === 'opponent' && reactiveScope === 'this_lane') {
                return `<div><span class='emphasis'>After your opponent plays a card in this line:</span> ${summary}</div>`;
            } else if (triggerActor === 'opponent') {
                return `<div><span class='emphasis'>After your opponent plays a card:</span> ${summary}</div>`;
            } else if (reactiveScope === 'this_lane') {
                return `<div><span class='emphasis'>After you play a card in this line:</span> ${summary}</div>`;
            }
            return `<div><span class='emphasis'>After you play a card:</span> ${summary}</div>`;
        }

        // NEW: Before compile delete trigger (Speed-2)
        if (trigger === 'before_compile_delete') {
            return `<div><span class='emphasis'>When this card would be deleted by compiling:</span> ${summary}</div>`;
        }

        // When a card would be returned to a player's hand
        if (trigger === 'when_card_returned') {
            // Check targetOwner to determine the text
            const targetOwner = effect.params?.targetOwner || 'opponent';
            const targetText = targetOwner === 'opponent' ? "your opponent's" : 'your';
            return `<div><span class='emphasis'>When a card would be returned to ${targetText} hand:</span> ${summary}</div>`;
        }

        return summary;
    }).join(' ');
};

/**
 * Convert a CustomCardDefinition to a Card object
 */
export const convertCustomCardToCard = (
    customCard: CustomCardDefinition,
    protocol: CustomProtocolDefinition
): Card => {
    // Pass protocol name for proper text generation (e.g., "non-Diversity card")
    const effectContext = { protocolName: protocol.name };

    // Use manual text if provided, otherwise generate from effects
    const topText = (customCard.text?.top !== undefined)
        ? customCard.text.top
        : generateEffectText(customCard.topEffects, effectContext);
    const middleText = (customCard.text?.middle !== undefined)
        ? customCard.text.middle
        : generateEffectText(customCard.middleEffects, effectContext);
    const bottomText = (customCard.text?.bottom !== undefined)
        ? customCard.text.bottom
        : generateEffectText(customCard.bottomEffects, effectContext);

    // Collect keywords from all effects
    const allEffects = [...customCard.topEffects, ...customCard.middleEffects, ...customCard.bottomEffects];
    const keywords = extractKeywords(allEffects);

    const card = {
        protocol: protocol.name,
        value: customCard.value,
        top: topText,
        middle: middleText,
        bottom: bottomText,
        keywords,
        category: protocol.category || 'Custom',  // Use protocol's category, default to 'Custom' for user-created
        color: protocol.color,  // Custom protocol color
        pattern: protocol.pattern,  // Custom protocol pattern
        // Store the effect definitions for runtime execution
        customEffects: {
            topEffects: customCard.topEffects,
            middleEffects: customCard.middleEffects,
            bottomEffects: customCard.bottomEffects,
        }
    } as any; // Type assertion needed since we're extending Card interface

    return card;
};

/**
 * Convert a CustomProtocolDefinition to an array of Card objects
 */
export const convertCustomProtocolToCards = (protocol: CustomProtocolDefinition): Card[] => {
    return protocol.cards.map(card => convertCustomCardToCard(card, protocol));
};

/**
 * Get all custom protocols as Card objects
 */
export const getAllCustomProtocolCards = (): Card[] => {
    try {
        const stored = localStorage.getItem('custom_protocols_v1');
        if (!stored) {
            return [];
        }

        const data = JSON.parse(stored);
        const protocols: CustomProtocolDefinition[] = data.protocols || [];

        const allCards: Card[] = [];

        for (const protocol of protocols) {
            const cards = convertCustomProtocolToCards(protocol);
            allCards.push(...cards);
        }

        return allCards;
    } catch (error) {
        console.error('Failed to load custom protocol cards:', error);
        return [];
    }
};
