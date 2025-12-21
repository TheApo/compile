/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type SourceScope = 'any' | 'this_lane' | 'this_line' | 'other_lanes' | 'each_lane' | 'each_other_line';
export type DestinationScope = 'any' | 'to_another_line' | 'non_matching_protocol' | 'specific_lane' |
                               'to_this_lane' | 'to_or_from_this_lane' | 'opponent_highest_value_lane';

interface ScopeSelectorProps {
    /** Source scope value */
    sourceScope?: SourceScope;
    /** Destination scope value */
    destinationScope?: DestinationScope;
    /** Callback for source scope change */
    onSourceChange?: (scope: SourceScope) => void;
    /** Callback for destination scope change */
    onDestinationChange?: (scope: DestinationScope) => void;
    /** Show source scope selector */
    showSource?: boolean;
    /** Show destination scope selector */
    showDestination?: boolean;
    /** Available source options */
    sourceOptions?: Array<{ value: SourceScope; label: string }>;
    /** Available destination options */
    destinationOptions?: Array<{ value: DestinationScope; label: string }>;
}

const DEFAULT_SOURCE_OPTIONS: Array<{ value: SourceScope; label: string }> = [
    { value: 'any', label: 'Any lane' },
    { value: 'this_lane', label: 'This lane only' },
    { value: 'each_lane', label: 'Each lane' }
];

const DEFAULT_DESTINATION_OPTIONS: Array<{ value: DestinationScope; label: string }> = [
    { value: 'any', label: 'Any lane' },
    { value: 'to_another_line', label: 'To another lane' },
    { value: 'to_this_lane', label: 'To this lane' },
    { value: 'to_or_from_this_lane', label: 'To or from this lane' }
];

export const ScopeSelector: React.FC<ScopeSelectorProps> = ({
    sourceScope = 'any',
    destinationScope = 'any',
    onSourceChange,
    onDestinationChange,
    showSource = true,
    showDestination = false,
    sourceOptions = DEFAULT_SOURCE_OPTIONS,
    destinationOptions = DEFAULT_DESTINATION_OPTIONS
}) => {
    return (
        <div className="filter-row">
            {showSource && onSourceChange && (
                <label>
                    Source Scope
                    <select
                        value={sourceScope}
                        onChange={e => onSourceChange(e.target.value as SourceScope)}
                    >
                        {sourceOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>
            )}

            {showDestination && onDestinationChange && (
                <label>
                    Destination
                    <select
                        value={destinationScope}
                        onChange={e => onDestinationChange(e.target.value as DestinationScope)}
                    >
                        {destinationOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>
            )}
        </div>
    );
};
