/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';

type CoinSide = 'heads' | 'tails';
type FlipPhase = 'choose' | 'flipping' | 'result';

interface CoinFlipModalProps {
  onComplete: (startingPlayer: 'player' | 'opponent', choice: CoinSide, won: boolean) => void;
}

export function CoinFlipModal({ onComplete }: CoinFlipModalProps) {
  const [phase, setPhase] = useState<FlipPhase>('choose');
  const [playerChoice, setPlayerChoice] = useState<CoinSide | null>(null);
  const [flipResult, setFlipResult] = useState<CoinSide | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);

  const handleChoice = (choice: CoinSide) => {
    setPlayerChoice(choice);
    setPhase('flipping');
    setIsFlipping(true);

    // Determine result (50/50)
    const result: CoinSide = Math.random() < 0.5 ? 'heads' : 'tails';

    // Wait for animation to complete
    setTimeout(() => {
      setFlipResult(result);
      setIsFlipping(false);
      setPhase('result');
    }, 2000); // 2 seconds for flip animation
  };

  const handleContinue = () => {
    if (flipResult === null || playerChoice === null) return;

    // Player wins if their choice matches the result
    const won = flipResult === playerChoice;
    const startingPlayer = won ? 'player' : 'opponent';
    onComplete(startingPlayer, playerChoice, won);
  };

  return (
    <div className="coin-flip-modal-overlay">
      <div className="modal-content coin-flip-modal-content" onClick={(e) => e.stopPropagation()}>
        {phase === 'choose' && (
          <>
            <h2>Coin Flip</h2>
            <p>Choose heads or tails to determine who starts the game.</p>
            <div className="coin-flip-choices">
              <button
                className="btn coin-flip-choice-btn"
                onClick={() => handleChoice('heads')}
              >
                <div className="coin-choice-icon">H</div>
                <div className="coin-choice-label">Heads</div>
              </button>
              <button
                className="btn coin-flip-choice-btn"
                onClick={() => handleChoice('tails')}
              >
                <div className="coin-choice-icon">T</div>
                <div className="coin-choice-label">Tails</div>
              </button>
            </div>
          </>
        )}

        {phase === 'flipping' && (
          <>
            <h2>Flipping...</h2>
            <p>You chose: <span className="coin-flip-highlight">{playerChoice === 'heads' ? 'Heads' : 'Tails'}</span></p>
            <div className="coin-flip-animation-container">
              <div className={`coin-3d ${isFlipping ? 'is-flipping' : ''}`}>
                <div className="coin-face coin-heads">H</div>
                <div className="coin-face coin-tails">T</div>
              </div>
            </div>
          </>
        )}

        {phase === 'result' && flipResult && playerChoice && (
          <>
            <h2>Result</h2>
            <p>You chose: <span className="coin-flip-highlight">{playerChoice === 'heads' ? 'Heads' : 'Tails'}</span></p>
            <div className="coin-flip-animation-container">
              <div className={`coin-3d result-${flipResult}`}>
                <div className="coin-face coin-heads">H</div>
                <div className="coin-face coin-tails">T</div>
              </div>
            </div>
            <p className="coin-flip-result-text">
              The coin landed on: <span className="coin-flip-highlight">{flipResult === 'heads' ? 'Heads' : 'Tails'}</span>
            </p>
            {flipResult === playerChoice ? (
              <p className="coin-flip-winner-text">You won! You will start the game.</p>
            ) : (
              <p className="coin-flip-loser-text">Opponent won! Opponent will start the game.</p>
            )}
            <button className="btn" onClick={handleContinue}>
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
