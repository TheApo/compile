/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeckDiscardModal - Shows the card that was discarded from the top of a deck
 * Used for effects like "Discard the top card of your/opponent's deck"
 * Uses CardComponent for proper card display
 */

import React from 'react';
import { PlayedCard } from '../types';
import { CardComponent } from './Card';

interface DeckDiscardModalProps {
    discardedCard: PlayedCard;
    deckOwner: 'own' | 'opponent';  // Whose deck was it from
    onConfirm: () => void;
}

export function DeckDiscardModal({
    discardedCard,
    deckOwner,
    onConfirm
}: DeckDiscardModalProps) {
    const ownerText = deckOwner === 'own' ? 'your' : "opponent's";

    // Create a card object for CardComponent
    const cardForDisplay = {
        ...discardedCard,
        id: discardedCard.id || 'deck-discard-preview',
        isFaceUp: true
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content deck-discard-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Card Discarded</h2>
                <p>From the top of <strong>{ownerText}</strong> deck:</p>

                <div className="deck-discard-preview-content">
                    <div className="deck-discard-preview-card">
                        <CardComponent
                            card={cardForDisplay}
                            isFaceUp={true}
                        />
                    </div>
                </div>

                <div className="modal-actions">
                    <button className="btn" onClick={onConfirm}>
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );
}
