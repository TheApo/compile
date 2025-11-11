/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card } from '../../data/cards';
import { CustomProtocolDefinition, CustomCardDefinition, EffectDefinition } from '../../types/customProtocol';

/**
 * Generates human-readable text for an effect
 */
const getEffectSummary = (effect: EffectDefinition): string => {
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
                text += `${optionalPrefix}Draw ${params.count} card${params.count !== 1 ? 's' : ''} from opponent's deck.`;
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

            // NEW: Spirit-3 special case - "shift this card"
            // Only when no owner filter OR no position filter (except position=any)
            const hasSpecificTargetFilter = params.targetFilter?.owner || (params.targetFilter?.position && params.targetFilter.position !== 'any');
            const isShiftSelf = !hasSpecificTargetFilter && !params.targetFilter?.excludeSelf && count === 1;

            if (isShiftSelf) {
                let text = `${mayShift} this card`;

                // NEW: Add "even if covered" for position="any"
                if (params.targetFilter?.position === 'any') {
                    text += ', even if this card is covered';
                }

                mainText = text + '.';
                break;
            }

            let targetDesc = '';

            if (params.targetFilter?.owner === 'opponent') targetDesc += "opponent's ";
            // NEW: Add "other" before position/faceState descriptors (Anarchy-1)
            if (params.targetFilter?.excludeSelf) targetDesc += 'other ';
            // Only add "covered" explicitly - "uncovered" is the default and should NOT appear in text
            if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';

            const countText = params.count === 'all' ? 'all' : '1';
            const cardWord = countText === '1' ? 'card' : 'cards';
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

            if (params.count === 'all_in_lane') {
                text += 'all ';
            } else {
                text += isCoveredOrUncovered ? 'a ' : `${params.count} `;
            }

            if (params.targetFilter?.calculation === 'highest_value') {
                text += 'highest value ';
            } else if (params.targetFilter?.calculation === 'lowest_value') {
                text += 'lowest value ';
            }

            if (params.targetFilter?.valueRange) {
                const { min, max } = params.targetFilter.valueRange;
                // Generate "value 0 or 1" instead of "value 0-1"
                const values = [];
                for (let i = min; i <= max; i++) {
                    values.push(i);
                }
                const valueText = values.join(' or ');
                text += `value ${valueText} `;
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
            const mayPrefix = params.optional ? 'You may discard' : params.count === 'all' ? 'Discard' : 'You discard';

            if (params.actor === 'opponent') {
                if (params.count === 'all') {
                    mainText = `Opponent discards their hand.`;
                } else {
                    mainText = `Opponent discards ${countText}.`;
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
                ownerText = " of opponent's";
            }

            mainText = `Return ${countText}${ownerText}${laneText}.`;
            break;
        }

        case 'play': {
            // If referencing card from previous effect, use "that card"
            if (effect.useCardFromPreviousEffect) {
                const faceState = params.faceDown ? 'face-down' : 'face-up';
                mainText = `Play that card ${faceState}.`;
                break;
            }

            const actor = params.actor;
            const cardWord = params.count === 1 ? 'card' : 'cards';
            const faceState = params.faceDown ? 'face-down' : 'face-up';

            let actorText = '';
            let source = '';
            if (actor === 'opponent') {
                actorText = 'Your opponent plays';
                source = params.source === 'deck' ? 'the top card of their deck' : 'from their hand';
            } else {
                actorText = 'Play';
                source = params.source === 'deck' ? 'the top card of your deck' : 'from your hand';
            }

            // NEW: Handle conditional play prefix (Gravity-0)
            let conditionalPrefix = '';
            if (params.condition?.type === 'per_x_cards_in_line') {
                const cardCount = params.condition.cardCount || 2;
                conditionalPrefix = `For every ${cardCount} cards in this line, `;
                // Lowercase the actor text when used in conditional
                actorText = actorText.toLowerCase();
            }

            let text = `${conditionalPrefix}${actorText} ${source} ${faceState}`;

            if (params.destinationRule?.type === 'other_lines') {
                text += ' to other lines';
            } else if (params.destinationRule?.type === 'each_other_line') {
                text += ' in each other line';
            } else if (params.destinationRule?.type === 'under_this_card') {
                text += ' under this card';
            } else if (params.destinationRule?.type === 'each_line_with_card') {
                text += ' to each line with a card';
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

            const cardWord = params.count === 1 ? 'card' : 'cards';
            const actionText = params.action === 'give' ? 'Give' : 'Reveal';
            const sourceText = params.source === 'opponent_hand' ? "opponent's hand" : 'your hand';

            let text = `${actionText} ${params.count} ${cardWord} from ${sourceText}`;

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
            const randomText = params.random ? 'random ' : '';

            mainText = `Take ${params.count} ${randomText}${cardWord} from opponent's hand.`;
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
                    mainText = 'Cards cannot be played in this line.';
                    break;
                case 'ignore_middle_commands':
                    mainText = 'Ignore all middle commands of cards in this line.';
                    break;
                case 'block_face_down_play':
                    mainText = "Opponent can't play cards face-down in this line.";
                    break;
                case 'require_face_down_play':
                    mainText = 'Opponent can only play cards face-down in this line.';
                    break;
                case 'allow_any_protocol_play':
                    mainText = 'You may play cards without matching protocols.';
                    break;
                case 'block_flips':
                    mainText = "Cards can't be flipped face-up in this line.";
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
                    const targetText = mod.target === 'opponent_total' ? 'Opponent total' : 'Your total';
                    const sign = mod.value >= 0 ? '+' : '';
                    mainText = `${targetText} ${sign}${mod.value}.`;
                    break;
                }
                default:
                    mainText = 'Value modifier effect.';
            }
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
            // Chaos-4: "Discard your hand. Draw the same amount of cards."
            // Remove period from first part and capitalize follow-up
            const firstPart = mainText.endsWith('.') ? mainText.slice(0, -1) : mainText;
            const secondPart = followUpText.charAt(0).toUpperCase() + followUpText.slice(1);
            mainText = `${firstPart}. ${secondPart}`;
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
 */
const generateEffectText = (effects: EffectDefinition[]): string => {
    if (effects.length === 0) return '';

    return effects.map(effect => {
        const summary = getEffectSummary(effect);
        const trigger = effect.trigger;

        if (trigger === 'start') return `<div><span class='emphasis'>Start:</span> ${summary}</div>`;
        if (trigger === 'end') return `<div><span class='emphasis'>End:</span> ${summary}</div>`;
        if (trigger === 'on_cover') return `<div><span class='emphasis'>When this card would be covered:</span> First, ${summary.toLowerCase()}</div>`;

        // NEW: Reactive triggers (Spirit-3, etc.)
        if (trigger === 'after_draw') return `<div><span class='emphasis'>After you draw cards:</span> ${summary}</div>`;
        if (trigger === 'after_delete') return `<div><span class='emphasis'>After a card is deleted:</span> ${summary}</div>`;
        if (trigger === 'after_shift') return `<div><span class='emphasis'>After a card is shifted:</span> ${summary}</div>`;
        if (trigger === 'after_flip') return `<div><span class='emphasis'>After a card is flipped:</span> ${summary}</div>`;

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
            console.log('[Custom Protocols] No custom protocols in localStorage');
            return [];
        }

        const data = JSON.parse(stored);
        const protocols: CustomProtocolDefinition[] = data.protocols || [];
        console.log('[Custom Protocols] Loaded protocols from localStorage:', protocols.map(p => p.name));

        const allCards: Card[] = [];

        for (const protocol of protocols) {
            const cards = convertCustomProtocolToCards(protocol);
            console.log(`[Custom Protocols] Converted ${protocol.name} to ${cards.length} cards`);
            allCards.push(...cards);
        }

        console.log('[Custom Protocols] Total custom cards:', allCards.length);
        return allCards;
    } catch (error) {
        console.error('Failed to load custom protocol cards:', error);
        return [];
    }
};
