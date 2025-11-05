/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProtocolEffectParams } from '../../../types/customProtocol';

export const ProtocolEffectEditor: React.FC<{ params: ProtocolEffectParams; onChange: (params: ProtocolEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Protocol Effect</h4>
            <label>
                Target
                <select value={params.target} onChange={e => onChange({ ...params, target: e.target.value as any })}>
                    <option value="own">Eigene</option>
                    <option value="opponent">Gegner</option>
                    <option value="both_sequential">Beide (nacheinander)</option>
                </select>
            </label>
        </div>
    );
};
