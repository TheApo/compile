/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProtocolEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

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

            <h5>Restriction (Anarchy-3)</h5>

            <label>
                <input
                    type="checkbox"
                    checked={!!params.restriction}
                    onChange={e => {
                        if (e.target.checked) {
                            onChange({ ...params, restriction: { disallowedProtocol: '', laneIndex: 'current' } });
                        } else {
                            const { restriction, ...rest } = params;
                            onChange(rest as ProtocolEffectParams);
                        }
                    }}
                />
                Add restriction (protocol cannot be on specific lane)
            </label>

            {params.restriction && (
                <>
                    <label>
                        Disallowed Protocol
                        <input
                            type="text"
                            value={params.restriction.disallowedProtocol}
                            onChange={e =>
                                onChange({
                                    ...params,
                                    restriction: { ...params.restriction!, disallowedProtocol: e.target.value }
                                })
                            }
                            placeholder="e.g., Anarchy, Fire, Death"
                        />
                    </label>

                    <label>
                        Lane
                        <select
                            value={params.restriction.laneIndex}
                            onChange={e =>
                                onChange({
                                    ...params,
                                    restriction: {
                                        ...params.restriction!,
                                        laneIndex: e.target.value === 'current' ? 'current' : parseInt(e.target.value)
                                    }
                                })
                            }
                        >
                            <option value="current">Current lane (where this card is)</option>
                            <option value="0">Lane 1 (Left)</option>
                            <option value="1">Lane 2 (Middle)</option>
                            <option value="2">Lane 3 (Right)</option>
                        </select>
                    </label>
                </>
            )}

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateProtocolText = (params: ProtocolEffectParams): string => {
    const targetText =
        params.target === 'opponent'
            ? "opponent's"
            : params.target === 'both_sequential'
            ? "both players'"
            : 'your';

    let text = '';
    if (params.action === 'rearrange_protocols') {
        text = `Rearrange ${targetText} protocols.`;
    } else {
        text = `Swap 2 ${targetText} protocols.`;
    }

    // Add restriction text
    if (params.restriction && params.restriction.disallowedProtocol) {
        const laneText = params.restriction.laneIndex === 'current'
            ? 'this line'
            : `lane ${typeof params.restriction.laneIndex === 'number' ? params.restriction.laneIndex + 1 : params.restriction.laneIndex}`;

        text += ` ${params.restriction.disallowedProtocol} cannot be on ${laneText}.`;
    }

    return text;
};
