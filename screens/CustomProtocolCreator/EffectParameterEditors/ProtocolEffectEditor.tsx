/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProtocolEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection } from './shared';

export const ProtocolEffectEditor: React.FC<{ params: ProtocolEffectParams; onChange: (params: ProtocolEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const hasRestriction = !!params.restriction;

    return (
        <div className="param-editor protocol-effect-editor">
            <h4>Protocol Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Action
                    <select
                        value={params.action}
                        onChange={e => onChange({ ...params, action: e.target.value as any })}
                    >
                        <option value="rearrange_protocols">Rearrange</option>
                        <option value="swap_protocols">Swap</option>
                    </select>
                </label>

                <label>
                    Target
                    <select
                        value={params.target}
                        onChange={e => onChange({ ...params, target: e.target.value as any })}
                    >
                        <option value="own">Own</option>
                        <option value="opponent">Opponent</option>
                        <option value="both_sequential">Both (sequential)</option>
                    </select>
                </label>
            </div>

            {/* Restriction Section */}
            <CollapsibleSection title="Restriction (Anarchy-3)" forceOpen={hasRestriction}>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={hasRestriction}
                        onChange={e => {
                            if (e.target.checked) {
                                onChange({ ...params, restriction: { disallowedProtocol: '', laneIndex: 'current' } });
                            } else {
                                const { restriction, ...rest } = params;
                                onChange(rest as ProtocolEffectParams);
                            }
                        }}
                    />
                    Protocol cannot be on specific lane
                </label>

                {hasRestriction && (
                    <div className="filter-row">
                        <label>
                            Disallowed Protocol
                            <input
                                type="text"
                                value={params.restriction!.disallowedProtocol}
                                onChange={e =>
                                    onChange({
                                        ...params,
                                        restriction: { ...params.restriction!, disallowedProtocol: e.target.value }
                                    })
                                }
                                placeholder="e.g., Anarchy, Fire"
                            />
                        </label>

                        <label>
                            Lane
                            <select
                                value={params.restriction!.laneIndex}
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
                                <option value="current">Current lane</option>
                                <option value="0">Lane 1 (Left)</option>
                                <option value="1">Lane 2 (Middle)</option>
                                <option value="2">Lane 3 (Right)</option>
                            </select>
                        </label>
                    </div>
                )}
            </CollapsibleSection>
        </div>
    );
};
