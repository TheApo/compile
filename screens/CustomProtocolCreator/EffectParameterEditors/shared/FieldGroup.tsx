/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface FieldGroupProps {
    title?: string;
    children: React.ReactNode;
}

export const FieldGroup: React.FC<FieldGroupProps> = ({ title, children }) => {
    return (
        <div className="field-group">
            {title && <div className="field-group-title">{title}</div>}
            {children}
        </div>
    );
};
