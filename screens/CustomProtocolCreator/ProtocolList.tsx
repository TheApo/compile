/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CustomProtocolDefinition } from '../../types/customProtocol';

interface ProtocolListProps {
    protocols: CustomProtocolDefinition[];
    onCreateNew: () => void;
    onEdit: (protocol: CustomProtocolDefinition) => void;
    onDelete: (id: string) => void;
    onBack?: () => void;
}

export const ProtocolList: React.FC<ProtocolListProps> = ({ protocols, onCreateNew, onEdit, onDelete, onBack }) => {
    const handleDelete = (id: string, name: string) => {
        if (confirm(`"${name}" wirklich löschen?`)) {
            onDelete(id);
        }
    };

    return (
        <div className="protocol-list">
            <div className="list-header">
                <h2>Custom Protocols</h2>
                <div className="header-actions">
                    {onBack && (
                        <button onClick={onBack} className="btn btn-back">
                            ← Zurück
                        </button>
                    )}
                    <button onClick={onCreateNew} className="btn">
                        + Neues Protokoll
                    </button>
                </div>
            </div>

            {protocols.length === 0 && (
                <div className="empty-state">
                    <p>Noch keine Custom Protocols erstellt.</p>
                    <p>Erstelle dein erstes Protokoll mit eigenen Farben, Mustern und Effekten!</p>
                </div>
            )}

            <div className="protocols-grid">
                {protocols.map(protocol => (
                    <div key={protocol.id} className="protocol-card" style={{ borderColor: protocol.color }}>
                        <div className="protocol-header" style={{ backgroundColor: protocol.color }}>
                            <h3>{protocol.name}</h3>
                        </div>

                        <div className="protocol-body">
                            <p className="description">{protocol.description || 'Keine Beschreibung'}</p>

                            <div className="protocol-meta">
                                <span>6 Karten (0-5)</span>
                                <span>Erstellt: {new Date(protocol.createdAt).toLocaleDateString('de-DE')}</span>
                            </div>

                            <div className="card-preview-mini">
                                {protocol.cards.map(card => (
                                    <div
                                        key={card.value}
                                        className="mini-card"
                                        style={{ backgroundColor: protocol.color }}
                                        title={`${protocol.name}-${card.value}: ${card.topEffects.length + card.middleEffects.length + card.bottomEffects.length} Effekte`}
                                    >
                                        {card.value}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="protocol-actions">
                            <button onClick={() => onEdit(protocol)} className="btn">
                                Bearbeiten
                            </button>
                            <button onClick={() => handleDelete(protocol.id, protocol.name)} className="btn btn-delete">
                                Löschen
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
