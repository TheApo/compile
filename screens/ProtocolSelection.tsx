/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import { uniqueProtocols, cards, Card as CardData } from '../data/cards';
import { CardComponent } from '../components/Card';


interface ProtocolSelectionProps {
  onBack: () => void;
  onStartGame: (playerProtocols: string[], opponentProtocols: string[]) => void;
}

const SELECTION_STEPS = [
    { player: 'Player', picks: 1 },
    { player: 'Opponent', picks: 2 },
    { player: 'Player', picks: 2 },
    { player: 'Opponent', picks: 1 },
];

export function ProtocolSelection({ onBack, onStartGame }: ProtocolSelectionProps) {
  const [step, setStep] = useState(0);
  const [playerProtocols, setPlayerProtocols] = useState<string[]>([]);
  const [opponentProtocols, setOpponentProtocols] = useState<string[]>([]);
  const [currentSelection, setCurrentSelection] = useState<string[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [scanningProtocol, setScanningProtocol] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<CardData | null>(null);

  const currentStepInfo = SELECTION_STEPS[step];
  const isPlayerTurn = currentStepInfo?.player === 'Player';
  const isOpponentTurn = currentStepInfo?.player === 'Opponent';

  const chosenProtocols = useMemo(() => new Set([...playerProtocols, ...opponentProtocols]), [playerProtocols, opponentProtocols]);
  
  const selectedProtocolsWithCards = useMemo(() => {
    return currentSelection.map(protocolName => ({
        name: protocolName,
        cards: cards.filter(c => c.protocol === protocolName).sort((a, b) => a.value - b.value)
    }));
  }, [currentSelection]);

  const handleSelectProtocol = (protocol: string) => {
    if (!isPlayerTurn || isAnimating) return;

    setCurrentSelection(prev => {
      // If the clicked protocol is already selected, deselect it.
      if (prev.includes(protocol)) {
        return prev.filter(p => p !== protocol);
      }

      // If the selection isn't full yet, add the new protocol.
      if (prev.length < currentStepInfo.picks) {
        return [...prev, protocol];
      }

      // If the selection is full, replace the oldest selection (first in the array).
      if (prev.length === currentStepInfo.picks) {
        const newSelection = prev.slice(1); // Remove the first element
        newSelection.push(protocol); // Add the new one to the end
        return newSelection;
      }

      return prev; // Fallback
    });
  };

  const confirmSelection = async () => {
    if (!isPlayerTurn || isAnimating || currentSelection.length !== currentStepInfo.picks) return;

    setIsAnimating(true);
    const selectionToAnimate = [...currentSelection];
    setCurrentSelection([]);

    for (const protocol of selectionToAnimate) {
        setPlayerProtocols(prev => [...prev, protocol]);
        await new Promise(resolve => setTimeout(resolve, 300)); // Staggered reveal
    }
    
    setIsAnimating(false);
    setStep(prev => prev + 1);
  };
  
  // This consolidated effect handles the entire opponent turn logic
  useEffect(() => {
    if (isOpponentTurn && !isAnimating && step < SELECTION_STEPS.length) {
      
      const runOpponentTurn = async () => {
        setIsAnimating(true);
        
        // "Thinking" delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // DEBUG: Force AI to pick specific protocols for testing
        const debugProtocols = ["Gravity"];

        // Select protocols
        const availableForOpponent = uniqueProtocols.filter(p => !chosenProtocols.has(p));
        const opponentChoices: string[] = [];
        
        const availableDebugProtocols = debugProtocols.filter(p => availableForOpponent.includes(p));

        for(let i=0; i < currentStepInfo.picks; i++) {
            if (availableDebugProtocols.length > 0) {
                // Prioritize debug protocols
                const choice = availableDebugProtocols.shift()!;
                opponentChoices.push(choice);
                // Also remove it from the general pool to avoid being picked randomly if debug choices run out
                const indexInAvailable = availableForOpponent.indexOf(choice);
                if (indexInAvailable > -1) {
                    availableForOpponent.splice(indexInAvailable, 1);
                }
            } else if (availableForOpponent.length > 0) {
                // Fallback to random if debug choices are unavailable or exhausted
                const randomIndex = Math.floor(Math.random() * availableForOpponent.length);
                opponentChoices.push(availableForOpponent.splice(randomIndex, 1)[0]);
            }
        }

        // Reveal choices with animation sequentially
        for (const protocol of opponentChoices) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay before scanning
            
            setScanningProtocol(protocol);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Scan animation duration
            setScanningProtocol(null);

            setOpponentProtocols(prev => [...prev, protocol]);
        }
        
        // End of turn
        setIsAnimating(false);
        setStep(prev => prev + 1);
      };

      runOpponentTurn();
    }
  }, [step, isOpponentTurn, isAnimating, chosenProtocols, currentStepInfo]);


  // Finalizing and starting the game
  useEffect(() => {
    if (step >= SELECTION_STEPS.length && !isAnimating) {
        setTimeout(() => {
            onStartGame(playerProtocols, opponentProtocols);
        }, 1000); // 1-second delay after the final protocol is revealed
    }
  }, [step, isAnimating, onStartGame, playerProtocols, opponentProtocols]);
  
  const getCardClassName = (protocol: string) => {
      let className = 'protocol-card';
      if (currentSelection.includes(protocol)) className += ' selected';
      if (chosenProtocols.has(protocol)) className += ' chosen';
      if (scanningProtocol === protocol) className += ' is-scanning';
      return className;
  };

  const getStatusMessage = () => {
      if (isAnimating && isOpponentTurn) return "Opponent is selecting protocols...";
      if (currentStepInfo?.player === 'Player') {
          return `Player, select ${currentStepInfo.picks} protocol(s). (${currentSelection.length}/${currentStepInfo.picks})`;
      }
      if (step >= SELECTION_STEPS.length) {
        return "Finalizing selections...";
      }
      return "Waiting for Opponent...";
  }

  return (
    <div className="screen protocol-selection-screen">
      <Header title="Protocol Selection" onBack={onBack} />
      <div className="protocol-selection-layout">
        <div className="protocol-selection-sidebar">
          <div className="player-protocols-area">
            <h3>Your Protocols</h3>
            {playerProtocols.map(p => (
              <div key={p} className="protocol-display-card player">{p}</div>
            ))}
          </div>
          <div className="protocol-preview-area">
            {previewCard ? (
                <CardComponent card={{...previewCard, id: 'preview', isFaceUp: true}} isFaceUp={true} />
            ) : (
                <p>
                  {selectedProtocolsWithCards.length > 0
                    ? "Hover over a card below to see details."
                    : "Select a protocol to see its cards."}
                </p>
            )}
          </div>
        </div>
        
        <div className="protocol-grid-container">
          <p>{getStatusMessage()}</p>
          <div className="protocol-grid">
            {uniqueProtocols.map((protocol) => (
              <div
                key={protocol}
                className={getCardClassName(protocol)}
                onClick={() => handleSelectProtocol(protocol)}
                role="button"
                aria-disabled={chosenProtocols.has(protocol) || !isPlayerTurn || isAnimating}
                tabIndex={!chosenProtocols.has(protocol) && isPlayerTurn && !isAnimating ? 0 : -1}
                onKeyPress={(e) => e.key === 'Enter' && handleSelectProtocol(protocol)}
              >
                {protocol}
              </div>
            ))}
          </div>
          {isPlayerTurn && (
              <button 
                className="btn" 
                onClick={confirmSelection} 
                disabled={isAnimating || currentSelection.length !== currentStepInfo?.picks}
              >
                Confirm Selection
              </button>
          )}
        </div>

        <div className="opponent-protocols-area">
          <h3>Opponent Protocols</h3>
          {opponentProtocols.map(p => (
            <div key={p} className="protocol-display-card opponent">{p}</div>
          ))}
        </div>
      </div>

      <div className="selected-protocol-cards-container">
        {selectedProtocolsWithCards.length > 0 && [...selectedProtocolsWithCards].reverse().map(proto => (
            <div key={proto.name} className="protocol-card-row">
              {proto.cards.map(card => (
                <CardComponent
                  key={`${proto.name}-${card.value}`}
                  card={{ ...card, id: `selection-${card.protocol}-${card.value}`, isFaceUp: true }}
                  isFaceUp={true}
                  additionalClassName="in-hand"
                  onMouseEnter={() => setPreviewCard(card)}
                  onMouseLeave={() => setPreviewCard(null)}
                />
              ))}
            </div>
        ))}
      </div>
    </div>
  );
}