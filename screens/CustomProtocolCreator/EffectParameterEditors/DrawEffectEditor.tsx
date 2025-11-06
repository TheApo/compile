/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DrawEffectParams } from '../../../types/customProtocol';

interface DrawEffectEditorProps {
    params: DrawEffectParams;
    onChange: (params: DrawEffectParams) => void;
}

export const DrawEffectEditor: React.FC<DrawEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor draw-effect-editor">
            <h4>Draw Effect Parameters</h4>

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
                Target
                <select value={params.target} onChange={e => onChange({ ...params, target: e.target.value as any })}>
                    <option value="self">Self</option>
                    <option value="opponent">Opponent</option>
                </select>
            </label>

            <label>
                Source
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="own_deck">Own Deck</option>
                    <option value="opponent_deck">Opponent's Deck</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.preAction === 'refresh'}
                    onChange={e => onChange({ ...params, preAction: e.target.checked ? 'refresh' : undefined })}
                />
                Refresh hand first (shuffle hand into deck, then draw)
            </label>

            <label>
                Conditional
                <select
                    value={params.conditional?.type || 'none'}
                    onChange={e => {
                        if (e.target.value === 'none') {
                            const { conditional, ...rest } = params;
                            onChange(rest as DrawEffectParams);
                        } else {
                            onChange({ ...params, conditional: { type: e.target.value as any } });
                        }
                    }}
                >
                    <option value="none">None</option>
                    <option value="count_face_down">1 per face-down card (all on board)</option>
                    <option value="is_covering">Only if this card is covering another</option>
                    <option value="non_matching_protocols">1 per line with non-matching protocol</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {generateDrawText(params)}
            </div>
        </div>
    );
};

const generateDrawText = (params: DrawEffectParams): string => {
    if (params.conditional) {
        switch (params.conditional.type) {
            case 'count_face_down':
                return 'Draw 1 card for each face-down card.';
            case 'is_covering':
                return `Draw ${params.count} card${params.count !== 1 ? 's' : ''} if this card is covering another.`;
            case 'non_matching_protocols':
                return 'Draw 1 card for each line with a non-matching protocol.';
        }
    }

    let text = '';
    if (params.preAction === 'refresh') {
        text = 'Refresh your hand. ';
    }

    if (params.source === 'opponent_deck') {
        text += `Draw ${params.count} card${params.count !== 1 ? 's' : ''} from opponent's deck.`;
    } else if (params.target === 'opponent') {
        text += `Opponent draws ${params.count} card${params.count !== 1 ? 's' : ''}.`;
    } else {
        text += `Draw ${params.count} card${params.count !== 1 ? 's' : ''}.`;
    }

    return text;
};
