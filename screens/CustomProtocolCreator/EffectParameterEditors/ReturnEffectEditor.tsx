/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ReturnEffectParams } from '../../../types/customProtocol';

export const ReturnEffectEditor: React.FC<{ params: ReturnEffectParams; onChange: (params: ReturnEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const owner = params.targetFilter?.owner || 'any';

    return (
        <div className="param-editor">
            <h4>Return Effect</h4>
            <label>
                Count
                <select
                    value={typeof params.count === 'number' ? params.count.toString() : 'all'}
                    onChange={e => onChange({ ...params, count: e.target.value === 'all' ? 'all' : parseInt(e.target.value) })}
                >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="all">All</option>
                </select>
            </label>

            <label>
                Whose cards?
                <select
                    value={owner}
                    onChange={e => onChange({
                        ...params,
                        targetFilter: {
                            ...params.targetFilter,
                            owner: e.target.value as 'own' | 'opponent' | 'any'
                        }
                    })}
                >
                    <option value="any">Any card (own or opponent)</option>
                    <option value="own">Only own cards</option>
                    <option value="opponent">Only opponent cards</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {generateReturnText(params)}
            </div>
        </div>
    );
};

const generateReturnText = (params: ReturnEffectParams): string => {
    if (params.targetFilter?.valueEquals !== undefined) {
        return `Return all value ${params.targetFilter.valueEquals} cards to hand.`;
    }

    const countText = params.count === 'all' ? 'all cards' : params.count === 1 ? '1 card' : `${params.count} cards`;
    const owner = params.targetFilter?.owner || 'any';

    let ownerText = '';
    if (owner === 'own') {
        ownerText = ' of your own';
    } else if (owner === 'opponent') {
        ownerText = " of opponent's";
    }

    return `Return ${countText}${ownerText} to hand.`;
};
