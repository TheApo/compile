/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import { GameState, Player } from '../types';

interface SwapProtocolsModalProps {
  gameState: GameState;
  targetPlayer: Player;
  onConfirm: (indices: [number, number]) => void;
}

export function SwapProtocolsModal({ gameState, targetPlayer, onConfirm }: SwapProtocolsModalProps) {
    const [initialProtocols] = useState([...gameState[targetPlayer].protocols]);
    const [protocols, setProtocols] = useState([...gameState[targetPlayer].protocols]);
    // Track original indices so we know which positions were swapped
    const [originalIndices, setOriginalIndices] = useState([0, 1, 2]);
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);
    const touchStartY = useRef<number>(0);
    const touchItem = useRef<number | null>(null);
    const touchCurrentY = useRef<number>(0);

    const targetPlayerState = gameState[targetPlayer];
    const otherPlayer = targetPlayer === 'player' ? 'opponent' : 'player';
    const otherPlayerState = gameState[otherPlayer];
    const isPlayerTarget = targetPlayer === 'player';
    const title = isPlayerTarget ? "Swap Your Protocols" : "Swap Opponent's Protocols";

    // Lane values and compiled status stay with the LANE (index), not the protocol
    const laneValues = targetPlayerState.laneValues;
    const laneCompiled = targetPlayerState.compiled;

    // Calculate how many positions have changed
    const changedPositions = useMemo(() => {
        const changed: number[] = [];
        for (let i = 0; i < protocols.length; i++) {
            if (protocols[i] !== initialProtocols[i]) {
                changed.push(i);
            }
        }
        return changed;
    }, [protocols, initialProtocols]);

    // Swap requires EXACTLY 2 positions to be different
    const isValidSwap = changedPositions.length === 2;

    // Get the swapped indices for the callback
    const getSwappedIndices = (): [number, number] => {
        if (changedPositions.length === 2) {
            return [changedPositions[0], changedPositions[1]];
        }
        return [0, 0]; // Should never happen if button is properly disabled
    };

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
            const newOriginalIndices = [...originalIndices];
            // SWAP the two protocols directly
            const temp = newProtocols[dragItem.current];
            newProtocols[dragItem.current] = newProtocols[dragOverItem.current];
            newProtocols[dragOverItem.current] = temp;
            // Also swap the original indices
            const tempIdx = newOriginalIndices[dragItem.current];
            newOriginalIndices[dragItem.current] = newOriginalIndices[dragOverItem.current];
            newOriginalIndices[dragOverItem.current] = tempIdx;
            dragItem.current = null;
            dragOverItem.current = null;
            setProtocols(newProtocols);
            setOriginalIndices(newOriginalIndices);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    // Touch handlers for iPad support
    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>, index: number) => {
        touchItem.current = index;
        touchStartY.current = e.touches[0].clientY;
        touchCurrentY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
        if (touchItem.current === null) return;

        touchCurrentY.current = e.touches[0].clientY;

        // Find which protocol element we're currently over
        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY);

        if (element) {
            const protocolDiv = element.closest('.rearrange-item');
            if (protocolDiv) {
                const allItems = Array.from(protocolDiv.parentElement?.children || []);
                const overIndex = allItems.indexOf(protocolDiv);
                if (overIndex !== -1 && overIndex !== touchItem.current) {
                    dragOverItem.current = overIndex;
                }
            }
        }
    };

    const handleTouchEnd = () => {
        if (touchItem.current !== null && dragOverItem.current !== null && touchItem.current !== dragOverItem.current) {
            const newProtocols = [...protocols];
            const newOriginalIndices = [...originalIndices];
            // SWAP the two protocols directly
            const temp = newProtocols[touchItem.current];
            newProtocols[touchItem.current] = newProtocols[dragOverItem.current];
            newProtocols[dragOverItem.current] = temp;
            // Also swap the original indices
            const tempIdx = newOriginalIndices[touchItem.current];
            newOriginalIndices[touchItem.current] = newOriginalIndices[dragOverItem.current];
            newOriginalIndices[dragOverItem.current] = tempIdx;
            setProtocols(newProtocols);
            setOriginalIndices(newOriginalIndices);
        }
        touchItem.current = null;
        dragOverItem.current = null;
        touchStartY.current = 0;
        touchCurrentY.current = 0;
    };

    const DraggableBar = (
        <div className={`protocol-bar ${isPlayerTarget ? 'player-bar' : 'opponent-bar'} rearrange-editable`} onDragOver={handleDragOver}>
            {protocols.map((protocol, index) => {
                const hasChanged = protocol !== initialProtocols[index];

                // Compiled status follows the PROTOCOL, not the lane position
                const originalIndex = originalIndices[index];
                const isCompiled = laneCompiled[originalIndex];
                const classList = getProtocolClass('protocol-display rearrange-item', isCompiled);

                return (
                    <div
                        key={`${protocol}-${index}`}
                        className={`${classList} ${hasChanged ? 'changed' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnter={(e) => handleDragEnter(e, index)}
                        onDragEnd={handleDragEnd}
                        onTouchStart={(e) => handleTouchStart(e, index)}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                    >
                        <span className="protocol-name">{protocol}</span>
                        <span className="protocol-value">{laneValues[index]}</span>
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

    // Helper text based on current state
    const getHelperText = () => {
        if (changedPositions.length === 0) {
            return "Drag and drop to swap exactly two protocols.";
        } else if (changedPositions.length === 2) {
            return "Two protocols swapped - you can confirm now.";
        } else {
            return `${changedPositions.length} positions changed - swap must change exactly 2 positions.`;
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content rearrange-modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p>{getHelperText()}</p>

                <div className="rearrange-board-view">
                    <div className="protocol-bars-container">
                        {isPlayerTarget ? StaticBar : DraggableBar}
                        {isPlayerTarget ? DraggableBar : StaticBar}
                    </div>
                </div>

                <div className="rearrange-actions">
                    <button
                        className="btn"
                        onClick={() => onConfirm(getSwappedIndices())}
                        disabled={!isValidSwap}
                    >
                        Confirm Swap
                    </button>
                    {changedPositions.length > 2 && (
                        <p className="error-text">Too many changes! Swap only exchanges two protocols.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
