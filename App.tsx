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
import { Difficulty } from './types';

type Screen = 'MainMenu' | 'ProtocolSelection' | 'GameScreen' | 'ResultsScreen' | 'CardLibrary';
export type Player = 'player' | 'opponent';

export function App() {
  const [screen, setScreen] = useState<Screen>('MainMenu');
  const [playerProtocols, setPlayerProtocols] = useState<string[]>([]);
  const [opponentProtocols, setOpponentProtocols] = useState<string[]>([]);
  const [winner, setWinner] = useState<Player | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');

  const handleBackToMenu = useCallback(() => {
    setScreen('MainMenu');
    setPlayerProtocols([]);
    setOpponentProtocols([]);
    setWinner(null);
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
    setScreen('GameScreen');
  }, []);

  const handleEndGame = useCallback((winner: Player) => {
    setWinner(winner);
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
        return <ResultsScreen onPlayAgain={handleBackToMenu} winner={winner} />;
      case 'CardLibrary':
        return <CardLibraryScreen onBack={handleBackToMenu} />;
      default:
        return <MainMenu onNavigate={(target) => setScreen(target)} difficulty={difficulty} setDifficulty={setDifficulty} />;
    }
  };

  return <>{renderScreen()}</>;
}