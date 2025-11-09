/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayEffectParams } from '../../../types/customProtocol';

export const PlayEffectEditor: React.FC<{ params: PlayEffectParams; onChange: (params: PlayEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Play Effect</h4>
            <label>
                Actor (who plays)
                <select
                    value={(params as any).actor || 'self'}
                    onChange={e => {
                        if (e.target.value === 'self') {
                            const { actor, ...rest } = params as any;
                            onChange(rest);
                        } else {
                            onChange({ ...params, actor: e.target.value as any });
                        }
                    }}
                >
                    <option value="self">You</option>
                    <option value="opponent">Opponent</option>
                </select>
            </label>
            <label>
                Source
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="hand">Hand</option>
                    <option value="deck">Deck</option>
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
                <input
                    type="checkbox"
                    checked={params.faceDown}
                    onChange={e => onChange({ ...params, faceDown: e.target.checked })}
                />
                Face-down
            </label>
            <label>
                Destination
                <select
                    value={params.destinationRule.type}
                    onChange={e => onChange({ ...params, destinationRule: { ...params.destinationRule, type: e.target.value as any } })}
                >
                    <option value="other_lines">Other lines (choose 1)</option>
                    <option value="each_other_line">Each other line (1 per line)</option>
                    <option value="specific_lane">Specific lane (this line)</option>
                    <option value="each_line_with_card">Each line with card</option>
                    <option value="under_this_card">Under this card</option>
                </select>
            </label>

            <label>
                Condition
                <select
                    value={params.condition?.type || 'none'}
                    onChange={e => {
                        const val = e.target.value;
                        if (val === 'none') {
                            const { condition, ...rest } = params;
                            onChange(rest as PlayEffectParams);
                        } else if (val === 'per_x_cards_in_line') {
                            onChange({ ...params, condition: { type: val, cardCount: 2 } });
                        } else {
                            onChange({ ...params, condition: { type: val as any } });
                        }
                    }}
                >
                    <option value="none">None (always play)</option>
                    <option value="per_x_cards_in_line">For every X cards in this line</option>
                    <option value="only_in_lines_with_cards">Only in lines where you have a card</option>
                </select>
            </label>

            {params.condition?.type === 'per_x_cards_in_line' && (
                <label>
                    Cards per play (X)
                    <input
                        type="number"
                        min={1}
                        max={6}
                        value={params.condition.cardCount || 2}
                        onChange={e => onChange({
                            ...params,
                            condition: { ...params.condition!, cardCount: parseInt(e.target.value) || 2 }
                        })}
                    />
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Gravity-0: "For every 2 cards in this line, play..." → X = 2
                    </small>
                </label>
            )}

            <div className="effect-preview">
                <strong>Preview:</strong> {generatePlayText(params)}
            </div>
        </div>
    );
};

const generatePlayText = (params: PlayEffectParams): string => {
    const actor = (params as any).actor;
    const cardWord = params.count === 1 ? 'card' : 'cards';
    const faceState = params.faceDown ? 'face-down' : 'face-up';

    let actorText = '';
    let source = '';
    if (actor === 'opponent') {
        actorText = 'Opponent plays';
        source = params.source === 'deck' ? 'from their deck' : 'from their hand';
    } else {
        actorText = 'Play';
        source = params.source === 'deck' ? 'from your deck' : 'from your hand';
    }

    let text = '';

    // Add condition prefix
    if (params.condition?.type === 'per_x_cards_in_line') {
        const x = params.condition.cardCount || 2;
        text = `For every ${x} cards in this line, `;
        text += `${actorText.toLowerCase()} ${params.count} ${cardWord} ${faceState} ${source}`;
    } else if (params.condition?.type === 'only_in_lines_with_cards') {
        text = `${actorText} ${params.count} ${cardWord} ${faceState} ${source}`;
        text += ' only in lines where you have a card';
        return text + '.';
    } else {
        text = `${actorText} ${params.count} ${cardWord} ${faceState} ${source}`;
    }

    if (params.destinationRule.type === 'other_lines') {
        text += ' to other lines';
    } else if (params.destinationRule.type === 'each_other_line') {
        text += ' in each other line';
    } else if (params.destinationRule.type === 'under_this_card') {
        text += ' under this card';
    } else if (params.destinationRule.type === 'each_line_with_card') {
        text += ' to each line with a card';
    } else if (params.destinationRule.type === 'specific_lane') {
        text += ' in this line';
    }

    return text + '.';
};
