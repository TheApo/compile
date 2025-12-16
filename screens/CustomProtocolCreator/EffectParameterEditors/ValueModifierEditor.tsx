/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ValueModifierParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface ValueModifierEditorProps {
    params: ValueModifierParams;
    onChange: (params: ValueModifierParams) => void;
}

export const ValueModifierEditor: React.FC<ValueModifierEditorProps> = ({ params, onChange }) => {
    const modifierType = params.modifier?.type || 'add_per_condition';
    const value = params.modifier?.value || 1;
    const condition = params.modifier?.condition || 'per_face_down_card';
    const target = params.modifier?.target || 'own_total';
    const scope = params.modifier?.scope || 'this_lane';
    const faceState = params.modifier?.filter?.faceState || 'face_down';
    const position = params.modifier?.filter?.position || 'any';

    const showCondition = modifierType === 'add_per_condition';
    const showFilter = modifierType === 'set_to_fixed' && (target === 'own_cards' || target === 'opponent_cards' || target === 'all_cards');

    return (
        <div className="param-editor value-modifier-editor">
            <h4>Value Modifier Parameters</h4>
            <p style={{ color: '#8A79E8', fontSize: '14px', marginBottom: '15px' }}>
                This modifier is active while the card is face-up. It modifies card values or lane totals.
            </p>

            <label>
                Modifier Type
                <select
                    value={modifierType}
                    onChange={e => onChange({
                        ...params,
                        modifier: {
                            ...params.modifier,
                            type: e.target.value as any,
                            value,
                            condition: showCondition ? condition : undefined,
                            target,
                            scope,
                            filter: showFilter ? { faceState, position } : undefined
                        }
                    })}
                >
                    <option value="add_per_condition">Add Per Condition (Apathy-0: +1 per face-down)</option>
                    <option value="set_to_fixed">Set Cards To Fixed Value (Darkness-2: face-down = 4)</option>
                    <option value="add_to_total">Add To Lane Total (Metal-0: opponent total -2)</option>
                </select>
            </label>

            <label>
                Value
                <input
                    type="number"
                    value={value}
                    onChange={e => onChange({
                        ...params,
                        modifier: {
                            ...params.modifier,
                            type: modifierType,
                            value: parseInt(e.target.value) || 0,
                            condition: showCondition ? condition : undefined,
                            target,
                            scope,
                            filter: showFilter ? { faceState, position } : undefined
                        }
                    })}
                    style={{
                        width: '100%',
                        padding: '8px',
                        marginTop: '5px',
                        backgroundColor: '#1A113B',
                        color: '#F0F0F0',
                        border: '1px solid rgba(97, 239, 255, 0.3)',
                        borderRadius: '4px'
                    }}
                />
                <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                    {modifierType === 'add_per_condition' && 'Value to add per condition (e.g., +1)'}
                    {modifierType === 'set_to_fixed' && 'Fixed value to set cards to (e.g., 4)'}
                    {modifierType === 'add_to_total' && 'Value to add to total (use negative for subtraction, e.g., -2)'}
                </small>
            </label>

            {showCondition && (
                <label>
                    Condition
                    <select
                        value={condition}
                        onChange={e => onChange({
                            ...params,
                            modifier: {
                                ...params.modifier,
                                type: modifierType,
                                value,
                                condition: e.target.value as any,
                                target,
                                scope,
                                filter: showFilter ? { faceState, position } : undefined
                            }
                        })}
                    >
                        <option value="per_face_down_card">Per Face-Down Card</option>
                        <option value="per_face_up_card">Per Face-Up Card</option>
                        <option value="per_card">Per Card (any)</option>
                        <option value="per_card_in_hand">Per Card in Your Hand</option>
                        <option value="per_opponent_card_in_lane">Per Opponent Card in Lane</option>
                    </select>
                </label>
            )}

            <label>
                Target
                <select
                    value={target}
                    onChange={e => onChange({
                        ...params,
                        modifier: {
                            ...params.modifier,
                            type: modifierType,
                            value,
                            condition: showCondition ? condition : undefined,
                            target: e.target.value as any,
                            scope,
                            filter: showFilter ? { faceState, position } : undefined
                        }
                    })}
                >
                    <optgroup label="Card Values">
                        <option value="own_cards">Own Cards</option>
                        <option value="opponent_cards">Opponent Cards</option>
                        <option value="all_cards">All Cards</option>
                    </optgroup>
                    <optgroup label="Lane Totals">
                        <option value="own_total">Own Total</option>
                        <option value="opponent_total">Opponent Total</option>
                    </optgroup>
                </select>
            </label>

            {showFilter && (
                <>
                    <label>
                        Card Face State (Filter)
                        <select
                            value={faceState}
                            onChange={e => onChange({
                                ...params,
                                modifier: {
                                    ...params.modifier,
                                    type: modifierType,
                                    value,
                                    condition: showCondition ? condition : undefined,
                                    target,
                                    scope,
                                    filter: { faceState: e.target.value as any, position }
                                }
                            })}
                        >
                            <option value="face_down">Face-Down Only</option>
                            <option value="face_up">Face-Up Only</option>
                            <option value="any">Any</option>
                        </select>
                    </label>

                    <label>
                        Card Position (Filter)
                        <select
                            value={position}
                            onChange={e => onChange({
                                ...params,
                                modifier: {
                                    ...params.modifier,
                                    type: modifierType,
                                    value,
                                    condition: showCondition ? condition : undefined,
                                    target,
                                    scope,
                                    filter: { faceState, position: e.target.value as any }
                                }
                            })}
                        >
                            <option value="any">Any Position</option>
                            <option value="covered">Covered Only</option>
                            <option value="uncovered">Uncovered Only</option>
                        </select>
                    </label>
                </>
            )}

            <label>
                Scope
                <select
                    value={scope}
                    onChange={e => onChange({
                        ...params,
                        modifier: {
                            ...params.modifier,
                            type: modifierType,
                            value,
                            condition: showCondition ? condition : undefined,
                            target,
                            scope: e.target.value as any,
                            filter: showFilter ? { faceState, position } : undefined
                        }
                    })}
                >
                    <option value="this_lane">This Lane Only</option>
                    <option value="global">Global (All Lanes)</option>
                </select>
            </label>

        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateValueModifierText = (params: ValueModifierParams): string => {
    const modifierType = params.modifier?.type || 'add_per_condition';
    const value = params.modifier?.value || 0;
    const condition = params.modifier?.condition || 'per_face_down_card';
    const target = params.modifier?.target || 'own_total';
    const scope = params.modifier?.scope || 'this_lane';
    const faceState = params.modifier?.filter?.faceState || 'face_down';

    const scopeText = scope === 'this_lane' ? ' in this lane' : '';

    let targetText = '';
    switch (target) {
        case 'own_cards': targetText = 'your cards'; break;
        case 'opponent_cards': targetText = "opponent's cards"; break;
        case 'all_cards': targetText = 'all cards'; break;
        case 'own_total': targetText = 'your total value'; break;
        case 'opponent_total': targetText = "opponent's total value"; break;
    }

    switch (modifierType) {
        case 'add_per_condition': {
            let conditionText = '';
            switch (condition) {
                case 'per_face_down_card': conditionText = 'face-down card'; break;
                case 'per_face_up_card': conditionText = 'face-up card'; break;
                case 'per_card': conditionText = 'card'; break;
            }
            const sign = value >= 0 ? '+' : '';
            return `${targetText}${scopeText} is increased by ${sign}${value} for each ${conditionText}${scopeText}.`;
        }
        case 'set_to_fixed': {
            const faceText = faceState === 'face_down' ? 'face-down ' : faceState === 'face_up' ? 'face-up ' : '';
            return `All ${faceText}${targetText}${scopeText} have a value of ${value}.`;
        }
        case 'add_to_total': {
            const sign = value >= 0 ? 'increased' : 'reduced';
            const absValue = Math.abs(value);
            return `${targetText}${scopeText} is ${sign} by ${absValue}.`;
        }
        default:
            return 'Value modifier active.';
    }
};
