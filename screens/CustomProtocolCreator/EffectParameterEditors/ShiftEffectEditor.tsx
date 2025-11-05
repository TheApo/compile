/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShiftEffectParams } from '../../../types/customProtocol';

export const ShiftEffectEditor: React.FC<{ params: ShiftEffectParams; onChange: (params: ShiftEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Shift Effect</h4>
            <label>
                Target Owner
                <select
                    value={params.targetFilter.owner}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, owner: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="own">Eigene</option>
                    <option value="opponent">Gegner</option>
                </select>
            </label>
            <label>
                Destination
                <select
                    value={params.destinationRestriction?.type || 'any'}
                    onChange={e => {
                        if (e.target.value === 'any') {
                            const { destinationRestriction, ...rest } = params;
                            onChange(rest as ShiftEffectParams);
                        } else {
                            onChange({ ...params, destinationRestriction: { type: e.target.value as any } });
                        }
                    }}
                >
                    <option value="any">Any line</option>
                    <option value="non_matching_protocol">Non-matching protocol</option>
                    <option value="specific_lane">This line</option>
                </select>
            </label>
        </div>
    );
};
