/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameState, Player, Difficulty, GamePhase } from '../types';
import { PHASE_TRANSITION_DURATION } from '../constants/animationTiming';

interface GameInfoPanelProps {
  gameState: GameState;
  turn: Player;
  difficulty?: Difficulty;
  // Phase transition animation data from the animation queue
  phaseTransitionAnimation?: {
    phaseSequence: Array<{ phase: GamePhase; turn: Player }>;
    duration: number;
  } | null;
  // Override phase/turn during non-phaseTransition animations (from snapshot)
  overridePhase?: GamePhase;
  overrideTurn?: Player;
  onPlayerClick?: () => void;
  onOpponentClick?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  start: 'Start',
  control: 'Control',
  compile: 'Compile',
  action: 'Action',
  hand_limit: 'Hand Limit',
  end: 'End',
};

// All phases in order for the TurnPhaseIndicator
const ALL_PHASES: GamePhase[] = ['start', 'control', 'compile', 'action', 'hand_limit', 'end'];

export const GameInfoPanel: React.FC<GameInfoPanelProps> = ({ gameState, turn, difficulty, phaseTransitionAnimation, overridePhase, overrideTurn, onPlayerClick, onOpponentClick }) => {
  const { player, opponent } = gameState;

  // State for animated phase display
  const [displayedPhase, setDisplayedPhase] = useState<GamePhase>(gameState.phase);
  const [displayedTurn, setDisplayedTurn] = useState<Player>(turn);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Animation effect: Use phaseTransitionAnimation when provided, otherwise sync to current state
  useEffect(() => {
    // Clear any existing animation timer
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }

    // Priority 1: Phase transition animation (animated sequence)
    if (phaseTransitionAnimation) {
      const { phaseSequence, duration } = phaseTransitionAnimation;

      if (phaseSequence.length === 0) {
        return;
      }

      // Calculate step duration based on total duration and number of steps
      const stepDuration = duration / phaseSequence.length;

      let stepIndex = 0;
      const animateNextStep = () => {
        if (stepIndex < phaseSequence.length) {
          const step = phaseSequence[stepIndex];
          setDisplayedPhase(step.phase);
          setDisplayedTurn(step.turn);
          stepIndex++;

          // Schedule next step if there are more
          if (stepIndex < phaseSequence.length) {
            animationTimeoutRef.current = setTimeout(animateNextStep, stepDuration);
          }
        }
      };

      // Start animation immediately
      animateNextStep();

      return () => {
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
          animationTimeoutRef.current = null;
        }
      };
    }

    // Priority 2: Override phase/turn from animation snapshot (non-phaseTransition animations)
    if (overridePhase) {
      setDisplayedPhase(overridePhase);
      setDisplayedTurn(overrideTurn ?? turn);
      return;
    }

    // Priority 3: No animation active - sync to current game state
    setDisplayedPhase(gameState.phase);
    setDisplayedTurn(turn);
  }, [phaseTransitionAnimation, gameState.phase, turn, overridePhase, overrideTurn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const getSectionClasses = (forPlayer: Player) => {
    const classes = ['info-section'];
    classes.push(forPlayer === 'player' ? 'player-info' : 'opponent-info');

    if (turn === forPlayer) {
      classes.push('active-turn');
    }

    return classes.join(' ');
  };

  const renderInfoSection = (p: Player) => {
    const playerState = p === 'player' ? player : opponent;
    const clickHandler = p === 'player' ? onPlayerClick : onOpponentClick;
    const title = p === 'player' ? 'Player' : `Opponent${difficulty ? ` (${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)})` : ''}`;
    const isDisplayedTurn = displayedTurn === p;

    return (
      <div className={getSectionClasses(p)} onClick={clickHandler}>
        <div className="info-section-body">
          <h3>{title}</h3>
          {isDisplayedTurn && <span className="phase-badge">{PHASE_LABELS[displayedPhase]}</span>}
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

  const difficultyLabel = difficulty ? ` (${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)})` : '';

  return (
    <div className="game-info-panel">
      {/* Opponent Header - always visible */}
      <div className="info-header opponent-header">
        <h3>Opponent{difficultyLabel}</h3>
      </div>

      {/* Turn Phase Indicator - visible when DeckTrashArea is visible (> 850px) */}
      <div className="turn-phase-indicator">
        <div className={`phase-list ${displayedTurn}-turn`}>
          {ALL_PHASES.map(phase => (
            <div
              key={phase}
              className={`phase-item ${phase === displayedPhase ? 'active' : ''} ${displayedTurn}-turn`}
            >
              {PHASE_LABELS[phase]}
            </div>
          ))}
        </div>
      </div>

      {/* Player Header - always visible */}
      <div className="info-header player-header">
        <h3>Player</h3>
      </div>

      {/* Old Hand/Deck/Trash Info - visible when DeckTrashArea is NOT visible (≤ 850px) */}
      <div className="info-stats">
        {renderInfoSection('opponent')}
        {renderInfoSection('player')}
      </div>
    </div>
  );
};
