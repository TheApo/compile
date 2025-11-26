/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface BlockCompileEffectParams {
    action: 'block_compile';
    target: 'opponent' | 'self';
}

interface BlockCompileEffectEditorProps {
    params: BlockCompileEffectParams;
    onChange: (params: BlockCompileEffectParams) => void;
}

export const BlockCompileEffectEditor: React.FC<BlockCompileEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor block-compile-effect-editor">
            <h4>Block Compile Effect Parameters</h4>

            <label>
                Target
                <select
                    value={params.target || 'opponent'}
                    onChange={e => onChange({ ...params, target: e.target.value as 'opponent' | 'self' })}
                >
                    <option value="opponent">Opponent cannot compile next turn</option>
                    <option value="self">You cannot compile next turn</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
        </div>
    );
};
