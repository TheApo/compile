/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

export const PlayEffectEditor: React.FC<{ params: PlayEffectParams; onChange: (params: PlayEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    // Ensure destinationRule exists with default value
    const destinationRule = params.destinationRule || { type: 'other_lines' };

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
                    <option value="trash">Trash (Discard Pile)</option>
                </select>
            </label>

            {/* Source owner - only for deck/trash source (Assimilation-2: opponent's deck) */}
            {(params.source === 'deck' || params.source === 'trash') && (
                <label>
                    Source Owner
                    <select
                        value={params.sourceOwner || 'own'}
                        onChange={e => onChange({ ...params, sourceOwner: e.target.value as 'own' | 'opponent' })}
                    >
                        <option value="own">Own {params.source}</option>
                        <option value="opponent">Opponent's {params.source}</option>
                    </select>
                    {params.sourceOwner === 'opponent' && (
                        <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                            Card is taken from opponent's {params.source} instead of your own.
                        </small>
                    )}
                </label>
            )}
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
                    value={destinationRule.type}
                    onChange={e => onChange({ ...params, destinationRule: { ...destinationRule, type: e.target.value as any } })}
                >
                    <option value="other_lines">Other lines (choose 1)</option>
                    <option value="each_other_line">Each other line (1 per line)</option>
                    <option value="specific_lane">Specific lane (this line)</option>
                    <option value="each_line_with_card">Each line with card</option>
                    <option value="line_with_matching_cards">Line with matching cards (choose 1)</option>
                    <option value="under_this_card">Under this card</option>
                </select>
            </label>

            {/* Card Filter for each_line_with_card and line_with_matching_cards */}
            {(destinationRule.type === 'each_line_with_card' || destinationRule.type === 'line_with_matching_cards') && (
                <label>
                    Card Filter (which cards must be in line)
                    <select
                        value={destinationRule.cardFilter?.faceState || 'any'}
                        onChange={e => {
                            const val = e.target.value;
                            if (val === 'any') {
                                const { cardFilter, ...rest } = destinationRule;
                                onChange({ ...params, destinationRule: rest });
                            } else {
                                onChange({ ...params, destinationRule: { ...destinationRule, cardFilter: { faceState: val as any } } });
                            }
                        }}
                    >
                        <option value="any">Any card</option>
                        <option value="face_down">Face-down cards only</option>
                        <option value="face_up">Face-up cards only</option>
                    </select>
                </label>
            )}

            {/* Target board - for Assimilation-6: play on opponent's board */}
            <label>
                Target Board
                <select
                    value={params.targetBoard || 'own'}
                    onChange={e => onChange({ ...params, targetBoard: e.target.value as 'own' | 'opponent' })}
                >
                    <option value="own">Own board (default)</option>
                    <option value="opponent">Opponent's board</option>
                </select>
                {params.targetBoard === 'opponent' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Card is played on opponent's board instead of your own.
                    </small>
                )}
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
                        Example: "For every 2 cards in this line, play..." → X = 2
                    </small>
                </label>
            )}

            <h5>Advanced Conditional</h5>

            <label>
                Conditional Type
                <select
                    value={params.advancedConditional?.type || 'none'}
                    onChange={e => {
                        if (e.target.value === 'none') {
                            const { advancedConditional, ...rest } = params;
                            onChange(rest as PlayEffectParams);
                        } else {
                            onChange({ ...params, advancedConditional: { type: e.target.value as any } });
                        }
                    }}
                >
                    <option value="none">None</option>
                    <option value="empty_hand">Only if hand is empty</option>
                    <option value="opponent_higher_value_in_lane">Only if opponent has higher value in this lane</option>
                </select>
            </label>

        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generatePlayText = (params: PlayEffectParams): string => {
    const actor = (params as any).actor;
    const cardWord = params.count === 1 ? 'card' : 'cards';
    const faceState = params.faceDown ? 'face-down' : 'face-up';
    const destinationRule = params.destinationRule || { type: 'other_lines' };

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

    if (destinationRule.type === 'other_lines') {
        text += ' to other lines';
    } else if (destinationRule.type === 'each_other_line') {
        text += ' in each other line';
    } else if (destinationRule.type === 'under_this_card') {
        text += ' under this card';
    } else if (destinationRule.type === 'each_line_with_card') {
        text += ' to each line with a card';
    } else if (destinationRule.type === 'specific_lane') {
        text += ' in this line';
    }

    return text + '.';
};
