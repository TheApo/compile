/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FlipEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection, TargetFilterRow } from './shared';

interface FlipEffectEditorProps {
    params: FlipEffectParams;
    onChange: (params: FlipEffectParams) => void;
}

export const FlipEffectEditor: React.FC<FlipEffectEditorProps> = ({ params, onChange }) => {
    const targetFilter = params.targetFilter || { owner: 'any', position: 'uncovered', faceState: 'any', excludeSelf: false };
    const count = params.count ?? 1;

    // Check for non-default configurations
    const hasTargetFilterConfig = targetFilter.owner !== 'any' || targetFilter.position !== 'uncovered' ||
                                   targetFilter.faceState !== 'any' || targetFilter.excludeSelf ||
                                   targetFilter.valueMinGreaterThanHandSize || targetFilter.valueLessThanUniqueProtocolsOnField;
    const hasAdvancedOptions = params.flipSelf || params.selfFlipAfter || params.skipMiddleCommand || params.sameLaneAsFirst;
    const hasConditional = !!params.advancedConditional?.type;
    const hasScopeConfig = (typeof count === 'number' && params.scope && params.scope !== 'any') ||
                           (count === 'each' && (params as any).eachLineScope);

    return (
        <div className="param-editor flip-effect-editor">
            <h4>Flip Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Count
                    <select
                        value={count === 'all' ? 'all' : count === 'each' ? 'each' : count.toString()}
                        onChange={e => {
                            const val = e.target.value;
                            if (val === 'all') onChange({ ...params, count: 'all' as any });
                            else if (val === 'each') onChange({ ...params, count: 'each' as any });
                            else onChange({ ...params, count: parseInt(val) });
                        }}
                    >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="all">All</option>
                        <option value="each">Each</option>
                    </select>
                </label>

                {typeof count === 'number' && (
                    <label>
                        Scope
                        <select
                            value={params.scope || 'any'}
                            onChange={e => onChange({ ...params, scope: e.target.value as any })}
                        >
                            <option value="any">Any lane</option>
                            <option value="this_lane">This lane only</option>
                            <option value="each_lane">Each lane</option>
                        </select>
                    </label>
                )}

                {count === 'each' && (
                    <label>
                        Each Scope
                        <select
                            value={(params as any).eachLineScope || 'all_lines'}
                            onChange={e => onChange({ ...params, eachLineScope: e.target.value as any })}
                        >
                            <option value="all_lines">Each on board</option>
                            <option value="each_line">1 per lane</option>
                        </select>
                    </label>
                )}

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.optional}
                        onChange={e => onChange({ ...params, optional: e.target.checked })}
                    />
                    Optional
                </label>
            </div>

            {/* Target Filter Section */}
            <CollapsibleSection title="Target Filter" forceOpen={hasTargetFilterConfig}>
                <TargetFilterRow
                    filter={targetFilter}
                    onChange={newFilter => onChange({ ...params, targetFilter: { ...targetFilter, ...newFilter } })}
                    showOwner={true}
                    showPosition={true}
                    showFaceState={true}
                    showExcludeSelf={true}
                    positionOptions={[
                        { value: 'any', label: 'Any' },
                        { value: 'uncovered', label: 'Uncovered' },
                        { value: 'covered', label: 'Covered' },
                        { value: 'covered_in_this_line', label: 'Covered in this line' }
                    ]}
                />

                <div className="filter-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={targetFilter.valueMinGreaterThanHandSize || false}
                            onChange={e => onChange({ ...params, targetFilter: { ...targetFilter, valueMinGreaterThanHandSize: e.target.checked } })}
                        />
                        Value &gt; hand size
                    </label>

                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={targetFilter.valueLessThanUniqueProtocolsOnField || false}
                            onChange={e => onChange({ ...params, targetFilter: { ...targetFilter, valueLessThanUniqueProtocolsOnField: e.target.checked } })}
                        />
                        Value &lt; protocol count
                    </label>
                </div>
            </CollapsibleSection>

            {/* Advanced Options Section */}
            <CollapsibleSection title="Advanced Options" forceOpen={hasAdvancedOptions}>
                <div className="filter-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={params.flipSelf || false}
                            onChange={e => onChange({ ...params, flipSelf: e.target.checked })}
                        />
                        Flip ONLY this card
                    </label>

                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={params.selfFlipAfter || false}
                            onChange={e => onChange({ ...params, selfFlipAfter: e.target.checked })}
                        />
                        Also flip this card after
                    </label>
                </div>

                <div className="filter-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={params.skipMiddleCommand || false}
                            onChange={e => onChange({ ...params, skipMiddleCommand: e.target.checked })}
                        />
                        Skip middle command
                    </label>

                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={params.sameLaneAsFirst || false}
                            onChange={e => onChange({ ...params, sameLaneAsFirst: e.target.checked })}
                        />
                        Same lane as first flip
                    </label>
                </div>
            </CollapsibleSection>

            {/* Conditionals Section */}
            <CollapsibleSection title="Conditionals" forceOpen={hasConditional}>
                <div className="filter-row">
                    <label>
                        Condition
                        <select
                            value={params.advancedConditional?.type || ''}
                            onChange={e => {
                                if (e.target.value === '') {
                                    const { advancedConditional, ...rest } = params;
                                    onChange(rest as FlipEffectParams);
                                } else if (e.target.value === 'protocol_match') {
                                    onChange({ ...params, advancedConditional: { type: 'protocol_match', protocol: '' } });
                                } else if (e.target.value === 'hand_size_greater_than') {
                                    onChange({ ...params, advancedConditional: { type: 'hand_size_greater_than', threshold: 1 } });
                                } else {
                                    onChange({ ...params, advancedConditional: { type: e.target.value as any } });
                                }
                            }}
                        >
                            <option value="">None</option>
                            <option value="protocol_match">In specific protocol lane</option>
                            <option value="opponent_higher_value_in_lane">Opponent higher value</option>
                            <option value="hand_size_greater_than">Hand size greater than</option>
                            <option value="same_protocol_on_field">Same protocol on field (Unity)</option>
                            <option value="this_card_is_covered">This card is covered</option>
                        </select>
                    </label>

                    {params.advancedConditional?.type === 'protocol_match' && (
                        <label>
                            Protocol
                            <input
                                type="text"
                                value={params.advancedConditional.protocol || ''}
                                onChange={e => onChange({
                                    ...params,
                                    advancedConditional: { ...params.advancedConditional!, protocol: e.target.value }
                                })}
                                placeholder="e.g., Fire"
                            />
                        </label>
                    )}

                    {params.advancedConditional?.type === 'hand_size_greater_than' && (
                        <label>
                            Threshold
                            <input
                                type="number"
                                min="0"
                                max="10"
                                value={params.advancedConditional.threshold ?? 1}
                                onChange={e => onChange({
                                    ...params,
                                    advancedConditional: { ...params.advancedConditional!, threshold: parseInt(e.target.value) || 0 }
                                })}
                            />
                        </label>
                    )}
                </div>
            </CollapsibleSection>
        </div>
    );
};
