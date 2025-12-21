/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CollapsibleSection } from './shared';

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
    const hasConditional = params.advancedConditional?.type === 'trash_not_empty';

    return (
        <div className="param-editor shuffle-trash-effect-editor">
            <h4>Shuffle Trash Effect</h4>
            <small className="hint-text">
                Shuffle your trash (discarded/deleted cards) back into your deck.
            </small>

            <div className="effect-editor-basic">
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.optional !== false}
                        onChange={e => onChange({ ...params, optional: e.target.checked })}
                    />
                    Optional ("You may shuffle...")
                </label>
            </div>

            <CollapsibleSection title="Conditionals" forceOpen={hasConditional}>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={hasConditional}
                        onChange={e => {
                            if (e.target.checked) {
                                onChange({ ...params, advancedConditional: { type: 'trash_not_empty' } });
                            } else {
                                const { advancedConditional, ...rest } = params;
                                onChange(rest as ShuffleTrashEffectParams);
                            }
                        }}
                    />
                    Only if trash is not empty
                </label>
                <small className="hint-text">"If there are any cards in your trash..."</small>
            </CollapsibleSection>
        </div>
    );
};

export const ShuffleDeckEffectEditor: React.FC<{
    params: ShuffleDeckEffectParams;
    onChange: (params: ShuffleDeckEffectParams) => void;
}> = () => {
    return (
        <div className="param-editor shuffle-deck-effect-editor">
            <h4>Shuffle Deck Effect</h4>
            <small className="hint-text">
                Shuffle your deck. Typically used after revealing the deck.
            </small>
            <p className="hint-text">No additional parameters required.</p>
        </div>
    );
};
