/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState } from '../types';
import { CardComponent } from './Card';

interface RevealedDeckTopModalProps {
    gameState: GameState;
    onAccept: () => void;
    onDecline: () => void;
}

/**
 * Modal for Clarity-1 Start Effect: "Reveal the top card of your deck. You may discard it."
 * Shows the revealed card large with its effects, and buttons to discard or keep.
 */
export function RevealedDeckTopModal({ gameState, onAccept, onDecline }: RevealedDeckTopModalProps) {
    const action = gameState.actionRequired as any;
    if (!action || action.type !== 'prompt_optional_effect') {
        return null;
    }

    // Only show for discard effects with useCardFromPreviousEffect (Clarity-1 style)
    const effectDef = action.effectDef;
    if (!effectDef || effectDef.params?.action !== 'discard' || !effectDef.params?.useCardFromPreviousEffect) {
        return null;
    }

    // Get the revealed card from the deck using lastCustomEffectTargetCardId
    const targetCardId = gameState.lastCustomEffectTargetCardId;
    if (!targetCardId) {
        return null;
    }

    // Find the card in the deck
    const actor = action.actor || 'player';
    const deck = gameState[actor].deck;
    const revealedCard = deck.find((c: any) => c.id === targetCardId);

    if (!revealedCard) {
        return null;
    }

    // Create a proper card object for display
    const cardForDisplay = {
        ...revealedCard,
        id: revealedCard.id || 'revealed-top',
        isFaceUp: true,
    };

    const cardName = `${revealedCard.protocol}-${revealedCard.value}`;

    return (
        <div className="modal-overlay">
            <div className="modal-content revealed-deck-top-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Revealed: Top Card of Your Deck</h2>
                <p>You may discard this card:</p>

                <div className="revealed-card-display">
                    <CardComponent
                        card={cardForDisplay}
                        isFaceUp={true}
                    />
                </div>

                <div className="revealed-deck-top-actions">
                    <button className="btn" onClick={onAccept}>
                        Discard {cardName}
                    </button>
                    <button className="btn btn-back" onClick={onDecline}>
                        Keep in Deck
                    </button>
                </div>
            </div>
        </div>
    );
}
