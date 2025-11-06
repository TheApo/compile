/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DeleteEffectParams } from '../../../types/customProtocol';

interface DeleteEffectEditorProps {
    params: DeleteEffectParams;
    onChange: (params: DeleteEffectParams) => void;
}

export const DeleteEffectEditor: React.FC<DeleteEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor delete-effect-editor">
            <h4>Delete Effect Parameters</h4>

            <label>
                Anzahl
                <select
                    value={typeof params.count === 'number' ? params.count.toString() : 'all'}
                    onChange={e => onChange({ ...params, count: e.target.value === 'all' ? 'all_in_lane' : parseInt(e.target.value) })}
                >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="all">Alle in einer Lane</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.excludeSelf}
                    onChange={e => onChange({ ...params, excludeSelf: e.target.checked })}
                />
                Exclude self (kann sich selbst nicht löschen)
            </label>

            <h5>Target Filter</h5>

            <label>
                Position
                <select
                    value={params.targetFilter.position}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, position: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="uncovered">Uncovered</option>
                    <option value="covered">Covered</option>
                </select>
            </label>

            <label>
                Face State
                <select
                    value={params.targetFilter.faceState}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, faceState: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="face_up">Face-up</option>
                    <option value="face_down">Face-down</option>
                </select>
            </label>

            <label>
                Calculation
                <select
                    value={params.targetFilter.calculation || 'none'}
                    onChange={e => {
                        const val = e.target.value;
                        const newFilter = { ...params.targetFilter };
                        if (val === 'none') {
                            delete newFilter.calculation;
                        } else {
                            newFilter.calculation = val as any;
                        }
                        onChange({ ...params, targetFilter: newFilter });
                    }}
                >
                    <option value="none">None</option>
                    <option value="highest_value">Highest value</option>
                    <option value="lowest_value">Lowest value</option>
                </select>
            </label>

            <label>
                Value Range (specific values to target)
                <select
                    value={params.targetFilter.valueRange ? `${params.targetFilter.valueRange.min}-${params.targetFilter.valueRange.max}` : 'none'}
                    onChange={e => {
                        const val = e.target.value;
                        const newFilter = { ...params.targetFilter };
                        if (val === 'none') {
                            delete newFilter.valueRange;
                        } else if (val === '0-1') {
                            newFilter.valueRange = { min: 0, max: 1 };
                        } else if (val === '1-2') {
                            newFilter.valueRange = { min: 1, max: 2 };
                        } else if (val === '0-0') {
                            newFilter.valueRange = { min: 0, max: 0 };
                        }
                        onChange({ ...params, targetFilter: newFilter });
                    }}
                >
                    <option value="none">Any value</option>
                    <option value="0-0">Value 0 only</option>
                    <option value="0-1">Values 0 or 1</option>
                    <option value="1-2">Values 1 or 2</option>
                </select>
            </label>

            <h5>Scope</h5>

            <label>
                Lane Scope
                <select
                    value={params.scope?.type || 'any'}
                    onChange={e => {
                        const val = e.target.value;
                        if (val === 'any') {
                            const { scope, ...rest } = params;
                            onChange(rest as DeleteEffectParams);
                        } else {
                            onChange({ ...params, scope: { type: val as any } });
                        }
                    }}
                >
                    <option value="any">Any lane</option>
                    <option value="this_line">This line only</option>
                    <option value="other_lanes">Other lanes</option>
                    <option value="each_other_line">Each other line (1 per line)</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {generateDeleteText(params)}
            </div>
        </div>
    );
};

const generateDeleteText = (params: DeleteEffectParams): string => {
    let text = 'Delete ';

    if (params.count === 'all_in_lane') {
        text += 'all ';
    } else {
        text += `${params.count} `;
    }

    if (params.targetFilter.calculation === 'highest_value') {
        text += 'highest value ';
    } else if (params.targetFilter.calculation === 'lowest_value') {
        text += 'lowest value ';
    }

    if (params.targetFilter.valueRange) {
        text += `value ${params.targetFilter.valueRange.min}-${params.targetFilter.valueRange.max} `;
    }

    if (params.targetFilter.position === 'covered') {
        text += 'covered ';
    } else if (params.targetFilter.position === 'uncovered') {
        text += 'uncovered ';
    }

    if (params.targetFilter.faceState === 'face_down') {
        text += 'face-down ';
    } else if (params.targetFilter.faceState === 'face_up') {
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

    return text + '.';
};
