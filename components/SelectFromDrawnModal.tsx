/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SelectFromDrawnModal - Shows all drawn cards with proper card preview
 * Used when player needs to reveal cards from drawn pile (e.g., "Draw 3. Reveal 1 matching...")
 * Uses same layout pattern as RevealedDeckModal for consistency
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameState, PlayedCard } from '../types';
import { CardComponent } from './Card';

interface SelectFromDrawnModalProps {
    gameState: GameState;
    allDrawnCardIds: string[];      // All cards that were drawn (for display)
    eligibleCardIds: string[];      // Cards that can be selected (match filter)
    statedNumber?: number;          // The stated number (if filtering by stated_number)
    revealCount?: number;           // How many cards to reveal (default 1)
    onConfirm: (cardId: string) => void;
    onClose?: () => void;           // For when no eligible cards
}

export function SelectFromDrawnModal({
    gameState,
    allDrawnCardIds,
    eligibleCardIds,
    statedNumber,
    revealCount = 1,
    onConfirm,
    onClose
}: SelectFromDrawnModalProps) {
    const [previewCard, setPreviewCard] = useState<PlayedCard | null>(null);
    const hasInitialized = useRef(false);

    // Find all drawn cards in the player's hand
    const allDrawnCards = gameState.player.hand.filter((card: PlayedCard) =>
        allDrawnCardIds.includes(card.id)
    );

    // Check if a card is eligible for selection
    const isEligible = (cardId: string) => eligibleCardIds.includes(cardId);
    const hasEligibleCards = eligibleCardIds.length > 0;

    // Auto-select first eligible card on mount
    useEffect(() => {
        if (!hasInitialized.current && eligibleCardIds.length > 0) {
            const firstEligible = allDrawnCards.find(c => isEligible(c.id));
            if (firstEligible) {
                setPreviewCard(firstEligible);
                hasInitialized.current = true;
            }
        }
    }, [allDrawnCards, eligibleCardIds]);

    const handleCardHover = (card: PlayedCard) => {
        if (isEligible(card.id)) {
            setPreviewCard(card);
        }
    };

    const handleCardClick = (card: PlayedCard) => {
        if (isEligible(card.id)) {
            setPreviewCard(card);
        }
    };

    const handleConfirmSelection = () => {
        if (previewCard && isEligible(previewCard.id)) {
            onConfirm(previewCard.id);
        }
    };

    const handleClose = () => {
        if (onClose) {
            onClose();
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content revealed-deck-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Cards Drawn</h2>
                {statedNumber !== undefined ? (
                    <p>Select a card with value <strong>{statedNumber}</strong> to reveal:</p>
                ) : (
                    <p>Select a card to reveal:</p>
                )}

                <div className="revealed-deck-content-wrapper">
                    {/* Left preview area */}
                    <div className="revealed-deck-preview-area">
                        {previewCard ? (
                            <div className="revealed-deck-preview-card">
                                <CardComponent
                                    card={previewCard}
                                    isFaceUp={true}
                                />
                                <button
                                    className="btn preview-confirm-btn"
                                    onClick={handleConfirmSelection}
                                >
                                    Reveal {previewCard.protocol}-{previewCard.value}
                                </button>
                            </div>
                        ) : (
                            <div className="revealed-deck-preview-card no-selection">
                                <p className="no-match-message">
                                    {hasEligibleCards
                                        ? 'Select an eligible card'
                                        : `No cards match value ${statedNumber}`}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Card grid */}
                    <div className="revealed-deck-grids-area">
                        <div className="revealed-deck-card-grid">
                            {allDrawnCards.length > 0 ? (
                                allDrawnCards.map((card: PlayedCard) => {
                                    const eligible = isEligible(card.id);
                                    const isPreview = previewCard?.id === card.id;
                                    return (
                                        <div
                                            key={card.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCardClick(card);
                                            }}
                                            onMouseEnter={() => handleCardHover(card)}
                                            style={{ cursor: eligible ? 'pointer' : 'default' }}
                                        >
                                            <CardComponent
                                                card={card}
                                                isFaceUp={true}
                                                additionalClassName={`in-hand ${eligible ? (isPreview ? 'highlight-selectable' : '') : 'dimmed'}`}
                                            />
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="no-cards">No cards drawn.</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Close button when no eligible cards */}
                {!hasEligibleCards && (
                    <div className="modal-actions">
                        <button className="btn" onClick={handleClose}>
                            Continue
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
