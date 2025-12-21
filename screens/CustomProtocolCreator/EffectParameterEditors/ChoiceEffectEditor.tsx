/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ChoiceEffectParams, EffectDefinition, EffectActionType } from '../../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { DrawEffectEditor } from './DrawEffectEditor';
import { FlipEffectEditor } from './FlipEffectEditor';
import { ShiftEffectEditor } from './ShiftEffectEditor';
import { DeleteEffectEditor } from './DeleteEffectEditor';
import { DiscardEffectEditor } from './DiscardEffectEditor';
import { ReturnEffectEditor } from './ReturnEffectEditor';
import { PlayEffectEditor } from './PlayEffectEditor';
import { ProtocolEffectEditor } from './ProtocolEffectEditor';
import { RevealEffectEditor } from './RevealEffectEditor';
import { TakeEffectEditor } from './TakeEffectEditor';

interface ChoiceEffectEditorProps {
    params: ChoiceEffectParams;
    onChange: (newParams: ChoiceEffectParams) => void;
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

export const ChoiceEffectEditor: React.FC<ChoiceEffectEditorProps> = ({ params, onChange }) => {
    const [option1Action, setOption1Action] = useState<EffectActionType | ''>('');
    const [option2Action, setOption2Action] = useState<EffectActionType | ''>('');
    const [editingOption, setEditingOption] = useState<1 | 2 | null>(null);

    const options = params.options || [];
    const option1 = options[0];
    const option2 = options[1];

    const handleAddOption1 = () => {
        if (!option1Action) return;

        const newEffect: EffectDefinition = {
            id: uuidv4(),
            params: createDefaultParams(option1Action),
            position: 'middle',
            trigger: 'on_play',
        };

        onChange({
            ...params,
            options: [newEffect, option2].filter(Boolean),
        });
        setOption1Action('');
        setEditingOption(1);
    };

    const handleAddOption2 = () => {
        if (!option2Action) return;

        const newEffect: EffectDefinition = {
            id: uuidv4(),
            params: createDefaultParams(option2Action),
            position: 'middle',
            trigger: 'on_play',
        };

        onChange({
            ...params,
            options: [option1, newEffect].filter(Boolean),
        });
        setOption2Action('');
        setEditingOption(2);
    };

    const handleRemoveOption1 = () => {
        onChange({
            ...params,
            options: [option2].filter(Boolean),
        });
        if (editingOption === 1) setEditingOption(null);
    };

    const handleRemoveOption2 = () => {
        onChange({
            ...params,
            options: [option1].filter(Boolean),
        });
        if (editingOption === 2) setEditingOption(null);
    };

    const handleUpdateOption1 = (newParams: any) => {
        const updatedEffect: EffectDefinition = {
            ...option1,
            params: newParams,
        };
        onChange({
            ...params,
            options: [updatedEffect, option2].filter(Boolean),
        });
    };

    const handleUpdateOption2 = (newParams: any) => {
        const updatedEffect: EffectDefinition = {
            ...option2,
            params: newParams,
        };
        onChange({
            ...params,
            options: [option1, updatedEffect].filter(Boolean),
        });
    };

    const handleChangeOption1Action = (action: EffectActionType) => {
        const newParams = createDefaultParams(action);
        const updatedEffect: EffectDefinition = {
            ...option1,
            params: newParams,
        };
        onChange({
            ...params,
            options: [updatedEffect, option2].filter(Boolean),
        });
    };

    const handleChangeOption2Action = (action: EffectActionType) => {
        const newParams = createDefaultParams(action);
        const updatedEffect: EffectDefinition = {
            ...option2,
            params: newParams,
        };
        onChange({
            ...params,
            options: [option1, updatedEffect].filter(Boolean),
        });
    };

    const getActionLabel = (action: EffectActionType): string => {
        const labels: Record<EffectActionType, string> = {
            draw: 'Draw Cards',
            flip: 'Flip Cards',
            shift: 'Shift Card',
            delete: 'Delete Cards',
            discard: 'Discard Cards',
            return: 'Return to Hand',
            play: 'Play from Hand/Deck',
            rearrange_protocols: 'Rearrange Protocols',
            swap_protocols: 'Swap Protocols',
            reveal: 'Reveal Hand',
            give: 'Give Cards',
            take: 'Take from Hand',
            choice: 'Either/Or Choice',
        };
        return labels[action] || action;
    };

    const renderEffectParams = (effect: EffectDefinition, onChange: (params: any) => void) => {
        switch (effect.params.action) {
            case 'draw':
                return <DrawEffectEditor params={effect.params} onChange={onChange} />;
            case 'flip':
                return <FlipEffectEditor params={effect.params} onChange={onChange} />;
            case 'shift':
                return <ShiftEffectEditor params={effect.params} onChange={onChange} />;
            case 'delete':
                return <DeleteEffectEditor params={effect.params} onChange={onChange} />;
            case 'discard':
                return <DiscardEffectEditor params={effect.params} onChange={onChange} />;
            case 'return':
                return <ReturnEffectEditor params={effect.params} onChange={onChange} />;
            case 'play':
                return <PlayEffectEditor params={effect.params} onChange={onChange} />;
            case 'rearrange_protocols':
            case 'swap_protocols':
                return <ProtocolEffectEditor params={effect.params} onChange={onChange} />;
            case 'reveal':
            case 'give':
                return <RevealEffectEditor params={effect.params} onChange={onChange} />;
            case 'take':
                return <TakeEffectEditor params={effect.params} onChange={onChange} />;
            default:
                return <div>Unknown effect type</div>;
        }
    };

    return (
        <div className="param-editor choice-effect-editor">
            <h4>Either/Or Choice</h4>
            <small className="hint-text">Player chooses one of two options during gameplay.</small>

            {/* Option 1 */}
            <div className="choice-option-container">
                <label className="choice-option-header">Option 1:</label>
                {option1 ? (
                    <>
                        <div className="choice-option-row">
                            <select
                                className="choice-action-select"
                                value={(option1.params as any).action}
                                onChange={(e) => handleChangeOption1Action(e.target.value as EffectActionType)}
                            >
                                <option value="draw">Draw Cards</option>
                                <option value="flip">Flip Cards</option>
                                <option value="shift">Shift Card</option>
                                <option value="delete">Delete Cards</option>
                                <option value="discard">Discard Cards</option>
                                <option value="return">Return to Hand</option>
                                <option value="play">Play from Hand/Deck</option>
                            </select>
                            <button
                                className={`choice-btn ${editingOption === 1 ? 'choice-btn-active' : 'choice-btn-edit'}`}
                                onClick={() => setEditingOption(editingOption === 1 ? null : 1)}
                            >
                                {editingOption === 1 ? 'Hide' : 'Edit'}
                            </button>
                            <button
                                className="choice-btn choice-btn-remove"
                                onClick={handleRemoveOption1}
                            >
                                Remove
                            </button>
                        </div>
                        {editingOption === 1 && (
                            <div className="choice-option-editor">
                                {renderEffectParams(option1, handleUpdateOption1)}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="choice-option-row">
                        <select
                            className="choice-action-select"
                            value={option1Action}
                            onChange={(e) => setOption1Action(e.target.value as EffectActionType)}
                        >
                            <option value="">Choose Action</option>
                            <option value="draw">Draw Cards</option>
                            <option value="flip">Flip Cards</option>
                            <option value="shift">Shift Card</option>
                            <option value="delete">Delete Cards</option>
                            <option value="discard">Discard Cards</option>
                            <option value="return">Return to Hand</option>
                            <option value="play">Play from Hand/Deck</option>
                        </select>
                        <button
                            className={`choice-btn ${option1Action ? 'choice-btn-add' : 'choice-btn-disabled'}`}
                            onClick={handleAddOption1}
                            disabled={!option1Action}
                        >
                            Add
                        </button>
                    </div>
                )}
            </div>

            {/* Option 2 */}
            <div className="choice-option-container">
                <label className="choice-option-header">Option 2:</label>
                {option2 ? (
                    <>
                        <div className="choice-option-row">
                            <select
                                className="choice-action-select"
                                value={(option2.params as any).action}
                                onChange={(e) => handleChangeOption2Action(e.target.value as EffectActionType)}
                            >
                                <option value="draw">Draw Cards</option>
                                <option value="flip">Flip Cards</option>
                                <option value="shift">Shift Card</option>
                                <option value="delete">Delete Cards</option>
                                <option value="discard">Discard Cards</option>
                                <option value="return">Return to Hand</option>
                                <option value="play">Play from Hand/Deck</option>
                            </select>
                            <button
                                className={`choice-btn ${editingOption === 2 ? 'choice-btn-active' : 'choice-btn-edit'}`}
                                onClick={() => setEditingOption(editingOption === 2 ? null : 2)}
                            >
                                {editingOption === 2 ? 'Hide' : 'Edit'}
                            </button>
                            <button
                                className="choice-btn choice-btn-remove"
                                onClick={handleRemoveOption2}
                            >
                                Remove
                            </button>
                        </div>
                        {editingOption === 2 && (
                            <div className="choice-option-editor">
                                {renderEffectParams(option2, handleUpdateOption2)}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="choice-option-row">
                        <select
                            className="choice-action-select"
                            value={option2Action}
                            onChange={(e) => setOption2Action(e.target.value as EffectActionType)}
                        >
                            <option value="">Choose Action</option>
                            <option value="draw">Draw Cards</option>
                            <option value="flip">Flip Cards</option>
                            <option value="shift">Shift Card</option>
                            <option value="delete">Delete Cards</option>
                            <option value="discard">Discard Cards</option>
                            <option value="return">Return to Hand</option>
                            <option value="play">Play from Hand/Deck</option>
                        </select>
                        <button
                            className={`choice-btn ${option2Action ? 'choice-btn-add' : 'choice-btn-disabled'}`}
                            onClick={handleAddOption2}
                            disabled={!option2Action}
                        >
                            Add
                        </button>
                    </div>
                )}
            </div>

            {options.length === 2 && (
                <div className="choice-complete-notice">
                    Both options configured. Player will choose one during gameplay.
                </div>
            )}
        </div>
    );
};

export function generateChoiceText(params: ChoiceEffectParams): string {
    const options = params.options || [];
    if (options.length !== 2) return 'Either/Or (incomplete)';

    const option1Text = getEffectActionText((options[0].params as any).action);
    const option2Text = getEffectActionText((options[1].params as any).action);

    return `Either ${option1Text} or ${option2Text}`;
}

function getEffectActionText(action: EffectActionType): string {
    const texts: Record<EffectActionType, string> = {
        draw: 'draw cards',
        flip: 'flip cards',
        shift: 'shift card',
        delete: 'delete cards',
        discard: 'discard cards',
        return: 'return to hand',
        play: 'play cards',
        rearrange_protocols: 'rearrange protocols',
        swap_protocols: 'swap protocols',
        reveal: 'reveal hand',
        give: 'give cards',
        take: 'take from hand',
        choice: 'choice',
    };
    return texts[action] || action;
}
