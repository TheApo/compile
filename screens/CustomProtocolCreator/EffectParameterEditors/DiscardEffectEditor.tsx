/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DiscardEffectParams } from '../../../types/customProtocol';

export const DiscardEffectEditor: React.FC<{ params: DiscardEffectParams; onChange: (params: DiscardEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const countType = params.countType || 'fixed';
    const isVariable = (params as any).variableCount;
    const showOffset = countType === 'equal_to_discarded';

    return (
        <div className="param-editor">
            <h4>Discard Effect</h4>

            {/* Count Type */}
            <label>
                Count Type
                <select
                    value={countType}
                    onChange={e => onChange({ ...params, countType: e.target.value as any })}
                >
                    <option value="fixed">Fixed Count</option>
                    <option value="equal_to_discarded">Equal to Previously Discarded (Plague-2)</option>
                </select>
            </label>

            {/* Fixed Count Options */}
            {countType === 'fixed' && (
                <label>
                    Count
                    <select
                        value={isVariable ? 'variable' : params.count.toString()}
                        onChange={e => {
                            const val = e.target.value;
                            if (val === 'variable') {
                                onChange({ ...params, variableCount: true, count: 1 } as any);
                            } else if (val === 'all') {
                                const { variableCount, ...rest } = params as any;
                                onChange({ ...rest, count: 'all' as any });
                            } else {
                                const { variableCount, ...rest } = params as any;
                                onChange({ ...rest, count: parseInt(val) });
                            }
                        }}
                    >
                        <option value="1">1 card</option>
                        <option value="2">2 cards</option>
                        <option value="3">3 cards</option>
                        <option value="all">All cards (entire hand)</option>
                        <option value="variable">1 or more cards (variable)</option>
                    </select>
                </label>
            )}

            {/* Offset for Dynamic Count */}
            {showOffset && (
                <label>
                    Offset (add to count)
                    <input
                        type="number"
                        value={params.countOffset || 0}
                        onChange={e => onChange({ ...params, countOffset: parseInt(e.target.value) })}
                        min="-5"
                        max="5"
                    />
                </label>
            )}

            <label>
                Actor
                <select value={params.actor} onChange={e => onChange({ ...params, actor: e.target.value as any })}>
                    <option value="self">Self</option>
                    <option value="opponent">Opponent</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {generateDiscardText(params)}
            </div>
        </div>
    );
};

const generateDiscardText = (params: DiscardEffectParams): string => {
    const isVariable = (params as any).variableCount;
    const countType = params.countType || 'fixed';
    let countText = '';

    if (countType === 'equal_to_discarded') {
        const offset = params.countOffset || 0;
        const offsetText = offset > 0 ? ` + ${offset}` : offset < 0 ? ` - ${Math.abs(offset)}` : '';
        countText = `(amount discarded${offsetText}) cards`;
    } else if (isVariable) {
        countText = '1 or more cards';
    } else if (params.count === 'all') {
        countText = 'your hand';
    } else {
        const cardWord = params.count === 1 ? 'card' : 'cards';
        countText = `${params.count} ${cardWord}`;
    }

    if (params.actor === 'opponent') {
        if (params.count === 'all') {
            return `Opponent discards their hand.`;
        }
        return `Opponent discards ${countText}.`;
    } else {
        return `Discard ${countText}.`;
    }
};
