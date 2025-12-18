/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CustomProtocolDefinition, CardPattern } from '../../types/customProtocol';

// System protocol IDs - these are read-only and cannot be edited
const SYSTEM_PROTOCOL_IDS = [
    'anarchy-custom-001',
    'apathy_custom',
    'assimilation-custom-001',
    'chaos_custom_1',
    'clarity-custom-001',
    'corruption-custom-001',
    'courage-custom-001',
    'darkness_custom_v1',
    'death_custom_v1',
    'diversity-custom-001',
    'fear_custom',
    'fire-custom-001',
    'frost_custom_1',
    'gravity_custom_1',
    'hate-custom-001',
    'ice_custom',
    'life_custom_1',
    'light_custom_1',
    'love_custom_v1',
    'luck-custom-001',
    'metal_custom_1',
    'mirror-custom-001',
    'peace-custom-001',
    'plague-custom-001',
    'psychic_custom_v1',
    'smoke-custom-001',
    'speed_custom_1',
    'spirit_custom_1',
    'time-custom-001',
    'war-custom-001',
    'water_custom_1',
];

export const isSystemProtocol = (protocol: CustomProtocolDefinition): boolean => {
    return SYSTEM_PROTOCOL_IDS.includes(protocol.id);
};

interface ProtocolListProps {
    protocols: CustomProtocolDefinition[];
    onCreateNew: () => void;
    onEdit: (protocol: CustomProtocolDefinition) => void;
    onDelete: (id: string) => void;
    onImport: (protocol: CustomProtocolDefinition) => void;
    onBack?: () => void;
}

/**
 * Helper function to generate pattern preview styles for mini cards
 */
const getPatternPreviewStyle = (pattern: CardPattern, color: string): React.CSSProperties => {
    const colorToRGBA = (hex: string, alpha: number): string => {
        hex = hex.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const baseStyle: React.CSSProperties = {
        borderColor: color,
    };

    switch (pattern) {
        case 'solid':
            return {
                ...baseStyle,
                backgroundColor: color,
            };

        case 'radial':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `radial-gradient(circle at 50% 50%, ${colorToRGBA(color, 0.25)} 0%, transparent 60%)`,
            };

        case 'dual-radial':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 0% 0%, ${colorToRGBA(color, 0.2)}, transparent 50%),
                    radial-gradient(at 100% 100%, ${colorToRGBA(color, 0.2)}, transparent 50%)
                `,
            };

        case 'multi-radial':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 50% 0%, ${colorToRGBA(color, 0.2)}, transparent 70%),
                    radial-gradient(circle at 20% 30%, ${colorToRGBA(color, 0.15)}, transparent 40%),
                    radial-gradient(circle at 80% 70%, ${colorToRGBA(color, 0.2)}, transparent 50%)
                `,
            };

        case 'chaos':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 10% 10%, hsla(60, 100%, 50%, 0.15), transparent 30%),
                    radial-gradient(at 90% 20%, hsla(180, 100%, 50%, 0.15), transparent 35%),
                    radial-gradient(at 30% 80%, hsla(300, 100%, 50%, 0.15), transparent 40%),
                    radial-gradient(at 70% 60%, hsla(0, 100%, 50%, 0.1), transparent 25%)
                `,
            };

        case 'grid':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(circle at 50% 50%, ${colorToRGBA(color, 0.2)} 0%, transparent 40%),
                    linear-gradient(hsla(0,0%,100%,0.03) 1px, transparent 1px),
                    linear-gradient(90deg, hsla(0,0%,100%,0.03) 1px, transparent 1px)
                `,
                backgroundSize: '100% 100%, 20px 20px, 20px 20px',
            };

        case 'diagonal-lines':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 0% 100%, ${colorToRGBA(color, 0.25)}, transparent 70%),
                    repeating-linear-gradient(120deg, transparent, transparent 15px, ${colorToRGBA(color, 0.05)} 15px, ${colorToRGBA(color, 0.05)} 30px)
                `,
            };

        case 'cross-diagonal':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 50% 50%, ${colorToRGBA(color, 0.25)} 0%, transparent 50%),
                    repeating-linear-gradient(45deg, transparent, transparent 8px, ${colorToRGBA(color, 0.08)} 8px, ${colorToRGBA(color, 0.08)} 16px),
                    repeating-linear-gradient(-45deg, transparent, transparent 8px, ${colorToRGBA(color, 0.06)} 8px, ${colorToRGBA(color, 0.06)} 16px)
                `,
            };

        case 'horizontal-lines':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 80% 80%, ${colorToRGBA(color, 0.1)}, transparent 50%),
                    repeating-linear-gradient(0deg, hsla(0,0%,100%,0.02), hsla(0,0%,100%,0.02) 1px, transparent 1px, transparent 3px)
                `,
            };

        case 'vertical-lines':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 10% 10%, ${colorToRGBA(color, 0.2)}, transparent 50%),
                    repeating-linear-gradient(175deg, transparent, transparent 1px, ${colorToRGBA(color, 0.05)} 1px, ${colorToRGBA(color, 0.05)} 2px)
                `,
            };

        case 'cross':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    linear-gradient(0deg, transparent 40%, ${colorToRGBA(color, 0.1)} 50%, transparent 60%),
                    linear-gradient(90deg, transparent 48%, ${colorToRGBA(color, 0.2)} 50%, transparent 52%)
                `,
            };

        case 'hexagons':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 50% 0%, ${colorToRGBA(color, 0.2)}, transparent 70%),
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg id='hexagons' fill='${encodeURIComponent(color)}' fill-opacity='0.05' fill-rule='nonzero'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.99-7.5L26 15v18.5l-13 7.5L0 33.5V15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
                `,
            };

        case 'stripes':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(at 50% 100%, ${colorToRGBA(color, 0.25)}, transparent 60%),
                    linear-gradient(135deg, hsla(0,0%,0%,0.1) 23%, transparent 23%, transparent 25%, hsla(0,0%,0%,0.1) 25%, hsla(0,0%,0%,0.1) 27%, transparent 27%, transparent 73%, hsla(0,0%,0%,0.1) 73%, hsla(0,0%,0%,0.1) 75%, transparent 75%, transparent 77%, hsla(0,0%,0%,0.1) 77%)
                `,
            };

        default:
            return {
                ...baseStyle,
                backgroundColor: color,
            };
    }
};

export const ProtocolList: React.FC<ProtocolListProps> = ({ protocols, onCreateNew, onEdit, onDelete, onImport, onBack }) => {
    const [showSystemProtocols, setShowSystemProtocols] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importJson, setImportJson] = useState('');
    const [importError, setImportError] = useState('');

    const handleDelete = (id: string, name: string) => {
        if (confirm(`Really delete "${name}"?`)) {
            onDelete(id);
        }
    };

    // Filter protocols based on checkbox state
    const filteredProtocols = showSystemProtocols
        ? protocols
        : protocols.filter(p => !isSystemProtocol(p));

    const handleImport = () => {
        setImportError('');
        try {
            const imported = JSON.parse(importJson) as CustomProtocolDefinition;

            // Validate structure
            if (!imported.name || !imported.color || !imported.pattern || !Array.isArray(imported.cards)) {
                setImportError('Invalid protocol format. Missing required fields.');
                return;
            }

            if (imported.cards.length !== 6) {
                setImportError('Invalid protocol: must have exactly 6 cards.');
                return;
            }

            // Check for duplicate name
            const existing = protocols.find(p => p.name.toLowerCase() === imported.name.toLowerCase());
            if (existing) {
                if (confirm(`A protocol named "${imported.name}" already exists. Overwrite it?`)) {
                    // Use existing ID to overwrite
                    imported.id = existing.id;
                    onImport(imported);
                    setShowImportModal(false);
                    setImportJson('');
                    alert('Protocol imported and overwritten successfully!');
                }
                // else skip
                return;
            }

            // Generate new ID and import
            imported.id = Date.now().toString();
            imported.createdAt = new Date().toISOString();

            // Import the protocol
            onImport(imported);
            setShowImportModal(false);
            setImportJson('');
            alert('Protocol imported successfully!');
        } catch (error) {
            setImportError('Invalid JSON format. Please check your input.');
        }
    };

    return (
        <div className="protocol-list">
            <div className="list-header">
                <h2>Custom Protocols</h2>
                <div className="header-actions">
                    <label className="system-protocols-toggle">
                        <input
                            type="checkbox"
                            checked={showSystemProtocols}
                            onChange={(e) => setShowSystemProtocols(e.target.checked)}
                        />
                        Show System Protocols
                    </label>
                    <button onClick={() => setShowImportModal(true)} className="btn">
                        Import Protocol
                    </button>
                    {onBack && (
                        <button onClick={onBack} className="btn btn-back">
                            Back
                        </button>
                    )}
                </div>
            </div>

            {/* Import Modal */}
            {showImportModal && (
                <div className="custom-protocol-modal-overlay" onClick={() => setShowImportModal(false)}>
                    <div className="custom-protocol-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Import Protocol</h3>
                        <p>Paste the protocol JSON below:</p>

                        <textarea
                            value={importJson}
                            onChange={(e) => setImportJson(e.target.value)}
                            placeholder='{"name":"Protocol Name","color":"#1976D2",...}'
                            rows={10}
                            className="import-textarea"
                        />

                        {importError && <div className="error-message">{importError}</div>}

                        <div className="custom-protocol-modal-actions">
                            <button onClick={() => setShowImportModal(false)} className="btn btn-back">
                                Cancel
                            </button>
                            <button onClick={handleImport} className="btn">
                                Import
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="protocols-grid">
                {/* New Protocol Card - Always first */}
                <div className="protocol-card new-protocol-card" onClick={onCreateNew}>
                    <div className="protocol-header new-protocol-header">
                        <div className="protocol-header-content">
                            <h3>+ New Protocol</h3>
                            <p className="header-description">Create a custom protocol</p>
                        </div>
                    </div>
                    <div className="protocol-body new-protocol-body">
                    </div>
                </div>

                {/* Existing Protocol Cards */}
                {filteredProtocols.map(protocol => {
                    const isSystem = isSystemProtocol(protocol);
                    return (
                        <div
                            key={protocol.id}
                            className={`protocol-card ${isSystem ? 'system-protocol' : ''}`}
                            style={getPatternPreviewStyle(protocol.pattern, protocol.color)}
                            onClick={() => onEdit(protocol)}
                        >
                            <div className="protocol-header-content">
                                <h3>{protocol.name}</h3>
                                {isSystem && <span className="system-badge">System</span>}
                                {protocol.description && <p className="header-description">{protocol.description}</p>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
