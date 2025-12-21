/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface CollapsibleSectionProps {
    title: string;
    defaultOpen?: boolean;
    /** Force open when true (e.g., when options are configured) */
    forceOpen?: boolean;
    children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    defaultOpen = false,
    forceOpen = false,
    children
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen || forceOpen);

    // If forceOpen is true, override the state
    const effectiveOpen = forceOpen || isOpen;

    return (
        <div className="collapsible-section">
            <button
                type="button"
                className={`collapsible-header ${effectiveOpen ? 'open' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="collapsible-arrow">{effectiveOpen ? '▼' : '▶'}</span>
                {title}
            </button>
            {effectiveOpen && <div className="collapsible-content">{children}</div>}
        </div>
    );
};
