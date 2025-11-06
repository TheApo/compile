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
                Action
                <select value={params.action} onChange={e => onChange({ ...params, action: e.target.value as any })}>
                    <option value="rearrange_protocols">Rearrange</option>
                    <option value="swap_protocols">Swap</option>
                </select>
            </label>
            <label>
                Target
                <select value={params.target} onChange={e => onChange({ ...params, target: e.target.value as any })}>
                    <option value="own">Own</option>
                    <option value="opponent">Opponent</option>
                    <option value="both_sequential">Beide (nacheinander)</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {generateProtocolText(params)}
            </div>
        </div>
    );
};

const generateProtocolText = (params: ProtocolEffectParams): string => {
    const targetText =
        params.target === 'opponent'
            ? "opponent's"
            : params.target === 'both_sequential'
            ? "both players'"
            : 'your';

    if (params.action === 'rearrange_protocols') {
        return `Rearrange ${targetText} protocols.`;
    } else {
        return `Swap 2 ${targetText} protocols.`;
    }
};
