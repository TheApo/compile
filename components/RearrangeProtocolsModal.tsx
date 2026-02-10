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
    // Track original indices so compiled status follows the protocol
    const [originalIndices, setOriginalIndices] = useState([0, 1, 2]);
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);
    const touchStartY = useRef<number>(0);
    const touchItem = useRef<number | null>(null);
    const touchCurrentY = useRef<number>(0);

    // Extract Anarchy-3 restriction from actionRequired
    const disallowedProtocolForLane = gameState.actionRequired?.type === 'prompt_rearrange_protocols'
        ? gameState.actionRequired.disallowedProtocolForLane
        : undefined;

    const protocolsHaveChanged = useMemo(() => {
        if (protocols.length !== initialProtocols.length) return false; // Should not happen
        for (let i = 0; i < protocols.length; i++) {
            if (protocols[i] !== initialProtocols[i]) {
                return true;
            }
        }
        return false;
    }, [protocols, initialProtocols]);

    // Check if current arrangement violates Anarchy-3 restriction
    const hasViolation = useMemo(() => {
        if (!disallowedProtocolForLane) return false;
        const { laneIndex, protocol } = disallowedProtocolForLane;
        return protocols[laneIndex] === protocol;
    }, [protocols, disallowedProtocolForLane]);

    const targetPlayerState = gameState[targetPlayer];
    const otherPlayer = targetPlayer === 'player' ? 'opponent' : 'player';
    const otherPlayerState = gameState[otherPlayer];

    // Lane values and compiled status stay with the LANE (index), not the protocol
    // So we use the current index to get lane data, not the protocol name
    const laneValues = targetPlayerState.laneValues;
    const laneCompiled = targetPlayerState.compiled;

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
            // SWAP the two protocols directly (don't shift all in between)
            const temp = newProtocols[dragItem.current];
            newProtocols[dragItem.current] = newProtocols[dragOverItem.current];
            newProtocols[dragOverItem.current] = temp;
            // Also swap the original indices so compiled status follows the protocol
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
            // SWAP the two protocols directly (don't shift all in between)
            const temp = newProtocols[touchItem.current];
            newProtocols[touchItem.current] = newProtocols[dragOverItem.current];
            newProtocols[dragOverItem.current] = temp;
            // Also swap the original indices so compiled status follows the protocol
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

    const isPlayerTarget = targetPlayer === 'player';
    const title = isPlayerTarget ? "Rearrange Your Protocols" : "Rearrange Opponent's Protocols";

    const DraggableBar = (
        <div className={`protocol-bar ${isPlayerTarget ? 'player-bar' : 'opponent-bar'} rearrange-editable`} onDragOver={handleDragOver}>
            {protocols.map((protocol, index) => {
                const hasChanged = protocol !== initialProtocols[index];

                // Check if this slot violates the Anarchy-3 restriction
                const isViolation = disallowedProtocolForLane
                    && disallowedProtocolForLane.laneIndex === index
                    && protocol === disallowedProtocolForLane.protocol;

                // Compiled status follows the PROTOCOL, not the lane position
                // Use originalIndices to find which lane was originally compiled
                const originalIndex = originalIndices[index];
                const isCompiled = laneCompiled[originalIndex];
                const classList = getProtocolClass('protocol-display rearrange-item', isCompiled);

                return (
                    <div
                        key={`${protocol}-${index}`}
                        className={`${classList} ${hasChanged ? 'changed' : ''} ${isViolation ? 'violation' : ''}`}
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


    return (
        <div className="modal-overlay">
            <div className="modal-content rearrange-modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p>Drag and drop the protocols to reorder them. You must change the order to continue.</p>

                {disallowedProtocolForLane && (
                    <p className="warning-text">
                        ⚠️ <strong>{disallowedProtocolForLane.protocol}</strong> cannot be placed on line <strong>{disallowedProtocolForLane.laneIndex}</strong> due to Anarchy-3's restriction.
                    </p>
                )}

                <div className="rearrange-board-view">
                    <div className="protocol-bars-container">
                        {isPlayerTarget ? StaticBar : DraggableBar}
                        {isPlayerTarget ? DraggableBar : StaticBar}
                    </div>
                </div>

                <div className="rearrange-actions">
                    <button
                        className="btn"
                        onClick={() => onConfirm(protocols)}
                        disabled={!protocolsHaveChanged || hasViolation}
                    >
                        Confirm Rearrangement
                    </button>
                    {hasViolation && (
                        <p className="error-text">Cannot confirm: {disallowedProtocolForLane!.protocol} is on line {disallowedProtocolForLane!.laneIndex}</p>
                    )}
                </div>
            </div>
        </div>
    );
}