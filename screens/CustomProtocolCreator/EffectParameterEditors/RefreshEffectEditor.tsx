/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface RefreshEffectParams {
    action: 'refresh';
    target: 'self' | 'opponent';
}

interface RefreshEffectEditorProps {
    params: RefreshEffectParams;
    onChange: (params: RefreshEffectParams) => void;
}

export const RefreshEffectEditor: React.FC<RefreshEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor refresh-effect-editor">
            <h4>Refresh Effect Parameters</h4>
            <p className="effect-description">
                Refresh fills the hand to 5 cards (Spirit-0: "Refresh.")
            </p>

            <label>
                Target
                <select
                    value={params.target || 'self'}
                    onChange={e => onChange({ ...params, target: e.target.value as 'self' | 'opponent' })}
                >
                    <option value="self">Self</option>
                    <option value="opponent">Opponent</option>
                </select>
            </label>
        </div>
    );
};
