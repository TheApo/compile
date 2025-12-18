/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ReturnEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

export const ReturnEffectEditor: React.FC<{ params: ReturnEffectParams; onChange: (params: ReturnEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const owner = params.targetFilter?.owner || 'any';
    const position = params.targetFilter?.position || 'uncovered';
    const faceState = params.targetFilter?.faceState;
    const valueEquals = params.targetFilter?.valueEquals;
    const selectLane = (params as any).selectLane || false;
    const destination = params.destination || 'owner_hand';

    return (
        <div className="param-editor">
            <h4>Return Effect</h4>
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

            <label>
                Whose cards?
                <select
                    value={owner}
                    onChange={e => onChange({
                        ...params,
                        targetFilter: {
                            ...params.targetFilter,
                            owner: e.target.value as 'own' | 'opponent' | 'any'
                        }
                    })}
                >
                    <option value="any">Any card (own or opponent)</option>
                    <option value="own">Only own cards</option>
                    <option value="opponent">Only opponent cards</option>
                </select>
            </label>

            <label>
                Position
                <select
                    value={position}
                    onChange={e => onChange({
                        ...params,
                        targetFilter: {
                            ...params.targetFilter,
                            position: e.target.value as 'uncovered' | 'covered' | 'any'
                        }
                    })}
                >
                    <option value="uncovered">Uncovered (default)</option>
                    <option value="covered">Covered</option>
                    <option value="any">Any (covered or uncovered)</option>
                </select>
            </label>

            <label>
                Face State Filter
                <select
                    value={faceState || 'any'}
                    onChange={e => {
                        const val = e.target.value;
                        if (val === 'any') {
                            const { faceState, ...rest } = params.targetFilter || {};
                            onChange({ ...params, targetFilter: rest });
                        } else {
                            onChange({
                                ...params,
                                targetFilter: {
                                    ...params.targetFilter,
                                    faceState: val as 'face_up' | 'face_down'
                                }
                            });
                        }
                    }}
                >
                    <option value="any">Any (face-up or face-down)</option>
                    <option value="face_up">Face-up only</option>
                    <option value="face_down">Face-down only</option>
                </select>
            </label>

            {/* Show destination option only when targeting opponent's cards */}
            {owner === 'opponent' && (
                <label>
                    Card goes to
                    <select
                        value={destination}
                        onChange={e => onChange({ ...params, destination: e.target.value as 'owner_hand' | 'actor_hand' })}
                    >
                        <option value="owner_hand">Owner's hand (normal return)</option>
                        <option value="actor_hand">Your hand (steal)</option>
                    </select>
                    {destination === 'actor_hand' && (
                        <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                            Steal: Card goes to your hand instead of owner's hand.
                        </small>
                    )}
                </label>
            )}

            <label>
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
                Select lane first (Water-3: "in 1 line")
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={valueEquals !== undefined}
                    onChange={e => {
                        if (e.target.checked) {
                            onChange({
                                ...params,
                                targetFilter: {
                                    ...params.targetFilter,
                                    valueEquals: 2
                                }
                            });
                        } else {
                            const { valueEquals, ...rest } = params.targetFilter || {};
                            onChange({
                                ...params,
                                targetFilter: rest
                            });
                        }
                    }}
                />
                Filter by value
            </label>

            {valueEquals !== undefined && (
                <label>
                    Value to return
                    <input
                        type="number"
                        min={0}
                        max={6}
                        value={valueEquals}
                        onChange={e => onChange({
                            ...params,
                            targetFilter: {
                                ...params.targetFilter,
                                valueEquals: parseInt(e.target.value) || 0
                            }
                        })}
                    />
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
                            onChange(rest as ReturnEffectParams);
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
const _generateReturnText = (params: ReturnEffectParams): string => {
    const selectLane = (params as any).selectLane || false;

    if (params.targetFilter?.valueEquals !== undefined) {
        const laneText = selectLane ? ' in 1 line' : '';
        return `Return all cards with a value of ${params.targetFilter.valueEquals}${laneText}.`;
    }

    const countText = params.count === 'all' ? 'all cards' : params.count === 1 ? '1 card' : `${params.count} cards`;
    const owner = params.targetFilter?.owner || 'any';

    let ownerText = '';
    if (owner === 'own') {
        ownerText = ' of your';
    } else if (owner === 'opponent') {
        ownerText = " of opponent's";
    }

    const laneText = selectLane ? ' in 1 line' : '';
    return `Return ${countText}${ownerText}${laneText}.`;
};
