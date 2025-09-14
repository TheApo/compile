/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Player } from '../App';

interface ResultsScreenProps {
  onPlayAgain: () => void;
  winner: Player | null;
}

export function ResultsScreen({ onPlayAgain, winner }: ResultsScreenProps) {
  const hasWon = winner === 'player'; 

  return (
    <div className="screen">
      <h1>{hasWon ? 'VICTORY' : 'DEFEAT'}</h1>
      <p>{hasWon ? 'System compiled successfully.' : 'Critical error in the mainframe.'}</p>
      <button className="btn" onClick={onPlayAgain}>
        Play Again
      </button>
    </div>
  );
}
