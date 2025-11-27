/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card } from '../../data/cards';
import { CustomProtocolDefinition, CustomCardDefinition, EffectDefinition } from '../../types/customProtocol';

/**
 * Generates human-readable text for an effect
 * IMPORTANT: This is the single source of truth for effect text generation
 * Used by both the game engine AND the card editor preview
 */
export const getEffectSummary = (effect: EffectDefinition): string => {
    const params = effect.params as any;
    let mainText = '';

    switch (params.action) {
        case 'refresh': {
            // Spirit-0: Refresh (fill hand to 5 cards)
            mainText = 'Refresh.';
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
            }

            // NEW: Handle optional draw (Death-1: "You may draw...")
            const optionalPrefix = params.optional ? 'You may ' : '';

            if (params.source === 'opponent_deck') {
                // Love-1: "Draw the top card of your opponent's deck"
                const cardWord = params.count === 1 ? 'the top card' : `the top ${params.count} cards`;
                text += `${optionalPrefix}Draw ${cardWord} of your opponent's deck.`;
            } else if (params.target === 'opponent') {
                text += `Opponent draws ${params.count} card${params.count !== 1 ? 's' : ''}.`;
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
                mainText = `${mayFlip} that card.`;
                break;
            }

            // NEW: Handle flipSelf mode (Anarchy-6)
            if (params.flipSelf) {
                let text = params.optional ? 'Flip this card' : 'Flip this card';

                // NEW: Add conditional text (Anarchy-6)
                if (params.advancedConditional?.type === 'protocol_match') {
                    text += `, if this card is in the line with the ${params.advancedConditional.protocol || '[Protocol]'} protocol`;
                }

                mainText = text + '.';
                break;
            }

            const may = params.optional ? 'You may flip' : 'Flip';
            const isOwn = params.targetFilter?.owner === 'own';
            const isOpponent = params.targetFilter?.owner === 'opponent';

            let targetDesc = '';
            if (isOwn) targetDesc = 'your ';
            if (isOpponent) targetDesc = "opponent's ";
            // Only add "covered" explicitly - "uncovered" is the default and should NOT appear in text
            if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';
            if (params.targetFilter?.excludeSelf) targetDesc += 'other ';

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

            const cardWord = (params.count === 1) ? 'card' : 'cards';

            // Build text differently for "of your" phrasing (Apathy-4)
            let text = '';
            if (isOwn && params.targetFilter?.position === 'covered' && params.targetFilter?.faceState === 'face_up' && params.optional) {
                // Special case: "You may flip 1 of your face-up covered cards" (always plural "cards")
                text = `${may} ${countText} of your ${params.targetFilter.faceState.replace('_', '-')} ${params.targetFilter.position} cards`;
            } else {
                text = `${may} ${countText} ${targetDesc}${cardWord}`;
            }

            // NEW: Add scope text
            if (params.scope === 'this_lane') {
                text += ' in this line';
            } else if (params.scope === 'each_lane') {
                // Chaos-0: "In each line, flip 1 covered card."
                text = `In each line, ${text.charAt(0).toLowerCase() + text.slice(1)}`;
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

            // NEW: Handle explicit shiftSelf parameter (Speed-2)
            if (params.shiftSelf) {
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

            // Only add "covered" explicitly - "uncovered" is the default and should NOT appear in text
            if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';

            const countText = params.count === 'all' ? 'all' : '1';
            // Use plural "cards" for "of your other/opponent's" phrasing
            const usePluralCards = (isOwn && excludeSelf) || isOpponent;
            const cardWord = usePluralCards ? 'cards' : (countText === '1' ? 'card' : 'cards');
            let text = `${mayShift} ${countText} ${targetDesc}${cardWord}`;

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
            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                mainText = 'Delete that card.';
                break;
            }

            // NEW: Handle deleteSelf (Death-1: "delete this card")
            if (params.deleteSelf) {
                mainText = 'Delete this card.';
                break;
            }

            let text = 'Delete ';

            // NEW: Special handling for Anarchy-2 style (covered or uncovered)
            const isCoveredOrUncovered = params.targetFilter?.position === 'any';

            // NEW: For better English grammar (Hate-2: "Delete your highest value uncovered card")
            // When count=1 + calculation + owner, skip the "1" and put owner first
            const hasCalculation = params.targetFilter?.calculation === 'highest_value' || params.targetFilter?.calculation === 'lowest_value';
            const hasOwner = params.targetFilter?.owner === 'own' || params.targetFilter?.owner === 'opponent';
            const useNaturalOrder = params.count === 1 && hasCalculation && hasOwner;

            // Add count (skip if using natural order)
            if (params.count === 'all_in_lane') {
                text += 'all ';
            } else if (!useNaturalOrder) {
                text += isCoveredOrUncovered ? 'a ' : `${params.count} `;
            }

            // Add owner FIRST if using natural order (Hate-2 style)
            if (useNaturalOrder) {
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
            if (!useNaturalOrder) {
                if (params.targetFilter?.owner === 'own') {
                    text += 'your ';
                } else if (params.targetFilter?.owner === 'opponent') {
                    text += "opponent's ";
                }
            }

            // NEW: Handle "covered or uncovered" case (Anarchy-2)
            if (isCoveredOrUncovered) {
                text += 'covered or uncovered ';
            } else {
                // Only add "covered" explicitly - "uncovered" is the default and should NOT appear in text
                if (params.targetFilter?.position === 'covered') {
                    text += 'covered ';
                }
            }

            if (params.targetFilter?.faceState === 'face_down') {
                text += 'face-down ';
            } else if (params.targetFilter?.faceState === 'face_up') {
                text += 'face-up ';
            }

            // NEW: Handle excludeSelf (Death-1: "delete 1 other card")
            const otherPrefix = params.excludeSelf ? 'other ' : '';
            const cardWord = params.count === 1 ? 'card' : 'cards';
            text += otherPrefix + cardWord;

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

            mainText = text + '.';
            break;
        }

        case 'discard': {
            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                if (params.actor === 'opponent') {
                    mainText = 'Opponent discards that card.';
                } else {
                    mainText = 'Discard that card.';
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

            if (params.actor === 'opponent') {
                if (params.count === 'all') {
                    mainText = `Opponent discards their hand.`;
                } else {
                    mainText = `Your opponent discards ${countText}.`;
                }
            } else {
                mainText = `${mayPrefix} ${countText}.`;
            }
            break;
        }

        case 'return': {
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

            const countText = params.count === 'all' ? 'all cards' : params.count === 1 ? '1 card' : `${params.count} cards`;
            const owner = params.targetFilter?.owner || 'any';

            let ownerText = '';
            if (owner === 'own') {
                ownerText = ' of your';
            } else if (owner === 'opponent') {
                ownerText = " of your opponent's";
            }

            // Handle optional return (Psychic-4: "You may return 1 of your opponent's cards")
            const optionalPrefix = params.optional ? 'You may r' : 'R';
            mainText = `${optionalPrefix}eturn ${countText}${ownerText}${laneText}.`;
            break;
        }

        case 'play': {
            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                const faceState = params.faceDown === true ? 'face-down' : params.faceDown === false ? 'face-up' : '';
                mainText = faceState ? `Play that card ${faceState}.` : 'Play that card.';
                break;
            }

            const actor = params.actor;
            const count = params.count || 1;
            // Only specify face state if explicitly set; undefined means player chooses
            const faceState = params.faceDown === true ? ' face-down' : params.faceDown === false ? ' face-up' : '';

            let actorText = '';
            let cardPart = '';

            if (actor === 'opponent') {
                actorText = 'Your opponent plays';
                if (params.source === 'deck') {
                    cardPart = count === 1 ? 'the top card of their deck' : `${count} cards from their deck`;
                } else {
                    cardPart = count === 1 ? 'a card from their hand' : `${count} cards from their hand`;
                }
            } else {
                actorText = 'Play';
                if (params.source === 'deck') {
                    cardPart = count === 1 ? 'the top card of your deck' : `${count} cards from your deck`;
                } else {
                    // Speed-0: Simple "Play 1 card" without "from your hand"
                    cardPart = count === 1 ? '1 card' : `${count} cards`;
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
                const ownerFilter = params.destinationRule.ownerFilter;
                if (ownerFilter === 'own') {
                    text += ' in each line where you have a card';
                } else if (ownerFilter === 'opponent') {
                    text += ' in each line where opponent has a card';
                } else {
                    text += ' to each line with a card';
                }
            } else if (params.destinationRule?.type === 'specific_lane') {
                text += ' in this line';
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

                mainText = `Either ${optionTexts[0]} or ${optionTexts[1]}.`;
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
                    mainText = 'Ignore all middle commands of cards in this line.';
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
                    mainText = 'You may play cards without matching protocols.';
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
                                      mod.target === 'opponent_total' ? "Opponent's total value" :
                                      'Total value';

                    let conditionText = '';
                    if (mod.condition === 'per_face_down_card') {
                        conditionText = 'for each face-down card';
                    } else if (mod.condition === 'per_face_up_card') {
                        conditionText = 'for each face-up card';
                    } else if (mod.condition === 'per_card') {
                        conditionText = 'for each card';
                    }

                    const sign = mod.value >= 0 ? '+' : '';
                    mainText = `${targetText} ${scopeText} is increased by ${sign}${mod.value} ${conditionText} ${scopeText}.`.replace(/\s+/g, ' ');
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
                    if (mod.target === 'opponent_total') {
                        if (mod.value < 0) {
                            mainText = `Your opponent's total value${scopeText} is reduced by ${Math.abs(mod.value)}.`;
                        } else {
                            mainText = `Your opponent's total value${scopeText} is increased by ${mod.value}.`;
                        }
                    } else {
                        if (mod.value < 0) {
                            mainText = `Your total value${scopeText} is reduced by ${Math.abs(mod.value)}.`;
                        } else {
                            mainText = `Your total value${scopeText} is increased by ${mod.value}.`;
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

        default:
            mainText = 'Effect';
            break;
    }

    // Handle conditional follow-up effects
    if (effect.conditional && effect.conditional.thenEffect) {
        const followUpText = getEffectSummary(effect.conditional.thenEffect);
        // Use "Then" for sequential actions, "If you do" for conditional execution
        if (effect.conditional.type === 'then') {
            // Death-1: "delete 1 other card, then delete this card."
            // Remove period from first part and add "then" before follow-up (lowercase)
            const firstPart = mainText.endsWith('.') ? mainText.slice(0, -1) : mainText;
            mainText = `${firstPart}, then ${followUpText.toLowerCase()}`;
        } else {
            // "If you do" format
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
export const generateEffectText = (effects: EffectDefinition[]): string => {
    if (effects.length === 0) return '';

    return effects.map(effect => {
        const summary = getEffectSummary(effect);
        const trigger = effect.trigger;

        if (trigger === 'start') return `<div><span class='emphasis'>Start:</span> ${summary}</div>`;
        if (trigger === 'end') return `<div><span class='emphasis'>End:</span> ${summary}</div>`;
        if (trigger === 'on_cover') return `<div><span class='emphasis'>When this card would be covered:</span> First, ${summary.toLowerCase()}</div>`;
        if (trigger === 'on_flip') return `<div><span class='emphasis'>When this card would be flipped:</span> First, ${summary.toLowerCase()}</div>`;
        if (trigger === 'on_cover_or_flip') return `<div><span class='emphasis'>When this card would be covered or flipped:</span> First, ${summary.toLowerCase()}</div>`;

        // NEW: Reactive triggers - text depends on reactiveTriggerActor
        if (trigger === 'after_draw' || trigger === 'after_delete' || trigger === 'after_shift' || trigger === 'after_flip' || trigger === 'after_clear_cache') {
            const triggerActor = effect.reactiveTriggerActor || 'self';
            const actorText = triggerActor === 'self' ? 'you' :
                             triggerActor === 'opponent' ? 'opponent' :
                             'a card is';

            let actionText = '';
            if (trigger === 'after_draw') {
                actionText = triggerActor === 'any' ? 'drawn' : 'draw cards';
            } else if (trigger === 'after_delete') {
                actionText = triggerActor === 'any' ? 'deleted' : 'delete cards';
            } else if (trigger === 'after_shift') {
                actionText = triggerActor === 'any' ? 'shifted' : 'shift cards';
            } else if (trigger === 'after_flip') {
                actionText = triggerActor === 'any' ? 'flipped' : 'flip cards';
            } else if (trigger === 'after_clear_cache') {
                actionText = 'clear cache';
            }

            const prefixText = triggerActor === 'any' ? `After ${actorText} ${actionText}` : `After ${actorText} ${actionText}`;
            return `<div><span class='emphasis'>${prefixText}:</span> ${summary}</div>`;
        }

        // Plague-1: "After your opponent discards cards: Draw 1 card."
        if (trigger === 'after_opponent_discard') {
            return `<div><span class='emphasis'>After your opponent discards cards:</span> ${summary}</div>`;
        }

        // NEW: Before compile delete trigger (Speed-2)
        if (trigger === 'before_compile_delete') {
            return `<div><span class='emphasis'>When this card would be deleted by compiling:</span> ${summary}</div>`;
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
    // Use manual text if provided, otherwise generate from effects
    const topText = (customCard.text?.top !== undefined)
        ? customCard.text.top
        : generateEffectText(customCard.topEffects);
    const middleText = (customCard.text?.middle !== undefined)
        ? customCard.text.middle
        : generateEffectText(customCard.middleEffects);
    const bottomText = (customCard.text?.bottom !== undefined)
        ? customCard.text.bottom
        : generateEffectText(customCard.bottomEffects);

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
        category: 'Custom',
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
