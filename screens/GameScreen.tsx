/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// FIX: Import useState and useEffect from React, and fix malformed import.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CardComponent } from '../components/Card';
import { useGameState } from '../hooks/useGameState';
import { GameBoard } from '../components/GameBoard';
import { PhaseController } from '../components/PhaseController';
import { GameState, Player, PlayedCard, Difficulty } from '../types';
import { GameInfoPanel } from '../components/GameInfoPanel';
import { LogModal } from '../components/LogModal';
import { isCardTargetable } from '../utils/targeting';
import { Toaster } from '../components/Toaster';
import { RearrangeProtocolsModal } from '../components/RearrangeProtocolsModal';
import { SwapProtocolsModal } from '../components/SwapProtocolsModal';
import { DebugModal } from '../components/DebugModal';


interface GameScreenProps {
  onBack: () => void;
  onEndGame: (winner: Player) => void;
  playerProtocols: string[];
  opponentProtocols: string[];
  difficulty: Difficulty;
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

export function GameScreen({ onBack, onEndGame, playerProtocols, opponentProtocols, difficulty }: GameScreenProps) {
  
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
    selectHandCardForAction,
    resolveActionWithHandCard,
    skipAction,
    resolveDeath1Prompt,
    resolveLove1Prompt,
    resolvePlague2Discard,
    resolvePlague4Flip,
    resolveFire3Prompt,
    resolveFire4Discard,
    resolveHate1Discard,
    resolveLight2Prompt,
    resolveRearrangeProtocols,
    resolveSpirit1Prompt,
    resolveSpirit3Prompt,
    resolveSwapProtocols,
    // FIX: Destructure `resolveSpeed3Prompt` from the `useGameState` hook to make it available.
    resolveSpeed3Prompt,
    resolvePsychic4Prompt,
  } = useGameState(playerProtocols, opponentProtocols, onEndGame, difficulty);

  const [hoveredCard, setHoveredCard] = useState<PreviewState>(null);
  const [multiSelectedCardIds, setMultiSelectedCardIds] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [toasts, setToasts] = useState<{ message: string; player: Player; id: string }[]>([]);
  const lastLogLengthRef = useRef(gameState.log.length);
  const [showRearrangeModal, setShowRearrangeModal] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [debugModalPlayer, setDebugModalPlayer] = useState<Player | null>(null);

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

  const previewState = hoveredCard || lastPlayedCardInfo;

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
    if (gameState.actionRequired?.type !== 'plague_2_player_discard' && gameState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_fire_4' && gameState.actionRequired?.type !== 'select_cards_from_hand_to_discard_for_hate_1') {
        setMultiSelectedCardIds([]);
    }
  }, [gameState.actionRequired]);

  useEffect(() => {
    setShowRearrangeModal(gameState.actionRequired?.type === 'prompt_rearrange_protocols' && gameState.turn === 'player');
    setShowSwapModal(gameState.actionRequired?.type === 'prompt_swap_protocols' && gameState.turn === 'player');
  }, [gameState.actionRequired, gameState.turn]);

  const handleLaneMouseDown = (laneIndex: number) => {
    const { actionRequired, turn, phase, compilableLanes, player, opponent } = gameState;

    // Determine if an action can be taken on this lane
    const isActionTarget = turn === 'player' && actionRequired &&
        ['select_lane_for_shift', 'shift_flipped_card_optional', 'select_lane_for_play', 'select_lane_for_death_2', 'select_lane_for_life_3_play', 'select_lane_to_shift_revealed_card_for_light_2', 'select_lane_to_shift_cards_for_light_3', 'select_lane_for_water_3'].includes(actionRequired.type);
    
    const isCompileTarget = turn === 'player' && !actionRequired &&
        phase === 'compile' && compilableLanes.includes(laneIndex);
        
    const opponentHasPsychic1 = opponent.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Psychic' && c.value === 1);
    const isPlayTarget = selectedCard && phase === 'action' && !actionRequired && player.hand.some(c => c.id === selectedCard) &&
        !opponent.lanes[laneIndex].some(c => c.isFaceUp && c.protocol === 'Plague' && c.value === 0);

    const canTakeAction = isActionTarget || isCompileTarget || isPlayTarget;

    if (canTakeAction) {
        if (isActionTarget) {
            resolveActionWithLane(laneIndex);
        } else if (isCompileTarget) {
            compileLane(laneIndex);
        } else if (isPlayTarget) {
            const cardInHand = player.hand.find(c => c.id === selectedCard)!;
            const playerHasSpiritOne = player.lanes.flat().some(c => c.isFaceUp && c.protocol === 'Spirit' && c.value === 1);
            const canPlayFaceUp = (playerHasSpiritOne || cardInHand.protocol === player.protocols[laneIndex]) && !opponentHasPsychic1;
            playSelectedCard(laneIndex, canPlayFaceUp);
            setHoveredCard(null);
        }
    } else {
        // If no action can be taken and a card is selected, deselect it.
        if (selectedCard) {
            setSelectedCard(null);
            setHoveredCard(null);
        }
    }
  };


  const handleHandCardMouseDown = (card: PlayedCard) => {
    if (gameState.actionRequired) {
      if (gameState.actionRequired.type === 'discard' && gameState.actionRequired.player === 'player') {
        discardCardFromHand(card.id);
        return;
      }
      if (gameState.actionRequired.type === 'select_card_from_hand_to_play') {
        selectHandCardForAction(card.id);
        return;
      }
      if (gameState.actionRequired.type === 'select_card_from_hand_to_give' || gameState.actionRequired.type === 'select_card_from_hand_to_reveal') {
        resolveActionWithHandCard(card.id);
        return;
      }
      if (gameState.actionRequired.type === 'plague_2_player_discard' || gameState.actionRequired.type === 'select_cards_from_hand_to_discard_for_fire_4' || gameState.actionRequired.type === 'select_cards_from_hand_to_discard_for_hate_1') {
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
    
    if (gameState.turn !== 'player' || (gameState.phase !== 'action' && gameState.phase !== 'compile')) return;

    if (card.id === selectedCard) {
      setSelectedCard(null);
      setHoveredCard(null);
    } else {
      setSelectedCard(card.id);
      setHoveredCard({ card, showContents: true });
    }
  };

  const handleBoardCardMouseDown = (card: PlayedCard, owner: Player, laneIndex: number) => {
      const { actionRequired, turn, phase, compilableLanes } = gameState;
      
      const isLaneTargetAction = actionRequired && ['select_lane_for_shift', 'shift_flipped_card_optional', 'select_lane_for_play', 'select_lane_for_death_2', 'select_lane_for_life_3_play', 'select_lane_to_shift_revealed_card_for_light_2', 'select_lane_to_shift_cards_for_light_3', 'select_lane_for_water_3'].includes(actionRequired.type);

      if (isLaneTargetAction) {
          // Player needs to click a valid LANE, not a card. A click on a card in this context
          // should just update the preview and do nothing else.
          const showContents = owner === 'player' || card.isFaceUp;
          setHoveredCard({ card, showContents });
          return;
      }

      // Clicks on board cards can sometimes be treated as lane clicks (e.g., when playing a card from hand).
      const isPlayCardContext = turn === 'player' && !actionRequired && selectedCard && phase === 'action';
      const isCompileContext = turn === 'player' && !actionRequired && phase === 'compile' && compilableLanes.includes(laneIndex);

      if (isPlayCardContext || isCompileContext) {
          handleLaneMouseDown(laneIndex);
          return;
      }

      // If it's not a lane click proxy, it's a card-specific interaction.
      const canTakeAction = isCardTargetable(card, gameState);
      
      if (canTakeAction) {
          resolveActionWithCard(card.id);
      } else {
          // FIX: `selectedCard` is a state variable, not a property of `gameState`.
          if (selectedCard) {
              // A hand card was selected, but the click was on an invalid target card, so deselect.
              setSelectedCard(null);
              setHoveredCard(null);
          } else {
              // No hand card was selected. Just preview the board card.
              const showContents = owner === 'player' || card.isFaceUp;
              setHoveredCard({ card, showContents });
          }
      }
  };
  
  const handleHandCardMouseEnter = (card: PlayedCard) => {
    if (!selectedCard) {
      setHoveredCard({ card, showContents: true });
    }
  };
  
  const handleHandCardMouseLeave = () => {
    if (!selectedCard) {
      setHoveredCard(null);
    }
  };

  const handleBoardCardMouseEnter = (card: PlayedCard, owner: Player) => {
    if (!selectedCard) {
        const showContents = owner === 'player' || card.isFaceUp;
        setHoveredCard({ card, showContents });
    }
  };

  const handleBoardCardMouseLeave = () => {
      if (!selectedCard) {
          setHoveredCard(null);
      }
  };

  const handleOpponentHandCardMouseEnter = (card: PlayedCard) => {
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

  const sourceCardId = gameState.actionRequired?.sourceCardId ?? null;

  return (
    <div className="screen game-screen">
        {debugModalPlayer && (
            <DebugModal
                player={debugModalPlayer}
                playerState={gameState[debugModalPlayer]}
                onClose={() => setDebugModalPlayer(null)}
            />
        )}
        {showRearrangeModal && gameState.actionRequired?.type === 'prompt_rearrange_protocols' && (
            <RearrangeProtocolsModal 
                gameState={gameState}
                targetPlayer={gameState.actionRequired.target}
                onConfirm={(newOrder: string[]) => {
                    resolveRearrangeProtocols(newOrder);
                    setShowRearrangeModal(false);
                }}
            />
        )}
        {showSwapModal && gameState.actionRequired?.type === 'prompt_swap_protocols' && (
            <SwapProtocolsModal 
                gameState={gameState}
                onConfirm={(indices) => {
                    resolveSwapProtocols(indices);
                    setShowSwapModal(false);
                }}
                onCancel={() => {
                    skipAction();
                    setShowSwapModal(false);
                }}
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
                <h2>Mainframe</h2>
                <GameInfoPanel 
                    gameState={gameState} 
                    turn={gameState.turn} 
                    animationState={gameState.animationState}
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
                  gameState={gameState}
                  onLaneMouseDown={handleLaneMouseDown}
                  selectedCardId={selectedCard}
                  onCardMouseDown={handleBoardCardMouseDown}
                  onCardMouseEnter={handleBoardCardMouseEnter}
                  onCardMouseLeave={handleBoardCardMouseLeave}
                  onOpponentHandCardMouseEnter={handleOpponentHandCardMouseEnter}
                  onOpponentHandCardMouseLeave={handleBoardCardMouseLeave}
                  sourceCardId={sourceCardId}
                />
                
                <div className="player-action-area">
                  <PhaseController 
                    gameState={gameState}
                    onFillHand={fillHand}
                    onSkipAction={skipAction}
                    onResolveDeath1Prompt={resolveDeath1Prompt}
                    onResolveLove1Prompt={resolveLove1Prompt}
                    onResolvePlague2Discard={resolvePlague2Discard}
                    onResolvePlague4Flip={resolvePlague4Flip}
                    onResolveFire3Prompt={resolveFire3Prompt}
                    onResolveSpeed3Prompt={resolveSpeed3Prompt}
                    onResolveFire4Discard={resolveFire4Discard}
                    onResolveHate1Discard={resolveHate1Discard}
                    onResolveLight2Prompt={resolveLight2Prompt}
                    onResolvePsychic4Prompt={resolvePsychic4Prompt}
                    onResolveSpirit1Prompt={resolveSpirit1Prompt}
                    onResolveSpirit3Prompt={resolveSpirit3Prompt}
                    selectedCardId={selectedCard}
                    multiSelectedCardIds={multiSelectedCardIds}
                  />
                  <div className={`player-hand-area ${gameState.actionRequired ? 'action-required' : ''}`}>
                    {gameState.player.hand.map((card) => (
                      <CardComponent 
                        key={card.id} 
                        card={card}
                        isFaceUp={true}
                        onMouseDown={() => handleHandCardMouseDown(card)}
                        onMouseEnter={() => handleHandCardMouseEnter(card)}
                        onMouseLeave={handleHandCardMouseLeave}
                        isSelected={card.id === selectedCard}
                        isMultiSelected={multiSelectedCardIds.includes(card.id)}
                        animationState={gameState.animationState}
                        additionalClassName="in-hand"
                      />
                    ))}
                  </div>
                </div>
            </div>
        </div>
    </div>
  );
}