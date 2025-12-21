/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface Option {
    value: string;
    label: string;
    description?: string;
}

interface ModeSelectorProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    name?: string;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
    options,
    value,
    onChange,
    name = 'mode'
}) => {
    return (
        <div className="mode-selector">
            {options.map(option => (
                <label
                    key={option.value}
                    className={`mode-option ${value === option.value ? 'selected' : ''}`}
                >
                    <input
                        type="radio"
                        name={name}
                        value={option.value}
                        checked={value === option.value}
                        onChange={e => onChange(e.target.value)}
                    />
                    <span>{option.label}</span>
                </label>
            ))}
        </div>
    );
};
