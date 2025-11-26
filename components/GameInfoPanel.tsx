/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, Player, AnimationState, Difficulty } from '../types';

interface GameInfoPanelProps {
  gameState: GameState;
  turn: Player;
  animationState: AnimationState;
  difficulty?: Difficulty;
  onPlayerClick?: () => void;
  onOpponentClick?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  start: 'Start',
  control: 'Control',
  action: 'Action',
  compile: 'Compile',
  hand_limit: 'Hand Limit',
  end: 'End',
};

export const GameInfoPanel: React.FC<GameInfoPanelProps> = ({ gameState, turn, animationState, difficulty, onPlayerClick, onOpponentClick }) => {
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
    const title = p === 'player' ? 'Player' : `Opponent${difficulty ? ` (${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)})` : ''}`;
    const isCurrentTurn = turn === p;

    return (
      <div className={getSectionClasses(p)} onClick={clickHandler}>
        <div className="info-section-body">
          <h3>{title}</h3>
          {isCurrentTurn && <span className="phase-badge">{PHASE_LABELS[gameState.phase]}</span>}
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