/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface TakeEffectParams {
    action: 'take';
    source: 'opponent_hand';
    count: number;
    random: boolean;
}

interface TakeEffectEditorProps {
    params: TakeEffectParams;
    onChange: (params: TakeEffectParams) => void;
}

export const TakeEffectEditor: React.FC<TakeEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor take-effect-editor">
            <h4>Take Effect Parameters</h4>

            <label>
                Card Count
                <input
                    type="number"
                    min={1}
                    max={6}
                    value={params.count}
                    onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                />
            </label>

            <label>
                Source
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="opponent_hand">Opponent's Hand</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.random}
                    onChange={e => onChange({ ...params, random: e.target.checked })}
                />
                Random (if unchecked, you choose)
            </label>

        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateTakeText = (params: TakeEffectParams): string => {
    const cardWord = params.count === 1 ? 'card' : 'cards';
    const randomText = params.random ? 'random ' : '';

    return `Take ${params.count} ${randomText}${cardWord} from opponent's hand.`;
};
