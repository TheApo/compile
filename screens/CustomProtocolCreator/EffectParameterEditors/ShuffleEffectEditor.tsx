/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface ShuffleTrashEffectParams {
    action: 'shuffle_trash';
    optional: boolean;
    advancedConditional?: {
        type: 'trash_not_empty';
    };
}

interface ShuffleDeckEffectParams {
    action: 'shuffle_deck';
}

export const ShuffleTrashEffectEditor: React.FC<{
    params: ShuffleTrashEffectParams;
    onChange: (params: ShuffleTrashEffectParams) => void;
}> = ({ params, onChange }) => {
    return (
        <div className="param-editor">
            <h4>Shuffle Trash Effect</h4>
            <p style={{ color: '#8A79E8', fontSize: '14px', marginBottom: '15px' }}>
                Shuffle your trash (discarded/deleted cards) back into your deck.
            </p>

            <label>
                <input
                    type="checkbox"
                    checked={params.optional !== false}
                    onChange={e => onChange({ ...params, optional: e.target.checked })}
                />
                Optional ("You may shuffle...")
            </label>

            <h5 style={{ marginTop: '15px' }}>Conditional</h5>
            <label>
                <input
                    type="checkbox"
                    checked={params.advancedConditional?.type === 'trash_not_empty'}
                    onChange={e => {
                        if (e.target.checked) {
                            onChange({ ...params, advancedConditional: { type: 'trash_not_empty' } });
                        } else {
                            const { advancedConditional, ...rest } = params;
                            onChange(rest as ShuffleTrashEffectParams);
                        }
                    }}
                />
                Only if trash is not empty ("If there are any cards in your trash...")
            </label>

        </div>
    );
};

export const ShuffleDeckEffectEditor: React.FC<{
    params: ShuffleDeckEffectParams;
    onChange: (params: ShuffleDeckEffectParams) => void;
}> = ({ params }) => {
    return (
        <div className="param-editor">
            <h4>Shuffle Deck Effect</h4>
            <p style={{ color: '#8A79E8', fontSize: '14px', marginBottom: '15px' }}>
                Shuffle your deck. Typically used after revealing the deck.
            </p>
        </div>
    );
};
