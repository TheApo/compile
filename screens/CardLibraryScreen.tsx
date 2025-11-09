/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Header } from '../components/Header';
import { CardComponent } from '../components/Card';
import { cards as baseCards, Card as CardData, uniqueProtocols as baseUniqueProtocols } from '../data/cards';
import { PlayedCard } from '../types';
import { getAllCustomProtocolCards } from '../logic/customProtocols/cardFactory';
import { invalidateCardCache } from '../utils/gameLogic';
import { isCustomProtocolEnabled } from '../utils/customProtocolSettings';

interface CardLibraryScreenProps {
  onBack: () => void;
}

export function CardLibraryScreen({ onBack }: CardLibraryScreenProps) {
  // Refresh tracker to force cards reload when custom protocols change
  const [refreshKey, setRefreshKey] = useState(0);

  // Invalidate card cache on mount to load latest custom protocols
  useEffect(() => {
    invalidateCardCache();
    setRefreshKey(prev => prev + 1);
  }, []);

  // Merge base cards with custom protocol cards (only if enabled)
  const cards = useMemo(() => {
    console.log('[Card Library] Loading cards, refreshKey:', refreshKey);
    const customEnabled = isCustomProtocolEnabled();
    const customCards = customEnabled ? getAllCustomProtocolCards() : [];
    const merged = [...baseCards, ...customCards];
    console.log('[Card Library] Total cards:', merged.length, '(base:', baseCards.length, ', custom:', customCards.length, ', enabled:', customEnabled, ')');
    return merged;
  }, [refreshKey]);

  // Get unique protocols from merged cards
  const uniqueProtocols = useMemo(() => {
    const protocolSet = new Set(cards.map(card => card.protocol));
    return Array.from(protocolSet).sort();
  }, [cards]);

  const [previewCard, setPreviewCard] = useState<CardData | null>(null);

  // Get all unique categories dynamically
  const allCategories = useMemo(() => {
    const categorySet = new Set(cards.map(card => card.category));
    return Array.from(categorySet).sort();
  }, [cards]);

  // Filter state - by default all categories are enabled
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => new Set(allCategories));

  // Initialize preview card when cards are loaded
  useEffect(() => {
    if (cards.length > 0 && !previewCard) {
      setPreviewCard(cards[0]);
    }
  }, [cards, previewCard]);

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
  }, [uniqueProtocols, enabledCategories, cards]);

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
  }, [cards]);

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