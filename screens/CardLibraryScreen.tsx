/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Header } from '../components/Header';
import { CardComponent } from '../components/Card';
import { cards, Card as CardData, uniqueProtocols } from '../data/cards';
import { PlayedCard } from '../types';

interface CardLibraryScreenProps {
  onBack: () => void;
}

export function CardLibraryScreen({ onBack }: CardLibraryScreenProps) {
  const [previewCard, setPreviewCard] = useState<CardData>(cards[0]);

  const cardsByProtocol = useMemo(() => {
    const grouped: Record<string, CardData[]> = {};
    for (const card of cards) {
      if (!grouped[card.protocol]) {
        grouped[card.protocol] = [];
      }
      grouped[card.protocol].push(card);
    }
    // Sort cards within each protocol by value
    for (const protocol in grouped) {
        grouped[protocol].sort((a, b) => a.value - b.value);
    }
    return grouped;
  }, []);

  const handleCardInteraction = (card: CardData) => {
    setPreviewCard(card);
  };
  
  const renderPreview = () => {
    if (!previewCard) return null;
    // CardComponent expects a PlayedCard, so we adapt the CardData
    const cardForComponent: PlayedCard = {
      ...previewCard,
      id: 'preview',
      isFaceUp: true,
    };
    return <CardComponent card={cardForComponent} isFaceUp={true} />;
  };

  return (
    <div className="screen card-library-screen">
      <Header title="Card Library" onBack={onBack} />
      <div className="card-library-layout">
        <div className="game-preview-container">
          <h2>Card Preview</h2>
          <div className="preview-card-area">
            {renderPreview()}
          </div>
        </div>
        <div className="card-list-container">
          {uniqueProtocols.map(protocol => (
            <div key={protocol} className="protocol-group">
              <h3>{protocol}</h3>
              <div className="protocol-card-grid">
                {cardsByProtocol[protocol].map(card => {
                  const cardForComponent: PlayedCard = {
                    ...card,
                    id: `${card.protocol}-${card.value}`,
                    isFaceUp: true,
                  };
                  return (
                    <CardComponent
                      key={cardForComponent.id}
                      card={cardForComponent}
                      isFaceUp={true}
                      additionalClassName="in-hand"
                      onMouseEnter={() => handleCardInteraction(card)}
                      onMouseDown={() => handleCardInteraction(card)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}