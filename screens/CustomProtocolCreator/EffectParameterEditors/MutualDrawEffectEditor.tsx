/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface MutualDrawEffectParams {
    action: 'mutual_draw';
    count: number;
}

interface MutualDrawEffectEditorProps {
    params: MutualDrawEffectParams;
    onChange: (params: MutualDrawEffectParams) => void;
}

export const MutualDrawEffectEditor: React.FC<MutualDrawEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor mutual-draw-effect-editor">
            <h4>Mutual Draw Effect</h4>
            <small className="hint-text">
                Both players draw from each other's decks (Chaos-0: "Draw the top card of your opponent's deck. Your opponent draws the top card of your deck.")
            </small>

            <div className="effect-editor-basic">
                <label>
                    Count
                    <input
                        type="number"
                        min="1"
                        max="10"
                        value={params.count || 1}
                        onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                    />
                </label>
            </div>
        </div>
    );
};
