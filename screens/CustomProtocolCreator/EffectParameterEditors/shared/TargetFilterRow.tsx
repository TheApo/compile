/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface TargetFilter {
    owner?: 'any' | 'own' | 'opponent';
    position?: 'any' | 'uncovered' | 'covered' | 'covered_in_this_line';
    faceState?: 'any' | 'face_up' | 'face_down';
    excludeSelf?: boolean;
    calculation?: 'highest_value' | 'lowest_value';
    valueRange?: { min: number; max: number };
    valueSource?: 'previous_effect_card';
    valueMinGreaterThanHandSize?: boolean;
    valueLessThanUniqueProtocolsOnField?: boolean;
}

interface TargetFilterRowProps {
    filter: TargetFilter;
    onChange: (filter: TargetFilter) => void;
    showOwner?: boolean;
    showPosition?: boolean;
    showFaceState?: boolean;
    showExcludeSelf?: boolean;
    positionOptions?: Array<{ value: string; label: string }>;
}

export const TargetFilterRow: React.FC<TargetFilterRowProps> = ({
    filter,
    onChange,
    showOwner = true,
    showPosition = true,
    showFaceState = true,
    showExcludeSelf = false,
    positionOptions
}) => {
    const defaultPositionOptions = [
        { value: 'any', label: 'Any' },
        { value: 'uncovered', label: 'Uncovered' },
        { value: 'covered', label: 'Covered' }
    ];

    const positions = positionOptions || defaultPositionOptions;

    return (
        <>
            {showOwner && (
                <label>
                    Owner
                    <select
                        value={filter.owner || 'any'}
                        onChange={e => {
                            const val = e.target.value;
                            const newFilter = { ...filter };
                            if (val === 'any') {
                                delete newFilter.owner;
                            } else {
                                newFilter.owner = val as any;
                            }
                            onChange(newFilter);
                        }}
                    >
                        <option value="any">Any</option>
                        <option value="own">Own</option>
                        <option value="opponent">Opponent</option>
                    </select>
                </label>
            )}

            {showPosition && (
                <label>
                    Position
                    <select
                        value={filter.position || 'uncovered'}
                        onChange={e => onChange({ ...filter, position: e.target.value as any })}
                    >
                        {positions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>
            )}

            {showFaceState && (
                <label>
                    Face State
                    <select
                        value={filter.faceState || 'any'}
                        onChange={e => onChange({ ...filter, faceState: e.target.value as any })}
                    >
                        <option value="any">Any</option>
                        <option value="face_up">Face-up</option>
                        <option value="face_down">Face-down</option>
                    </select>
                </label>
            )}

            {showExcludeSelf && (
                <label>
                    <input
                        type="checkbox"
                        checked={filter.excludeSelf || false}
                        onChange={e => onChange({ ...filter, excludeSelf: e.target.checked })}
                    />
                    Exclude self
                </label>
            )}
        </>
    );
};
