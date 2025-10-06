/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GameState } from '../types';
import { allScenarios, TestScenario } from '../utils/testScenarios';

interface DebugPanelProps {
    onLoadScenario: (setup: (state: GameState) => GameState) => void;
    onSkipCoinFlip?: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ onLoadScenario, onSkipCoinFlip }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    position: 'fixed',
                    top: '20px',
                    left: '20px',
                    padding: '10px 20px',
                    backgroundColor: '#ff6b6b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    zIndex: 9999,
                    fontSize: '14px',
                }}
            >
                🐛 DEBUG
            </button>
        );
    }

    return (
        <div
            style={{
                position: 'fixed',
                top: '20px',
                left: '20px',
                width: '400px',
                maxHeight: '600px',
                backgroundColor: '#2c2c2c',
                border: '2px solid #ff6b6b',
                borderRadius: '8px',
                padding: '20px',
                zIndex: 9999,
                overflowY: 'auto',
                color: 'white',
                fontFamily: 'monospace',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h3 style={{ margin: 0 }}>🐛 Debug Panel</h3>
                <button
                    onClick={() => setIsOpen(false)}
                    style={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '20px',
                    }}
                >
                    ✕
                </button>
            </div>

            <div style={{ marginBottom: '15px', fontSize: '12px', color: '#aaa' }}>
                Lade vordefinierte Test-Szenarien zum Testen der Actor/Owner-Fixes.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {allScenarios.map((scenario: TestScenario, index: number) => (
                    <div
                        key={index}
                        style={{
                            backgroundColor: '#1a1a1a',
                            padding: '12px',
                            borderRadius: '5px',
                            border: '1px solid #444',
                        }}
                    >
                        <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#4ecdc4' }}>
                            {scenario.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '10px' }}>
                            {scenario.description}
                        </div>
                        <button
                            onClick={() => {
                                // Skip coin flip first if callback provided
                                if (onSkipCoinFlip) {
                                    onSkipCoinFlip();
                                }
                                // Then load scenario
                                onLoadScenario(scenario.setup);
                                setIsOpen(false);
                            }}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: '#4ecdc4',
                                color: '#1a1a1a',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '12px',
                            }}
                        >
                            Load Scenario
                        </button>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: '20px', fontSize: '11px', color: '#666', textAlign: 'center' }}>
                Drücke ESC oder klicke ✕ zum Schließen
            </div>
        </div>
    );
};
