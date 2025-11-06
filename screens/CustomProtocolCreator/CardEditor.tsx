/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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

    const getEffectSummary = (effect: EffectDefinition): string => {
        const params = effect.params as any;
        let mainText = '';

        switch (params.action) {
            case 'draw': {
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

                if (params.action === 'rearrange_protocols') {
                    mainText = `Rearrange ${targetText} protocols.`;
                } else {
                    mainText = `Swap 2 ${targetText} protocols.`;
                }
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
                    <h4>Top Box (Passive)</h4>
                    <p className="box-description">Always active when face-up, even when covered</p>

                    <div className="effects-list">
                        {card.topEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('top', index)}>
                                    {getEffectSummary(effect)}
                                </span>
                                <button onClick={() => handleRemoveEffect('top', index)}>×</button>
                            </div>
                        ))}
                        {card.topEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    <select
                        onChange={e => {
                            if (e.target.value) {
                                handleAddEffect('top', e.target.value as EffectActionType, 'passive');
                                e.target.value = '';
                            }
                        }}
                    >
                        <option value="">+ Add Effect</option>
                        <option value="draw">Draw Cards</option>
                        <option value="flip">Flip Cards</option>
                        <option value="delete">Delete Cards</option>
                    </select>
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
                                    <strong>{effect.trigger === 'start' ? 'Start:' : effect.trigger === 'end' ? 'End:' : 'On Cover:'}</strong>{' '}
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
                targetFilter: { owner: 'any', position: 'uncovered', faceState: 'any' },
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
        default:
            return {};
    }
};
