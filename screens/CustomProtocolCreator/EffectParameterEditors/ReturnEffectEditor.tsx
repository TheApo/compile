/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ReturnEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection, TargetFilterRow, AdvancedConditionalSection } from './shared';

export const ReturnEffectEditor: React.FC<{ params: ReturnEffectParams; onChange: (params: ReturnEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const owner = params.targetFilter?.owner || 'any';
    const position = params.targetFilter?.position || 'uncovered';
    const faceState = params.targetFilter?.faceState || 'any';
    const valueEquals = params.targetFilter?.valueEquals;
    const selectLane = (params as any).selectLane || false;
    const destination = params.destination || 'owner_hand';

    // Check if target filter has non-default values
    const hasTargetFilterConfig = owner !== 'any' || position !== 'uncovered' || faceState !== 'any' || valueEquals !== undefined;
    const hasAdvancedConfig = params.returnSelf || selectLane;

    const handleTargetFilterChange = (newFilter: any) => {
        onChange({ ...params, targetFilter: { ...params.targetFilter, ...newFilter } });
    };

    return (
        <div className="param-editor return-effect-editor">
            <h4>Return Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Count
                    <select
                        value={typeof params.count === 'number' ? params.count.toString() : 'all'}
                        onChange={e => onChange({ ...params, count: e.target.value === 'all' ? 'all' : parseInt(e.target.value) })}
                    >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="all">All</option>
                    </select>
                </label>

                {owner === 'opponent' && (
                    <label>
                        Destination
                        <select
                            value={destination}
                            onChange={e => onChange({ ...params, destination: e.target.value as 'owner_hand' | 'actor_hand' })}
                        >
                            <option value="owner_hand">Owner's hand</option>
                            <option value="actor_hand">Your hand (steal)</option>
                        </select>
                    </label>
                )}
            </div>

            {/* Target Filter Section */}
            <CollapsibleSection title="Target Filter" forceOpen={hasTargetFilterConfig}>
                <div className="filter-row">
                    <TargetFilterRow
                        filter={params.targetFilter || {}}
                        onChange={handleTargetFilterChange}
                        showOwner={true}
                        showPosition={true}
                        showFaceState={true}
                    />
                </div>

                <div className="filter-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={valueEquals !== undefined}
                            onChange={e => {
                                if (e.target.checked) {
                                    onChange({
                                        ...params,
                                        targetFilter: { ...params.targetFilter, valueEquals: 2 }
                                    });
                                } else {
                                    const { valueEquals, ...rest } = params.targetFilter || {};
                                    onChange({ ...params, targetFilter: rest });
                                }
                            }}
                        />
                        Filter by value
                    </label>

                    {valueEquals !== undefined && (
                        <label>
                            Value
                            <select
                                value={valueEquals}
                                onChange={e => onChange({
                                    ...params,
                                    targetFilter: { ...params.targetFilter, valueEquals: parseInt(e.target.value) }
                                })}
                            >
                                {[0, 1, 2, 3, 4, 5, 6].map(v => (
                                    <option key={v} value={v}>{v}</option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
            </CollapsibleSection>

            {/* Advanced Options Section */}
            <CollapsibleSection title="Advanced Options" forceOpen={hasAdvancedConfig}>
                <div className="filter-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={selectLane}
                            onChange={e => {
                                if (e.target.checked) {
                                    onChange({ ...params, selectLane: true } as any);
                                } else {
                                    const { selectLane, ...rest } = params as any;
                                    onChange(rest);
                                }
                            }}
                        />
                        Select lane first
                        <small className="hint-text">Water-3: "in 1 line"</small>
                    </label>

                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={params.returnSelf || false}
                            onChange={e => {
                                if (e.target.checked) {
                                    onChange({ ...params, returnSelf: true });
                                } else {
                                    const { returnSelf, optional, ...rest } = params;
                                    onChange(rest as ReturnEffectParams);
                                }
                            }}
                        />
                        Return this card
                    </label>

                    {params.returnSelf && (
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={params.optional || false}
                                onChange={e => onChange({ ...params, optional: e.target.checked })}
                            />
                            Optional
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
                        onChange(rest as ReturnEffectParams);
                    }
                }}
                availableTypes={['none', 'empty_hand', 'opponent_higher_value_in_lane', 'this_card_is_covered']}
            />
        </div>
    );
};
