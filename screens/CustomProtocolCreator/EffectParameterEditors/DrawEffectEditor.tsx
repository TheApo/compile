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
                Anzahl Karten
                <input
                    type="number"
                    min={1}
                    max={6}
                    value={params.count}
                    onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                />
            </label>

            <label>
                Ziel
                <select value={params.target} onChange={e => onChange({ ...params, target: e.target.value as any })}>
                    <option value="self">Selbst</option>
                    <option value="opponent">Gegner</option>
                </select>
            </label>

            <label>
                Quelle
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="own_deck">Eigenes Deck</option>
                    <option value="opponent_deck">Gegner Deck</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.preAction === 'refresh'}
                    onChange={e => onChange({ ...params, preAction: e.target.checked ? 'refresh' : undefined })}
                />
                Refresh hand vorher (Hand zurück ins Deck, mischen, neu ziehen)
            </label>

            <label>
                Konditional
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
                    <option value="none">Keine</option>
                    <option value="count_face_down">1 pro face-down Karte (alle auf dem Board)</option>
                    <option value="is_covering">Nur wenn diese Karte eine andere bedeckt</option>
                    <option value="non_matching_protocols">1 pro Line mit non-matching Protokoll</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Vorschau:</strong> {generateDrawText(params)}
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
