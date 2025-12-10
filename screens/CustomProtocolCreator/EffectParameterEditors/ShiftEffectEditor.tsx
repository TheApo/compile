/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShiftEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

export const ShiftEffectEditor: React.FC<{ params: ShiftEffectParams; onChange: (params: ShiftEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Shift Effect</h4>
            <label>
                Count/Scope
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
                    <option value="all">All matching cards</option>
                </select>
            </label>
            <label>
                Target Owner
                <select
                    value={params.targetFilter.owner}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, owner: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="own">Own</option>
                    <option value="opponent">Opponent</option>
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
                    <option value="uncovered">Uncovered</option>
                    <option value="covered">Covered</option>
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
                    checked={params.targetFilter.excludeSelf || false}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...params.targetFilter, excludeSelf: e.target.checked } })
                    }
                />
                Exclude self ("other card")
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.optional || false}
                    onChange={e =>
                        onChange({ ...params, optional: e.target.checked })
                    }
                />
                Optional ("You may shift" instead of "Shift")
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.shiftSelf || false}
                    onChange={e =>
                        onChange({ ...params, shiftSelf: e.target.checked })
                    }
                />
                Shift this card (instead of selecting target)
                <small style={{ display: 'block', marginLeft: '24px', color: '#8A79E8' }}>
                    The card shifts itself, ignoring target filter.
                </small>
            </label>

            <h5>Advanced Conditional</h5>

            <label>
                Conditional Type
                <select
                    value={params.advancedConditional?.type || 'none'}
                    onChange={e => {
                        if (e.target.value === 'none') {
                            const { advancedConditional, ...rest } = params;
                            onChange(rest as ShiftEffectParams);
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
                    <option value="any">Any line</option>
                    <option value="to_another_line">To another line</option>
                    <option value="non_matching_protocol">Non-matching protocol</option>
                    <option value="specific_lane">This line (within)</option>
                    <option value="to_this_lane">To THIS lane only</option>
                    <option value="to_or_from_this_lane">To OR from this lane</option>
                    <option value="opponent_highest_value_lane">To opponent's highest value lane</option>
                </select>
                {params.destinationRestriction?.type === 'opponent_highest_value_lane' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Card can only be shifted to the lane where opponent has highest total value.
                    </small>
                )}
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateShiftText = (params: ShiftEffectParams): string => {
    const mayShift = params.optional ? 'You may shift' : 'Shift';
    let targetDesc = '';

    if (params.targetFilter.owner === 'opponent') targetDesc += "opponent's ";
    if (params.targetFilter.excludeSelf) targetDesc += 'other ';
    if (params.targetFilter.position === 'covered') targetDesc += 'covered ';
    if (params.targetFilter.position === 'uncovered') targetDesc += 'uncovered ';
    if (params.targetFilter.faceState === 'face_down') targetDesc += 'face-down ';
    if (params.targetFilter.faceState === 'face_up') targetDesc += 'face-up ';

    const count = (params as any).count === 'all' ? 'all' : '1';
    const cardWord = count === '1' ? 'card' : 'cards';
    let text = `${mayShift} ${count} ${targetDesc}${cardWord}`;

    if (params.destinationRestriction?.type === 'non_matching_protocol') {
        text += ' to a line without a matching protocol';
    } else if (params.destinationRestriction?.type === 'specific_lane') {
        text += ' within this line';
    } else if (params.destinationRestriction?.type === 'to_another_line') {
        text += ' to another line';
    }

    return text + '.';
};
