/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeckPlayPreviewModal - Shows the card that will be drawn from deck before playing
 * Used for effects like "Play the top card of your deck face-down in another line"
 * Uses same layout pattern as RevealedDeckModal for consistency
 */

import React from 'react';
import { PlayedCard } from '../types';
import { CardComponent } from './Card';

interface DeckPlayPreviewModalProps {
    card: PlayedCard;           // The card drawn from deck
    isFaceDown: boolean;        // Will it be played face-down?
    onConfirm: () => void;      // Continue to lane selection
}

export function DeckPlayPreviewModal({
    card,
    isFaceDown,
    onConfirm
}: DeckPlayPreviewModalProps) {
    const faceText = isFaceDown ? 'face-down' : 'face-up';

    return (
        <div className="modal-overlay">
            <div className="modal-content deck-play-preview-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Card from Deck</h2>
                <p>You will play this card <strong>{faceText}</strong>:</p>

                <div className="deck-play-preview-content">
                    <div className="deck-play-preview-card">
                        <CardComponent
                            card={card}
                            isFaceUp={true}
                        />
                    </div>
                </div>

                <div className="modal-actions">
                    <button className="btn" onClick={onConfirm}>
                        Select Lane
                    </button>
                </div>
            </div>
        </div>
    );
}
