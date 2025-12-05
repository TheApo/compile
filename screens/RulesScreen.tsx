/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Header } from '../components/Header';
import { CardComponent } from '../components/Card';
import { PlayedCard } from '../types';
import '../styles/layouts/rules-screen.css';

interface RulesScreenProps {
  onBack: () => void;
}

// Spirit-1 card data for the anatomy example
const spiritCard: PlayedCard = {
  id: 'spirit-1-example',
  protocol: 'Spirit',
  value: 1,
  top: 'When you play cards face-up, they may be played without matching protocols.',
  middle: 'Draw 2 cards.',
  bottom: '<span class="emphasis">Start:</span> Either discard 1 card or flip this card.',
  isFaceUp: true,
  category: 'Main 1',
  keywords: {}
};

// Generic face-down card
const faceDownCard: PlayedCard = {
  id: 'face-down-example',
  protocol: 'Spirit',
  value: 1,
  top: '',
  middle: '',
  bottom: '',
  isFaceUp: false,
  category: 'Main 1',
  keywords: {}
};

// =====================================
// DEMO BOARD DATA - Example game state
// =====================================

// Lane 0: Light COMPILED (opponent), Darkness in progress (player has 7)
// Lane 1: Spirit vs Plague - Plague ready to compile (10 value) but NOT yet compiled
// Lane 2: Water vs Death - early game

// Opponent cards for demo board (Opponent has: Light, Spirit, Water)
// NOTE: Opponent side is rotated 180°, so visual order is reversed!
const opponentLane0Cards: PlayedCard[] = [
  {
    id: 'opp-light-4',
    protocol: 'Light',
    value: 4,
    top: '',
    middle: 'Your opponent reveals their hand.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { reveal: true }
  }
];

const opponentLane1Cards: PlayedCard[] = [
  {
    id: 'opp-spirit-3',
    protocol: 'Spirit',
    value: 3,
    top: "<div><span class='emphasis'>After you draw cards:</span> You may shift this card, even if this card is covered.</div>",
    middle: '',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { shift: true }
  },
  {
    id: 'opp-spirit-2',
    protocol: 'Spirit',
    value: 2,
    top: '',
    middle: 'You may flip 1 card.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { flip: true }
  }
];

const opponentLane2Cards: PlayedCard[] = [
  {
    id: 'opp-water-3',
    protocol: 'Water',
    value: 3,
    top: '',
    middle: 'Return all cards with a value of 2 in 1 line.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { return: true }
  }
];

// Player cards for demo board (Player has: Darkness, Plague, Death)
const playerLane0Cards: PlayedCard[] = [
  {
    id: 'player-darkness-5',
    protocol: 'Darkness',
    value: 5,
    top: '',
    middle: 'You discard 1 card.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { discard: true }
  },
  {
    id: 'player-facedown-0',
    protocol: 'Darkness',
    value: 2,
    top: '',
    middle: '',
    bottom: '',
    isFaceUp: false,
    category: 'Main 1',
    keywords: {}
  }
];

const playerLane1Cards: PlayedCard[] = [
  {
    id: 'player-plague-1',
    protocol: 'Plague',
    value: 1,
    top: "<div><span class='emphasis'>After your opponent discards cards:</span> Draw 1 card.</div>",
    middle: 'Your opponent discards 1 card.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { draw: true, discard: true }
  },
  {
    id: 'player-plague-5',
    protocol: 'Plague',
    value: 5,
    top: '',
    middle: 'You discard 1 card.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { discard: true }
  },
  {
    id: 'player-plague-4',
    protocol: 'Plague',
    value: 4,
    top: '',
    middle: '',
    bottom: "<div><span class='emphasis'>End:</span> Your opponent deletes 1 of their face-down cards. You may flip this card.</div>",
    isFaceUp: true,
    category: 'Main 1',
    keywords: { delete: true, flip: true }
  }
];

const playerLane2Cards: PlayedCard[] = [
  {
    id: 'player-death-0',
    protocol: 'Death',
    value: 0,
    top: '',
    middle: 'Delete 1 card from each other line.',
    bottom: '',
    isFaceUp: true,
    category: 'Main 1',
    keywords: { delete: true }
  },
  {
    id: 'player-facedown-3',
    protocol: 'Death',
    value: 2,
    top: '',
    middle: '',
    bottom: '',
    isFaceUp: false,
    category: 'Main 1',
    keywords: {}
  }
];

// Protocol configuration - IMPORTANT: Each player has different protocols!
// The 6 protocols are split between players (no overlap allowed)
const demoProtocols = {
  opponent: ['Light', 'Spirit', 'Water'],    // Opponent's 3 protocols
  player: ['Darkness', 'Plague', 'Death'],   // Player's 3 protocols
  opponentCompiled: [true, false, false],    // Light IS compiled
  playerCompiled: [false, false, false],     // None compiled yet (Plague ready but not compiled)
  opponentValues: [4, 5, 3],                 // Light: 4, Spirit: 3+2=5, Water: 3
  playerValues: [7, 10, 2],                  // Darkness: 5+2=7, Plague: 1+5+4=10 (ready!), Death: 0+2=2
};

export function RulesScreen({ onBack }: RulesScreenProps) {
  const opponentLanes = [opponentLane0Cards, opponentLane1Cards, opponentLane2Cards];
  const playerLanes = [playerLane0Cards, playerLane1Cards, playerLane2Cards];

  return (
    <div className="screen rules-screen">
      <Header title="GAME RULES" onBack={onBack} />

      <div className="rules-content">
        {/* Objective Section */}
        <section className="rules-section">
          <h2 className="section-title">Objective</h2>
          <div className="rules-text">
            <p>
              You play as an artificial intelligence trying to <span className="emphasis">compile your 3 protocols</span>.
              Play command cards on protocols and execute their effects. If you reach a total value of
              <span className="emphasis"> at least 10</span> with your cards on a protocol and exceed the
              opponent's total value in the same line, you may compile that protocol.
            </p>
            <p className="rules-highlight">
              The first player to compile all 3 protocols wins!
            </p>
          </div>
        </section>

        {/* NEW: The Field Overview Section */}
        <section className="rules-section field-overview-section">
          <h2 className="section-title">The Field</h2>
          <div className="field-intro">
            <p>
              The field consists of <span className="emphasis">3 lines</span>, each passing through two opposing protocols.
              Both players place cards on their side of each line. The goal is to build up value in your stacks
              to reach the compile threshold.
            </p>
          </div>

          {/* Demo Game Board */}
          <div className="demo-board-container">
            <div className="demo-board">
              {/* Opponent Side Label */}
              <div className="demo-side-label opponent-label">Opponent</div>

              {/* Opponent's Side */}
              <div className="demo-player-side demo-opponent-side">
                <div className="demo-lanes">
                  {opponentLanes.map((laneCards, laneIndex) => (
                    <div
                      key={`opp-lane-${laneIndex}`}
                      className={`demo-lane ${demoProtocols.opponentCompiled[laneIndex] ? 'demo-lane-compiled' : ''}`}
                    >
                      <div className="demo-lane-stack">
                        {laneCards.map((card, cardIndex) => (
                          <CardComponent
                            key={card.id}
                            card={card}
                            isFaceUp={card.isFaceUp}
                            style={{ '--i': cardIndex } as React.CSSProperties}
                            faceDownValue={2}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Central Protocol Bars */}
              <div className="demo-protocol-bars-container">
                {/* Opponent Protocol Bar */}
                <div className="demo-protocol-bar demo-opponent-bar">
                  {demoProtocols.opponent.map((protocol, i) => (
                    <div
                      key={`opp-proto-${i}`}
                      className={`demo-protocol-display ${demoProtocols.opponentCompiled[i] ? 'compiled' : ''}`}
                    >
                      <span className="demo-protocol-name">{protocol}</span>
                      <span className="demo-protocol-value">{demoProtocols.opponentValues[i]}</span>
                    </div>
                  ))}
                </div>

                {/* Player Protocol Bar */}
                <div className="demo-protocol-bar demo-player-bar">
                  {demoProtocols.player.map((protocol, i) => (
                    <div
                      key={`player-proto-${i}`}
                      className={`demo-protocol-display ${demoProtocols.playerCompiled[i] ? 'compiled' : ''}`}
                    >
                      <span className="demo-protocol-name">{protocol}</span>
                      <span className="demo-protocol-value">{demoProtocols.playerValues[i]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Player's Side */}
              <div className="demo-player-side">
                <div className="demo-lanes">
                  {playerLanes.map((laneCards, laneIndex) => (
                    <div
                      key={`player-lane-${laneIndex}`}
                      className={`demo-lane ${demoProtocols.playerCompiled[laneIndex] ? 'demo-lane-compiled' : ''} ${laneIndex === 1 ? 'demo-lane-compilable' : ''}`}
                    >
                      <div className="demo-lane-stack">
                        {laneCards.map((card, cardIndex) => (
                          <CardComponent
                            key={card.id}
                            card={card}
                            isFaceUp={card.isFaceUp}
                            style={{ '--i': cardIndex } as React.CSSProperties}
                            faceDownValue={2}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Player Side Label */}
              <div className="demo-side-label player-label">You</div>
            </div>

            {/* Demo Board Annotations */}
            <div className="demo-board-annotations">
              <div className="demo-annotation compiled-annotation">
                <div className="demo-annotation-marker compiled-marker">1</div>
                <div className="demo-annotation-content">
                  <strong>Compiled Protocol</strong>
                  <p>Light has been compiled by the opponent! The protocol bar glows cyan.</p>
                </div>
              </div>
              <div className="demo-annotation compilable-annotation">
                <div className="demo-annotation-marker compilable-marker">2</div>
                <div className="demo-annotation-content">
                  <strong>Ready to Compile!</strong>
                  <p>Plague has value 10 (1+5+4) which is ≥10 and higher than opponent's Spirit at 5. This protocol can be compiled!</p>
                </div>
              </div>
              <div className="demo-annotation inprogress-annotation">
                <div className="demo-annotation-marker inprogress-marker">3</div>
                <div className="demo-annotation-content">
                  <strong>In Progress</strong>
                  <p>Death/Water lanes are still building up. Keep playing cards to reach the compile threshold of 10!</p>
                </div>
              </div>
              <div className="demo-annotation topbox-annotation">
                <div className="demo-annotation-marker topbox-marker">4</div>
                <div className="demo-annotation-content">
                  <strong>Top Effect Always Visible</strong>
                  <p>See Plague-1's top effect? It stays active even when covered! Top effects are always visible and active on face-up cards.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Field Legend */}
          <div className="field-legend">
            <div className="legend-item">
              <div className="legend-swatch legend-compiled"></div>
              <span>Compiled Protocol</span>
            </div>
            <div className="legend-item">
              <div className="legend-swatch legend-compilable"></div>
              <span>Ready to Compile (≥10 value & higher than opponent)</span>
            </div>
            <div className="legend-item">
              <div className="legend-swatch legend-facedown"></div>
              <span>Face-down Card (base value: 2)</span>
            </div>
          </div>
        </section>

        {/* Card Anatomy Section */}
        <section className="rules-section card-anatomy-section">
          <h2 className="section-title">Card Anatomy</h2>
          <div className="card-anatomy-layout">
            <div className="card-anatomy-display">
              <div className="anatomy-card-wrapper">
                <CardComponent card={spiritCard} isFaceUp={true} />

                {/* Annotation arrows and labels */}
                <div className="anatomy-annotation annotation-protocol">
                  <div className="annotation-line annotation-line-left"></div>
                  <div className="annotation-label">
                    <span className="annotation-letter">A</span>
                    <span className="annotation-text">Protocol</span>
                  </div>
                </div>

                <div className="anatomy-annotation annotation-value">
                  <div className="annotation-line annotation-line-right"></div>
                  <div className="annotation-label">
                    <span className="annotation-letter">B</span>
                    <span className="annotation-text">Value</span>
                  </div>
                </div>

                <div className="anatomy-annotation annotation-top">
                  <div className="annotation-line annotation-line-right"></div>
                  <div className="annotation-label">
                    <span className="annotation-letter">C</span>
                    <span className="annotation-text">Top Effect</span>
                  </div>
                </div>

                <div className="anatomy-annotation annotation-middle">
                  <div className="annotation-line annotation-line-right"></div>
                  <div className="annotation-label">
                    <span className="annotation-letter">D</span>
                    <span className="annotation-text">Middle Effect</span>
                  </div>
                </div>

                <div className="anatomy-annotation annotation-bottom">
                  <div className="annotation-line annotation-line-right"></div>
                  <div className="annotation-label">
                    <span className="annotation-letter">E</span>
                    <span className="annotation-text">Bottom Effect</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="card-anatomy-descriptions">
              <div className="anatomy-item">
                <span className="anatomy-letter">A</span>
                <div className="anatomy-desc">
                  <strong>Protocol Indicator</strong>
                  <p>Dictates which line a card can be played face-up in. Cards must match the protocol of that line.</p>
                </div>
              </div>
              <div className="anatomy-item">
                <span className="anatomy-letter">B</span>
                <div className="anatomy-desc">
                  <strong>Value</strong>
                  <p>The value added to the total value of a stack. Higher values help you reach the compile threshold of 10.</p>
                </div>
              </div>
              <div className="anatomy-item anatomy-item-highlight">
                <span className="anatomy-letter">C</span>
                <div className="anatomy-desc">
                  <strong>Top Command - Persistent</strong>
                  <p>While this card is face-up, this passive text is <span className="emphasis">always active</span>, even when covered by other cards.</p>
                </div>
              </div>
              <div className="anatomy-item anatomy-item-highlight">
                <span className="anatomy-letter">D</span>
                <div className="anatomy-desc">
                  <strong>Middle Command - Immediate</strong>
                  <p>Resolve this active text immediately when the card is played, flipped face-up, or uncovered.</p>
                </div>
              </div>
              <div className="anatomy-item anatomy-item-highlight">
                <span className="anatomy-letter">E</span>
                <div className="anatomy-desc">
                  <strong>Bottom Command - Auxiliary</strong>
                  <p>This passive text (often triggered effects like "Start:" or "End:") is only active when the card is <span className="emphasis">uncovered</span>.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Face-Down Cards Section */}
        <section className="rules-section face-down-section">
          <h2 className="section-title">Face-Down Cards</h2>
          <div className="face-down-layout">
            <div className="face-down-card-wrapper">
              <CardComponent card={faceDownCard} isFaceUp={false} faceDownValue={2} />
            </div>
            <div className="face-down-description">
              <p>
                Cards can be played <span className="emphasis">face-down</span> into any line, regardless of protocol matching.
              </p>
              <ul>
                <li>Face-down cards have a <span className="emphasis">base value of 2</span></li>
                <li>No effects are active while face-down</li>
                <li>Can be flipped face-up by card effects</li>
                <li>When flipped, the middle effect triggers</li>
                <li>Some cards modify face-down values (e.g., Darkness-2)</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Turn Order Section */}
        <section className="rules-section">
          <h2 className="section-title">Turn Order</h2>
          <div className="turn-order-grid">
            <div className="turn-phase">
              <span className="phase-number">1</span>
              <div className="phase-content">
                <strong>Start Phase</strong>
                <p>Resolve all visible "Start" effects of your face-up command cards.</p>
              </div>
            </div>
            <div className="turn-phase">
              <span className="phase-number">2</span>
              <div className="phase-content">
                <strong>Check Control</strong>
                <p>If your total value is higher than opponent's in at least 2 lines, take the control component.</p>
              </div>
            </div>
            <div className="turn-phase">
              <span className="phase-number">3</span>
              <div className="phase-content">
                <strong>Check Compile</strong>
                <p>If you can compile (10+ value and higher than opponent), you must compile one protocol.</p>
              </div>
            </div>
            <div className="turn-phase">
              <span className="phase-number">4</span>
              <div className="phase-content">
                <strong>Action</strong>
                <p>Play 1 card from hand OR refresh your hand (draw until you have 5 cards).</p>
              </div>
            </div>
            <div className="turn-phase">
              <span className="phase-number">5</span>
              <div className="phase-content">
                <strong>Check Cache</strong>
                <p>If you have more than 5 cards, discard down to 5.</p>
              </div>
            </div>
            <div className="turn-phase">
              <span className="phase-number">6</span>
              <div className="phase-content">
                <strong>End Phase</strong>
                <p>Resolve all visible "End" effects of your face-up command cards.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Glossary Section */}
        <section className="rules-section glossary-section">
          <h2 className="section-title">Glossary</h2>
          <div className="glossary-grid">
            <div className="glossary-item">
              <strong>Compile</strong>
              <p>Delete all cards in a line on both sides and flip your protocol to "Compiled".</p>
            </div>
            <div className="glossary-item">
              <strong>Covered</strong>
              <p>A card with another card on top of it. Only top effects remain active.</p>
            </div>
            <div className="glossary-item">
              <strong>Uncovered</strong>
              <p>The topmost card in a stack, furthest from the protocol.</p>
            </div>
            <div className="glossary-item">
              <strong>Delete</strong>
              <p>Move a card from the field to the trash.</p>
            </div>
            <div className="glossary-item">
              <strong>Discard</strong>
              <p>Move a card from hand to the owner's trash.</p>
            </div>
            <div className="glossary-item">
              <strong>Flip</strong>
              <p>Change a card from face-down to face-up, or vice versa.</p>
            </div>
            <div className="glossary-item">
              <strong>Shift</strong>
              <p>Move a card to another line on the same side of the field.</p>
            </div>
            <div className="glossary-item">
              <strong>Return</strong>
              <p>Move a card from the field to its owner's hand.</p>
            </div>
            <div className="glossary-item">
              <strong>Reveal</strong>
              <p>Show hidden information publicly, then return it to its previous state.</p>
            </div>
            <div className="glossary-item">
              <strong>Refresh</strong>
              <p>Draw cards until you have 5 cards in hand.</p>
            </div>
            <div className="glossary-item">
              <strong>Line</strong>
              <p>The area passing through two opposing protocols. The field has 3 lines.</p>
            </div>
            <div className="glossary-item">
              <strong>Stack</strong>
              <p>The cards in a line on one player's side.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
