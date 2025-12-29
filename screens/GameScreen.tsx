/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// FIX: Import useState and useEffect from React, and fix malformed import.
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CardComponent } from '../components/Card';
import { useGameState } from '../hooks/useGameState';
import { GameBoard } from '../components/GameBoard';
import { PhaseController } from '../components/PhaseController';
import { GameState, Player, PlayedCard, Difficulty, ActionRequired } from '../types';
import { GameInfoPanel } from '../components/GameInfoPanel';
import { LogModal } from '../components/LogModal';
import { isCardTargetable } from '../utils/targeting';
import { Toaster } from '../components/Toaster';
import { RearrangeProtocolsModal } from '../components/RearrangeProtocolsModal';
import { SwapProtocolsModal } from '../components/SwapProtocolsModal';
import { StateNumberModal } from '../components/StateNumberModal';
import { StateProtocolModal } from '../components/StateProtocolModal';
import { SelectFromDrawnModal } from '../components/SelectFromDrawnModal';
import { RevealedDeckModal } from '../components/RevealedDeckModal';
import { RevealedDeckTopModal } from '../components/RevealedDeckTopModal';
import { DeckDiscardModal } from '../components/DeckDiscardModal';
import { DeckPlayPreviewModal } from '../components/DeckPlayPreviewModal';
import { TrashSelectionModal } from '../components/TrashSelectionModal';
import { DebugModal } from '../components/DebugModal';
import { CoinFlipModal } from '../components/CoinFlipModal';
import { useStatistics } from '../hooks/useStatistics';
import { DebugPanel } from '../components/DebugPanel';
import { hasRequireNonMatchingProtocolRule, hasAnyProtocolPlayRule, hasPlayOnOpponentSideRule, canPlayFaceUpDueToSameProtocolRule } from '../logic/game/passiveRuleChecker';
import { AnimationQueueProvider, useAnimationQueue } from '../contexts/AnimationQueueContext';
import { AnimationOverlay } from '../components/AnimationOverlay';
import { snapshotToGameState } from '../utils/snapshotUtils';


interface GameScreenProps {
  onBack: () => void;
  // FIX: Updated onEndGame prop type to match the expected signature from App.tsx and useGameState hook.
  onEndGame: (winner: Player, finalState: GameState) => void;
  playerProtocols: string[];
  opponentProtocols: string[];
  difficulty: Difficulty;
  useControlMechanic: boolean;
  startingPlayer?: Player;
  // E2E Testing: Setup function for complex test scenarios
  initialScenarioSetup?: ((state: GameState) => GameState) | null;
}

type PreviewState = {
  card: PlayedCard;
  showContents: boolean;
} | null;

const findCardOnBoard = (state: GameState, cardId: string | undefined): { card: PlayedCard, owner: Player } | null => {
    if (!cardId) return null;
    for (const p of ['player', 'opponent'] as Player[]) {
        for (const lane of state[p].lanes) {
            const card = lane.find(c => c.id === cardId);
            if (card) return { card, owner: p };
        }
    }
    return null;
}

const ACTIONS_REQUIRING_HAND_INTERACTION = new Set<ActionRequired['type']>([
  'discard',
  'select_card_from_hand_to_play',
  'select_card_from_hand_to_give',
  'select_card_from_hand_to_reveal',
  'plague_2_player_discard',
  'select_cards_from_hand_to_discard_for_fire_4',
  'select_cards_from_hand_to_discard_for_hate_1',
]);


/**
 * GameScreen - Wrapper that provides AnimationQueueContext
 */
export function GameScreen(props: GameScreenProps) {
  return (
    <AnimationQueueProvider>
      <GameScreenContent {...props} />
    </AnimationQueueProvider>
  );
}

/**
 * GameScreenContent - Main game screen content
 */
function GameScreenContent({ onBack, onEndGame, playerProtocols, opponentProtocols, difficulty, useControlMechanic, startingPlayer = 'player', initialScenarioSetup }: GameScreenProps) {
  // Animation queue context for the new animation system
  const { isAnimating, currentAnimation, enqueueAnimation, enqueueAnimations } = useAnimationQueue();
  // Determine starting player via coin flip on first mount
  const [actualStartingPlayer, setActualStartingPlayer] = useState<Player | null>(null);
  const [showCoinFlip, setShowCoinFlip] = useState(true);

  // Statistics tracking
  const {
    startGame: startGameTracking,
    endGame,
    trackPlayerCardPlayed,
    trackPlayerCardDeleted,
    trackPlayerCoinFlip,
    trackPlayerRearrange,
  } = useStatistics(playerProtocols, difficulty, useControlMechanic);

  const handleCoinFlipComplete = useCallback((starter: Player, choice: 'heads' | 'tails', won: boolean) => {
    setActualStartingPlayer(starter);
    setShowCoinFlip(false);
    trackPlayerCoinFlip(choice, won);
  }, [trackPlayerCoinFlip]);

  // Debug: Skip coin flip for test scenarios
  const handleSkipCoinFlip = useCallback(() => {
    setActualStartingPlayer('player');
    setShowCoinFlip(false);
    startGameTracking();
  }, [startGameTracking]);

  // Auto-skip coin flip when loading a test scenario
  useEffect(() => {
    if (initialScenarioSetup && showCoinFlip) {
      console.log('[E2E] Auto-skipping coin flip for scenario');
      setActualStartingPlayer('player');
      setShowCoinFlip(false);
    }
  }, [initialScenarioSetup, showCoinFlip]);

  // Start tracking when coin flip completes
  useEffect(() => {
    if (!showCoinFlip && actualStartingPlayer) {
      startGameTracking();
    }
  }, [showCoinFlip, actualStartingPlayer, startGameTracking]);

  // Wrap onEndGame to track statistics
  const wrappedOnEndGame = useCallback((winner: Player, finalState: GameState) => {
    // Count compiles
    const compilesCount = finalState.player.compiled.filter(c => c).length;

    // Pass both player and opponent stats, plus detailed game stats if available
    endGame(
      winner,
      finalState.stats.player,
      compilesCount,
      finalState.stats.opponent,
      finalState.detailedGameStats
    );
    onEndGame(winner, finalState);
  }, [endGame, onEndGame]);

  // Initialize game state - will use 'player' initially, but that's ok because we don't show the game until coin flip is done
  const {
    gameState,
    selectedCard,
    setSelectedCard,
    playSelectedCard,
    fillHand,
    discardCardFromHand,
    compileLane,
    resolveActionWithCard,
    resolveActionWithLane,
    resolveActionWithLaneFaceDown,
    selectHandCardForAction,
    resolveActionWithHandCard,
    skipAction,
    resolveOptionalDrawPrompt,
    resolveDeath1Prompt,
    resolveLove1Prompt,
    resolvePlague2Discard,
    resolvePlague4Flip,
    resolveFire3Prompt,
    resolveOptionalDiscardCustomPrompt,
    resolveOptionalEffectPrompt,
    resolveFire4Discard,
    resolveHate1Discard,
    resolveLight2Prompt,
    resolveRevealBoardCardPrompt,
    resolveRearrangeProtocols,
    resolveSpirit1Prompt,
    resolveSpirit3Prompt,
    resolveSwapProtocols,
    resolveSpeed3Prompt,
    resolvePsychic4Prompt,
    resolveControlMechanicPrompt,
    resolveCustomChoice,
    resolveSelectRevealedDeckCard,
    resolveRevealDeckDrawProtocol,
    resolveStateNumber,
    resolveStateProtocol,
    resolveSelectFromDrawnToReveal,
    resolveConfirmDeckDiscard,
    resolveConfirmDeckPlayPreview,
    resolveSelectTrashCardToPlay,
    resolveSelectTrashCardToReveal,
    setupTestScenario,
  } = useGameState(
    playerProtocols,
    opponentProtocols,
    wrappedOnEndGame,
    difficulty,
    useControlMechanic,
    actualStartingPlayer ?? 'player',
    trackPlayerRearrange,
    // NEW: Pass animation queue functions for the new animation system
    enqueueAnimation,
    enqueueAnimations
  );

  // Compute the visual game state - uses snapshot data during animation
  // This allows the SAME GameBoard to render both real state and animation snapshots
  const visualGameState = useMemo(() => {
    console.log('[GameScreen] Computing visualGameState:', {
      isAnimating,
      hasCurrentAnimation: !!currentAnimation,
      hasSnapshot: !!currentAnimation?.snapshot,
      animationType: currentAnimation?.type
    });

    if (isAnimating && currentAnimation?.snapshot) {
      const baseState = snapshotToGameState(currentAnimation.snapshot, useControlMechanic);
      // NOTE: We do NOT filter out the animated card anymore!
      // Instead, we hide it via CSS (see animatingCardId below).
      // This is critical because filtering changes array indices,
      // which breaks DOM position detection in AnimatedCard.
      return baseState;
    }
    return gameState;
  }, [isAnimating, currentAnimation, gameState, useControlMechanic]);

  // Track which card is currently being animated - used to hide it via CSS
  const animatingCardId = useMemo(() => {
    if (isAnimating && currentAnimation?.animatingCard) {
      return currentAnimation.animatingCard.card.id;
    }
    return null;
  }, [isAnimating, currentAnimation]);

  const [hoveredCard, setHoveredCard] = useState<PreviewState>(null);
  const [multiSelectedCardIds, setMultiSelectedCardIds] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [toasts, setToasts] = useState<{ message: string; player: Player; id: string }[]>([]);
  const lastLogLengthRef = useRef(gameState.log.length);
  const [showRearrangeModal, setShowRearrangeModal] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [debugModalPlayer, setDebugModalPlayer] = useState<Player | null>(null);
  const [showDebugButton, setShowDebugButton] = useState(false);
  const [mainframeClickCount, setMainframeClickCount] = useState(0);
  const mainframeResetTimerRef = useRef<NodeJS.Timeout | null>(null);

  const gameStateRef = useRef(gameState);
  useEffect(() => {
      gameStateRef.current = gameState;
  }, [gameState]);

  // E2E Testing: Apply initial scenario setup if provided
  const scenarioAppliedRef = useRef(false);
  useEffect(() => {
    if (initialScenarioSetup && !scenarioAppliedRef.current) {
      console.log('[E2E] Applying initial scenario setup...');
      scenarioAppliedRef.current = true;
      // Small delay to ensure game is fully initialized
      setTimeout(() => {
        setupTestScenario(initialScenarioSetup);
        console.log('[E2E] Scenario setup complete');
      }, 100);
    }
  }, [initialScenarioSetup, setupTestScenario]);

  // Mainframe Debug Toggle: 5 clicks to toggle debug mode
  const handleMainframeClick = () => {
    const newCount = mainframeClickCount + 1;
    setMainframeClickCount(newCount);

    if (newCount >= 5) {
      setShowDebugButton(prev => !prev);
      setMainframeClickCount(0); // Reset counter
      if (mainframeResetTimerRef.current) {
        clearTimeout(mainframeResetTimerRef.current);
        mainframeResetTimerRef.current = null;
      }
      return;
    }

    // Reset counter after 2 seconds of inactivity
    if (mainframeResetTimerRef.current) {
      clearTimeout(mainframeResetTimerRef.current);
    }
    mainframeResetTimerRef.current = setTimeout(() => {
      setMainframeClickCount(0);
      mainframeResetTimerRef.current = null;
    }, 2000);
  };

  // Debug: Force Win/Lose handlers for DebugPanel
  const handleForceWin = useCallback(() => {
    console.log('Debug: Forcing player win via DebugPanel.');
    wrappedOnEndGame('player', gameState);
  }, [wrappedOnEndGame, gameState]);

  const handleForceLose = useCallback(() => {
    console.log('Debug: Forcing player loss via DebugPanel.');
    wrappedOnEndGame('opponent', gameState);
  }, [wrappedOnEndGame, gameState]);

  const lastPlayedCardInfo = useMemo(() => {
    if (gameState.lastPlayedCardId) {
        const cardInfo = findCardOnBoard(gameState, gameState.lastPlayedCardId);
        if (cardInfo) {
            // A card's contents are visible if it's the player's or if it's face-up.
            const showContents = cardInfo.owner === 'player' || cardInfo.card.isFaceUp;
            return { card: cardInfo.card, showContents };
        }
    }
    return null;
  }, [gameState.lastPlayedCardId, gameState.player.lanes, gameState.opponent.lanes]);

  // Auto-preview the source card when an effect is active (highlighted with golden border)
  const sourceCardInfo = useMemo(() => {
    const sourceId = gameState.actionRequired?.sourceCardId;
    if (sourceId) {
        const cardInfo = findCardOnBoard(gameState, sourceId);
        if (cardInfo) {
            const showContents = cardInfo.owner === 'player' || cardInfo.card.isFaceUp;
            return { card: cardInfo.card, showContents };
        }
    }
    return null;
  }, [gameState.actionRequired?.sourceCardId, gameState.player.lanes, gameState.opponent.lanes]);

  // Clear hoveredCard when sourceCardId changes so the active effect's card is shown in preview
  useEffect(() => {
    if (gameState.actionRequired?.sourceCardId) {
      setHoveredCard(null);
    }
  }, [gameState.actionRequired?.sourceCardId]);

  // Priority: 1) User hover, 2) Effect source card, 3) Last played card
  const previewState = hoveredCard || sourceCardInfo || lastPlayedCardInfo;

  useEffect(() => {
    if (gameState.log.length > lastLogLengthRef.current) {
        const newLogs = gameState.log.slice(lastLogLengthRef.current);
        newLogs.forEach(logEntry => {
            if (logEntry.message !== 'Game Started.') {
                const newToast = { message: logEntry.message, player: logEntry.player, id: uuidv4() };
                setToasts(currentToasts => [...currentToasts, newToast]);

                setTimeout(() => {
                    setToasts(currentToasts => currentToasts.filter(t => t.id !== newToast.id));
                }, 5000);
            }
        });
    }
    lastLogLengthRef.current = gameState.log.length;
  }, [gameState.log]);

  useEffect(() => {
    const isVariableDiscard = gameState.actionRequired?.type === 'discard' && gameState.actionRequired?.variableCount;
    if (!isVariableDiscard && gameState.actionRequired?.type !== 'plague_2_player_discard' && gameState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_fire_4' && gameState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_hate_1') {
        setMultiSelectedCardIds([]);
    }
  }, [gameState.actionRequired]);

  useEffect(() => {
    setShowRearrangeModal(gameState.actionRequired?.type === 'prompt_rearrange_protocols' && gameState.actionRequired.actor === 'player');
    setShowSwapModal(gameState.actionRequired?.type === 'prompt_swap_protocols' && gameState.actionRequired.actor === 'player');
  }, [gameState.actionRequired]);

  useEffect(() => {
    const handleDebugKeyDown = (event: KeyboardEvent) => {
        if (event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            if (event.key.toLowerCase() === 'd') {
                console.log('Debug: Toggling debug button visibility.');
                setShowDebugButton(prev => !prev);
            } else if (event.key.toLowerCase() === 'w') {
                console.log('Debug: Forcing player win.');
                onEndGame('player', gameState);
            } else if (event.key.toLowerCase() === 'o') {
                console.log('Debug: Forcing opponent win.');
                onEndGame('opponent', gameState);
            } else if (event.key.toLowerCase() === 'p') {
                console.log('Debug: Setting up Speed-0 interrupt scenario.');
                setupTestScenario('speed-0-interrupt');
            } else if (event.key.toLowerCase() === 'l') {
                console.log('Debug: Setting up Speed-1 discard trigger scenario.');
                setupTestScenario('speed-1-trigger');
            } else if (event.key.toLowerCase() === 'f') {
                console.log('Debug: Setting up Fire On-Cover test scenario.');
                setupTestScenario('fire-oncover-test');
            } else if (event.key.toLowerCase() === 's') {
                console.log('Debug: Setting up Speed-2 + Control test scenario.');
                setupTestScenario('speed-2-control-test');
            } else if (event.key.toLowerCase() === 'u') {
                console.log('Debug: Setting up Death-1 Uncover test scenario.');
                // Import the scenario and use it as a setup function
                import('../utils/testScenarios').then(module => {
                    setupTestScenario(module.scenario14_Death1UncoverTest.setup);
                });
            }
        }
    };

    window.addEventListener('keydown', handleDebugKeyDown);
    return () => {
        window.removeEventListener('keydown', handleDebugKeyDown);
    };
  }, [gameState, onEndGame, setupTestScenario]);

  const handleLanePointerDown = (laneIndex: number, owner: Player) => {
    const currentState = gameStateRef.current;
    // Block input during animations (old system OR new queue system)
    if (currentState.animationState || isAnimating) return;

    const { actionRequired, turn, phase, compilableLanes, player, opponent } = currentState;

    // Highest priority: Compiling (only on player's lanes)
    if (owner === 'player' && turn === 'player' && phase === 'compile' && compilableLanes.includes(laneIndex)) {
        if (actionRequired) {
            console.warn("Compile click blocked by pending action:", actionRequired);
            // Don't proceed, but also don't do anything else that could change state
            return;
        }
        compileLane(laneIndex);
        return;
    }

    // Second priority: Resolving a required action that targets a lane
    // FIX: Check actionRequired.actor instead of turn, because during interrupt scenarios
    // (e.g., Spirit-3 triggering during opponent's end phase), the player needs to act
    // even though turn might still be set to 'opponent'.
    if (actionRequired && actionRequired.actor === 'player' &&
        ['select_lane_for_shift', 'select_lane_for_shift_all', 'shift_flipped_card_optional', 'select_lane_for_play', 'select_lane_for_delete', 'select_lane_for_death_2', 'select_lane_for_life_3_play', 'select_lane_to_shift_revealed_card_for_light_2', 'select_lane_to_shift_revealed_board_card_custom', 'select_lane_to_shift_cards_for_light_3', 'select_lane_for_water_3', 'select_lane_for_metal_3_delete', 'select_lane_for_delete_all', 'select_lane_for_return', 'select_lanes_for_swap_stacks'].includes(actionRequired.type)) {
        resolveActionWithLane(laneIndex);
        return;
    }

    // Third priority: Playing a card from hand
    const opponentHasPsychic1 = opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
    const oppLane = opponent.lanes[laneIndex];
    const isLaneBlockedByPlague0 = oppLane.length > 0 &&
                                   oppLane[oppLane.length - 1].isFaceUp &&
                                   oppLane[oppLane.length - 1].protocol === 'Plague' &&
                                   oppLane[oppLane.length - 1].value === 0;

    const isPlayTarget = selectedCard && phase === 'action' && !actionRequired && player.hand.some(c => c.id === selectedCard) &&
        !isLaneBlockedByPlague0;

    if (isPlayTarget) {
        const cardInHand = player.hand.find(c => c.id === selectedCard)!;

        // Handle playing on opponent's side (cards with allow_play_on_opponent_side)
        if (owner === 'opponent') {
            // Check if card can be played on opponent's side
            if (!hasPlayOnOpponentSideRule(currentState, cardInHand)) {
                // Card can't be played on opponent's side
                setSelectedCard(null);
                setHoveredCard(null);
                return;
            }
            // Cards with allow_play_on_opponent_side can play on ANY opponent lane (face-up only)
            // Psychic-1 still blocks face-up plays
            if (opponentHasPsychic1) {
                setSelectedCard(null);
                setHoveredCard(null);
                return;
            }
            // Play on opponent's side (always face-up)
            playSelectedCard(laneIndex, true, 'opponent');
            setHoveredCard(null);
            return;
        }

        // Normal play on player's side
        const playerHasSpiritOne = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);

        // Check if the card being played has ignore_protocol_matching card_property (generic check)
        const thisCardIgnoresMatching = (cardInHand as any).customEffects?.bottomEffects?.some(
            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
        ) || (cardInHand as any).customEffects?.topEffects?.some(
            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
        ) || (cardInHand as any).customEffects?.middleEffects?.some(
            (e: any) => e.params?.action === 'card_property' && e.params?.property === 'ignore_protocol_matching'
        );

        // Check for Anarchy-1 on ANY player's field (affects both players)
        const anyPlayerHasAnarchy1 = [...player.lanes.flat(), ...opponent.lanes.flat()]
            .some(c => c.isFaceUp && c.protocol === 'Anarchy' && c.value === 1);

        // Check for custom cards with require_non_matching_protocol passive rule
        const hasCustomNonMatchingRule = hasRequireNonMatchingProtocolRule(currentState);

        // NEW: Check for custom cards with allow_any_protocol_play passive rule (Spirit_custom-1)
        const hasCustomAllowAnyProtocol = hasAnyProtocolPlayRule(currentState, 'player', laneIndex);

        // Check if card can play on any lane (allow_play_on_opponent_side passive rule)
        const canPlayAnywhere = hasPlayOnOpponentSideRule(currentState, cardInHand);

        // NEW: Check for Unity-1 same-protocol face-up play rule
        const hasSameProtocolFaceUpRule = canPlayFaceUpDueToSameProtocolRule(currentState, 'player', laneIndex, cardInHand.protocol);

        let canPlayFaceUp: boolean;
        if (canPlayAnywhere) {
            // Can play face-up on ANY lane (ignores protocol matching)
            canPlayFaceUp = !opponentHasPsychic1;
        } else if (anyPlayerHasAnarchy1 || hasCustomNonMatchingRule) {
            // Anarchy-1 OR custom require_non_matching_protocol: INVERTED rule - can only play face-up if protocol does NOT match
            const doesNotMatch = cardInHand.protocol !== player.protocols[laneIndex] && cardInHand.protocol !== opponent.protocols[laneIndex];
            canPlayFaceUp = doesNotMatch && !opponentHasPsychic1;
        } else {
            // Normal rule: can play face-up if protocol DOES match (or Spirit-1/custom override)
            // OR if THIS CARD ignores protocol matching (Chaos-3 or custom cards with ignore_protocol_matching)
            // OR if Unity-1 same-protocol face-up rule allows it
            canPlayFaceUp = (
                playerHasSpiritOne ||
                hasCustomAllowAnyProtocol ||
                thisCardIgnoresMatching ||
                hasSameProtocolFaceUpRule ||
                cardInHand.protocol === player.protocols[laneIndex] ||
                cardInHand.protocol === opponent.protocols[laneIndex]
            ) && !opponentHasPsychic1;
        }
        playSelectedCard(laneIndex, canPlayFaceUp);
        setHoveredCard(null);
        return;
    }

    // Fallback: Deselect card if clicking an invalid target
    if (selectedCard) {
        setSelectedCard(null);
        setHoveredCard(null);
    }
  };

  const handlePlayFaceDown = (laneIndex: number) => {
    const currentState = gameStateRef.current;
    // Block input during animations (old system OR new queue system)
    if (currentState.animationState || isAnimating) return;

    const { phase, actionRequired, player } = currentState;

    // Handle face-down during select_lane_for_play with player orientation choice
    if (actionRequired?.type === 'select_lane_for_play' &&
        (actionRequired as any).ignoreProtocolMatching &&
        (actionRequired as any).isFaceDown === undefined) {
      const validLanes = (actionRequired as any).validLanes;
      if (validLanes && !validLanes.includes(laneIndex)) return;
      resolveActionWithLaneFaceDown(laneIndex);
      return;
    }

    // Normal face-down from hand
    if (!selectedCard) return;
    if (phase !== 'action' || actionRequired || !player.hand.some(c => c.id === selectedCard)) return;

    playSelectedCard(laneIndex, false);
    setHoveredCard(null);
  };


  const handleHandCardPointerDown = (card: PlayedCard) => {
    const currentState = gameStateRef.current;
    // Block input during animations (old system OR new queue system)
    if (currentState.animationState || isAnimating) return;

    if (currentState.actionRequired) {
      // Check for discard action
      if (currentState.actionRequired.type === 'discard' && currentState.actionRequired.actor === 'player') {
        const discardCount = currentState.actionRequired.count;
        // Multi-select mode when count > 1 OR variableCount (select all, then confirm)
        if (discardCount > 1 || currentState.actionRequired.variableCount) {
          setMultiSelectedCardIds(prev => {
            if (prev.includes(card.id)) {
              return prev.filter(id => id !== card.id);
            }
            // For fixed count, limit selection to exactly count cards
            if (!currentState.actionRequired.variableCount && prev.length >= discardCount) {
              return prev; // Don't add more than required
            }
            return [...prev, card.id];
          });
          return;
        } else {
          // Single discard (count === 1)
          discardCardFromHand(card.id);
          return;
        }
      }
      if (currentState.actionRequired.type === 'select_card_from_hand_to_play') {
        selectHandCardForAction(card.id);
        return;
      }
      if (currentState.actionRequired.type === 'select_card_from_hand_to_give' || currentState.actionRequired.type === 'select_card_from_hand_to_reveal') {
        resolveActionWithHandCard(card.id);
        return;
      }
      if (currentState.actionRequired.type === 'plague_2_player_discard' || currentState.actionRequired.type === 'select_cards_from_hand_to_discard_for_fire_4' || currentState.actionRequired.type === 'select_cards_from_hand_to_discard_for_hate_1') {
        setMultiSelectedCardIds(prev => {
            if (prev.includes(card.id)) {
                return prev.filter(id => id !== card.id);
            }
            return [...prev, card.id];
        });
        return;
      }
      return;
    }
    
    if (currentState.turn !== 'player' || (currentState.phase !== 'action' && currentState.phase !== 'compile')) return;

    if (card.id === selectedCard) {
      setSelectedCard(null);
      setHoveredCard(null);
    } else {
      setSelectedCard(card.id);
      setHoveredCard({ card, showContents: true });
    }
  };

  const handleBoardCardPointerDown = (card: PlayedCard, owner: Player, laneIndex: number) => {
      const currentState = gameStateRef.current;
      // Block input during animations (old system OR new queue system)
      if (currentState.animationState || isAnimating) return;

      const { actionRequired, turn, phase, compilableLanes } = currentState;

      // Proxy click to lane if in compile phase
      if (turn === 'player' && phase === 'compile' && compilableLanes.includes(laneIndex)) {
          handleLanePointerDown(laneIndex, owner);
          return;
      }

      // Proxy click to lane if playing a card from hand
      if (turn === 'player' && !actionRequired && selectedCard && phase === 'action') {
          handleLanePointerDown(laneIndex, owner);
          return;
      }

      // Handle Hate-2 selections
      if (actionRequired && actionRequired.actor === 'player') {
          if (actionRequired.type === 'select_own_highest_card_to_delete_for_hate_2' ||
              actionRequired.type === 'select_opponent_highest_card_to_delete_for_hate_2') {
              if (isCardTargetable(card, currentState)) {
                  resolveActionWithCard(card.id);
                  return;
              }
          }
      }

      // If it's not a proxy, it's a card-specific interaction.
      if (isCardTargetable(card, currentState)) {
          resolveActionWithCard(card.id);
      } else {
          // If a hand card was selected, but the click was on an invalid target card, deselect.
          if (selectedCard) {
              setSelectedCard(null);
              setHoveredCard(null);
          } else {
              // No hand card was selected. Just preview the board card.
              const showContents = owner === 'player' || card.isFaceUp;
              setHoveredCard({ card, showContents });
          }
      }
  };
  
  const handleHandCardPointerEnter = (card: PlayedCard) => {
    if (!selectedCard) {
      setHoveredCard({ card, showContents: true });
    }
  };
  
  const handleHandCardPointerLeave = () => {
    if (!selectedCard) {
      setHoveredCard(null);
    }
  };

  const handleBoardCardPointerEnter = (card: PlayedCard, owner: Player) => {
    if (!selectedCard) {
        const showContents = owner === 'player' || card.isFaceUp;
        setHoveredCard({ card, showContents });
    }
  };

  const handleBoardCardPointerLeave = () => {
      if (!selectedCard) {
          setHoveredCard(null);
      }
  };

  const handleOpponentHandCardPointerEnter = (card: PlayedCard) => {
    if (!selectedCard && !gameState.actionRequired) {
      setHoveredCard({ card, showContents: card.isRevealed || false });
    }
  };


  const renderPreview = () => {
    if (!previewState) return null;
    const { card, showContents } = previewState;
    return (
        <CardComponent
            card={card}
            isFaceUp={showContents}
        />
    );
  };

  const isCompilePromptVisible = gameState.turn === 'player' && 
                               !gameState.actionRequired && 
                               gameState.phase === 'compile' && 
                               gameState.compilableLanes.length > 0;

  // FIX: Safely access sourceCardId, as not all actions have it (e.g., control mechanic).
  const sourceCardId = gameState.actionRequired?.sourceCardId ?? null;

  const actionRequiredClass = useMemo(() => {
    if (gameState.actionRequired?.actor) {
        return gameState.actionRequired.actor === 'player'
            ? 'action-required-player'
            : 'action-required-opponent';
    }
    return '';
  }, [gameState.actionRequired]);

  const handBackgroundClass = useMemo(() => {
    const action = gameState.actionRequired;
    if (action && action.actor === 'player') {
      // If the action requires interacting with hand cards, DON'T put it in the background.
      if (ACTIONS_REQUIRING_HAND_INTERACTION.has(action.type)) {
        return '';
      }
      // Otherwise, it's a button-based action, so put the hand in the background.
      return 'hand-in-background';
    }
    // No action, or action is for opponent, hand is normal.
    return '';
  }, [gameState.actionRequired]);


  return (
    <div className="screen game-screen">
        {debugModalPlayer && (
            <DebugModal
                player={debugModalPlayer}
                playerState={gameState[debugModalPlayer]}
                onClose={() => setDebugModalPlayer(null)}
                difficulty={difficulty}
            />
        )}
        {showRearrangeModal && gameState.actionRequired?.type === 'prompt_rearrange_protocols' && (
            <RearrangeProtocolsModal
                gameState={gameState}
                targetPlayer={gameState.actionRequired.target}
                onConfirm={(newOrder: string[]) => {
                    // Track rearrange in statistics ONLY if from Control Mechanic (not Psychic-2 etc.)
                    if (gameState.actionRequired?.sourceCardId === 'CONTROL_MECHANIC' && gameState.actionRequired?.actor) {
                        trackPlayerRearrange(gameState.actionRequired.actor);
                    }
                    resolveRearrangeProtocols(newOrder);
                    setShowRearrangeModal(false);
                }}
            />
        )}
        {showSwapModal && gameState.actionRequired?.type === 'prompt_swap_protocols' && (
            <SwapProtocolsModal
                gameState={gameState}
                targetPlayer={gameState.actionRequired.target}
                onConfirm={(indices) => {
                    resolveSwapProtocols(indices);
                    setShowSwapModal(false);
                }}
            />
        )}
        {(gameState.actionRequired?.type === 'select_card_from_revealed_deck' || gameState.actionRequired?.type === 'reveal_deck_draw_protocol') && gameState.actionRequired.actor === 'player' && (
            <RevealedDeckModal
                gameState={gameState}
                onSelectCard={(cardId) => {
                    resolveSelectRevealedDeckCard(cardId);
                }}
                onConfirmProtocolDraw={() => {
                    resolveRevealDeckDrawProtocol();
                }}
            />
        )}
        {/* Time Protocol: Trash selection modals */}
        {gameState.actionRequired?.type === 'select_card_from_trash_to_play' && gameState.actionRequired.actor === 'player' && (
            <TrashSelectionModal
                gameState={gameState}
                onSelectCard={(cardIndex) => {
                    resolveSelectTrashCardToPlay(cardIndex);
                }}
            />
        )}
        {gameState.actionRequired?.type === 'select_card_from_trash_to_reveal' && gameState.actionRequired.actor === 'player' && (
            <TrashSelectionModal
                gameState={gameState}
                onSelectCard={(cardIndex) => {
                    resolveSelectTrashCardToReveal(cardIndex);
                }}
            />
        )}
        {gameState.actionRequired?.type === 'prompt_optional_effect' && gameState.actionRequired.actor === 'player' && (
            <RevealedDeckTopModal
                gameState={gameState}
                onAccept={() => resolveOptionalEffectPrompt(true)}
                onDecline={() => resolveOptionalEffectPrompt(false)}
            />
        )}
        {gameState.actionRequired?.type === 'state_number' && gameState.actionRequired.actor === 'player' && (
            <StateNumberModal
                gameState={gameState}
                onConfirm={(number) => resolveStateNumber(number)}
            />
        )}
        {gameState.actionRequired?.type === 'state_protocol' && gameState.actionRequired.actor === 'player' && (
            <StateProtocolModal
                gameState={gameState}
                availableProtocols={(gameState.actionRequired as any).availableProtocols || []}
                onConfirm={(protocol) => resolveStateProtocol(protocol)}
            />
        )}
        {gameState.actionRequired?.type === 'select_from_drawn_to_reveal' && gameState.actionRequired.actor === 'player' && (
            <SelectFromDrawnModal
                gameState={gameState}
                allDrawnCardIds={(gameState.actionRequired as any).allDrawnCardIds || []}
                eligibleCardIds={(gameState.actionRequired as any).eligibleCardIds || []}
                statedNumber={(gameState.actionRequired as any).statedNumber}
                revealCount={(gameState.actionRequired as any).revealCount}
                onConfirm={(cardId) => resolveSelectFromDrawnToReveal(cardId)}
                onClose={() => {
                    // No eligible cards - call resolver with empty string to clear action
                    resolveSelectFromDrawnToReveal('');
                }}
            />
        )}
        {gameState.actionRequired?.type === 'confirm_deck_discard' && gameState.actionRequired.actor === 'player' && (
            <DeckDiscardModal
                discardedCard={(gameState.actionRequired as any).discardedCard}
                deckOwner={(gameState.actionRequired as any).deckOwner}
                onConfirm={() => resolveConfirmDeckDiscard()}
            />
        )}
        {gameState.actionRequired?.type === 'confirm_deck_play_preview' && gameState.actionRequired.actor === 'player' && (
            <DeckPlayPreviewModal
                card={(gameState.actionRequired as any).drawnCard}
                isFaceDown={(gameState.actionRequired as any).isFaceDown}
                onConfirm={() => resolveConfirmDeckPlayPreview()}
            />
        )}
        <div className="toaster-container">
            {toasts.map((toast) => (
                <Toaster key={toast.id} message={toast.message} player={toast.player} />
            ))}
        </div>
        {showLog && <LogModal log={gameState.log} onClose={() => setShowLog(false)} />}
        <button className="btn log-button" onClick={() => setShowLog(true)}>Log</button>
        <div className="game-screen-layout">
            <div className="game-preview-container">
                <h2 onClick={handleMainframeClick} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click 5 times to toggle debug mode">Mainframe</h2>
                <GameInfoPanel
                    gameState={gameState}
                    turn={gameState.actionRequired?.actor || gameState.turn}
                    animationState={gameState.animationState}
                    difficulty={difficulty}
                    onPlayerClick={() => setDebugModalPlayer('player')}
                    onOpponentClick={() => setDebugModalPlayer('opponent')}
                />
                <div className="preview-card-area">
                    {renderPreview()}
                </div>
                <button className="btn btn-back" onClick={onBack}>
                    Back
                </button>
            </div>

            <div className="game-main-area">
                {isCompilePromptVisible && (
                  <div className="compile-prompt-container">
                    <h3>Select a Protocol to Compile</h3>
                  </div>
                )}
                <GameBoard
                  gameState={visualGameState}
                  onLanePointerDown={handleLanePointerDown}
                  onPlayFaceDown={handlePlayFaceDown}
                  selectedCardId={isAnimating ? null : selectedCard}
                  onCardPointerDown={handleBoardCardPointerDown}
                  onCardPointerEnter={handleBoardCardPointerEnter}
                  onCardPointerLeave={handleBoardCardPointerLeave}
                  onOpponentHandCardPointerEnter={handleOpponentHandCardPointerEnter}
                  onOpponentHandCardPointerLeave={handleBoardCardPointerLeave}
                  sourceCardId={isAnimating ? null : sourceCardId}
                  animatingCardId={animatingCardId}
                  onDeckClick={(owner) => setDebugModalPlayer(owner)}
                  onTrashClick={(owner) => setDebugModalPlayer(owner)}
                  onTrashCardHover={(card, owner) => {
                    if (!selectedCard) {
                      setHoveredCard({ card, showContents: true });
                    }
                  }}
                  onTrashCardLeave={() => {
                    if (!selectedCard) {
                      setHoveredCard(null);
                    }
                  }}
                />
                
                <div className="player-action-area">
                  <PhaseController
                    gameState={gameState}
                    onFillHand={fillHand}
                    onSkipAction={skipAction}
                    onResolveOptionalDrawPrompt={resolveOptionalDrawPrompt}
                    onResolveDeath1Prompt={resolveDeath1Prompt}
                    onResolveLove1Prompt={resolveLove1Prompt}
                    onResolvePlague2Discard={resolvePlague2Discard}
                    onResolvePlague4Flip={resolvePlague4Flip}
                    onResolveFire3Prompt={resolveFire3Prompt}
                    onResolveOptionalDiscardCustomPrompt={resolveOptionalDiscardCustomPrompt}
                    onResolveOptionalEffectPrompt={resolveOptionalEffectPrompt}
                    onResolveSpeed3Prompt={resolveSpeed3Prompt}
                    onResolveFire4Discard={resolveFire4Discard}
                    onResolveHate1Discard={resolveHate1Discard}
                    onResolveLight2Prompt={resolveLight2Prompt}
                    onResolveRevealBoardCardPrompt={resolveRevealBoardCardPrompt}
                    onResolvePsychic4Prompt={resolvePsychic4Prompt}
                    onResolveSpirit1Prompt={resolveSpirit1Prompt}
                    onResolveSpirit3Prompt={resolveSpirit3Prompt}
                    onResolveControlMechanicPrompt={resolveControlMechanicPrompt}
                    onResolveCustomChoice={resolveCustomChoice}
                    selectedCardId={selectedCard}
                    multiSelectedCardIds={multiSelectedCardIds}
                    actionRequiredClass={actionRequiredClass}
                  />
                  <div className={`player-hand-area ${isAnimating ? '' : handBackgroundClass}`}>
                    {visualGameState.player.hand
                      .filter((card) => {
                        // During animation, show all cards from the snapshot
                        if (isAnimating) return true;
                        // When there's a selectableCardIds filter (Clarity-2 play effect),
                        // only show selectable cards - others stay hidden behind the banner
                        const action = gameState.actionRequired as any;
                        const hasSelectableFilter = action?.type === 'select_card_from_hand_to_play' && action?.selectableCardIds;
                        if (hasSelectableFilter) {
                          return action.selectableCardIds.includes(card.id);
                        }
                        return true; // Show all cards normally
                      })
                      .map((card) => {
                      // During animation: hide the animating card via CSS (visibility: hidden)
                      // We keep it in DOM for position detection, just invisible
                      const isBeingAnimated = animatingCardId === card.id;
                      if (isAnimating) {
                        return (
                          <CardComponent
                            key={card.id}
                            card={card}
                            isFaceUp={true}
                            additionalClassName={`in-hand ${isBeingAnimated ? 'animating-hidden' : ''}`}
                          />
                        );
                      }
                      // CRITICAL: When select_lane_for_play is active, only the cardInHandId should be selected
                      const isSelectedForPlay = gameState.actionRequired?.type === 'select_lane_for_play'
                        ? card.id === (gameState.actionRequired as any).cardInHandId
                        : card.id === selectedCard;

                      return (
                        <CardComponent
                          key={card.id}
                          card={card}
                          isFaceUp={true}
                          onPointerDown={() => handleHandCardPointerDown(card)}
                          onPointerEnter={() => handleHandCardPointerEnter(card)}
                          isSelected={isSelectedForPlay}
                          isMultiSelected={multiSelectedCardIds.includes(card.id)}
                          animationState={gameState.animationState}
                          additionalClassName="in-hand"
                        />
                      );
                    })}
                  </div>
                </div>
            </div>
        </div>
        {showCoinFlip && <CoinFlipModal onComplete={handleCoinFlipComplete} />}
        {showDebugButton && <DebugPanel onLoadScenario={setupTestScenario} onSkipCoinFlip={handleSkipCoinFlip} onForceWin={handleForceWin} onForceLose={handleForceLose} />}

        {/* Animation Overlay - renders above game during animation queue playback */}
        <AnimationOverlay />
    </div>
  );
}