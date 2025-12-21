/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShiftEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection, TargetFilterRow, AdvancedConditionalSection } from './shared';

export const ShiftEffectEditor: React.FC<{ params: ShiftEffectParams; onChange: (params: ShiftEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const targetFilter = params.targetFilter || { owner: 'any', position: 'uncovered', faceState: 'any' };
    const hasTargetFilterConfig = targetFilter.owner !== 'any' || targetFilter.position !== 'uncovered' ||
                                   targetFilter.faceState !== 'any' || targetFilter.excludeSelf;
    const hasScopeConfig = params.destinationRestriction?.type !== 'any' && params.destinationRestriction?.type ||
                           params.scope && params.scope !== 'any';

    return (
        <div className="param-editor shift-effect-editor">
            <h4>Shift Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Count
                    <select
                        value={(params as any).count === 'all' ? 'all' : '1'}
                        onChange={e => {
                            if (e.target.value === 'all') {
                                onChange({ ...params, count: 'all' as any });
                            } else {
                                const { count, ...rest } = params as any;
                                onChange(rest);
                            }
                        }}
                    >
                        <option value="1">1 card</option>
                        <option value="all">All matching</option>
                    </select>
                </label>

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.optional || false}
                        onChange={e => onChange({ ...params, optional: e.target.checked })}
                    />
                    Optional
                </label>

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.shiftSelf || false}
                        onChange={e => onChange({ ...params, shiftSelf: e.target.checked })}
                    />
                    Shift this card
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
                />
            </CollapsibleSection>

            {/* Scope & Destination Section */}
            <CollapsibleSection title="Scope & Destination" forceOpen={hasScopeConfig}>
                <div className="filter-row">
                    <label>
                        Source Scope
                        <select
                            value={params.scope || 'any'}
                            onChange={e => {
                                if (e.target.value === 'any') {
                                    const { scope, ...rest } = params;
                                    onChange(rest as ShiftEffectParams);
                                } else {
                                    onChange({ ...params, scope: e.target.value as any });
                                }
                            }}
                        >
                            <option value="any">Any lane</option>
                            <option value="this_lane">This lane only</option>
                            <option value="each_lane">Each lane</option>
                        </select>
                    </label>

                    <label>
                        Destination
                        <select
                            value={params.destinationRestriction?.type || 'any'}
                            onChange={e => {
                                if (e.target.value === 'any') {
                                    const { destinationRestriction, ...rest } = params;
                                    onChange(rest as ShiftEffectParams);
                                } else {
                                    onChange({ ...params, destinationRestriction: { type: e.target.value as any } });
                                }
                            }}
                        >
                            <option value="any">Any lane</option>
                            <option value="to_another_line">To another lane</option>
                            <option value="non_matching_protocol">Non-matching protocol</option>
                            <option value="specific_lane">This lane (within)</option>
                            <option value="to_this_lane">To THIS lane only</option>
                            <option value="to_or_from_this_lane">To OR from this lane</option>
                            <option value="opponent_highest_value_lane">Opponent's highest value lane</option>
                        </select>
                    </label>
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
                        onChange(rest as ShiftEffectParams);
                    }
                }}
                availableTypes={['none', 'empty_hand', 'opponent_higher_value_in_lane', 'this_card_is_covered']}
            />
        </div>
    );
};
