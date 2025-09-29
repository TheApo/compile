/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { GameState, Player } from '../types';

interface SwapProtocolsModalProps {
  gameState: GameState;
  targetPlayer: Player;
  onConfirm: (indices: [number, number]) => void;
}

export function SwapProtocolsModal({ gameState, targetPlayer, onConfirm }: SwapProtocolsModalProps) {
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
    
    const targetPlayerState = gameState[targetPlayer];
    const isPlayerTarget = targetPlayer === 'player';
    const title = isPlayerTarget ? "Swap Your Protocols" : "Swap Opponent's Protocols";

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
        if (targetPlayerState.compiled[index]) classes.push('compiled');
        if (selectedIndices.includes(index)) classes.push('selected');
        return classes.join(' ');
    }


    return (
        <div className="modal-overlay">
            <div className="modal-content rearrange-modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p>Select two protocols to swap their positions. This action is mandatory.</p>

                <div className="rearrange-board-view">
                    <div className="protocol-bars-container">
                        <div className={`protocol-bar ${isPlayerTarget ? 'player-bar' : 'opponent-bar'}`}>
                            {targetPlayerState.protocols.map((protocol, index) => (
                                <div
                                    key={protocol}
                                    className={getProtocolClass(index)}
                                    onClick={() => handleSelect(index)}
                                >
                                    <span className="protocol-name">{protocol}</span>
                                    <span className="protocol-value">{targetPlayerState.laneValues[index]}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="rearrange-actions">
                    <button className="btn" onClick={handleConfirm} disabled={selectedIndices.length !== 2}>Confirm Swap</button>
                </div>
            </div>
        </div>
    );
}