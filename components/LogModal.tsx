/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { LogEntry, PlayedCard } from '../types';
import { cards as allBaseCards, Card } from '../data/cards';
import { getAllCustomProtocolCards } from '../logic/customProtocols/cardFactory';
import { CardComponent } from './Card';

interface LogModalProps {
  log: LogEntry[];
  onClose: () => void;
}

// Card name pattern: Protocol-Value (e.g., "Fire-3", "Anarchy_custom-0", "Death-1")
const CARD_NAME_PATTERN = /\b([A-Z][a-z]+(?:_custom)?)-(\d)\b/g;

// Create a PlayedCard from card data for preview
function createPreviewCard(cardData: Card, isFaceUp: boolean): PlayedCard {
  return {
    ...cardData,
    id: `preview-${cardData.protocol}-${cardData.value}`,
    isFaceUp,
  };
}

// Parse a single card name string like "Gravity-2" or "Fire_custom-1"
function parseCardName(cardName: string): { protocol: string; value: number } | null {
  const match = cardName.match(/^([A-Z][a-z]+(?:_custom)?)-(\d)$/);
  if (match) {
    return {
      protocol: match[1],
      value: parseInt(match[2], 10),
    };
  }
  return null;
}

// Parse card names from log message
function extractCardNames(message: string): { protocol: string; value: number }[] {
  const matches: { protocol: string; value: number }[] = [];
  let match;
  const regex = new RegExp(CARD_NAME_PATTERN);

  while ((match = regex.exec(message)) !== null) {
    matches.push({
      protocol: match[1],
      value: parseInt(match[2], 10),
    });
  }

  return matches;
}

// Check if log entry has card references (either from refs, sourceCard, or parsed from message)
function hasCardPreview(entry: LogEntry, allCards: Card[]): boolean {
  // Check explicit refs first
  if (entry.sourceCardRef || (entry.targetCardRefs && entry.targetCardRefs.length > 0)) {
    return true;
  }

  // Check sourceCard field (e.g., "Gravity-2")
  if (entry.sourceCard) {
    const parsed = parseCardName(entry.sourceCard);
    if (parsed && allCards.some(c => c.protocol === parsed.protocol && c.value === parsed.value)) {
      return true;
    }
  }

  // Parse card names from message
  const cardNames = extractCardNames(entry.message);
  if (cardNames.length > 0) {
    if (cardNames.some(cn => allCards.some(c => c.protocol === cn.protocol && c.value === cn.value))) {
      return true;
    }
  }

  return false;
}

interface CardPreviewData {
  source: PlayedCard | null;
  targets: PlayedCard[];
}

// Get preview cards for a log entry
function getPreviewCards(entry: LogEntry, allCards: Card[]): CardPreviewData {
  const result: CardPreviewData = { source: null, targets: [] };

  // If we have explicit refs, use them
  if (entry.sourceCardRef) {
    const cardData = allCards.find(
      c => c.protocol === entry.sourceCardRef!.protocol && c.value === entry.sourceCardRef!.value
    );
    if (cardData) {
      result.source = createPreviewCard(cardData, entry.sourceCardRef.isFaceUp);
    }
  }

  if (entry.targetCardRefs && entry.targetCardRefs.length > 0) {
    for (const ref of entry.targetCardRefs) {
      const cardData = allCards.find(
        c => c.protocol === ref.protocol && c.value === ref.value
      );
      if (cardData) {
        result.targets.push(createPreviewCard(cardData, ref.isFaceUp));
      }
    }
  }

  // If no explicit refs, use sourceCard field and parse message
  if (!result.source && result.targets.length === 0) {
    // First: Use entry.sourceCard as the source (e.g., "Gravity-2" from "[Middle] Gravity-2: ...")
    if (entry.sourceCard) {
      const parsed = parseCardName(entry.sourceCard);
      if (parsed) {
        const cardData = allCards.find(c => c.protocol === parsed.protocol && c.value === parsed.value);
        if (cardData) {
          result.source = createPreviewCard(cardData, true);
        }
      }
    }

    // Second: Parse card names from the message as targets
    const cardNames = extractCardNames(entry.message);
    for (const cn of cardNames) {
      const cardData = allCards.find(c => c.protocol === cn.protocol && c.value === cn.value);
      if (cardData) {
        const previewCard = createPreviewCard(cardData, true);
        // If we don't have a source yet, use the first card as source
        if (!result.source) {
          result.source = previewCard;
        } else {
          // Otherwise add as target (avoid duplicates with source)
          if (result.source.protocol !== cn.protocol || result.source.value !== cn.value) {
            result.targets.push(previewCard);
          }
        }
      }
    }
  }

  return result;
}

export function LogModal({ log, onClose }: LogModalProps) {
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number>(0);

  // Get all cards (base + custom)
  const allCards = useMemo(() => {
    const customCards = getAllCustomProtocolCards();
    return [...allBaseCards, ...customCards];
  }, []);

  const formatLogEntry = (entry: LogEntry) => {
    let prefix = '';

    // Add phase marker if present
    if (entry.phase) {
      const phaseLabel = entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1);
      prefix += `[${phaseLabel}] `;
    }

    // Add source card if present (and different from message)
    if (entry.sourceCard && !entry.message.startsWith(entry.sourceCard)) {
      prefix += `${entry.sourceCard}: `;
    }

    return `${prefix}${entry.message}`;
  };

  // Get preview data for selected entry
  const selectedPreview = useMemo(() => {
    if (selectedEntryIndex === null) return null;
    const entry = log[selectedEntryIndex];
    if (!entry) return null;
    return getPreviewCards(entry, allCards);
  }, [selectedEntryIndex, log, allCards]);

  const handleEntryClick = (index: number, entry: LogEntry) => {
    if (!hasCardPreview(entry, allCards)) return;

    if (selectedEntryIndex === index) {
      // If clicking same entry, cycle through targets or deselect
      if (selectedPreview && selectedPreview.targets.length > 1) {
        setTargetIndex((prev) => (prev + 1) % selectedPreview.targets.length);
      } else {
        setSelectedEntryIndex(null);
        setTargetIndex(0);
      }
    } else {
      setSelectedEntryIndex(index);
      setTargetIndex(0);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content log-modal-content log-modal-with-preview" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-back modal-close-btn" onClick={onClose}>X</button>
        <h2>Game Log</h2>

        <div className="log-content-wrapper">
          {/* Left preview area */}
          <div className="log-preview-area log-preview-left">
            {selectedPreview?.source && (
              <div className="log-preview-card">
                <CardComponent
                  card={selectedPreview.source}
                  isFaceUp={selectedPreview.source.isFaceUp}
                />
              </div>
            )}
          </div>

          {/* Log list */}
          <ol className="log-list">
            {log.map((entry, index) => {
              // Only apply custom paddingLeft if there's an indentLevel (effect-related logs)
              // Otherwise, let CSS handle it (game setup logs, etc.)
              const hasCustomIndent = entry.indentLevel !== undefined;
              const style: React.CSSProperties = hasCustomIndent
                ? { paddingLeft: `${entry.indentLevel * 20 + 40}px` }
                : {};

              // Make top-level effect logs bold
              if (hasCustomIndent && entry.indentLevel === 0) {
                style.fontWeight = 'bold';
              }

              const hasPreview = hasCardPreview(entry, allCards);
              const isSelected = selectedEntryIndex === index;

              return (
                <li
                  key={index}
                  className={`log-entry log-entry-${entry.player}${hasPreview ? ' log-entry-clickable' : ''}${isSelected ? ' log-entry-selected' : ''}`}
                  style={style}
                  onClick={() => handleEntryClick(index, entry)}
                >
                  {formatLogEntry(entry)}
                </li>
              );
            })}
          </ol>

          {/* Right preview area */}
          <div className="log-preview-area log-preview-right">
            {selectedPreview?.targets && selectedPreview.targets.length > 0 && (
              <div className="log-preview-card">
                <CardComponent
                  card={selectedPreview.targets[targetIndex]}
                  isFaceUp={selectedPreview.targets[targetIndex].isFaceUp}
                />
                {selectedPreview.targets.length > 1 && (
                  <div className="log-preview-counter">
                    {targetIndex + 1} / {selectedPreview.targets.length}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
