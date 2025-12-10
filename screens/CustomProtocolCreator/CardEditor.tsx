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
import { getEffectSummary, generateEffectText } from '../../logic/customProtocols/cardFactory';

interface CardEditorProps {
    card: CustomCardDefinition;
    protocolName: string;
    protocolColor: string;
    protocolPattern: CardPattern;
    onChange: (card: CustomCardDefinition) => void;
    readOnly?: boolean;
}

type BoxType = 'top' | 'middle' | 'bottom';

export const CardEditor: React.FC<CardEditorProps> = ({ card, protocolName, protocolColor, protocolPattern, onChange, readOnly = false }) => {
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

    const getTriggerLabel = (trigger: string, effect?: EffectDefinition): string => {
        const triggerActor = effect?.reactiveTriggerActor || 'self';
        const reactiveScope = (effect as any)?.reactiveScope || 'global';

        // Special handling for after_play with actor and scope
        if (trigger === 'after_play') {
            const actorText = triggerActor === 'opponent' ? 'your opponent plays' :
                             triggerActor === 'any' ? 'a card is played' : 'you play';
            const scopeText = reactiveScope === 'this_lane' ? ' in this line' : '';
            return `After ${actorText} a card${scopeText}`;
        }

        // Other reactive triggers with actor context
        if (['after_delete', 'after_discard', 'after_draw', 'after_shift', 'after_flip'].includes(trigger)) {
            const actionMap: Record<string, string> = {
                'after_delete': 'delete cards',
                'after_discard': 'discard cards',
                'after_draw': 'draw cards',
                'after_shift': 'shift cards',
                'after_flip': 'flip cards',
            };
            const actorText = triggerActor === 'opponent' ? 'your opponent' :
                             triggerActor === 'any' ? 'anyone' : 'you';
            const scopeText = reactiveScope === 'this_lane' ? ' in this line' : '';
            return `After ${actorText} ${actionMap[trigger]}${scopeText}`;
        }

        switch (trigger) {
            case 'passive': return '';
            case 'on_play': return '';
            case 'start': return 'Start';
            case 'end': return 'End';
            case 'on_cover': return 'On Cover';
            case 'after_opponent_discard': return 'After opponent discards';
            case 'after_clear_cache': return 'After you clear cache';
            case 'before_compile_delete': return 'Before deleted by compile';
            case 'on_flip': return 'When this card would be flipped';
            case 'on_cover_or_flip': return 'When covered or flipped';
            default: return trigger;
        }
    };

    // NOTE: Both getEffectSummary AND generateEffectText are now imported from cardFactory.ts
    // This ensures the editor preview matches the actual game card text INCLUDING TRIGGERS
    // Single source of truth for all text generation!

    const handleValueChange = (newValue: number) => {
        const updatedCard = { ...card, value: newValue as any };
        onChange(updatedCard);
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
                                <span onClick={() => handleEditEffect('top', index)} className={readOnly ? 'read-only-clickable' : ''}>
                                    {effect.trigger !== 'passive' && (
                                        <strong>{getTriggerLabel(effect.trigger, effect)}:</strong>
                                    )}{' '}
                                    {getEffectSummary(effect)}
                                </span>
                                {!readOnly && <button onClick={() => handleRemoveEffect('top', index)}>×</button>}
                            </div>
                        ))}
                        {card.topEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    {!readOnly && <div className="add-effect-controls">
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
                                <option value="on_cover_or_flip">When this card would be covered or flipped</option>
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
                            <option value="block_compile">Block Compile</option>
                            <option value="delete_all_in_lane">Delete All in Lane</option>
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
                    </div>}
                </div>

                {/* Middle Box */}
                <div className="card-box middle-box">
                    <h4>Middle Box (On Play)</h4>
                    <p className="box-description">When played or uncovered</p>

                    <div className="effects-list">
                        {card.middleEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('middle', index)} className={readOnly ? 'read-only-clickable' : ''}>
                                    {getEffectSummary(effect)}
                                </span>
                                {!readOnly && <button onClick={() => handleRemoveEffect('middle', index)}>×</button>}
                            </div>
                        ))}
                        {card.middleEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    {!readOnly && <select
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
                        <option value="block_compile">Block Compile</option>
                        <option value="delete_all_in_lane">Delete All in Lane</option>
                    </select>}
                </div>

                {/* Bottom Box */}
                <div className="card-box bottom-box">
                    <h4>Bottom Box (Triggered)</h4>
                    <p className="box-description">Only when uncovered AND face-up</p>

                    <div className="effects-list">
                        {card.bottomEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('bottom', index)} className={readOnly ? 'read-only-clickable' : ''}>
                                    <strong>{getTriggerLabel(effect.trigger, effect)}:</strong>{' '}
                                    {getEffectSummary(effect)}
                                </span>
                                {!readOnly && <button onClick={() => handleRemoveEffect('bottom', index)}>×</button>}
                            </div>
                        ))}
                        {card.bottomEffects.length === 0 && <p className="empty-box">No effects</p>}
                    </div>

                    {!readOnly && <div className="bottom-effect-add">
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
                            <option value="block_compile">Block Compile</option>
                            <option value="delete_all_in_lane">Delete All in Lane</option>
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
                    </div>}
                </div>
            </div>
                </div>
            </div>

            {/* Effect Parameter Editor */}
            {editingEffect && (
                <div className="effect-parameter-editor">
                    <h3>{readOnly ? 'View Effect' : 'Configure Effect'}</h3>
                    {readOnly && <div className="read-only-notice">This effect is read-only</div>}
                    <EffectEditor effect={editingEffect.effect} onChange={handleUpdateEffect} readOnly={readOnly} />
                    <button onClick={() => setEditingEffect(null)} className="btn">
                        {readOnly ? 'Close' : 'Done'}
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
