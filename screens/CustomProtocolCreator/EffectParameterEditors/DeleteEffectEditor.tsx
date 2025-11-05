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
        </div>
    );
};
