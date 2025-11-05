/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CustomCardDefinition, EffectDefinition, EffectActionType } from '../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { EffectEditor } from './EffectEditor';

interface CardEditorProps {
    card: CustomCardDefinition;
    protocolName: string;
    protocolColor: string;
    onChange: (card: CustomCardDefinition) => void;
}

type BoxType = 'top' | 'middle' | 'bottom';

export const CardEditor: React.FC<CardEditorProps> = ({ card, protocolName, protocolColor, onChange }) => {
    const [editingEffect, setEditingEffect] = useState<{
        box: BoxType;
        effectIndex: number;
        effect: EffectDefinition;
    } | null>(null);

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
        if (!confirm('Effekt wirklich löschen?')) return;

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
    };

    const handleUpdateEffect = (updatedEffect: EffectDefinition) => {
        if (!editingEffect) return;

        const { box, effectIndex } = editingEffect;
        const updatedCard = { ...card };

        if (box === 'top') {
            updatedCard.topEffects[effectIndex] = updatedEffect;
        } else if (box === 'middle') {
            updatedCard.middleEffects[effectIndex] = updatedEffect;
        } else {
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
        const params = effect.params;
        switch (params.action) {
            case 'draw':
                return `Draw ${params.count} card${params.count !== 1 ? 's' : ''}`;
            case 'flip':
                return `Flip ${params.count} card${params.count !== 1 ? 's' : ''}`;
            case 'shift':
                return `Shift 1 card`;
            case 'delete':
                return `Delete ${params.count} card${params.count !== 1 ? 's' : ''}`;
            case 'discard':
                return `${params.actor === 'opponent' ? 'Opponent discards' : 'Discard'} ${params.count}`;
            case 'return':
                return `Return ${params.count} to hand`;
            case 'play':
                return `Play ${params.count} card${params.count !== 1 ? 's' : ''}`;
            case 'rearrange_protocols':
                return `Rearrange ${params.target === 'opponent' ? "opponent's" : 'your'} protocols`;
            case 'swap_protocols':
                return `Swap 2 protocols`;
            case 'reveal':
                return `Reveal ${params.count} card${params.count !== 1 ? 's' : ''}`;
            default:
                return 'Effect';
        }
    };

    return (
        <div className="card-editor-container">
            <div className="card-preview" style={{ borderColor: protocolColor }}>
                <div className="card-header" style={{ backgroundColor: protocolColor }}>
                    <h3>{protocolName}-{card.value}</h3>
                </div>

                {/* Top Box */}
                <div className="card-box top-box">
                    <h4>Top Box (Passive)</h4>
                    <p className="box-description">Immer aktiv wenn face-up, auch wenn covered</p>

                    <div className="effects-list">
                        {card.topEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('top', index)}>
                                    {getEffectSummary(effect)}
                                </span>
                                <button onClick={() => handleRemoveEffect('top', index)}>×</button>
                            </div>
                        ))}
                        {card.topEffects.length === 0 && <p className="empty-box">Keine Effekte</p>}
                    </div>

                    <select
                        onChange={e => {
                            if (e.target.value) {
                                handleAddEffect('top', e.target.value as EffectActionType, 'passive');
                                e.target.value = '';
                            }
                        }}
                    >
                        <option value="">+ Effekt hinzufügen</option>
                        <option value="draw">Draw Cards</option>
                        <option value="flip">Flip Cards</option>
                        <option value="delete">Delete Cards</option>
                    </select>
                </div>

                {/* Middle Box */}
                <div className="card-box middle-box">
                    <h4>Middle Box (On Play)</h4>
                    <p className="box-description">Wenn gespielt oder uncovered wird</p>

                    <div className="effects-list">
                        {card.middleEffects.map((effect, index) => (
                            <div key={effect.id} className="effect-item">
                                <span onClick={() => handleEditEffect('middle', index)}>
                                    {getEffectSummary(effect)}
                                </span>
                                <button onClick={() => handleRemoveEffect('middle', index)}>×</button>
                            </div>
                        ))}
                        {card.middleEffects.length === 0 && <p className="empty-box">Keine Effekte</p>}
                    </div>

                    <select
                        onChange={e => {
                            if (e.target.value) {
                                handleAddEffect('middle', e.target.value as EffectActionType, 'on_play');
                                e.target.value = '';
                            }
                        }}
                    >
                        <option value="">+ Effekt hinzufügen</option>
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
                    </select>
                </div>

                {/* Bottom Box */}
                <div className="card-box bottom-box">
                    <h4>Bottom Box (Triggered)</h4>
                    <p className="box-description">Nur wenn uncovered UND face-up</p>

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
                        {card.bottomEffects.length === 0 && <p className="empty-box">Keine Effekte</p>}
                    </div>

                    <div className="bottom-effect-add">
                        <select
                            id="bottom-trigger"
                            onChange={e => {
                                const trigger = e.target.value as 'start' | 'end' | 'on_cover';
                                const actionSelect = document.getElementById('bottom-action') as HTMLSelectElement;
                                if (trigger && actionSelect.value) {
                                    handleAddEffect('bottom', actionSelect.value as EffectActionType, trigger);
                                    e.target.value = '';
                                    actionSelect.value = '';
                                }
                            }}
                        >
                            <option value="">1. Trigger wählen</option>
                            <option value="start">Start Phase</option>
                            <option value="end">End Phase</option>
                            <option value="on_cover">On Cover</option>
                        </select>

                        <select id="bottom-action">
                            <option value="">2. Effekt wählen</option>
                            <option value="draw">Draw Cards</option>
                            <option value="flip">Flip Cards</option>
                            <option value="shift">Shift Card</option>
                            <option value="delete">Delete Cards</option>
                            <option value="discard">Discard Cards</option>
                            <option value="return">Return to Hand</option>
                            <option value="rearrange_protocols">Rearrange Protocols</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Effect Parameter Editor */}
            {editingEffect && (
                <div className="effect-parameter-editor">
                    <h3>Effekt konfigurieren</h3>
                    <EffectEditor effect={editingEffect.effect} onChange={handleUpdateEffect} />
                    <button onClick={() => setEditingEffect(null)} className="btn">
                        Fertig
                    </button>
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
        default:
            return {};
    }
};
