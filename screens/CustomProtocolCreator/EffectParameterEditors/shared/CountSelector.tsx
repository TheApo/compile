/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type CountMode = 'fixed' | 'all' | 'each' | 'variable' | 'all_in_lane';
export type CountType = 'fixed' | 'equal_to_card_value' | 'equal_to_discarded' | 'hand_size' | 'count_own_protocol_cards_on_field';

interface CountSelectorProps {
    /** Current count value (1-6 for fixed, or string like 'all', 'each') */
    count: number | string;
    /** Callback for count change */
    onCountChange: (count: number | string) => void;
    /** Count mode (fixed number or special mode) */
    mode?: CountMode;
    /** Callback for mode change */
    onModeChange?: (mode: CountMode) => void;
    /** Show mode selector */
    showModeSelector?: boolean;
    /** Available modes */
    availableModes?: Array<{ value: CountMode; label: string }>;
    /** Min value for fixed count */
    min?: number;
    /** Max value for fixed count */
    max?: number;
    /** Label for the count field */
    label?: string;
    /** For draw effects: count type */
    countType?: CountType;
    /** Callback for count type change */
    onCountTypeChange?: (type: CountType) => void;
    /** Show count type selector (for draw effects) */
    showCountType?: boolean;
    /** Count offset for variable counts */
    countOffset?: number;
    /** Callback for count offset change */
    onCountOffsetChange?: (offset: number) => void;
    /** Show count offset */
    showCountOffset?: boolean;
}

const DEFAULT_MODES: Array<{ value: CountMode; label: string }> = [
    { value: 'fixed', label: 'Fixed amount' },
    { value: 'all', label: 'All' },
    { value: 'each', label: 'Each' }
];

const COUNT_TYPE_OPTIONS: Array<{ value: CountType; label: string }> = [
    { value: 'fixed', label: 'Fixed amount' },
    { value: 'equal_to_card_value', label: 'Equal to card value' },
    { value: 'equal_to_discarded', label: 'Equal to discarded cards' },
    { value: 'hand_size', label: 'Equal to hand size' },
    { value: 'count_own_protocol_cards_on_field', label: 'Count same protocol cards (Unity)' }
];

export const CountSelector: React.FC<CountSelectorProps> = ({
    count,
    onCountChange,
    mode = 'fixed',
    onModeChange,
    showModeSelector = false,
    availableModes = DEFAULT_MODES,
    min = 1,
    max = 6,
    label = 'Count',
    countType,
    onCountTypeChange,
    showCountType = false,
    countOffset = 0,
    onCountOffsetChange,
    showCountOffset = false
}) => {
    const isFixedMode = mode === 'fixed' || (typeof count === 'number');

    return (
        <div className="filter-row">
            {showCountType && onCountTypeChange && (
                <label>
                    Count Type
                    <select
                        value={countType || 'fixed'}
                        onChange={e => onCountTypeChange(e.target.value as CountType)}
                    >
                        {COUNT_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>
            )}

            {showModeSelector && onModeChange && !showCountType && (
                <label>
                    Mode
                    <select
                        value={mode}
                        onChange={e => {
                            const newMode = e.target.value as CountMode;
                            onModeChange(newMode);
                            // Reset count based on mode
                            if (newMode === 'all') onCountChange('all');
                            else if (newMode === 'each') onCountChange('each');
                            else if (newMode === 'all_in_lane') onCountChange('all_in_lane');
                            else onCountChange(1);
                        }}
                    >
                        {availableModes.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>
            )}

            {(isFixedMode || countType === 'fixed') && (
                <label>
                    {label}
                    <select
                        value={typeof count === 'number' ? count : 1}
                        onChange={e => onCountChange(parseInt(e.target.value))}
                    >
                        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(n => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </label>
            )}

            {showCountOffset && onCountOffsetChange && countType === 'equal_to_discarded' && (
                <label>
                    Offset
                    <input
                        type="number"
                        min={-5}
                        max={5}
                        value={countOffset}
                        onChange={e => onCountOffsetChange(parseInt(e.target.value))}
                    />
                    <small className="hint-text">
                        e.g., +1 means "discarded + 1"
                    </small>
                </label>
            )}
        </div>
    );
};
