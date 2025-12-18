/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomProtocolDefinition, CustomProtocolStorage, CustomCardDefinition } from "../../types/customProtocol";
import { Card } from "../../types";
// REMOVED: generateEffect import - was never used, all effects go through effectInterpreter

const STORAGE_KEY = 'custom_protocols_v1';
const STORAGE_VERSION = 1;

/**
 * Storage Manager for Custom Protocols
 *
 * Handles localStorage persistence and retrieval of custom protocol definitions.
 */

/**
 * Load all custom protocols from localStorage
 */
export const loadCustomProtocols = (): CustomProtocolDefinition[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const data: CustomProtocolStorage = JSON.parse(stored);

        // Version check for future migrations
        if (data.version !== STORAGE_VERSION) {
            console.warn(`Custom protocol storage version mismatch: expected ${STORAGE_VERSION}, got ${data.version}`);
            // Future: handle migrations here
        }

        return data.protocols || [];
    } catch (error) {
        console.error('Error loading custom protocols:', error);
        return [];
    }
};

/**
 * Save all custom protocols to localStorage
 */
export const saveCustomProtocols = (protocols: CustomProtocolDefinition[]): void => {
    try {
        const data: CustomProtocolStorage = {
            protocols,
            version: STORAGE_VERSION,
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving custom protocols:', error);
    }
};

/**
 * Add a new custom protocol
 */
export const addCustomProtocol = (protocol: CustomProtocolDefinition): void => {
    const protocols = loadCustomProtocols();

    // Check for duplicate ID
    const existingIndex = protocols.findIndex(p => p.id === protocol.id);
    if (existingIndex >= 0) {
        // Update existing
        protocols[existingIndex] = protocol;
    } else {
        // Add new
        protocols.push(protocol);
    }

    saveCustomProtocols(protocols);
};

/**
 * Delete a custom protocol by ID
 */
export const deleteCustomProtocol = (id: string): void => {
    const protocols = loadCustomProtocols();
    const filtered = protocols.filter(p => p.id !== id);
    saveCustomProtocols(filtered);
};

/**
 * Get a custom protocol by ID
 */
export const getCustomProtocol = (id: string): CustomProtocolDefinition | null => {
    const protocols = loadCustomProtocols();
    return protocols.find(p => p.id === id) || null;
};

/**
 * Convert custom card definition to CardData format
 *
 * This generates the card text and effect functions dynamically.
 */
export const customCardToCardData = (
    customCard: CustomCardDefinition,
    protocolName: string
): Card => {
    // Generate card text from effects
    const topTexts: string[] = [];
    const middleTexts: string[] = [];
    const bottomTexts: string[] = [];

    // Process top effects
    for (const effect of customCard.topEffects) {
        const effectText = generateEffectText(effect.params);
        topTexts.push(effectText);
    }

    // Process middle effects
    for (const effect of customCard.middleEffects) {
        const effectText = generateEffectText(effect.params);
        middleTexts.push(effectText);
    }

    // Process bottom effects
    for (const effect of customCard.bottomEffects) {
        const effectText = generateEffectText(effect.params);
        // Categorize by trigger
        let prefix = '';
        switch (effect.trigger) {
            case 'start':
                prefix = "<span class='emphasis'>Start:</span> ";
                break;
            case 'end':
                prefix = "<span class='emphasis'>End:</span> ";
                break;
            case 'on_cover':
                prefix = "<span class='emphasis'>On Cover:</span> ";
                break;
        }
        bottomTexts.push(prefix + effectText);
    }

    // Build top, middle, bottom strings
    const top = topTexts.length > 0 ? topTexts.join(' ') : '';
    const middle = middleTexts.length > 0 ? middleTexts.join(' ') : '';
    const bottom = bottomTexts.length > 0 ? bottomTexts.join(' ') : '';

    return {
        protocol: protocolName,  // Will be the custom protocol name
        value: customCard.value,
        top,
        middle,
        bottom,
        keywords: {},
        category: 'Custom',
    };
};

/**
 * Generate human-readable text from effect parameters
 */
const generateEffectText = (params: any): string => {
    switch (params.action) {
        case 'draw':
            if (params.conditional) {
                switch (params.conditional.type) {
                    case 'count_face_down':
                        return 'Draw 1 card for each face-down card.';
                    case 'is_covering':
                        return `Draw ${params.count} card${params.count !== 1 ? 's' : ''} if this card is covering another.`;
                    case 'non_matching_protocols':
                        return 'Draw 1 card for each line with a non-matching protocol.';
                }
            }
            if (params.preAction === 'refresh') {
                return `Refresh your hand. Draw ${params.count} card${params.count !== 1 ? 's' : ''}.`;
            }
            if (params.source === 'opponent_deck') {
                return `Draw ${params.count} card${params.count !== 1 ? 's' : ''} from opponent's deck.`;
            }
            if (params.target === 'opponent') {
                return `Opponent draws ${params.count} card${params.count !== 1 ? 's' : ''}.`;
            }
            return `Draw ${params.count} card${params.count !== 1 ? 's' : ''}.`;

        case 'flip':
            const may = params.optional ? 'May flip' : 'Flip';
            const countStr = params.count === 1 ? '1' : params.count.toString();
            let targetDesc = '';

            if (params.targetFilter.owner === 'opponent') targetDesc = "opponent's ";
            if (params.targetFilter.position === 'covered') targetDesc += 'covered ';
            if (params.targetFilter.position === 'uncovered') targetDesc += 'uncovered ';
            if (params.targetFilter.faceState === 'face_down') targetDesc += 'face-down ';
            if (params.targetFilter.faceState === 'face_up') targetDesc += 'face-up ';
            if (params.targetFilter.excludeSelf) targetDesc += 'other ';

            const cardWord = params.count === 1 ? 'card' : 'cards';
            let text = `${may} ${countStr} ${targetDesc}${cardWord}.`;

            if (params.selfFlipAfter) {
                text += ' Then flip this card.';
            }

            return text;

        case 'shift':
            const mayShift = params.optional ? 'You may shift' : 'Shift';
            let shiftTarget = '';
            if (params.targetFilter.owner === 'opponent') shiftTarget = "opponent's ";
            if (params.targetFilter.position === 'covered') shiftTarget += 'covered ';
            if (params.targetFilter.faceState === 'face_down') shiftTarget += 'face-down ';

            let destination = '';
            if (params.destinationRestriction?.type === 'non_matching_protocol') {
                destination = ' to a line without matching protocol';
            } else if (params.destinationRestriction?.type === 'specific_lane') {
                destination = ' to this line';
            }

            return `${mayShift} 1 ${shiftTarget}card${destination}.`;

        case 'delete':
            const mayDelete = params.optional ? 'May delete' : 'Delete';
            const deleteCount = typeof params.count === 'number' ? params.count.toString() : 'all';
            let deleteTarget = '';

            if (params.targetFilter.position === 'covered') deleteTarget = 'covered ';
            if (params.targetFilter.faceState === 'face_down') deleteTarget = 'face-down ';
            if (params.targetFilter.calculation === 'highest_value') deleteTarget = 'highest value ';
            if (params.targetFilter.calculation === 'lowest_value') deleteTarget = 'lowest value ';

            let deleteScope = '';
            if (params.scope?.type === 'other_lanes') deleteScope = ' from each other line';
            if (params.scope?.type === 'this_line') deleteScope = ' in this line';

            const deleteCardWord = deleteCount === '1' ? 'card' : 'cards';

            return `${mayDelete} ${deleteCount} ${deleteTarget}${deleteCardWord}${deleteScope}.`;

        case 'discard':
            let discardActor = '';
            if (params.actor === 'opponent') {
                discardActor = params.optional ? 'Opponent may discard' : 'Opponent discards';
            } else {
                discardActor = params.optional ? 'May discard' : 'Discard';
            }
            return `${discardActor} ${params.count} card${params.count !== 1 ? 's' : ''}.`;

        case 'return':
            const mayReturn = params.optional ? 'May return' : 'Return';
            const returnCount = typeof params.count === 'number' ? params.count.toString() : 'all';
            let returnFilter = '';
            if (params.targetFilter.valueEquals !== undefined) {
                returnFilter = ` with value ${params.targetFilter.valueEquals}`;
            }
            return `${mayReturn} ${returnCount} card${params.count !== 1 ? 's' : ''}${returnFilter} to hand.`;

        case 'play':
            const mayPlay = params.optional ? 'May play' : 'Play';
            const playSource = params.source === 'deck' ? ' from top of deck' : '';
            const faceState = params.faceDown ? 'face-down' : 'face-up';
            return `${mayPlay} ${params.count} card${params.count !== 1 ? 's' : ''}${playSource} ${faceState}.`;

        case 'rearrange_protocols':
            const rearrangeTarget = params.target === 'opponent' ? "opponent's" : 'your';
            let restriction = '';
            if (params.restriction) {
                restriction = ` (${params.restriction.disallowedProtocol} cannot be on this line)`;
            }
            return `Rearrange ${rearrangeTarget} protocols${restriction}.`;

        case 'swap_protocols':
            const swapTarget = params.target === 'opponent' ? "opponent's" : 'your';
            return `Swap 2 of ${swapTarget} protocols.`;

        case 'reveal':
            const mayReveal = params.optional ? 'May reveal' : 'Reveal';
            return `${mayReveal} ${params.count} card${params.count !== 1 ? 's' : ''} from your hand.`;

        case 'give':
            const mayGive = params.optional ? 'May give' : 'Give';
            return `${mayGive} ${params.count} card${params.count !== 1 ? 's' : ''} to opponent.`;

        case 'take':
            const mayTake = params.optional ? 'May take' : 'Take';
            const randomness = params.random ? ' at random' : '';
            return `${mayTake} ${params.count} card${params.count !== 1 ? 's' : ''} from opponent${randomness}.`;

        case 'value_modifier':
            const modifier = params.modifier;
            if (modifier.type === 'set_to_fixed') {
                // Build description based on target/scope/filter
                let targetDesc = '';
                if (modifier.target === 'own_cards') {
                    targetDesc = 'your';
                } else if (modifier.target === 'opponent_cards') {
                    targetDesc = "opponent's";
                } else {
                    targetDesc = 'all';
                }

                let faceDesc = '';
                if (modifier.filter?.faceState === 'face_down') {
                    faceDesc = ' face-down';
                } else if (modifier.filter?.faceState === 'face_up') {
                    faceDesc = ' face-up';
                }

                let scopeDesc = '';
                if (modifier.scope === 'this_lane') {
                    scopeDesc = ' in this stack';
                } else if (modifier.scope === 'global') {
                    scopeDesc = '';
                }

                return `All ${targetDesc}${faceDesc} cards${scopeDesc} have a value of ${modifier.value}.`;

            } else if (modifier.type === 'add_per_condition') {
                let conditionDesc = '';
                if (modifier.condition === 'per_face_down_card') {
                    conditionDesc = 'for each face-down card';
                } else if (modifier.condition === 'per_face_up_card') {
                    conditionDesc = 'for each face-up card';
                } else if (modifier.condition === 'per_card') {
                    conditionDesc = 'for each card';
                }

                let scopeDesc = modifier.scope === 'this_lane' ? "this line's " : '';
                return `+${modifier.value} to ${scopeDesc}total ${conditionDesc}.`;

            } else if (modifier.type === 'add_to_total') {
                const sign = modifier.value >= 0 ? '+' : '';
                let targetDesc = modifier.target === 'opponent_total' ? "Opponent's" : "Your";
                return `${targetDesc} total ${sign}${modifier.value}.`;
            }
            return 'Modify card values.';

        case 'passive_rule':
            // Simplified text for passive rules
            const rule = params.rule;
            if (rule.type === 'ignore_middle_commands') {
                return 'Middle effects in this line are ignored.';
            }
            return 'Special rule active.';

        default:
            return 'Unknown effect.';
    }
};

/**
 * Convert custom protocol to full card set
 */
export const customProtocolToCards = (protocol: CustomProtocolDefinition): Card[] => {
    return protocol.cards.map(customCard => customCardToCardData(customCard, protocol.name));
};
