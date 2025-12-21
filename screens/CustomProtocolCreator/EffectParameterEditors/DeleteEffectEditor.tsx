/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DeleteEffectParams } from '../../../types/customProtocol';
import { CollapsibleSection, TargetFilterRow, AdvancedConditionalSection } from './shared';

interface DeleteEffectEditorProps {
    params: DeleteEffectParams;
    onChange: (params: DeleteEffectParams) => void;
}

export const DeleteEffectEditor: React.FC<DeleteEffectEditorProps> = ({ params, onChange }) => {
    const targetFilter = params.targetFilter || { position: 'uncovered', faceState: 'any' };

    // Check for non-default configurations
    const hasTargetFilterConfig = targetFilter.position !== 'uncovered' || targetFilter.faceState !== 'any' ||
                                   targetFilter.owner || targetFilter.calculation || targetFilter.valueRange || targetFilter.valueSource;
    const hasScopeConfig = params.scope?.type && params.scope.type !== 'any';
    const hasLaneConfig = params.laneCondition?.type || params.selectLane;
    const hasDeleteSelf = params.deleteSelf;

    return (
        <div className="param-editor delete-effect-editor">
            <h4>Delete Effect</h4>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Count
                    <select
                        value={typeof params.count === 'number' ? params.count.toString() : 'all'}
                        onChange={e => onChange({ ...params, count: e.target.value === 'all' ? 'all_in_lane' : parseInt(e.target.value) })}
                    >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="all">All in lane</option>
                    </select>
                </label>

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.excludeSelf}
                        onChange={e => onChange({ ...params, excludeSelf: e.target.checked })}
                    />
                    Exclude self
                </label>

                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={params.deleteSelf || false}
                        onChange={e => onChange({ ...params, deleteSelf: e.target.checked })}
                    />
                    Delete this card
                </label>
            </div>

            {/* Delete Self Condition */}
            {hasDeleteSelf && (
                <CollapsibleSection title="Delete Self Condition" forceOpen={!!(params as any).protocolCountConditional}>
                    <label>
                        Protocol Count
                        <select
                            value={(params as any).protocolCountConditional?.threshold || 'none'}
                            onChange={e => {
                                const val = e.target.value;
                                if (val === 'none') {
                                    const { protocolCountConditional, ...rest } = params as any;
                                    onChange(rest as DeleteEffectParams);
                                } else {
                                    onChange({
                                        ...params,
                                        protocolCountConditional: { type: 'unique_protocols_on_field_below', threshold: parseInt(val) }
                                    } as any);
                                }
                            }}
                        >
                            <option value="none">Always delete</option>
                            <option value="2">If &lt; 2 protocols</option>
                            <option value="3">If &lt; 3 protocols</option>
                            <option value="4">If &lt; 4 protocols</option>
                            <option value="5">If &lt; 5 protocols</option>
                            <option value="6">If &lt; 6 protocols</option>
                        </select>
                    </label>
                </CollapsibleSection>
            )}

            {/* Target Filter Section */}
            <CollapsibleSection title="Target Filter" forceOpen={hasTargetFilterConfig}>
                <TargetFilterRow
                    filter={targetFilter}
                    onChange={newFilter => onChange({ ...params, targetFilter: { ...targetFilter, ...newFilter } })}
                    showOwner={true}
                    showPosition={true}
                    showFaceState={true}
                />

                <div className="filter-row">
                    <label>
                        Calculation
                        <select
                            value={targetFilter.calculation || 'none'}
                            onChange={e => {
                                const val = e.target.value;
                                const newFilter = { ...targetFilter };
                                if (val === 'none') delete newFilter.calculation;
                                else newFilter.calculation = val as any;
                                onChange({ ...params, targetFilter: newFilter });
                            }}
                        >
                            <option value="none">None</option>
                            <option value="highest_value">Highest value</option>
                            <option value="lowest_value">Lowest value</option>
                        </select>
                    </label>

                    <label>
                        Value Range
                        <select
                            value={targetFilter.valueRange ? `${targetFilter.valueRange.min}-${targetFilter.valueRange.max}` : 'none'}
                            onChange={e => {
                                const val = e.target.value;
                                const newFilter = { ...targetFilter };
                                if (val === 'none') delete newFilter.valueRange;
                                else if (val === '0-1') newFilter.valueRange = { min: 0, max: 1 };
                                else if (val === '1-2') newFilter.valueRange = { min: 1, max: 2 };
                                else if (val === '0-0') newFilter.valueRange = { min: 0, max: 0 };
                                onChange({ ...params, targetFilter: newFilter });
                            }}
                        >
                            <option value="none">Any value</option>
                            <option value="0-0">Value 0 only</option>
                            <option value="0-1">Values 0-1</option>
                            <option value="1-2">Values 1-2</option>
                        </select>
                    </label>

                    <label>
                        Value Source
                        <select
                            value={targetFilter.valueSource || 'none'}
                            onChange={e => {
                                const val = e.target.value;
                                const newFilter = { ...targetFilter };
                                if (val === 'none') delete newFilter.valueSource;
                                else newFilter.valueSource = val as any;
                                onChange({ ...params, targetFilter: newFilter });
                            }}
                        >
                            <option value="none">None</option>
                            <option value="previous_effect_card">Previous effect card</option>
                        </select>
                    </label>
                </div>
            </CollapsibleSection>

            {/* Scope Section */}
            <CollapsibleSection title="Scope" forceOpen={hasScopeConfig}>
                <div className="filter-row">
                    <label>
                        Lane Scope
                        <select
                            value={params.scope?.type || 'any'}
                            onChange={e => {
                                const val = e.target.value;
                                if (val === 'any') {
                                    const { scope, ...rest } = params;
                                    onChange(rest as DeleteEffectParams);
                                } else {
                                    onChange({ ...params, scope: { type: val as any } });
                                }
                            }}
                        >
                            <option value="any">Any lane</option>
                            <option value="this_line">This lane only</option>
                            <option value="other_lanes">Other lanes</option>
                            <option value="each_other_line">Each other lane</option>
                            <option value="each_lane">Each lane</option>
                        </select>
                    </label>

                    {(params.scope?.type === 'other_lanes' || params.scope?.type === 'any') && (
                        <label>
                            Min Cards
                            <select
                                value={params.scope?.minCardsInLane || 0}
                                onChange={e => {
                                    const val = parseInt(e.target.value);
                                    if (val === 0) {
                                        const newScope = { ...params.scope };
                                        delete newScope.minCardsInLane;
                                        onChange({ ...params, scope: newScope as any });
                                    } else {
                                        onChange({ ...params, scope: { ...params.scope!, minCardsInLane: val } });
                                    }
                                }}
                            >
                                <option value={0}>No minimum</option>
                                <option value={4}>4+ cards</option>
                                <option value={6}>6+ cards</option>
                                <option value={8}>8+ cards</option>
                            </select>
                        </label>
                    )}

                    <label>
                        Who Chooses
                        <select
                            value={params.actorChooses || 'effect_owner'}
                            onChange={e => {
                                const val = e.target.value as 'effect_owner' | 'card_owner';
                                if (val === 'effect_owner') {
                                    const { actorChooses, ...rest } = params;
                                    onChange(rest as DeleteEffectParams);
                                } else {
                                    onChange({ ...params, actorChooses: val });
                                }
                            }}
                        >
                            <option value="effect_owner">Effect owner</option>
                            <option value="card_owner">Card owner (Plague-4)</option>
                        </select>
                    </label>
                </div>
            </CollapsibleSection>

            {/* Lane Restriction Section */}
            <CollapsibleSection title="Lane Restriction" forceOpen={hasLaneConfig}>
                <div className="filter-row">
                    <label>
                        Lane Condition
                        <select
                            value={params.laneCondition?.type || 'none'}
                            onChange={e => {
                                const val = e.target.value;
                                if (val === 'none') {
                                    const { laneCondition, selectLane, ...rest } = params;
                                    onChange(rest as DeleteEffectParams);
                                } else {
                                    onChange({ ...params, laneCondition: { type: val as any }, selectLane: true });
                                }
                            }}
                        >
                            <option value="none">None</option>
                            <option value="opponent_higher_value">Opponent higher value</option>
                        </select>
                    </label>

                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={params.selectLane || false}
                            onChange={e => onChange({ ...params, selectLane: e.target.checked })}
                        />
                        Select lane first
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
                        onChange(rest as DeleteEffectParams);
                    }
                }}
                availableTypes={['none', 'empty_hand', 'opponent_higher_value_in_lane', 'this_card_is_covered']}
            />
        </div>
    );
};
