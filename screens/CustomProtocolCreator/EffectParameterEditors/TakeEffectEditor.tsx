/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface TakeEffectParams {
    action: 'take';
    source: 'opponent_hand';
    count: number;
    random: boolean;
}

interface TakeEffectEditorProps {
    params: TakeEffectParams;
    onChange: (params: TakeEffectParams) => void;
}

export const TakeEffectEditor: React.FC<TakeEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor take-effect-editor">
            <h4>Take Effect</h4>

            <div className="effect-editor-basic">
                <label>
                    Count
                    <select
                        value={params.count || 1}
                        onChange={e => onChange({ ...params, count: parseInt(e.target.value) })}
                    >
                        {[1, 2, 3, 4, 5, 6].map(n => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </label>

                <label>
                    Source
                    <select
                        value={params.source}
                        onChange={e => onChange({ ...params, source: e.target.value as any })}
                    >
                        <option value="opponent_hand">Opponent's Hand</option>
                    </select>
                </label>

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.random}
                        onChange={e => onChange({ ...params, random: e.target.checked })}
                    />
                    Random
                    <small className="hint-text">If unchecked, you choose</small>
                </label>
            </div>
        </div>
    );
};
