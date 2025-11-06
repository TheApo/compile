/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { EffectDefinition, EffectActionType } from '../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { DrawEffectEditor } from './EffectParameterEditors/DrawEffectEditor';
import { FlipEffectEditor } from './EffectParameterEditors/FlipEffectEditor';
import { ShiftEffectEditor } from './EffectParameterEditors/ShiftEffectEditor';
import { DeleteEffectEditor } from './EffectParameterEditors/DeleteEffectEditor';
import { DiscardEffectEditor } from './EffectParameterEditors/DiscardEffectEditor';
import { ReturnEffectEditor } from './EffectParameterEditors/ReturnEffectEditor';
import { PlayEffectEditor } from './EffectParameterEditors/PlayEffectEditor';
import { ProtocolEffectEditor } from './EffectParameterEditors/ProtocolEffectEditor';
import { RevealEffectEditor } from './EffectParameterEditors/RevealEffectEditor';
import { TakeEffectEditor } from './EffectParameterEditors/TakeEffectEditor';

interface EffectEditorProps {
    effect: EffectDefinition;
    onChange: (effect: EffectDefinition) => void;
}

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
                targetFilter: { owner: 'any', position: 'any', faceState: 'any' },
                destinationRestriction: { type: 'any' },
            };
        case 'delete':
            return {
                action: 'delete',
                count: 1,
                targetFilter: { position: 'any', faceState: 'any' },
                scope: { type: 'anywhere' },
                excludeSelf: false,
            };
        case 'discard':
            return { action: 'discard', count: 1, actor: 'self' };
        case 'return':
            return { action: 'return', count: 1, targetFilter: {}, scope: { type: 'any_card' } };
        case 'play':
            return {
                action: 'play',
                source: 'hand',
                count: 1,
                faceDown: false,
                destinationRule: { type: 'other_lines' },
            };
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

export const EffectEditor: React.FC<EffectEditorProps> = ({ effect, onChange }) => {
    const handleParamsChange = (newParams: any) => {
        onChange({ ...effect, params: newParams });
    };

    const handleToggleConditional = (enabled: boolean) => {
        if (enabled) {
            // Create default follow-up effect
            const thenEffect: EffectDefinition = {
                id: uuidv4(),
                params: createDefaultParams('draw'),
                position: effect.position,
                trigger: effect.trigger,
            };
            onChange({
                ...effect,
                conditional: {
                    type: 'if_you_do',
                    thenEffect,
                },
            });
        } else {
            // Remove conditional
            const { conditional, ...rest } = effect;
            onChange(rest as EffectDefinition);
        }
    };

    const handleConditionalEffectChange = (updatedThenEffect: EffectDefinition) => {
        if (!effect.conditional) return;
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: updatedThenEffect,
            },
        });
    };

    const handleConditionalActionChange = (action: EffectActionType) => {
        if (!effect.conditional) return;
        const newParams = createDefaultParams(action);
        const updatedThenEffect: EffectDefinition = {
            ...effect.conditional.thenEffect,
            params: newParams,
        };
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: updatedThenEffect,
            },
        });
    };

    const renderEffectParams = (effectToRender: EffectDefinition, onChange: (params: any) => void) => {
        switch (effectToRender.params.action) {
            case 'draw':
                return <DrawEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'flip':
                return <FlipEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'shift':
                return <ShiftEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'delete':
                return <DeleteEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'discard':
                return <DiscardEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'return':
                return <ReturnEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'play':
                return <PlayEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'rearrange_protocols':
            case 'swap_protocols':
                return <ProtocolEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'reveal':
            case 'give':
                return <RevealEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'take':
                return <TakeEffectEditor params={effectToRender.params} onChange={onChange} />;
            default:
                return <div>Unknown effect type</div>;
        }
    };

    return (
        <div className="effect-editor">
            {/* Main Effect */}
            <div className="main-effect">
                <h3>Main Effect</h3>
                {renderEffectParams(effect, handleParamsChange)}
            </div>

            {/* Conditional Follow-Up */}
            <div className="conditional-section" style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '15px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <input
                        type="checkbox"
                        checked={!!effect.conditional}
                        onChange={(e) => handleToggleConditional(e.target.checked)}
                    />
                    <strong>Add follow-up effect (If you do)</strong>
                </label>

                {effect.conditional && (
                    <div className="follow-up-effect" style={{ marginLeft: '20px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                        <h4 style={{ marginTop: 0 }}>Follow-Up Effect</h4>

                        <label>
                            Effect Type
                            <select
                                value={effect.conditional.thenEffect.params.action}
                                onChange={(e) => handleConditionalActionChange(e.target.value as EffectActionType)}
                                style={{ width: '100%', padding: '5px', marginTop: '5px' }}
                            >
                                <option value="draw">Draw Cards</option>
                                <option value="flip">Flip Cards</option>
                                <option value="shift">Shift Card</option>
                                <option value="delete">Delete Cards</option>
                                <option value="discard">Discard Cards</option>
                                <option value="return">Return to Hand</option>
                                <option value="play">Play from Hand/Deck</option>
                                <option value="reveal">Reveal Hand</option>
                                <option value="give">Give Cards</option>
                                <option value="take">Take from Hand</option>
                            </select>
                        </label>

                        <div style={{ marginTop: '15px' }}>
                            {renderEffectParams(
                                effect.conditional.thenEffect,
                                (newParams) => handleConditionalEffectChange({ ...effect.conditional!.thenEffect, params: newParams })
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
