/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CustomProtocolDefinition, CustomCardDefinition, CardPattern } from '../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { CardEditor } from './CardEditor';

/**
 * Helper function to generate pattern preview styles
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
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg id='hexagons' fill='%23ffffff' fill-opacity='0.05' fill-rule='nonzero'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.99-7.5L26 15v18.5l-13 7.5L0 33.5V15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
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

        case 'frost':
            return {
                ...baseStyle,
                backgroundColor: 'var(--surface-color)',
                backgroundImage: `
                    radial-gradient(circle at 50% 50%, ${colorToRGBA(color, 0.2)} 0%, transparent 50%),
                    repeating-linear-gradient(30deg, transparent, transparent 10px, ${colorToRGBA(color, 0.08)} 10px, ${colorToRGBA(color, 0.08)} 11px),
                    repeating-linear-gradient(-30deg, transparent, transparent 10px, ${colorToRGBA(color, 0.08)} 10px, ${colorToRGBA(color, 0.08)} 11px),
                    repeating-linear-gradient(90deg, transparent, transparent 8px, ${colorToRGBA(color, 0.05)} 8px, ${colorToRGBA(color, 0.05)} 9px)
                `,
            };

        default:
            return baseStyle;
    }
};

interface ProtocolWizardProps {
    onSave: (protocol: CustomProtocolDefinition) => void;
    onCancel: () => void;
    onDelete?: (protocolId: string) => void;
    initialProtocol?: CustomProtocolDefinition;
}

type WizardStep = 'name' | 'color' | 'pattern' | 'cards';

const PREDEFINED_COLORS = [
    // Original Protocol Colors (from components.css)
    { name: 'Anarchy', hex: '#EA5A3C' },  // hsl(15, 85%, 60%)
    { name: 'Apathy', hex: '#989A9A' },   // hsl(240, 5%, 60%)
    { name: 'Chaos', hex: '#E53FE5' },    // hsl(300, 80%, 60%)
    { name: 'Darkness', hex: '#A772D4' }, // hsl(270, 50%, 70%)
    { name: 'Death', hex: '#E25656' },    // hsl(0, 70%, 65%)
    { name: 'Fire', hex: '#F06838' },     // hsl(20, 90%, 65%)
    { name: 'Gravity', hex: '#7599EB' },  // hsl(230, 60%, 70%)
    { name: 'Hate', hex: '#E03E5E' },     // hsl(350, 60%, 60%)
    { name: 'Life', hex: '#3CE076' },     // hsl(140, 70%, 60%)
    { name: 'Light', hex: '#FFEB7F' },    // hsl(50, 100%, 75%)
    { name: 'Love', hex: '#F074D9' },     // hsl(320, 80%, 75%)
    { name: 'Metal', hex: '#B3B8BD' },    // hsl(210, 15%, 75%)
    { name: 'Plague', hex: '#A2CD3A' },   // hsl(80, 60%, 55%)
    { name: 'Psychic', hex: '#C971EB' },  // hsl(280, 70%, 70%)
    { name: 'Speed', hex: '#33DDDD' },    // hsl(180, 80%, 60%)
    { name: 'Spirit', hex: '#42D4A8' },   // hsl(170, 60%, 65%)
    { name: 'Water', hex: '#3FA4EB' },    // hsl(210, 80%, 65%)
];

const CARD_PATTERNS = [
    { name: 'Solid', value: 'solid', description: 'Solid color background' },
    { name: 'Radial Glow', value: 'radial', description: 'Single radial gradient glow' },
    { name: 'Dual Radial', value: 'dual-radial', description: 'Two radial gradient spots' },
    { name: 'Multi Radial', value: 'multi-radial', description: 'Multiple radial gradient spots' },
    { name: 'Chaos', value: 'chaos', description: 'Colorful chaotic spots' },
    { name: 'Grid', value: 'grid', description: 'Grid line pattern' },
    { name: 'Diagonal Lines', value: 'diagonal-lines', description: 'Repeating diagonal lines' },
    { name: 'Cross Diagonal', value: 'cross-diagonal', description: 'Crossed diagonal lines' },
    { name: 'Horizontal Lines', value: 'horizontal-lines', description: 'Fine horizontal lines' },
    { name: 'Vertical Lines', value: 'vertical-lines', description: 'Fine vertical lines' },
    { name: 'Cross Pattern', value: 'cross', description: 'Cross/plus pattern' },
    { name: 'Hexagons', value: 'hexagons', description: 'Hexagon pattern' },
    { name: 'Stripes', value: 'stripes', description: 'Diagonal stripe pattern' },
    { name: 'Frost', value: 'frost', description: 'Icy crystalline pattern with crossing lines' },
];

export const ProtocolWizard: React.FC<ProtocolWizardProps> = ({ onSave, onCancel, onDelete, initialProtocol }) => {
    const [step, setStep] = useState<WizardStep>('name');
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportJson, setExportJson] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    console.log('ProtocolWizard render - initialProtocol:', initialProtocol);

    // Protocol data
    const [protocolName, setProtocolName] = useState(initialProtocol?.name || '');
    const [protocolDescription, setProtocolDescription] = useState(initialProtocol?.description || '');
    const [protocolColor, setProtocolColor] = useState(initialProtocol?.color || '#1976D2');
    const [protocolPattern, setProtocolPattern] = useState(initialProtocol?.pattern || 'solid');
    const [cards, setCards] = useState<CustomCardDefinition[]>(
        initialProtocol?.cards || [
            { value: 0, topEffects: [], middleEffects: [], bottomEffects: [] },
            { value: 1, topEffects: [], middleEffects: [], bottomEffects: [] },
            { value: 2, topEffects: [], middleEffects: [], bottomEffects: [] },
            { value: 3, topEffects: [], middleEffects: [], bottomEffects: [] },
            { value: 4, topEffects: [], middleEffects: [], bottomEffects: [] },
            { value: 5, topEffects: [], middleEffects: [], bottomEffects: [] },
        ]
    );

    console.log('ProtocolWizard state - name:', protocolName, 'color:', protocolColor, 'pattern:', protocolPattern);

    const handleNextStep = () => {
        if (step === 'name') {
            if (!protocolName.trim()) {
                alert('Please enter a protocol name.');
                return;
            }
            setStep('color');
        } else if (step === 'color') {
            setStep('pattern');
        } else if (step === 'pattern') {
            setStep('cards');
        }
    };

    const handlePreviousStep = () => {
        if (step === 'color') setStep('name');
        else if (step === 'pattern') setStep('color');
        else if (step === 'cards') setStep('pattern');
    };

    const handleNextCard = () => {
        if (currentCardIndex < 5) {
            setCurrentCardIndex(currentCardIndex + 1);
        } else {
            handleFinish();
        }
    };

    const handlePreviousCard = () => {
        if (currentCardIndex > 0) {
            setCurrentCardIndex(currentCardIndex - 1);
        }
    };

    const handleUpdateCard = (updatedCard: CustomCardDefinition) => {
        const newCards = [...cards];
        newCards[currentCardIndex] = updatedCard;
        setCards(newCards);
    };

    const handleFinish = () => {
        const protocol: CustomProtocolDefinition = {
            id: initialProtocol?.id || uuidv4(),
            name: protocolName,
            description: protocolDescription,
            author: 'Player',
            createdAt: initialProtocol?.createdAt || new Date().toISOString(),
            color: protocolColor,
            pattern: protocolPattern as any,
            cards,
        };

        onSave(protocol);
    };

    const handleDelete = () => {
        if (initialProtocol && onDelete) {
            onDelete(initialProtocol.id);
        }
        setShowDeleteModal(false);
    };

    const handleExport = () => {
        const protocol: CustomProtocolDefinition = {
            id: initialProtocol?.id || uuidv4(),
            name: protocolName,
            description: protocolDescription,
            author: 'Player',
            createdAt: initialProtocol?.createdAt || new Date().toISOString(),
            color: protocolColor,
            pattern: protocolPattern as any,
            cards,
        };

        const json = JSON.stringify(protocol, null, 2);
        setExportJson(json);
        setShowExportModal(true);
    };

    const handleCopyJson = () => {
        navigator.clipboard.writeText(exportJson).then(() => {
            alert('Protocol JSON copied to clipboard!');
            setShowExportModal(false);
        }).catch(() => {
            alert('Failed to copy to clipboard. Please try again.');
        });
    };

    const canNavigateToStep = (targetStep: WizardStep): boolean => {
        if (!protocolName.trim() && targetStep !== 'name') return false;
        return true;
    };

    const handleStepClick = (targetStep: WizardStep) => {
        if (!canNavigateToStep(targetStep)) {
            alert('Please enter a protocol name first.');
            return;
        }
        setStep(targetStep);
    };

    return (
        <div className="protocol-wizard">
            <div className="wizard-header">
                <h2>
                    {initialProtocol ? `Edit Protocol: ${protocolName}` : 'Create New Protocol'}
                </h2>
                <div className="wizard-progress">
                    <button
                        className={`step ${step === 'name' ? 'active' : 'done'}`}
                        onClick={() => handleStepClick('name')}
                        type="button"
                    >
                        1. Name
                    </button>
                    <button
                        className={`step ${step === 'color' ? 'active' : step === 'pattern' || step === 'cards' ? 'done' : ''}`}
                        onClick={() => handleStepClick('color')}
                        disabled={!canNavigateToStep('color')}
                        type="button"
                    >
                        2. Color
                    </button>
                    <button
                        className={`step ${step === 'pattern' ? 'active' : step === 'cards' ? 'done' : ''}`}
                        onClick={() => handleStepClick('pattern')}
                        disabled={!canNavigateToStep('pattern')}
                        type="button"
                    >
                        3. Pattern
                    </button>
                    <button
                        className={`step ${step === 'cards' ? 'active' : ''}`}
                        onClick={() => handleStepClick('cards')}
                        disabled={!canNavigateToStep('cards')}
                        type="button"
                    >
                        4. Cards
                    </button>
                </div>
            </div>

            <div className="wizard-content">
                {/* Step 1: Name */}
                {step === 'name' && (
                    <div className="wizard-step name-step">
                        <h3>Step 1: Name and Description</h3>

                        <label>
                            Protocol Name *
                            <input
                                type="text"
                                value={protocolName}
                                onChange={e => setProtocolName(e.target.value)}
                                placeholder="e.g. Lightning, Shadow, Void"
                                autoFocus
                            />
                        </label>

                        <label>
                            Description
                            <textarea
                                value={protocolDescription}
                                onChange={e => setProtocolDescription(e.target.value)}
                                placeholder="Describe the strategy and theme of your protocol"
                                rows={4}
                            />
                        </label>
                    </div>
                )}

                {/* Step 2: Color */}
                {step === 'color' && (
                    <div className="wizard-step color-step">
                        <h3>Step 2: Choose Color</h3>

                        <div className="color-preview" style={{ backgroundColor: protocolColor }}>
                            <span>{protocolName || 'Your Protocol'}</span>
                        </div>

                        <h4>Predefined Colors</h4>
                        <div className="color-grid">
                            {PREDEFINED_COLORS.map(color => (
                                <button
                                    key={color.hex}
                                    className={`color-option ${protocolColor === color.hex ? 'selected' : ''}`}
                                    style={{ backgroundColor: color.hex }}
                                    onClick={() => setProtocolColor(color.hex)}
                                    title={color.name}
                                >
                                    {protocolColor === color.hex && '✓'}
                                </button>
                            ))}
                        </div>

                        <h4>Custom Color</h4>
                        <div className="custom-color">
                            <input
                                type="color"
                                value={protocolColor}
                                onChange={e => setProtocolColor(e.target.value)}
                            />
                            <input
                                type="text"
                                value={protocolColor}
                                onChange={e => setProtocolColor(e.target.value)}
                                placeholder="#1976D2"
                            />
                        </div>
                    </div>
                )}

                {/* Step 3: Pattern */}
                {step === 'pattern' && (
                    <div className="wizard-step pattern-step">
                        <h3>Step 3: Choose Card Pattern</h3>

                        <div className="pattern-selection-grid">
                            {CARD_PATTERNS.map(pattern => {
                                const previewStyle = getPatternPreviewStyle(pattern.value, protocolColor);
                                return (
                                    <div
                                        key={pattern.value}
                                        className={`pattern-option ${protocolPattern === pattern.value ? 'selected' : ''}`}
                                        onClick={() => setProtocolPattern(pattern.value)}
                                    >
                                        <div className={`pattern-preview`} style={previewStyle}>
                                            {protocolName || 'Protocol'}-0
                                        </div>
                                        <h4>{pattern.name}</h4>
                                        <p>{pattern.description}</p>
                                        {protocolPattern === pattern.value && <div className="selected-badge">✓ Selected</div>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 4: Cards */}
                {step === 'cards' && (
                    <div className="wizard-step cards-step">
                        <h3>Step 4: Configure Cards</h3>

                        {/* Card Navigation Buttons */}
                        <div className="card-navigation">
                            {cards.map((card, index) => (
                                <button
                                    key={index}
                                    className={`card-nav-btn ${currentCardIndex === index ? 'active' : ''}`}
                                    onClick={() => setCurrentCardIndex(index)}
                                    type="button"
                                >
                                    Card {card.value}
                                </button>
                            ))}
                        </div>

                        <CardEditor
                            card={cards[currentCardIndex]}
                            protocolName={protocolName}
                            protocolColor={protocolColor}
                            protocolPattern={protocolPattern as any}
                            onChange={handleUpdateCard}
                        />
                    </div>
                )}
            </div>

            <div className="wizard-actions">
                <div className="wizard-actions-left">
                    <button onClick={onCancel} className="btn btn-back">
                        Cancel
                    </button>

                    {initialProtocol && onDelete && (
                        <button onClick={() => setShowDeleteModal(true)} className="btn btn-delete">
                            Delete Protocol
                        </button>
                    )}
                </div>

                <div className="wizard-actions-right">
                    {/* For existing protocols: always show Export JSON and Save */}
                    {initialProtocol && (
                        <>
                            <button onClick={handleExport} className="btn btn-export">
                                Export JSON
                            </button>
                            <button onClick={handleFinish} className="btn">
                                Save
                            </button>
                        </>
                    )}

                    {/* For new protocols: show Next until cards step, then Save */}
                    {!initialProtocol && (
                        <>
                            {step !== 'cards' && (
                                <button onClick={handleNextStep} className="btn">
                                    Next
                                </button>
                            )}

                            {step === 'cards' && (
                                <>
                                    <button onClick={handleExport} className="btn btn-export">
                                        Export JSON
                                    </button>
                                    <button onClick={handleFinish} className="btn">
                                        Save
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Export JSON Modal */}
            {showExportModal && (
                <div className="custom-protocol-modal-overlay" onClick={() => setShowExportModal(false)}>
                    <div className="custom-protocol-modal-content custom-protocol-modal-large" onClick={(e) => e.stopPropagation()}>
                        <h3>Export Protocol JSON</h3>
                        <p>Copy the JSON below to share or backup your protocol:</p>

                        <textarea
                            value={exportJson}
                            readOnly
                            rows={15}
                            className="export-textarea"
                            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                        />

                        <div className="custom-protocol-modal-actions">
                            <button onClick={() => setShowExportModal(false)} className="btn btn-back">
                                Close
                            </button>
                            <button onClick={handleCopyJson} className="btn">
                                Copy to Clipboard
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Protocol Modal */}
            {showDeleteModal && (
                <div className="custom-protocol-modal-overlay" onClick={() => setShowDeleteModal(false)}>
                    <div className="custom-protocol-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Delete Protocol</h3>
                        <p>Are you sure you want to delete "{protocolName}"?</p>
                        <p style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }}>
                            This action cannot be undone.
                        </p>

                        <div className="custom-protocol-modal-actions">
                            <button onClick={() => setShowDeleteModal(false)} className="btn btn-back">
                                Cancel
                            </button>
                            <button onClick={handleDelete} className="btn btn-delete">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
