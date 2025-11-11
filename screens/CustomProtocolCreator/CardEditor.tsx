/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CustomCardDefinition, EffectDefinition, EffectActionType, CardPattern } from '../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { EffectEditor } from './EffectEditor';
import { CardComponent } from '../../components/Card';
import { getPatternStyle } from '../../logic/customProtocols/patternStyles';

interface CardEditorProps {
    card: CustomCardDefinition;
    protocolName: string;
    protocolColor: string;
    protocolPattern: CardPattern;
    onChange: (card: CustomCardDefinition) => void;
}

type BoxType = 'top' | 'middle' | 'bottom';

export const CardEditor: React.FC<CardEditorProps> = ({ card, protocolName, protocolColor, protocolPattern, onChange }) => {
    const [editingEffect, setEditingEffect] = useState<{
        box: BoxType;
        effectIndex: number;
        effect: EffectDefinition;
    } | null>(null);

    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        box: BoxType;
        effectIndex: number;
    } | null>(null);

    const [showValidationModal, setShowValidationModal] = useState(false);

    // Close effect editor when card changes
    useEffect(() => {
        setEditingEffect(null);
    }, [card.value]);

    const handleAddEffect = (box: BoxType, action: EffectActionType, trigger: 'passive' | 'on_play' | 'start' | 'end' | 'on_cover') => {
        const newEffect: EffectDefinition = {
            id: uuidv4(),
            params: createDefaultParams(action),
            position: box,
            trigger,
        };

        const updatedCard = { ...card };
        if (box === 'top') {
            updatedCard.topEffects = [...updatedCard.topEffects, newEffect];
        } else if (box === 'middle') {
            updatedCard.middleEffects = [...updatedCard.middleEffects, newEffect];
        } else {
            updatedCard.bottomEffects = [...updatedCard.bottomEffects, newEffect];
        }

        onChange(updatedCard);

        // Open editor for new effect
        const effectIndex = box === 'top' ? updatedCard.topEffects.length - 1 :
                           box === 'middle' ? updatedCard.middleEffects.length - 1 :
                           updatedCard.bottomEffects.length - 1;
        setEditingEffect({ box, effectIndex, effect: newEffect });
    };

    const handleRemoveEffect = (box: BoxType, effectIndex: number) => {
        setDeleteConfirmation({ box, effectIndex });
    };

    const confirmDelete = () => {
        if (!deleteConfirmation) return;

        const { box, effectIndex } = deleteConfirmation;
        const updatedCard = { ...card };
        if (box === 'top') {
            updatedCard.topEffects.splice(effectIndex, 1);
        } else if (box === 'middle') {
            updatedCard.middleEffects.splice(effectIndex, 1);
        } else {
            updatedCard.bottomEffects.splice(effectIndex, 1);
        }

        onChange(updatedCard);
        if (editingEffect && editingEffect.box === box && editingEffect.effectIndex === effectIndex) {
            setEditingEffect(null);
        }
        setDeleteConfirmation(null);
    };

    const handleUpdateEffect = (updatedEffect: EffectDefinition) => {
        if (!editingEffect) return;

        const { box, effectIndex } = editingEffect;
        const updatedCard = { ...card };

        if (box === 'top') {
            updatedCard.topEffects = [...updatedCard.topEffects];
            updatedCard.topEffects[effectIndex] = updatedEffect;
        } else if (box === 'middle') {
            updatedCard.middleEffects = [...updatedCard.middleEffects];
            updatedCard.middleEffects[effectIndex] = updatedEffect;
        } else {
            updatedCard.bottomEffects = [...updatedCard.bottomEffects];
            updatedCard.bottomEffects[effectIndex] = updatedEffect;
        }

        onChange(updatedCard);
        setEditingEffect({ box, effectIndex, effect: updatedEffect });
    };

    const handleEditEffect = (box: BoxType, effectIndex: number) => {
        const effect = box === 'top' ? card.topEffects[effectIndex] :
                      box === 'middle' ? card.middleEffects[effectIndex] :
                      card.bottomEffects[effectIndex];

        setEditingEffect({ box, effectIndex, effect });
    };

    const getTriggerLabel = (trigger: string): string => {
        switch (trigger) {
            case 'passive': return '';
            case 'on_play': return '';
            case 'start': return 'Start';
            case 'end': return 'End';
            case 'on_cover': return 'On Cover';
            case 'after_delete': return 'After you delete cards';
            case 'after_opponent_discard': return 'After opponent discards';
            case 'after_draw': return 'After you draw cards';
            case 'after_clear_cache': return 'After you clear cache';
            case 'before_compile_delete': return 'Before deleted by compile';
            case 'after_flip': return 'After cards are flipped';
            case 'after_shift': return 'After cards are shifted';
            case 'after_play': return 'After cards are played';
            case 'on_flip': return 'When this card would be flipped';
            case 'on_cover_or_flip': return 'When covered or flipped';
            default: return trigger;
        }
    };

    const getEffectSummary = (effect: EffectDefinition): string => {
        const params = effect.params as any;
        let mainText = '';

        switch (params.action) {
            case 'draw': {
                // Handle dynamic count types (Fire-4)
                if (params.countType === 'equal_to_discarded') {
                    const offset = params.countOffset || 0;
                    if (offset === 0) {
                        mainText = 'draw the amount discarded';
                    } else if (offset > 0) {
                        mainText = `draw the amount discarded plus ${offset}`;
                    } else {
                        mainText = `draw the amount discarded minus ${Math.abs(offset)}`;
                    }
                    break;
                }

                // Match DrawEffectEditor's generateDrawText
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

                const mayPrefix = params.optional ? 'You may ' : '';
                if (params.source === 'opponent_deck') {
                    text += `${mayPrefix}draw ${params.count} card${params.count !== 1 ? 's' : ''} from opponent's deck`;
                } else if (params.target === 'opponent') {
                    text += `Opponent ${params.optional ? 'may draw' : 'draws'} ${params.count} card${params.count !== 1 ? 's' : ''}`;
                } else {
                    text += `${mayPrefix}draw ${params.count} card${params.count !== 1 ? 's' : ''}`;
                }

                mainText = text;
                break;
            }

            case 'flip': {
                // NEW: Flip self mode (Anarchy-6)
                if (params.flipSelf) {
                    let text = params.optional ? 'May flip this card' : 'Flip this card';

                    // Add conditional
                    if (params.advancedConditional?.type === 'protocol_match') {
                        text += `, if this card is in the line with the ${params.advancedConditional.protocol || '[Protocol]'} protocol`;
                    }

                    text += '.';
                    mainText = text;
                    break;
                }

                // Match FlipEffectEditor's generateFlipText
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
                // Match ShiftEffectEditor's generateShiftText
                let targetDesc = '';

                if (params.targetFilter?.owner === 'opponent') targetDesc += "opponent's ";
                if (params.targetFilter?.excludeSelf) targetDesc += 'other ';
                if (params.targetFilter?.position === 'covered') targetDesc += 'covered ';
                if (params.targetFilter?.position === 'uncovered') targetDesc += 'uncovered ';
                if (params.targetFilter?.faceState === 'face_down') targetDesc += 'face-down ';
                if (params.targetFilter?.faceState === 'face_up') targetDesc += 'face-up ';

                const count = params.count === 'all' ? 'all' : '1';
                const cardWord = count === '1' ? 'card' : 'cards';
                let text = `Shift ${count} ${targetDesc}${cardWord}`;

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

            case 'delete': {
                // Special case: deleteSelf
                if (params.deleteSelf) {
                    mainText = 'delete this card';
                    break;
                }

                // Match DeleteEffectEditor's generateDeleteText
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

                // Add "other" if excludeSelf is true
                if (params.excludeSelf) {
                    text += 'other ';
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

                mainText = text;
                break;
            }

            case 'discard': {
                // Match DiscardEffectEditor's generateDiscardText
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
                // Match ReturnEffectEditor's generateReturnText
                if (params.targetFilter?.valueEquals !== undefined) {
                    mainText = `Return all value ${params.targetFilter.valueEquals} cards to hand.`;
                    break;
                }

                const countText = params.count === 'all' ? 'all cards' : params.count === 1 ? '1 card' : `${params.count} cards`;

                mainText = `Return ${countText} to hand.`;
                break;
            }

            case 'play': {
                // Match PlayEffectEditor's generatePlayText
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
                // Match ProtocolEffectEditor's generateProtocolText
                const targetText =
                    params.target === 'opponent'
                        ? "opponent's"
                        : params.target === 'both_sequential'
                        ? "both players'"
                        : 'your';

                let text = '';
                if (params.action === 'rearrange_protocols') {
                    text = `Rearrange ${targetText} protocols.`;
                } else {
                    text = `Swap 2 ${targetText} protocols.`;
                }

                // Add restriction text (Anarchy-3)
                if (params.restriction && params.restriction.disallowedProtocol) {
                    const laneText = params.restriction.laneIndex === 'current'
                        ? 'this line'
                        : `lane ${typeof params.restriction.laneIndex === 'number' ? params.restriction.laneIndex + 1 : params.restriction.laneIndex}`;

                    text += ` ${params.restriction.disallowedProtocol} cannot be on ${laneText}.`;
                }

                mainText = text;
                break;
            }

            case 'reveal':
            case 'give': {
                // Match RevealEffectEditor's generateRevealText
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
                // Match TakeEffectEditor's generateTakeText
                const cardWord = params.count === 1 ? 'card' : 'cards';
                const randomText = params.random ? 'random ' : '';

                mainText = `Take ${params.count} ${randomText}${cardWord} from opponent's hand.`;
                break;
            }

            case 'choice': {
                const options = params.options || [];
                if (options.length !== 2) {
                    mainText = 'Either/Or (incomplete)';
                } else {
                    const option1Text = getEffectSummary(options[0]);
                    const option2Text = getEffectSummary(options[1]);
                    mainText = `Either ${option1Text.toLowerCase()} or ${option2Text.toLowerCase()}`;
                }
                break;
            }

            case 'passive_rule': {
                const ruleType = params.rule?.type || 'block_all_play';
                const target = params.rule?.target || 'opponent';
                const scope = params.rule?.scope || 'this_lane';

                const targetText = target === 'self' ? 'You' : target === 'opponent' ? 'Your opponent' : 'All players';
                const scopeText = scope === 'this_lane' ? ' in this lane' : '';

                switch (ruleType) {
                    case 'block_face_down_play':
                        mainText = `${targetText} cannot play cards face-down${scopeText}`;
                        break;
                    case 'block_face_up_play':
                        mainText = `${targetText} cannot play cards face-up${scopeText}`;
                        break;
                    case 'block_all_play':
                        mainText = `${targetText} cannot play cards${scopeText}`;
                        break;
                    case 'require_face_down_play':
                        mainText = `${targetText} can only play cards face-down${scopeText}`;
                        break;
                    case 'allow_any_protocol_play':
                        mainText = `${targetText} may play cards without matching protocols${scopeText}`;
                        break;
                    case 'require_non_matching_protocol':
                        mainText = `${targetText} can only play cards without matching protocols${scopeText}`;
                        break;
                    case 'block_flips':
                        mainText = `Cards cannot be flipped face-up${scopeText}`;
                        break;
                    case 'block_protocol_rearrange':
                        mainText = 'Protocols cannot be rearranged';
                        break;
                    case 'block_shifts_from_lane':
                        mainText = 'Cards cannot shift from this lane';
                        break;
                    case 'block_shifts_to_lane':
                        mainText = 'Cards cannot shift to this lane';
                        break;
                    case 'ignore_middle_commands':
                        mainText = `Ignore all middle commands of cards${scopeText}`;
                        break;
                    case 'skip_check_cache_phase':
                        mainText = 'Skip your check cache phase';
                        break;
                    default:
                        mainText = 'Passive rule active';
                        break;
                }
                break;
            }

            case 'value_modifier': {
                const mod = params.modifier;
                const modifierType = mod?.type || 'add_per_condition';

                switch (modifierType) {
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
                    case 'set_to_fixed':
                        mainText = `Set cards to value ${mod?.value || 0}`;
                        break;
                    case 'add_to_total':
                        mainText = (mod?.value || 0) >= 0 ? `+${mod?.value || 0} to total` : `${mod?.value || 0} to total`;
                        break;
                    default:
                        mainText = 'Value modifier active';
                        break;
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

            // Distinguish between "then" (sequential) and "if_executed" (conditional)
            if (effect.conditional.type === 'then') {
                mainText = `${mainText} Then ${followUpText.toLowerCase()}`;
            } else if (effect.conditional.type === 'if_executed') {
                mainText = `${mainText} If you do, ${followUpText.toLowerCase()}`;
            } else {
                // Default fallback
                mainText = `${mainText} ${followUpText}`;
            }
        }

        return mainText;
    };

    const handleValueChange = (newValue: number) => {
        const updatedCard = { ...card, value: newValue as any };
        onChange(updatedCard);
    };

    // Generate text for card boxes - recalculates on every render when card changes
    const generateEffectText = (effects: EffectDefinition[]): string => {
        if (effects.length === 0) return '';

        return effects.map(effect => {
            const summary = getEffectSummary(effect);
            const trigger = effect.trigger;

            if (trigger === 'start') return `<div><span class='emphasis'>Start:</span> ${summary}</div>`;
            if (trigger === 'end') return `<div><span class='emphasis'>End:</span> ${summary}</div>`;
            if (trigger === 'on_cover') return `<div><span class='emphasis'>When this card would be covered:</span> First, ${summary.toLowerCase()}</div>`;

            return summary;
        }).join('. ');
    };

    // Generate text directly - will update when card changes
    const topText = generateEffectText(card.topEffects);
    const middleText = generateEffectText(card.middleEffects);
    const bottomText = generateEffectText(card.bottomEffects);

    // Create a stable key based on effect content for re-rendering when effects actually change
    const effectsHash = JSON.stringify({
        top: card.topEffects.map(e => ({ id: e.id, params: e.params })),
        middle: card.middleEffects.map(e => ({ id: e.id, params: e.params })),
        bottom: card.bottomEffects.map(e => ({ id: e.id, params: e.params })),
    });
    const previewCardKey = `${protocolName}-${card.value}-${effectsHash}`;
    const previewCard = {
        id: previewCardKey,
        protocol: protocolName,
        value: card.value,
        top: topText,
        middle: middleText,
        bottom: bottomText,
        isFaceUp: true,
        owner: 'player' as const,
        laneIndex: 0,
        category: 'Custom',
        keywords: {}
    };

    // Generate CSS variables for color with different alpha values
    const colorToRGBA = (hex: string, alpha: number): string => {
        hex = hex.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const patternClassName = `card-custom-preview pattern-${protocolPattern}`;
    const customColorVars = {
        '--custom-color': protocolColor,
        '--custom-color-alpha-05': colorToRGBA(protocolColor, 0.05),
        '--custom-color-alpha-06': colorToRGBA(protocolColor, 0.06),
        '--custom-color-alpha-08': colorToRGBA(protocolColor, 0.08),
        '--custom-color-alpha-10': colorToRGBA(protocolColor, 0.10),
        '--custom-color-alpha-15': colorToRGBA(protocolColor, 0.15),
        '--custom-color-alpha-20': colorToRGBA(protocolColor, 0.20),
        '--custom-color-alpha-25': colorToRGBA(protocolColor, 0.25),
        'borderColor': protocolColor,
    } as React.CSSProperties;

    return (
        <div className="card-editor-container">
            <div className="card-editor-content">
                {/* Live Card Preview */}
                <div className="card-live-preview">
                    <h4>Card Preview</h4>
                    <label className="card-value-selector">
                        Card Value:
                        <select value={card.value} onChange={e => handleValueChange(Number(e.target.value))}>
                            <option value={-1}>-1</option>
                            <option value={0}>0</option>
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                            <option value={5}>5</option>
                            <option value={6}>6</option>
                        </select>
                    </label>
                    <div className="card-preview-wrapper" style={customColorVars}>
                        <CardComponent
                            key={previewCardKey}
                            card={previewCard}
                            isFaceUp={true}
                            additionalClassName={patternClassName}
                        />
                    </div>
                </div>

                {/* Effect Editor */}
                <div className="card-effects-editor">
                    <div className="card-preview" style={{ borderColor: protocolColor }}>
                <div className="card-header" style={{ backgroundColor: protocolColor }}>
                    <h3>{protocolName}-{card.value}</h3>
                </div>

                {/* Top Box */}
                <div className="card-box top-box">
                    <h4>Top Box (Passive/Reactive)</h4>
                    <p className="box-description">Passive effects or reactive triggers</p>

                    <div className="effects-list">
                        {card.topEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('top', index)}>
                                    {effect.trigger !== 'passive' && (
                                        <strong>{getTriggerLabel(effect.trigger)}:</strong>
                                    )}{' '}
                                    {getEffectSummary(effect)}
                                </span>
                                <button onClick={() => handleRemoveEffect('top', index)}>×</button>
                            </div>
                        ))}
                        {card.topEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    <div className="add-effect-controls">
                        <select id="top-trigger" defaultValue="">
                            <option value="">Choose Trigger</option>
                            <optgroup label="Passive">
                                <option value="passive">Passive (always active)</option>
                            </optgroup>
                            <optgroup label="Phase Triggers">
                                <option value="start">Start Phase</option>
                                <option value="end">End Phase</option>
                                <option value="on_cover">On Cover</option>
                            </optgroup>
                            <optgroup label="Reactive Triggers">
                                <option value="after_delete">After you delete cards</option>
                                <option value="after_opponent_discard">After opponent discards</option>
                                <option value="after_draw">After you draw cards</option>
                                <option value="after_clear_cache">After you clear cache</option>
                                <option value="before_compile_delete">Before deleted by compile</option>
                                <option value="after_flip">After cards are flipped</option>
                                <option value="after_shift">After cards are shifted</option>
                                <option value="after_play">After cards are played</option>
                                <option value="on_flip">When this card would be flipped</option>
                            </optgroup>
                        </select>

                        <select id="top-action" defaultValue="">
                            <option value="">Choose Action</option>
                            <option value="draw">Draw Cards</option>
                            <option value="refresh">Refresh Hand</option>
                            <option value="mutual_draw">Mutual Draw (Exchange)</option>
                            <option value="flip">Flip Cards</option>
                            <option value="shift">Shift Card</option>
                            <option value="delete">Delete Cards</option>
                            <option value="discard">Discard Cards</option>
                            <option value="return">Return to Hand</option>
                            <option value="play">Play from Hand/Deck</option>
                            <option value="rearrange_protocols">Rearrange Protocols</option>
                            <option value="swap_protocols">Swap Protocols</option>
                            <option value="reveal">Reveal Hand</option>
                            <option value="give">Give Cards</option>
                            <option value="take">Take from Hand</option>
                            <option value="choice">Either/Or Choice</option>
                            <option value="passive_rule">Passive Rule</option>
                            <option value="value_modifier">Value Modifier</option>
                        </select>

                        <button
                            className="btn btn-add-effect"
                            onClick={() => {
                                const triggerSelect = document.getElementById('top-trigger') as HTMLSelectElement;
                                const actionSelect = document.getElementById('top-action') as HTMLSelectElement;
                                const trigger = triggerSelect.value as any;
                                const action = actionSelect.value as EffectActionType;

                                if (trigger && action) {
                                    handleAddEffect('top', action, trigger);
                                    triggerSelect.value = '';
                                    actionSelect.value = '';
                                } else {
                                    setShowValidationModal(true);
                                }
                            }}
                        >
                            +
                        </button>
                    </div>
                </div>

                {/* Middle Box */}
                <div className="card-box middle-box">
                    <h4>Middle Box (On Play)</h4>
                    <p className="box-description">When played or uncovered</p>

                    <div className="effects-list">
                        {card.middleEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('middle', index)}>
                                    {getEffectSummary(effect)}
                                </span>
                                <button onClick={() => handleRemoveEffect('middle', index)}>×</button>
                            </div>
                        ))}
                        {card.middleEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    <select
                        onChange={e => {
                            if (e.target.value) {
                                handleAddEffect('middle', e.target.value as EffectActionType, 'on_play');
                                e.target.value = '';
                            }
                        }}
                    >
                        <option value="">+ Add Effect</option>
                        <option value="draw">Draw Cards</option>
                        <option value="refresh">Refresh Hand</option>
                        <option value="flip">Flip Cards</option>
                        <option value="shift">Shift Card</option>
                        <option value="delete">Delete Cards</option>
                        <option value="discard">Discard Cards</option>
                        <option value="return">Return to Hand</option>
                        <option value="play">Play from Hand/Deck</option>
                        <option value="rearrange_protocols">Rearrange Protocols</option>
                        <option value="swap_protocols">Swap Protocols</option>
                        <option value="reveal">Reveal Hand</option>
                        <option value="give">Give Cards</option>
                        <option value="take">Take from Hand</option>
                        <option value="choice">Either/Or Choice</option>
                        <option value="passive_rule">Passive Rule</option>
                        <option value="value_modifier">Value Modifier</option>
                    </select>
                </div>

                {/* Bottom Box */}
                <div className="card-box bottom-box">
                    <h4>Bottom Box (Triggered)</h4>
                    <p className="box-description">Only when uncovered AND face-up</p>

                    <div className="effects-list">
                        {card.bottomEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('bottom', index)}>
                                    <strong>{getTriggerLabel(effect.trigger)}:</strong>{' '}
                                    {getEffectSummary(effect)}
                                </span>
                                <button onClick={() => handleRemoveEffect('bottom', index)}>×</button>
                            </div>
                        ))}
                        {card.bottomEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    <div className="bottom-effect-add">
                        <select id="bottom-trigger">
                            <option value="">1. Choose Trigger</option>
                            <option value="start">Start Phase</option>
                            <option value="end">End Phase</option>
                            <option value="on_cover">On Cover</option>
                        </select>

                        <select id="bottom-action">
                            <option value="">2. Choose Effect</option>
                            <option value="draw">Draw Cards</option>
                            <option value="refresh">Refresh Hand</option>
                            <option value="mutual_draw">Mutual Draw (Exchange)</option>
                            <option value="flip">Flip Cards</option>
                            <option value="shift">Shift Card</option>
                            <option value="delete">Delete Cards</option>
                            <option value="discard">Discard Cards</option>
                            <option value="return">Return to Hand</option>
                            <option value="play">Play from Hand/Deck</option>
                            <option value="rearrange_protocols">Rearrange Protocols</option>
                            <option value="swap_protocols">Swap Protocols</option>
                            <option value="reveal">Reveal Hand</option>
                            <option value="give">Give Cards</option>
                            <option value="take">Take from Hand</option>
                            <option value="choice">Either/Or Choice</option>
                            <option value="passive_rule">Passive Rule</option>
                            <option value="value_modifier">Value Modifier</option>
                        </select>

                        <button
                            className="btn btn-add-effect"
                            onClick={() => {
                                const triggerSelect = document.getElementById('bottom-trigger') as HTMLSelectElement;
                                const actionSelect = document.getElementById('bottom-action') as HTMLSelectElement;
                                const trigger = triggerSelect.value as 'start' | 'end' | 'on_cover';
                                const action = actionSelect.value as EffectActionType;

                                if (trigger && action) {
                                    handleAddEffect('bottom', action, trigger);
                                    triggerSelect.value = '';
                                    actionSelect.value = '';
                                } else {
                                    setShowValidationModal(true);
                                }
                            }}
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>
                </div>
            </div>

            {/* Effect Parameter Editor */}
            {editingEffect && (
                <div className="effect-parameter-editor">
                    <h3>Configure Effect</h3>
                    <EffectEditor effect={editingEffect.effect} onChange={handleUpdateEffect} />
                    <button onClick={() => setEditingEffect(null)} className="btn">
                        Done
                    </button>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirmation && (
                <div className="custom-protocol-modal-overlay" onClick={() => setDeleteConfirmation(null)}>
                    <div className="custom-protocol-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Delete Effect</h3>
                        <p>Are you sure you want to delete this effect?</p>

                        <div className="custom-protocol-modal-actions">
                            <button onClick={() => setDeleteConfirmation(null)} className="btn btn-back">
                                Cancel
                            </button>
                            <button onClick={confirmDelete} className="btn btn-delete">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Validation Modal */}
            {showValidationModal && (
                <div className="custom-protocol-modal-overlay" onClick={() => setShowValidationModal(false)}>
                    <div className="custom-protocol-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Missing Selection</h3>
                        <p>Please select both a trigger and an effect before adding.</p>

                        <div className="custom-protocol-modal-actions">
                            <button onClick={() => setShowValidationModal(false)} className="btn">
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * Create default parameters for a given action type
 */
const createDefaultParams = (action: EffectActionType): any => {
    switch (action) {
        case 'draw':
            return { action: 'draw', count: 1, target: 'self', source: 'own_deck' };
        case 'flip':
            return {
                action: 'flip',
                count: 1,
                targetFilter: { owner: 'any', position: 'any', faceState: 'any', excludeSelf: false },
                optional: false,
            };
        case 'shift':
            return {
                action: 'shift',
                targetFilter: { owner: 'any', position: 'uncovered', faceState: 'any', excludeSelf: false },
            };
        case 'delete':
            return {
                action: 'delete',
                count: 1,
                targetFilter: { position: 'uncovered', faceState: 'any' },
                excludeSelf: true,
            };
        case 'discard':
            return { action: 'discard', count: 1, actor: 'self' };
        case 'return':
            return { action: 'return', count: 1, targetFilter: {}, scope: { type: 'any_card' } };
        case 'play':
            return { action: 'play', source: 'hand', count: 1, faceDown: true, destinationRule: { type: 'other_lines' } };
        case 'rearrange_protocols':
            return { action: 'rearrange_protocols', target: 'own' };
        case 'swap_protocols':
            return { action: 'swap_protocols', target: 'own' };
        case 'reveal':
        case 'give':
            return { action, source: 'own_hand', count: 1 };
        case 'take':
            return { action: 'take', source: 'opponent_hand', count: 1, random: true };
        case 'choice':
            return { action: 'choice', options: [] };
        case 'passive_rule':
            return { action: 'passive_rule', rule: { type: 'block_all_play', target: 'opponent', scope: 'this_lane' } };
        case 'value_modifier':
            return { action: 'value_modifier', modifier: { type: 'add_per_condition', value: 1, condition: 'per_face_down_card', target: 'own_total', scope: 'this_lane' } };
        default:
            return {};
    }
};
