/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StateProtocolModal - For Luck-3: "State a protocol"
 * Player selects a protocol from opponent's unique protocols
 */

import React, { useState } from 'react';
import { GameState } from '../types';

interface StateProtocolModalProps {
    gameState: GameState;
    availableProtocols: string[];
    onConfirm: (protocol: string) => void;
}

export function StateProtocolModal({ gameState, availableProtocols, onConfirm }: StateProtocolModalProps) {
    const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);

    const handleSelect = (protocol: string) => {
        setSelectedProtocol(protocol);
    };

    const handleConfirm = () => {
        if (selectedProtocol !== null) {
            onConfirm(selectedProtocol);
        }
    };

    const getProtocolClass = (protocol: string) => {
        let classes = ['protocol-button'];
        if (selectedProtocol === protocol) classes.push('selected');
        return classes.join(' ');
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content state-protocol-modal" onClick={(e) => e.stopPropagation()}>
                <h2>State a Protocol</h2>
                <p>Choose a protocol from your opponent's cards. If the discarded card matches, you'll delete a card.</p>

                <div className="protocol-selection">
                    {availableProtocols.map(protocol => (
                        <button
                            key={protocol}
                            className={getProtocolClass(protocol)}
                            onClick={() => handleSelect(protocol)}
                        >
                            {protocol}
                        </button>
                    ))}
                </div>

                <div className="modal-actions">
                    <button
                        className="btn"
                        onClick={handleConfirm}
                        disabled={selectedProtocol === null}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}
