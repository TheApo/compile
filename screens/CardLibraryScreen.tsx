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

  // Get all unique categories dynamically
  const allCategories = useMemo(() => {
    const categorySet = new Set(cards.map(card => card.category));
    return Array.from(categorySet).sort();
  }, []);

  // Filter state - by default all categories are enabled
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => new Set(allCategories));

  // Toggle category filter
  const toggleCategory = (category: string) => {
    setEnabledCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Get category for a protocol
  const getProtocolCategory = (protocol: string): string => {
    const card = cards.find(c => c.protocol === protocol);
    return card?.category || '';
  };

  // Filter protocols by enabled categories
  const filteredProtocols = useMemo(() => {
    return uniqueProtocols.filter(protocol => {
      const category = getProtocolCategory(protocol);
      return enabledCategories.has(category);
    });
  }, [enabledCategories]);

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
          {/* Category Filters */}
          <div className="category-filters">
            {allCategories.map(category => (
              <label key={category} className="category-filter-item">
                <input
                  type="checkbox"
                  checked={enabledCategories.has(category)}
                  onChange={() => toggleCategory(category)}
                />
                <span>{category}</span>
              </label>
            ))}
          </div>

          {filteredProtocols.map(protocol => (
            <div key={protocol} className="protocol-group">
              <h3>
                {protocol}
                <span className="protocol-category-label"> ({getProtocolCategory(protocol)})</span>
              </h3>
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
                      onPointerEnter={() => handleCardInteraction(card)}
                      onPointerDown={() => handleCardInteraction(card)}
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