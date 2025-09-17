/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import { GameState, Player } from '../types';

interface RearrangeProtocolsModalProps {
  gameState: GameState;
  targetPlayer: Player;
  onConfirm: (newOrder: string[]) => void;
}

export function RearrangeProtocolsModal({ gameState, targetPlayer, onConfirm }: RearrangeProtocolsModalProps) {
    const [initialProtocols] = useState([...gameState[targetPlayer].protocols]);
    const [protocols, setProtocols] = useState([...gameState[targetPlayer].protocols]);
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);

    const protocolsHaveChanged = useMemo(() => {
        if (protocols.length !== initialProtocols.length) return false; // Should not happen
        for (let i = 0; i < protocols.length; i++) {
            if (protocols[i] !== initialProtocols[i]) {
                return true;
            }
        }
        return false;
    }, [protocols, initialProtocols]);

    const targetPlayerState = gameState[targetPlayer];
    const otherPlayer = targetPlayer === 'player' ? 'opponent' : 'player';
    const otherPlayerState = gameState[otherPlayer];

    // Create a stable mapping of protocol name to its original data (value, compiled status)
    const originalProtocolData = useMemo(() => {
        const data: { [key: string]: { value: number; compiled: boolean } } = {};
        targetPlayerState.protocols.forEach((proto, index) => {
            data[proto] = {
                value: targetPlayerState.laneValues[index],
                compiled: targetPlayerState.compiled[index],
            };
        });
        return data;
    }, [targetPlayerState.protocols, targetPlayerState.laneValues, targetPlayerState.compiled]);

    const getProtocolClass = (baseClass: string, isCompiled: boolean) => {
        let classes = [baseClass];
        if (isCompiled) classes.push('compiled');
        return classes.join(' ');
    }

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        dragItem.current = index;
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        dragOverItem.current = index;
    };

    const handleDragEnd = () => {
        if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
            const newProtocols = [...protocols];
            const draggedItemContent = newProtocols.splice(dragItem.current, 1)[0];
            newProtocols.splice(dragOverItem.current, 0, draggedItemContent);
            dragItem.current = null;
            dragOverItem.current = null;
            setProtocols(newProtocols);
        }
    };
    
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const isPlayerTarget = targetPlayer === 'player';
    const title = isPlayerTarget ? "Rearrange Your Protocols" : "Rearrange Opponent's Protocols";

    const DraggableBar = (
        <div className={`protocol-bar ${isPlayerTarget ? 'player-bar' : 'opponent-bar'}`} onDragOver={handleDragOver}>
            {protocols.map((protocol, index) => {
                const data = originalProtocolData[protocol];
                const hasChanged = protocol !== initialProtocols[index];
                const classList = getProtocolClass('protocol-display rearrange-item', data.compiled);

                return (
                    <div
                        key={protocol}
                        className={`${classList} ${hasChanged ? 'changed' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnter={(e) => handleDragEnter(e, index)}
                        onDragEnd={handleDragEnd}
                    >
                        <span className="protocol-name">{protocol}</span>
                        <span className="protocol-value">{data.value}</span>
                    </div>
                );
            })}
        </div>
    );
    
    const StaticBar = (
         <div className={`protocol-bar ${!isPlayerTarget ? 'player-bar' : 'opponent-bar'}`}>
            {otherPlayerState.protocols.map((p, i) => 
                <div key={`other-proto-${p}-${i}`} className={getProtocolClass('protocol-display', otherPlayerState.compiled[i])}>
                    <span className="protocol-name">{p}</span>
                    <span className="protocol-value">{otherPlayerState.laneValues[i]}</span>
                </div>
            )}
        </div>
    );


    return (
        <div className="modal-overlay">
            <div className="modal-content rearrange-modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p>Drag and drop the protocols to reorder them. You must change the order to continue.</p>

                <div className="rearrange-board-view">
                    <div className="protocol-bars-container">
                        {isPlayerTarget ? StaticBar : DraggableBar}
                        {isPlayerTarget ? DraggableBar : StaticBar}
                    </div>
                </div>

                <div className="rearrange-actions">
                    <button className="btn" onClick={() => onConfirm(protocols)} disabled={!protocolsHaveChanged}>
                        Confirm Rearrangement
                    </button>
                </div>
            </div>
        </div>
    );
}