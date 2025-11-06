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
    return (
        <div className="param-editor">
            <h4>Discard Effect</h4>
            <label>
                Count
                <select
                    value={(params as any).variableCount ? 'variable' : params.count.toString()}
                    onChange={e => {
                        const val = e.target.value;
                        if (val === 'variable') {
                            onChange({ ...params, variableCount: true, count: 1 } as any);
                        } else {
                            const { variableCount, ...rest } = params as any;
                            onChange({ ...rest, count: parseInt(val) });
                        }
                    }}
                >
                    <option value="1">1 card</option>
                    <option value="2">2 cards</option>
                    <option value="3">3 cards</option>
                    <option value="variable">1 or more cards (variable)</option>
                </select>
            </label>
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
    let countText = '';

    if (isVariable) {
        countText = '1 or more cards';
    } else {
        const cardWord = params.count === 1 ? 'card' : 'cards';
        countText = `${params.count} ${cardWord}`;
    }

    if (params.actor === 'opponent') {
        return `Opponent discards ${countText}.`;
    } else {
        return `Discard ${countText}.`;
    }
};
