/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StateNumberModal - For Luck-0: "State a number"
 * Player selects a number from 0-5 (card values from their protocols)
 */

import React, { useState } from 'react';
import { GameState } from '../types';

interface StateNumberModalProps {
    gameState: GameState;
    onConfirm: (number: number) => void;
}

export function StateNumberModal({ gameState, onConfirm }: StateNumberModalProps) {
    const [selectedNumber, setSelectedNumber] = useState<number | null>(null);

    const handleSelect = (num: number) => {
        setSelectedNumber(num);
    };

    const handleConfirm = () => {
        if (selectedNumber !== null) {
            onConfirm(selectedNumber);
        }
    };

    const getNumberClass = (num: number) => {
        let classes = ['number-button'];
        if (selectedNumber === num) classes.push('selected');
        return classes.join(' ');
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content state-number-modal" onClick={(e) => e.stopPropagation()}>
                <h2>State a Number</h2>
                <p>Choose a number (0-5) to state. Cards drawn with this value may be revealed and played.</p>

                <div className="number-selection">
                    {[0, 1, 2, 3, 4, 5].map(num => (
                        <button
                            key={num}
                            className={getNumberClass(num)}
                            onClick={() => handleSelect(num)}
                        >
                            {num}
                        </button>
                    ))}
                </div>

                <div className="modal-actions">
                    <button
                        className="btn"
                        onClick={handleConfirm}
                        disabled={selectedNumber === null}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}
