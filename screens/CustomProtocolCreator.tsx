/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CustomProtocolDefinition } from '../types/customProtocol';
import {
    loadCustomProtocols,
    saveCustomProtocols,
    addCustomProtocol,
    deleteCustomProtocol,
} from '../logic/customProtocols/storage';
import { ProtocolList } from './CustomProtocolCreator/ProtocolList';
import { ProtocolWizard } from './CustomProtocolCreator/ProtocolWizard';
import '../styles/custom-protocol-creator.css';

type View = 'list' | 'create' | 'edit';

interface CustomProtocolCreatorProps {
    onBack?: () => void;
}

export const CustomProtocolCreator: React.FC<CustomProtocolCreatorProps> = ({ onBack }) => {
    const [view, setView] = useState<View>('list');
    const [protocols, setProtocols] = useState<CustomProtocolDefinition[]>([]);
    const [editingProtocol, setEditingProtocol] = useState<CustomProtocolDefinition | undefined>(undefined);

    useEffect(() => {
        loadProtocols();
    }, []);

    const loadProtocols = () => {
        const loaded = loadCustomProtocols();
        setProtocols(loaded);
    };

    const handleCreateNew = () => {
        setEditingProtocol(undefined);
        setView('create');
    };

    const handleEdit = (protocol: CustomProtocolDefinition) => {
        setEditingProtocol(protocol);
        setView('edit');
    };

    const handleDelete = (id: string) => {
        deleteCustomProtocol(id);
        loadProtocols();
    };

    const handleSave = (protocol: CustomProtocolDefinition) => {
        addCustomProtocol(protocol);
        loadProtocols();
        setView('list');
        setEditingProtocol(undefined);
    };

    const handleCancel = () => {
        setView('list');
        setEditingProtocol(undefined);
    };

    return (
        <div className="custom-protocol-creator">
            {view === 'list' && (
                <ProtocolList
                    protocols={protocols}
                    onCreateNew={handleCreateNew}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onBack={onBack}
                />
            )}

            {(view === 'create' || view === 'edit') && (
                <ProtocolWizard onSave={handleSave} onCancel={handleCancel} initialProtocol={editingProtocol} />
            )}
        </div>
    );
};
