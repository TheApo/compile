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

  const renderInfoSection = (p: Player) => {
    const playerState = p === 'player' ? player : opponent;
    const clickHandler = p === 'player' ? onPlayerClick : onOpponentClick;
    const title = p === 'player' ? 'Player' : 'Opponent';

    return (
      <div className={getSectionClasses(p)} onClick={clickHandler}>
        <div className="info-section-body">
          <h3>{title}</h3>
          <div className="info-line">
            <span>Hand:</span>
            <span>{playerState.hand.length}</span>
          </div>
          <div className="info-line">
            <span>Deck:</span>
            <span>{playerState.deck.length}</span>
          </div>
          <div className="info-line">
            <span>Trash:</span>
            <span>{playerState.discard.length}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="game-info-panel">
      {renderInfoSection('opponent')}
      {renderInfoSection('player')}
    </div>
  );
};