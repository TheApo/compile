/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

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
            <h4>Block Compile Effect</h4>

            <div className="effect-editor-basic">
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
            </div>
        </div>
    );
};
