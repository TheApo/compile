/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FlipEffectParams } from '../../../types/customProtocol';

interface FlipEffectEditorProps {
    params: FlipEffectParams;
    onChange: (params: FlipEffectParams) => void;
}

export const FlipEffectEditor: React.FC<FlipEffectEditorProps> = ({ params, onChange }) => {
    return (
        <div className="param-editor flip-effect-editor">
            <h4>Flip Effect Parameters</h4>

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
                <input
                    type="checkbox"
                    checked={params.optional}
                    onChange={e => onChange({ ...params, optional: e.target.checked })}
                />
                Optional ("May flip" statt "Flip")
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.selfFlipAfter || false}
                    onChange={e => onChange({ ...params, selfFlipAfter: e.target.checked })}
                />
                Danach diese Karte flippen
            </label>

            <h5>Target Filter</h5>

            <label>
                Owner
                <select
                    value={params.targetFilter.owner}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, owner: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="own">Eigene</option>
                    <option value="opponent">Gegner</option>
                </select>
            </label>

            <label>
                Position
                <select
                    value={params.targetFilter.position}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, position: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="uncovered">Uncovered (top card)</option>
                    <option value="covered">Covered</option>
                    <option value="covered_in_this_line">Covered in this line</option>
                </select>
            </label>

            <label>
                Face State
                <select
                    value={params.targetFilter.faceState}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, faceState: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="face_up">Face-up</option>
                    <option value="face_down">Face-down</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.targetFilter.excludeSelf}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, excludeSelf: e.target.checked } })
                    }
                />
                Exclude self ("other cards")
            </label>

            <div className="effect-preview">
                <strong>Vorschau:</strong> {generateFlipText(params)}
            </div>
        </div>
    );
};

const generateFlipText = (params: FlipEffectParams): string => {
    const may = params.optional ? 'May flip' : 'Flip';
    let targetDesc = '';

    if (params.targetFilter.owner === 'opponent') targetDesc = "opponent's ";
    if (params.targetFilter.position === 'covered') targetDesc += 'covered ';
    if (params.targetFilter.position === 'uncovered') targetDesc += 'uncovered ';
    if (params.targetFilter.faceState === 'face_down') targetDesc += 'face-down ';
    if (params.targetFilter.faceState === 'face_up') targetDesc += 'face-up ';
    if (params.targetFilter.excludeSelf) targetDesc += 'other ';

    const cardWord = params.count === 1 ? 'card' : 'cards';
    let text = `${may} ${params.count} ${targetDesc}${cardWord}.`;

    if (params.selfFlipAfter) {
        text += ' Then flip this card.';
    }

    return text;
};
