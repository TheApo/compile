/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, Player, AnimationState } from '../types';

interface GameInfoPanelProps {
  gameState: GameState;
  turn: Player;
  animationState: AnimationState;
  onPlayerClick?: () => void;
  onOpponentClick?: () => void;
}

export const GameInfoPanel: React.FC<GameInfoPanelProps> = ({ gameState, turn, animationState, onPlayerClick, onOpponentClick }) => {
  const { player, opponent } = gameState;

  const getSectionClasses = (forPlayer: Player) => {
    const classes = ['info-section'];
    classes.push(forPlayer === 'player' ? 'player-info' : 'opponent-info');
    
    if (turn === forPlayer) {
      classes.push('active-turn');
    }
    
    if (animationState?.type === 'drawCard' && animationState.owner === forPlayer) {
      classes.push('is-drawing');
    }
    if (animationState?.type === 'discardCard' && animationState.owner === forPlayer) {
      classes.push('is-discarding');
    }
    
    return classes.join(' ');
  };

  return (
    <div className="game-info-panel">
      <div className={getSectionClasses('opponent')} onClick={onOpponentClick}>
        <h3>Opponent</h3>
        <div className="info-line">
          <span>Hand:</span>
          <span>{opponent.hand.length}</span>
        </div>
        <div className="info-line">
          <span>Deck:</span>
          <span>{opponent.deck.length}</span>
        </div>
        <div className="info-line">
          <span>Discard:</span>
          <span>{opponent.discard.length}</span>
        </div>
      </div>
      <div className={getSectionClasses('player')} onClick={onPlayerClick}>
        <h3>Player</h3>
        <div className="info-line">
          <span>Hand:</span>
          <span>{player.hand.length}</span>
        </div>
        <div className="info-line">
          <span>Deck:</span>
          <span>{player.deck.length}</span>
        </div>
        <div className="info-line">
          <span>Discard:</span>
          <span>{player.discard.length}</span>
        </div>
      </div>
    </div>
  );
};