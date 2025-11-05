/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RevealEffectParams } from '../../../types/customProtocol';

export const RevealEffectEditor: React.FC<{ params: RevealEffectParams; onChange: (params: RevealEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Reveal/Give Effect</h4>
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
        </div>
    );
};
