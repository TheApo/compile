/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card as CardData } from '../data/cards';
import { Player, PlayerState, PlayedCard } from '../types';
import { CardComponent } from './Card';

interface DebugModalProps {
  player: Player;
  playerState: PlayerState;
  onClose: () => void;
}

export function DebugModal({ player, playerState, onClose }: DebugModalProps) {
  const playerName = player.charAt(0).toUpperCase() + player.slice(1);

  const renderCardGrid = (cards: CardData[], title: string) => {
    // Adapt CardData to PlayedCard for the component
    const playedCards: PlayedCard[] = cards.map((card, index) => ({
      ...card,
      id: `${title}-${card.protocol}-${card.value}-${index}`,
      isFaceUp: true,
    }));

    return (
      <>
        <h3>{title} ({playedCards.length})</h3>
        <div className="debug-card-grid">
          {playedCards.length > 0 ? (
            playedCards.map(card => (
              <CardComponent
                key={card.id}
                card={card}
                isFaceUp={true}
                additionalClassName="in-hand"
              />
            ))
          ) : (
            <p className="no-cards">No cards in {title.toLowerCase()}.</p>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content debug-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-back modal-close-btn" onClick={onClose}>X</button>
        <h2>{playerName}'s Info</h2>
        
        {renderCardGrid(playerState.deck, 'Deck')}
        {renderCardGrid(playerState.discard, 'Discard Pile')}
      </div>
    </div>
  );
}
