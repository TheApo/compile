/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { GameState } from '../types';

interface SwapProtocolsModalProps {
  gameState: GameState;
  onConfirm: (indices: [number, number]) => void;
  onCancel: () => void;
}

export function SwapProtocolsModal({ gameState, onConfirm, onCancel }: SwapProtocolsModalProps) {
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
    
    const playerState = gameState.player;

    const handleSelect = (index: number) => {
        if (selectedIndices.includes(index)) {
            setSelectedIndices(prev => prev.filter(i => i !== index));
        } else if (selectedIndices.length < 2) {
            setSelectedIndices(prev => [...prev, index]);
        }
    };
    
    const handleConfirm = () => {
        if (selectedIndices.length === 2) {
            onConfirm(selectedIndices as [number, number]);
        }
    }

    const getProtocolClass = (index: number) => {
        let classes = ['protocol-display', 'rearrange-item'];
        if (playerState.compiled[index]) classes.push('compiled');
        if (selectedIndices.includes(index)) classes.push('selected');
        return classes.join(' ');
    }


    return (
        <div className="modal-overlay">
            <div className="modal-content rearrange-modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>Swap Protocols</h2>
                <p>Select two of your protocols to swap their positions.</p>

                <div className="rearrange-board-view">
                    <div className="protocol-bars-container">
                        <div className="protocol-bar player-bar">
                            {playerState.protocols.map((protocol, index) => (
                                <div
                                    key={protocol}
                                    className={getProtocolClass(index)}
                                    onClick={() => handleSelect(index)}
                                >
                                    <span className="protocol-name">{protocol}</span>
                                    <span className="protocol-value">{playerState.laneValues[index]}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="rearrange-actions">
                    <button className="btn" onClick={handleConfirm} disabled={selectedIndices.length !== 2}>Confirm Swap</button>
                    <button className="btn btn-back" onClick={onCancel}>Cancel</button>
                </div>
            </div>
        </div>
    );
}