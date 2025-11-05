/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayEffectParams } from '../../../types/customProtocol';

export const PlayEffectEditor: React.FC<{ params: PlayEffectParams; onChange: (params: PlayEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Play Effect</h4>
            <label>
                Source
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="hand">Hand</option>
                    <option value="deck">Deck</option>
                </select>
            </label>
            <label>
                Anzahl
                <input
                    type="number"
                    min={1}
                    max={6}
                    value={params.count}
                    onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                />
            </label>
            <label>
                <input
                    type="checkbox"
                    checked={params.faceDown}
                    onChange={e => onChange({ ...params, faceDown: e.target.checked })}
                />
                Face-down
            </label>
        </div>
    );
};
