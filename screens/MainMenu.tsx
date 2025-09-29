/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { RulesModal } from '../components/RulesModal';
import { CardComponent } from '../components/Card';
import { cards, Card as CardData } from '../data/cards';
import { shuffleDeck } from '../utils/gameLogic';
import { Difficulty } from '../types';

interface MainMenuProps {
  onNavigate: (screen: 'ProtocolSelection' | 'CardLibrary') => void;
  difficulty: Difficulty;
  setDifficulty: (difficulty: Difficulty) => void;
  useControl: boolean;
  onUseControlChange: (enabled: boolean) => void;
}

export function MainMenu({ onNavigate, difficulty, setDifficulty, useControl, onUseControlChange }: MainMenuProps) {
  const [showRules, setShowRules] = useState(false);
  const [decorativeCardRight, setDecorativeCardRight] = useState<CardData | null>(null);
  const [previewCard, setPreviewCard] = useState<CardData | null>(null);
  const [initialPreviewCard, setInitialPreviewCard] = useState<CardData | null>(null);
  const [shuffledTickerCards, setShuffledTickerCards] = useState<CardData[]>([]);

  useEffect(() => {
    // A stable way to get two different random cards
    const indices = new Set<number>();
    while(indices.size < 2 && indices.size < cards.length) {
        indices.add(Math.floor(Math.random() * cards.length));
    }
    const randomCards = Array.from(indices).map(i => cards[i]);
    
    // Set up the preview card and the right decorative card
    if (randomCards.length > 0) {
      setInitialPreviewCard(randomCards[0]);
      setPreviewCard(randomCards[0]);
    }
    if (randomCards.length > 1) {
      setDecorativeCardRight(randomCards[1]);
    }

    // Shuffle all cards for the bottom ticker animation
    setShuffledTickerCards(shuffleDeck(cards));
  }, []);

  return (
    <div className="screen main-menu">
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      
      <h1>COMPILE: MAIN 1</h1>
      <div className="main-menu-attribution">
        <p>
          based on the card game <a href="https://boardgamegeek.com/boardgame/406652/compile-main-1" target="_blank" rel="noopener noreferrer">Compile: Main 1</a> designed by <a href="https://justgravyllc.com/" target="_blank" rel="noopener noreferrer">Michael Yang</a>
        </p>
        <p>
          developed by <a href="https://apo-games.de/" target="_blank" rel="noopener noreferrer">Dirk Aporius</a>
        </p>
      </div>
      
      <div className="main-menu-layout">
        <div className="main-menu-preview decorative-card">
            {previewCard && 
                <CardComponent 
                    card={{...previewCard, id: 'preview', isFaceUp: true}} 
                    isFaceUp={true} 
                />
            }
        </div>

        <div className="main-menu-actions-container">
          <div className="main-menu-start-group">
            <div className="difficulty-selector">
              <h3 className="difficulty-title">Difficulty</h3>
              <div className="difficulty-options">
                <button className={`btn ${difficulty === 'easy' ? 'active' : ''}`} onClick={() => setDifficulty('easy')}>Easy</button>
                <button className={`btn ${difficulty === 'normal' ? 'active' : ''}`} onClick={() => setDifficulty('normal')}>Normal</button>
                <button className={`btn ${difficulty === 'hard' ? 'active' : ''}`} onClick={() => setDifficulty('hard')}>Hard</button>
              </div>
            </div>
            <div className="control-mechanic-selector">
                <input
                    type="checkbox"
                    id="control-mechanic"
                    checked={useControl}
                    onChange={(e) => onUseControlChange(e.target.checked)}
                />
                <label htmlFor="control-mechanic">Use Control Mechanic</label>
            </div>
            <button className="btn btn-start" onClick={() => onNavigate('ProtocolSelection')}>
              Start Game
            </button>
          </div>
          <div className="main-menu-other-actions">
            <button className="btn" onClick={() => onNavigate('CardLibrary')}>
              Cards
            </button>
            <button className="btn" onClick={() => setShowRules(true)}>
              Rules
            </button>
            <p className="version-info">Version 0.16</p>
          </div>
        </div>
        
        <div className="decorative-card decorative-card-right">
          {decorativeCardRight && 
              <CardComponent 
                  card={{...decorativeCardRight, id: 'deco-2', isFaceUp: true}} 
                  isFaceUp={true} 
              />
          }
        </div>
      </div>
      
      <div className="card-ticker-container" onPointerLeave={() => setPreviewCard(initialPreviewCard)}>
        <div className="card-ticker-track">
            {/* Render the list twice for a seamless loop */}
            {shuffledTickerCards.map((card, index) => (
                <CardComponent 
                    key={`ticker-1-${index}`}
                    card={{...card, id: `ticker-1-${index}`, isFaceUp: true}} 
                    isFaceUp={true}
                    additionalClassName="in-hand"
                    onPointerEnter={() => setPreviewCard(card)}
                />
            ))}
            {shuffledTickerCards.map((card, index) => (
                <CardComponent 
                    key={`ticker-2-${index}`}
                    card={{...card, id: `ticker-2-${index}`, isFaceUp: true}} 
                    isFaceUp={true}
                    additionalClassName="in-hand"
                    onPointerEnter={() => setPreviewCard(card)}
                />
            ))}
        </div>
      </div>
    </div>
  );
}