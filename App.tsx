/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MainMenu } from './screens/MainMenu';
import { ProtocolSelection } from './screens/ProtocolSelection';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { CardLibraryScreen } from './screens/CardLibraryScreen';
import { Difficulty, GameState } from './types';

type Screen = 'MainMenu' | 'ProtocolSelection' | 'GameScreen' | 'ResultsScreen' | 'CardLibrary';
export type Player = 'player' | 'opponent';

export function App() {
  const [screen, setScreen] = useState<Screen>('MainMenu');
  const [playerProtocols, setPlayerProtocols] = useState<string[]>([]);
  const [opponentProtocols, setOpponentProtocols] = useState<string[]>([]);
  const [winner, setWinner] = useState<Player | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [finalGameState, setFinalGameState] = useState<GameState | null>(null);

  const handleBackToMenu = useCallback(() => {
    setScreen('MainMenu');
    setPlayerProtocols([]);
    setOpponentProtocols([]);
    setWinner(null);
    setFinalGameState(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBackToMenu();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleBackToMenu]);

  const startGame = useCallback((playerProtos: string[], opponentProtos: string[]) => {
    setPlayerProtocols(playerProtos);
    setOpponentProtocols(opponentProtos);
    setWinner(null);
    setFinalGameState(null);
    setScreen('GameScreen');
  }, []);

  const handleEndGame = useCallback((winner: Player, finalState: GameState) => {
    setWinner(winner);
    setFinalGameState(finalState);
    setScreen('ResultsScreen');
  }, []);

  const renderScreen = () => {
    switch (screen) {
      case 'MainMenu':
        return (
          <MainMenu
            onNavigate={(target) => setScreen(target)}
            difficulty={difficulty}
            setDifficulty={setDifficulty}
          />
        );
      case 'ProtocolSelection':
        return (
          <ProtocolSelection
            onBack={handleBackToMenu}
            onStartGame={startGame}
          />
        );
      case 'GameScreen':
        return (
          <GameScreen
            onBack={handleBackToMenu}
            onEndGame={handleEndGame}
            playerProtocols={playerProtocols}
            opponentProtocols={opponentProtocols}
            difficulty={difficulty}
          />
        );
      case 'ResultsScreen':
        return <ResultsScreen onPlayAgain={handleBackToMenu} winner={winner} finalState={finalGameState} />;
      case 'CardLibrary':
        return <CardLibraryScreen onBack={handleBackToMenu} />;
      default:
        return <MainMenu onNavigate={(target) => setScreen(target)} difficulty={difficulty} setDifficulty={setDifficulty} />;
    }
  };

  return <>{renderScreen()}</>;
}