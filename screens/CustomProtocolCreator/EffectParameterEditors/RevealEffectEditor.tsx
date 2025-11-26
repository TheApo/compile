/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RevealEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

export const RevealEffectEditor: React.FC<{ params: RevealEffectParams; onChange: (params: RevealEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Reveal/Give Effect</h4>
            <label>
                Action
                <select value={params.action} onChange={e => onChange({ ...params, action: e.target.value as any })}>
                    <option value="reveal">Reveal</option>
                    <option value="give">Give</option>
                </select>
            </label>
            <label>
                Source
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="own_hand">Your hand</option>
                    <option value="opponent_hand">Opponent's hand</option>
                </select>
            </label>
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
            <label>
                Follow-up action
                <select
                    value={params.followUpAction || 'none'}
                    onChange={e => {
                        if (e.target.value === 'none') {
                            const { followUpAction, ...rest } = params;
                            onChange(rest as RevealEffectParams);
                        } else {
                            onChange({ ...params, followUpAction: e.target.value as any });
                        }
                    }}
                >
                    <option value="none">None</option>
                    <option value="flip">Then flip</option>
                    <option value="shift">Then shift</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateRevealText = (params: RevealEffectParams): string => {
    const cardWord = params.count === 1 ? 'card' : 'cards';
    const actionText = params.action === 'give' ? 'Give' : 'Reveal';
    const sourceText = params.source === 'opponent_hand' ? "opponent's hand" : 'your hand';

    let text = `${actionText} ${params.count} ${cardWord} from ${sourceText}`;

    if (params.followUpAction === 'flip') {
        text += '. Then flip it.';
    } else if (params.followUpAction === 'shift') {
        text += '. Then shift it.';
    } else {
        text += '.';
    }

    return text;
};
