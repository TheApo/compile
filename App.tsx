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
import { StatisticsScreen } from './screens/StatisticsScreen';
import { CustomProtocolCreator } from './screens/CustomProtocolCreator';
import { RulesScreen } from './screens/RulesScreen';
import { CoinFlipModal } from './components/CoinFlipModal';
import { Difficulty, GameState } from './types';
import { loadDefaultCustomProtocols } from './logic/customProtocols/loadDefaultProtocols';
import * as testScenarios from './utils/testScenarios';

type Screen = 'MainMenu' | 'ProtocolSelection' | 'GameScreen' | 'ResultsScreen' | 'CardLibrary' | 'Statistics' | 'CustomProtocols' | 'Rules';
export type Player = 'player' | 'opponent';

export function App() {
  const [screen, setScreen] = useState<Screen>('MainMenu');
  const [playerProtocols, setPlayerProtocols] = useState<string[]>([]);
  const [opponentProtocols, setOpponentProtocols] = useState<string[]>([]);
  const [winner, setWinner] = useState<Player | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [finalGameState, setFinalGameState] = useState<GameState | null>(null);
  const [useControl, setUseControl] = useState(true);
  const [startingPlayer, setStartingPlayer] = useState<Player>('player');
  const [initialScenarioSetup, setInitialScenarioSetup] = useState<((state: GameState) => GameState) | null>(null);

  // Load default custom protocols on app start (Anarchy_custom for testing)
  useEffect(() => {
    loadDefaultCustomProtocols();
  }, []);

  // E2E TEST SUPPORT: Load test scenario from URL parameter
  // Usage: http://localhost:3000/?testScenario=basic-game (JSON file)
  // Usage: http://localhost:3000/?scenario=scenario1_Psychic3Uncover (from testScenarios.ts)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jsonScenario = params.get('testScenario');
    const tsScenario = params.get('scenario');

    // Option 1: Load from JSON file (simple scenarios)
    if (jsonScenario) {
      console.log(`[E2E] Loading JSON test scenario: ${jsonScenario}`);
      fetch(`/e2e/scenarios/${jsonScenario}.json`)
        .then(res => {
          if (!res.ok) throw new Error(`Scenario not found: ${jsonScenario}`);
          return res.json();
        })
        .then((scenario: {
          playerProtocols: string[];
          opponentProtocols: string[];
          difficulty: Difficulty;
          useControlMechanic: boolean;
          startingPlayer: Player;
        }) => {
          console.log('[E2E] Scenario loaded:', scenario);
          setDifficulty(scenario.difficulty);
          setUseControl(scenario.useControlMechanic);
          setPlayerProtocols(scenario.playerProtocols);
          setOpponentProtocols(scenario.opponentProtocols);
          setStartingPlayer(scenario.startingPlayer);
          setScreen('GameScreen');
        })
        .catch(err => {
          console.error('[E2E] Failed to load scenario:', err);
        });
    }

    // Option 2: Load from testScenarios.ts (complex scenarios with board setup)
    if (tsScenario) {
      console.log(`[E2E] Loading complex scenario: ${tsScenario}`);
      const scenario = (testScenarios as any)[tsScenario] as testScenarios.TestScenario | undefined;

      if (scenario) {
        console.log('[E2E] Complex scenario found:', scenario.name);
        // Store the setup function to be called after game initializes
        setInitialScenarioSetup(() => scenario.setup);
        // Set default protocols (will be overwritten by setup)
        setPlayerProtocols(['Fire', 'Water', 'Speed']);
        setOpponentProtocols(['Death', 'Life', 'Light']);
        setDifficulty('easy');
        setUseControl(false);
        setScreen('GameScreen');
      } else {
        console.error(`[E2E] Scenario not found: ${tsScenario}`);
        console.log('[E2E] Available scenarios:', Object.keys(testScenarios).filter(k => k.startsWith('scenario')));
      }
    }
  }, []);

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
    setStartingPlayer('player'); // Reset, will be set by coin flip
    setScreen('GameScreen'); // Go directly to game, coin flip will show as overlay
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
            useControl={useControl}
            onUseControlChange={setUseControl}
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
            useControlMechanic={useControl}
            startingPlayer={startingPlayer}
            initialScenarioSetup={initialScenarioSetup}
          />
        );
      case 'ResultsScreen':
        return <ResultsScreen onPlayAgain={handleBackToMenu} winner={winner} finalState={finalGameState} difficulty={difficulty} />;
      case 'CardLibrary':
        return <CardLibraryScreen onBack={handleBackToMenu} />;
      case 'Statistics':
        return <StatisticsScreen onBack={handleBackToMenu} />;
      case 'CustomProtocols':
        return <CustomProtocolCreator onBack={handleBackToMenu} />;
      case 'Rules':
        return <RulesScreen onBack={handleBackToMenu} />;
      default:
        return <MainMenu onNavigate={(target) => setScreen(target)} difficulty={difficulty} setDifficulty={setDifficulty} useControl={useControl} onUseControlChange={setUseControl} />;
    }
  };

  return <>{renderScreen()}</>;
}