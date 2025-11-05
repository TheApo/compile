/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CustomProtocolDefinition, CustomCardDefinition } from '../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { CardEditor } from './CardEditor';

interface ProtocolWizardProps {
    onSave: (protocol: CustomProtocolDefinition) => void;
    onCancel: () => void;
    initialProtocol?: CustomProtocolDefinition;
}

type WizardStep = 'name' | 'color' | 'pattern' | 'cards';

const PREDEFINED_COLORS = [
    { name: 'Rot (Fire)', hex: '#D32F2F' },
    { name: 'Blau (Water)', hex: '#1976D2' },
    { name: 'Grün (Life)', hex: '#388E3C' },
    { name: 'Gelb (Light)', hex: '#F57C00' },
    { name: 'Lila (Psychic)', hex: '#7B1FA2' },
    { name: 'Grau (Metal)', hex: '#616161' },
    { name: 'Schwarz (Death)', hex: '#212121' },
    { name: 'Weiß (Spirit)', hex: '#FAFAFA' },
    { name: 'Braun (Gravity)', hex: '#5D4037' },
    { name: 'Pink (Love)', hex: '#C2185B' },
    { name: 'Türkis (Frost)', hex: '#00ACC1' },
    { name: 'Orange (Hate)', hex: '#E64A19' },
];

const CARD_PATTERNS = [
    { name: 'Solid', value: 'solid', description: 'Einfarbiger Hintergrund' },
    { name: 'Gradient', value: 'gradient', description: 'Farbverlauf' },
    { name: 'Diagonal', value: 'diagonal', description: 'Diagonale Linien' },
    { name: 'Dots', value: 'dots', description: 'Punktmuster' },
];

export const ProtocolWizard: React.FC<ProtocolWizardProps> = ({ onSave, onCancel, initialProtocol }) => {
    const [step, setStep] = useState<WizardStep>('name');
    const [currentCardIndex, setCurrentCardIndex] = useState(0);

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

    const handleNextStep = () => {
        if (step === 'name') {
            if (!protocolName.trim()) {
                alert('Bitte gib einen Protokoll-Namen ein.');
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

    return (
        <div className="protocol-wizard">
            <div className="wizard-header">
                <h2>
                    {initialProtocol ? 'Protokoll Bearbeiten' : 'Neues Protokoll Erstellen'}
                </h2>
                <div className="wizard-progress">
                    <div className={`step ${step === 'name' ? 'active' : 'done'}`}>1. Name</div>
                    <div className={`step ${step === 'color' ? 'active' : step === 'pattern' || step === 'cards' ? 'done' : ''}`}>
                        2. Farbe
                    </div>
                    <div className={`step ${step === 'pattern' ? 'active' : step === 'cards' ? 'done' : ''}`}>
                        3. Muster
                    </div>
                    <div className={`step ${step === 'cards' ? 'active' : ''}`}>4. Karten</div>
                </div>
            </div>

            <div className="wizard-content">
                {/* Step 1: Name */}
                {step === 'name' && (
                    <div className="wizard-step name-step">
                        <h3>Schritt 1: Name und Beschreibung</h3>

                        <label>
                            Protokoll-Name *
                            <input
                                type="text"
                                value={protocolName}
                                onChange={e => setProtocolName(e.target.value)}
                                placeholder="z.B. Lightning, Shadow, Void"
                                autoFocus
                            />
                        </label>

                        <label>
                            Beschreibung
                            <textarea
                                value={protocolDescription}
                                onChange={e => setProtocolDescription(e.target.value)}
                                placeholder="Beschreibe die Strategie und das Thema deines Protokolls"
                                rows={4}
                            />
                        </label>
                    </div>
                )}

                {/* Step 2: Color */}
                {step === 'color' && (
                    <div className="wizard-step color-step">
                        <h3>Schritt 2: Farbe wählen</h3>

                        <div className="color-preview" style={{ backgroundColor: protocolColor }}>
                            <span>{protocolName || 'Dein Protokoll'}</span>
                        </div>

                        <h4>Vordefinierte Farben</h4>
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

                        <h4>Eigene Farbe</h4>
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
                        <h3>Schritt 3: Karten-Muster wählen</h3>

                        <div className="pattern-grid">
                            {CARD_PATTERNS.map(pattern => (
                                <div
                                    key={pattern.value}
                                    className={`pattern-option ${protocolPattern === pattern.value ? 'selected' : ''}`}
                                    onClick={() => setProtocolPattern(pattern.value)}
                                >
                                    <div className={`pattern-preview ${pattern.value}`} style={{ backgroundColor: protocolColor }}>
                                        {protocolName || 'Protokoll'}-0
                                    </div>
                                    <h4>{pattern.name}</h4>
                                    <p>{pattern.description}</p>
                                    {protocolPattern === pattern.value && <div className="selected-badge">✓ Ausgewählt</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 4: Cards */}
                {step === 'cards' && (
                    <div className="wizard-step cards-step">
                        <h3>
                            Schritt 4: Karten konfigurieren ({currentCardIndex + 1}/6)
                        </h3>

                        <CardEditor
                            card={cards[currentCardIndex]}
                            protocolName={protocolName}
                            protocolColor={protocolColor}
                            onChange={handleUpdateCard}
                        />
                    </div>
                )}
            </div>

            <div className="wizard-actions">
                <button onClick={onCancel} className="btn btn-back">
                    Abbrechen
                </button>

                {step !== 'name' && (
                    <button onClick={step === 'cards' ? handlePreviousCard : handlePreviousStep} className="btn btn-back">
                        {step === 'cards' && currentCardIndex > 0 ? 'Vorherige Karte' : 'Zurück'}
                    </button>
                )}

                {step !== 'cards' && (
                    <button onClick={handleNextStep} className="btn">
                        Weiter
                    </button>
                )}

                {step === 'cards' && (
                    <button onClick={handleNextCard} className="btn">
                        {currentCardIndex < 5 ? 'Nächste Karte' : 'Fertig'}
                    </button>
                )}
            </div>
        </div>
    );
};
