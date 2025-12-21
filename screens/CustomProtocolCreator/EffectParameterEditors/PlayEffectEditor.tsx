/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection, AdvancedConditionalSection } from './shared';

export const PlayEffectEditor: React.FC<{ params: PlayEffectParams; onChange: (params: PlayEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const destinationRule = params.destinationRule || { type: 'other_lines' };
    const hasDestinationConfig = destinationRule.type !== 'other_lines' || destinationRule.cardFilter;
    const hasCondition = params.condition?.type && params.condition.type !== 'none';
    const hasAdvancedConfig = params.sourceOwner === 'opponent' || params.targetBoard === 'opponent';

    return (
        <div className="param-editor play-effect-editor">
            <h4>Play Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Actor
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
                        <option value="trash">Trash</option>
                    </select>
                </label>

                <label>
                    Count
                    <select
                        value={params.count}
                        onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                    >
                        {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>

                <label>
                    Orientation
                    <select
                        value={params.faceDown === undefined ? 'choice' : params.faceDown ? 'down' : 'up'}
                        onChange={e => {
                            const val = e.target.value;
                            if (val === 'choice') {
                                const { faceDown, ...rest } = params;
                                onChange(rest as PlayEffectParams);
                            } else {
                                onChange({ ...params, faceDown: val === 'down' });
                            }
                        }}
                    >
                        <option value="up">Face-up</option>
                        <option value="down">Face-down</option>
                        <option value="choice">Player Chooses</option>
                    </select>
                </label>
            </div>

            {/* Destination Section */}
            <CollapsibleSection title="Destination" forceOpen={hasDestinationConfig}>
                <div className="filter-row">
                    <label>
                        Destination Rule
                        <select
                            value={destinationRule.type}
                            onChange={e => onChange({ ...params, destinationRule: { ...destinationRule, type: e.target.value as any } })}
                        >
                            <option value="other_lines">Other lines</option>
                            <option value="each_other_line">Each other line</option>
                            <option value="specific_lane">This lane</option>
                            <option value="each_line_with_card">Each line with card</option>
                            <option value="line_with_matching_cards">Line with matching cards</option>
                            <option value="under_this_card">Under this card</option>
                        </select>
                    </label>

                    {(destinationRule.type === 'each_line_with_card' || destinationRule.type === 'line_with_matching_cards') && (
                        <label>
                            Card Filter
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
                                <option value="face_down">Face-down only</option>
                                <option value="face_up">Face-up only</option>
                            </select>
                        </label>
                    )}
                </div>
            </CollapsibleSection>

            {/* Advanced Options Section */}
            <CollapsibleSection title="Advanced Options" forceOpen={hasAdvancedConfig}>
                <div className="filter-row">
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
                        </label>
                    )}

                    <label>
                        Target Board
                        <select
                            value={params.targetBoard || 'own'}
                            onChange={e => onChange({ ...params, targetBoard: e.target.value as 'own' | 'opponent' })}
                        >
                            <option value="own">Own board</option>
                            <option value="opponent">Opponent's board</option>
                        </select>
                    </label>
                </div>
            </CollapsibleSection>

            {/* Condition Section */}
            <CollapsibleSection title="Condition" forceOpen={hasCondition}>
                <div className="filter-row">
                    <label>
                        Play Condition
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
                            <option value="none">None</option>
                            <option value="per_x_cards_in_line">For every X cards</option>
                            <option value="only_in_lines_with_cards">Only in lines with cards</option>
                        </select>
                    </label>

                    {params.condition?.type === 'per_x_cards_in_line' && (
                        <label>
                            Cards per Play
                            <select
                                value={params.condition.cardCount || 2}
                                onChange={e => onChange({
                                    ...params,
                                    condition: { ...params.condition!, cardCount: parseInt(e.target.value) || 2 }
                                })}
                            >
                                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </label>
                    )}
                </div>
            </CollapsibleSection>

            {/* Conditionals Section */}
            <AdvancedConditionalSection
                conditional={params.advancedConditional}
                onChange={cond => {
                    if (cond) {
                        onChange({ ...params, advancedConditional: cond });
                    } else {
                        const { advancedConditional, ...rest } = params;
                        onChange(rest as PlayEffectParams);
                    }
                }}
                availableTypes={['none', 'empty_hand', 'opponent_higher_value_in_lane']}
            />
        </div>
    );
};
