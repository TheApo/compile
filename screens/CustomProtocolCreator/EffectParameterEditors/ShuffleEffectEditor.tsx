/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface ShuffleTrashEffectParams {
    action: 'shuffle_trash';
    optional: boolean;
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

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
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

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
        </div>
    );
};
