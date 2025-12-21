/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StateNumberEffectParams } from '../../../types/customProtocol';

interface StateNumberEffectEditorProps {
    params: StateNumberEffectParams;
    onChange: (params: StateNumberEffectParams) => void;
}

export const StateNumberEffectEditor: React.FC<StateNumberEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor state-number-effect-editor">
            <h4>State Number Effect</h4>
            <small className="hint-text">
                Player chooses a number from the available protocol card values.
                The stated number is stored for subsequent effects.
            </small>

            <div className="effect-editor-basic">
                <label>
                    Number Source
                    <select
                        value={params.numberSource || 'own_protocol_values'}
                        onChange={e => onChange({ ...params, numberSource: e.target.value as any })}
                    >
                        <option value="own_protocol_values">Own Protocol Values (0-5)</option>
                    </select>
                </label>
            </div>
        </div>
    );
};
