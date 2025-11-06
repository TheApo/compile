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
        case 'draw': {
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
            if (params.preAction === 'refresh') {
                text = 'Refresh your hand. ';
            }

            if (params.source === 'opponent_deck') {
                text += `Draw ${params.count} card${params.count !== 1 ? 's' : ''} from opponent's deck.`;
            } else if (params.target === 'opponent') {
                text += `Opponent draws ${params.count} card${params.count !== 1 ? 's' : ''}.`;
            } else {
                text += `Draw ${params.count} card${params.count !== 1 ? 's' : ''}.`;
            }

            mainText = text;
            break;
        }

        case 'flip': {
            const may = params.optional ? 'May flip' : 'Flip';
            let targetDesc = '';

            if (params.targetFilter?.owner === 'opponent') targetDesc = "opponent's ";
            if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.position === 'uncovered') targetDesc += 'uncovered ';
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
            let text = `${may} ${countText} ${targetDesc}${cardWord}.`;

            if (params.selfFlipAfter) {
                text += ' Then flip this card.';
            }

            mainText = text;
            break;
        }

        case 'shift': {
            let targetDesc = '';

            if (params.targetFilter?.owner === 'opponent') targetDesc += "opponent's ";
            if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter?.position === 'uncovered') targetDesc += 'uncovered ';
            if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';

            const count = params.count === 'all' ? 'all' : '1';
            const cardWord = count === '1' ? 'card' : 'cards';
            let text = `Shift ${count} ${targetDesc}${cardWord}`;

            if (params.destinationRestriction?.type === 'non_matching_protocol') {
                text += ' to a non-matching protocol';
            } else if (params.destinationRestriction?.type === 'specific_lane') {
                text += ' within this line';
            } else if (params.destinationRestriction?.type === 'to_another_line') {
                text += ' to another line';
            }

            mainText = text + '.';
            break;
        }

        case 'delete': {
            let text = 'Delete ';

            if (params.count === 'all_in_lane') {
                text += 'all ';
            } else {
                text += `${params.count} `;
            }

            if (params.targetFilter?.calculation === 'highest_value') {
                text += 'highest value ';
            } else if (params.targetFilter?.calculation === 'lowest_value') {
                text += 'lowest value ';
            }

            if (params.targetFilter?.valueRange) {
                text += `value ${params.targetFilter.valueRange.min}-${params.targetFilter.valueRange.max} `;
            }

            if (params.targetFilter?.position === 'covered') {
                text += 'covered ';
            } else if (params.targetFilter?.position === 'uncovered') {
                text += 'uncovered ';
            }

            if (params.targetFilter?.faceState === 'face_down') {
                text += 'face-down ';
            } else if (params.targetFilter?.faceState === 'face_up') {
                text += 'face-up ';
            }

            const cardWord = params.count === 1 ? 'card' : 'cards';
            text += cardWord;

            if (params.scope?.type === 'this_line') {
                text += ' in this line';
            } else if (params.scope?.type === 'other_lanes') {
                text += ' in other lanes';
            } else if (params.scope?.type === 'each_other_line') {
                text += ' from each other line';
            }

            if (params.excludeSelf) {
                text += ' (excluding self)';
            }

            mainText = text + '.';
            break;
        }

        case 'discard': {
            const isVariable = params.variableCount;
            let countText = '';

            if (isVariable) {
                countText = '1 or more cards';
            } else {
                const cardWord = params.count === 1 ? 'card' : 'cards';
                countText = `${params.count} ${cardWord}`;
            }

            if (params.actor === 'opponent') {
                mainText = `Opponent discards ${countText}.`;
            } else {
                mainText = `Discard ${countText}.`;
            }
            break;
        }

        case 'return': {
            if (params.targetFilter?.valueEquals !== undefined) {
                mainText = `Return all value ${params.targetFilter.valueEquals} cards to hand.`;
                break;
            }

            const countText = params.count === 'all' ? 'all cards' : params.count === 1 ? '1 card' : `${params.count} cards`;

            mainText = `Return ${countText} to hand.`;
            break;
        }

        case 'play': {
            const actor = params.actor;
            const cardWord = params.count === 1 ? 'card' : 'cards';
            const faceState = params.faceDown ? 'face-down' : 'face-up';

            let actorText = '';
            let source = '';
            if (actor === 'opponent') {
                actorText = 'Opponent plays';
                source = params.source === 'deck' ? 'from their deck' : 'from their hand';
            } else {
                actorText = 'Play';
                source = params.source === 'deck' ? 'from your deck' : 'from your hand';
            }

            let text = `${actorText} ${params.count} ${cardWord} ${faceState} ${source}`;

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
                    ? "opponent's"
                    : params.target === 'both_sequential'
                    ? "both players'"
                    : 'your';

            if (params.action === 'rearrange_protocols') {
                mainText = `Rearrange ${targetText} protocols.`;
            } else {
                mainText = `Swap 2 ${targetText} protocols.`;
            }
            break;
        }

        case 'reveal':
        case 'give': {
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

        default:
            mainText = 'Effect';
            break;
    }

    // Handle conditional follow-up effects
    if (effect.conditional && effect.conditional.thenEffect) {
        const followUpText = getEffectSummary(effect.conditional.thenEffect);
        mainText = `${mainText} If you do, ${followUpText.toLowerCase()}`;
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

        return summary;
    }).join(' ');
};

/**
 * Convert a CustomCardDefinition to a Card object
 */
export const convertCustomCardToCard = (
    customCard: CustomCardDefinition,
    protocolName: string
): Card => {
    const topText = generateEffectText(customCard.topEffects);
    const middleText = generateEffectText(customCard.middleEffects);
    const bottomText = generateEffectText(customCard.bottomEffects);

    // Collect keywords from all effects
    const allEffects = [...customCard.topEffects, ...customCard.middleEffects, ...customCard.bottomEffects];
    const keywords = extractKeywords(allEffects);

    return {
        protocol: protocolName,
        value: customCard.value,
        top: topText,
        middle: middleText,
        bottom: bottomText,
        keywords,
        category: 'Custom',
        // Store the effect definitions for runtime execution
        customEffects: {
            topEffects: customCard.topEffects,
            middleEffects: customCard.middleEffects,
            bottomEffects: customCard.bottomEffects,
        }
    } as any; // Type assertion needed since we're extending Card interface
};

/**
 * Convert a CustomProtocolDefinition to an array of Card objects
 */
export const convertCustomProtocolToCards = (protocol: CustomProtocolDefinition): Card[] => {
    return protocol.cards.map(card => convertCustomCardToCard(card, protocol.name));
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
