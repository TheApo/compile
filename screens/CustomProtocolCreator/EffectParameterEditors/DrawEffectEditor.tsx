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
                Count Type
                <select
                    value={params.countType || 'fixed'}
                    onChange={e => {
                        const countType = e.target.value as any;
                        onChange({
                            ...params,
                            countType,
                            countOffset: countType === 'equal_to_discarded' ? 0 : undefined
                        });
                    }}
                >
                    <option value="fixed">Fixed Amount</option>
                    <option value="equal_to_card_value">Equal to Card Value (from previous effect)</option>
                    <option value="equal_to_discarded">Equal to Discarded Cards</option>
                    <option value="hand_size">Equal to Hand Size</option>
                </select>
            </label>

            {(!params.countType || params.countType === 'fixed') && (
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
            )}

            {params.countType === 'equal_to_discarded' && (
                <label>
                    Offset (+/-)
                    <input
                        type="number"
                        min={-5}
                        max={5}
                        value={params.countOffset || 0}
                        onChange={e => onChange({ ...params, countOffset: parseInt(e.target.value) || 0 })}
                    />
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Example: +1 for "discard count plus 1" (Fire-4)
                    </small>
                </label>
            )}

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

            <label>
                Advanced Conditional
                <select
                    value={params.advancedConditional?.type || 'none'}
                    onChange={e => {
                        if (e.target.value === 'none') {
                            const { advancedConditional, ...rest } = params;
                            onChange(rest as DrawEffectParams);
                        } else if (e.target.value === 'protocol_match') {
                            onChange({ ...params, advancedConditional: { type: 'protocol_match', protocol: '' } });
                        } else if (e.target.value === 'compile_block') {
                            onChange({ ...params, advancedConditional: { type: 'compile_block', turnDuration: 1 } });
                        }
                    }}
                >
                    <option value="none">None</option>
                    <option value="protocol_match">Only if in line with matching protocol (Anarchy-6)</option>
                    <option value="compile_block">Block opponent's compile next turn (Metal-1)</option>
                </select>
            </label>

            {params.advancedConditional?.type === 'protocol_match' && (
                <label>
                    Required Protocol
                    <input
                        type="text"
                        placeholder="e.g., Fire, Water, Lightning"
                        value={params.advancedConditional.protocol || ''}
                        onChange={e => onChange({
                            ...params,
                            advancedConditional: { ...params.advancedConditional, type: 'protocol_match', protocol: e.target.value }
                        })}
                    />
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Only draw if this card is in a line with this protocol
                    </small>
                </label>
            )}

            {params.advancedConditional?.type === 'compile_block' && (
                <label>
                    Block Duration (turns)
                    <input
                        type="number"
                        min={1}
                        max={3}
                        value={params.advancedConditional.turnDuration || 1}
                        onChange={e => onChange({
                            ...params,
                            advancedConditional: { ...params.advancedConditional, type: 'compile_block', turnDuration: parseInt(e.target.value) || 1 }
                        })}
                    />
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Opponent can't compile for this many turns
                    </small>
                </label>
            )}

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

    // Handle dynamic draw counts
    const countType = params.countType || 'fixed';
    let countText = '';

    switch (countType) {
        case 'equal_to_card_value':
            countText = 'cards equal to that card\'s value';
            break;
        case 'equal_to_discarded':
            const offset = params.countOffset || 0;
            if (offset > 0) {
                countText = `the amount discarded plus ${offset}`;
            } else if (offset < 0) {
                countText = `the amount discarded minus ${Math.abs(offset)}`;
            } else {
                countText = 'the same amount of cards';
            }
            break;
        case 'hand_size':
            countText = 'the same amount of cards';
            break;
        default: // 'fixed'
            countText = `${params.count} card${params.count !== 1 ? 's' : ''}`;
            break;
    }

    if (params.source === 'opponent_deck') {
        text += `Draw ${countText} from opponent's deck.`;
    } else if (params.target === 'opponent') {
        text += `Opponent draws ${countText}.`;
    } else {
        text += `Draw ${countText}.`;
    }

    // Add advanced conditional text
    if (params.advancedConditional) {
        switch (params.advancedConditional.type) {
            case 'protocol_match':
                const protocol = params.advancedConditional.protocol || '[Protocol]';
                text += ` Only if in ${protocol} line.`;
                break;
            case 'compile_block':
                const duration = params.advancedConditional.turnDuration || 1;
                const turnText = duration === 1 ? 'turn' : 'turns';
                text += ` Opponent can't compile for ${duration} ${turnText}.`;
                break;
        }
    }

    return text;
};
