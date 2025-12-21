/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StateProtocolEffectParams } from '../../../types/customProtocol';

interface StateProtocolEffectEditorProps {
    params: StateProtocolEffectParams;
    onChange: (params: StateProtocolEffectParams) => void;
}

export const StateProtocolEffectEditor: React.FC<StateProtocolEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor state-protocol-effect-editor">
            <h4>State Protocol Effect</h4>
            <small className="hint-text">
                Player chooses a protocol from the opponent's unique protocols.
                The stated protocol is stored for subsequent effects (e.g., matching conditionals).
            </small>

            <div className="effect-editor-basic">
                <label>
                    Protocol Source
                    <select
                        value={params.protocolSource || 'opponent_cards'}
                        onChange={e => onChange({ ...params, protocolSource: e.target.value as any })}
                    >
                        <option value="opponent_cards">Opponent's Cards (unique protocols)</option>
                    </select>
                </label>
            </div>
        </div>
    );
};
