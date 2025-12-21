/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ValueModifierParams } from '../../../types/customProtocol';
import { CollapsibleSection } from './shared';

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
    const hasFilterConfig = showFilter && (faceState !== 'face_down' || position !== 'any');

    const updateModifier = (updates: Partial<typeof params.modifier>) => {
        onChange({
            ...params,
            modifier: {
                ...params.modifier,
                type: modifierType,
                value,
                condition: showCondition ? condition : undefined,
                target,
                scope,
                filter: showFilter ? { faceState, position } : undefined,
                ...updates
            }
        });
    };

    return (
        <div className="param-editor value-modifier-editor">
            <h4>Value Modifier</h4>
            <small className="hint-text">Active while card is face-up. Modifies card values or lane totals.</small>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Type
                    <select
                        value={modifierType}
                        onChange={e => updateModifier({ type: e.target.value as any })}
                    >
                        <option value="add_per_condition">Add Per Condition</option>
                        <option value="set_to_fixed">Set To Fixed Value</option>
                        <option value="add_to_total">Add To Total</option>
                    </select>
                </label>

                <label>
                    Value
                    <input
                        type="number"
                        value={value}
                        onChange={e => updateModifier({ value: parseInt(e.target.value) || 0 })}
                    />
                </label>

                {showCondition && (
                    <label>
                        Condition
                        <select
                            value={condition}
                            onChange={e => updateModifier({ condition: e.target.value as any })}
                        >
                            <option value="per_face_down_card">Per Face-Down</option>
                            <option value="per_face_up_card">Per Face-Up</option>
                            <option value="per_card">Per Card (any)</option>
                            <option value="per_card_in_hand">Per Hand Card</option>
                            <option value="per_opponent_card_in_lane">Per Opp. Card</option>
                        </select>
                    </label>
                )}
            </div>

            {/* Target & Scope Section */}
            <CollapsibleSection title="Target & Scope" forceOpen={target !== 'own_total' || scope !== 'this_lane'}>
                <div className="filter-row">
                    <label>
                        Target
                        <select
                            value={target}
                            onChange={e => updateModifier({ target: e.target.value as any })}
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

                    <label>
                        Scope
                        <select
                            value={scope}
                            onChange={e => updateModifier({ scope: e.target.value as any })}
                        >
                            <option value="this_lane">This Lane</option>
                            <option value="global">Global</option>
                        </select>
                    </label>
                </div>
            </CollapsibleSection>

            {/* Card Filter Section - only for set_to_fixed with card targets */}
            {showFilter && (
                <CollapsibleSection title="Card Filter" forceOpen={hasFilterConfig}>
                    <div className="filter-row">
                        <label>
                            Face State
                            <select
                                value={faceState}
                                onChange={e => updateModifier({
                                    filter: { faceState: e.target.value as any, position }
                                })}
                            >
                                <option value="face_down">Face-Down</option>
                                <option value="face_up">Face-Up</option>
                                <option value="any">Any</option>
                            </select>
                        </label>

                        <label>
                            Position
                            <select
                                value={position}
                                onChange={e => updateModifier({
                                    filter: { faceState, position: e.target.value as any }
                                })}
                            >
                                <option value="any">Any</option>
                                <option value="covered">Covered</option>
                                <option value="uncovered">Uncovered</option>
                            </select>
                        </label>
                    </div>
                </CollapsibleSection>
            )}
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
