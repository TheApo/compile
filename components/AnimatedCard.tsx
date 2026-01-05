/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { AnimationQueueItem, CardPosition } from '../types/animation';
import { ANIMATION_DURATIONS, ANIMATION_EASINGS } from '../constants/animationTiming';
import { CardComponent } from './Card';
import { Player } from '../types';

// Animation timing constants
const HIGHLIGHT_DURATION = 500; // ms - only for opponent animations
const DOM_DETECTION_DELAY = 100; // ms - wait for React to render snapshot fully
// Note: FLY_DURATION now comes from ANIMATION_DURATIONS based on animation type

interface AnimatedCardProps {
    animation: AnimationQueueItem;
    startDelay?: number;  // For staggered multi-card animations
    onComplete?: () => void;
}

/**
 * AnimatedCard - Renders a card with CSS animation.
 *
 * Animation phases:
 * - PLAYER: Just fly (no highlight needed - player knows what they selected)
 * - OPPONENT: Highlight 500ms (red glow) → then fly 1 second
 */
export const AnimatedCard: React.FC<AnimatedCardProps> = ({
    animation,
    startDelay = 0,
    onComplete,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [animationPhase, setAnimationPhase] = useState<'waiting' | 'idle' | 'highlight' | 'flying' | 'complete'>('waiting');
    const [domPositions, setDomPositions] = useState<{ start: DOMRect | null; end: DOMRect | null }>({ start: null, end: null });
    const onCompleteCalledRef = useRef(false);

    const animatingCard = animation.animatingCard;
    if (!animatingCard) return null;

    const { card, fromPosition, toPosition, flipDirection, targetRotation } = animatingCard;

    // Determine if this is an opponent's card (needs rotation because opponent side is rotated 180°)
    const isOpponentCard = fromPosition.owner === 'opponent';
    // Highlight phase ONLY when OPPONENT is performing the action (so player sees what opponent selected)
    // NOT when player targets opponent's card (player already knows what they selected)
    // ALSO NOT for draw animations - card comes from deck, highlighting is useless (you don't know the card)
    const isOpponentAction = animatingCard.isOpponentAction ?? false;
    const hasHighlightPhase = isOpponentAction && animation.type !== 'flip' && animation.type !== 'draw';

    // Opponent's side is rotated 180° in CSS, so we need to rotate the animated card too
    const needsRotation = isOpponentCard;

    // Animation configuration
    // Use custom duration if provided (for sequential multi-card animations)
    // Otherwise use the correct duration from ANIMATION_DURATIONS based on type
    const flyDuration = animation.duration || ANIMATION_DURATIONS[animation.type] || 400;
    const easing = ANIMATION_EASINGS[animation.type] || 'ease-in-out';

    // Try to get real DOM positions on mount - BEFORE starting animation
    useLayoutEffect(() => {
        // Wait for DOM to fully render before detecting positions
        const timer = setTimeout(() => {
            const startRect = getDOMPosition(fromPosition);
            const endRect = getDOMPosition(toPosition);

            setDomPositions({ start: startRect, end: endRect });

            // NOW we can move from 'waiting' to 'idle' state
            setAnimationPhase('idle');
        }, DOM_DETECTION_DELAY);
        return () => clearTimeout(timer);
    }, [fromPosition, toPosition]);

    // Start animation AFTER DOM positions are detected (not during 'waiting' phase)
    useEffect(() => {
        // Only start animation after we've moved past 'waiting' phase
        if (animationPhase !== 'idle') return;

        // CRITICAL: Combine prop startDelay with animatingCard.startDelay
        // - prop startDelay: For sequential animations in queue
        // - animatingCard.startDelay: For staggered multi-card animations (e.g., draw 5 cards)
        const animStartDelay = animatingCard.startDelay || 0;
        const totalDelay = startDelay + animStartDelay;

        // CRITICAL: Wait for the browser to render the element at the start position
        // before starting the transition. Without this, the transition appears instant
        // because the browser hasn't painted the start state yet.
        const startTimer = setTimeout(() => {
            // Use requestAnimationFrame to ensure the start position is painted
            // before we begin transitioning to the end position
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Double RAF ensures the browser has actually painted the start position
                    if (hasHighlightPhase) {
                        setAnimationPhase('highlight');
                    } else {
                        setAnimationPhase('flying');
                    }
                });
            });
        }, totalDelay);

        return () => clearTimeout(startTimer);
    }, [animationPhase, startDelay, hasHighlightPhase, animatingCard.startDelay]);

    // Store onComplete in a ref to avoid resetting timers when callback reference changes
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    // Progress through animation phases
    useEffect(() => {
        if (animationPhase === 'highlight') {
            const timer = setTimeout(() => {
                setAnimationPhase('flying');
            }, HIGHLIGHT_DURATION);
            return () => clearTimeout(timer);
        }

        if (animationPhase === 'flying') {
            const timer = setTimeout(() => {
                setAnimationPhase('complete');
                if (!onCompleteCalledRef.current) {
                    onCompleteCalledRef.current = true;
                    onCompleteRef.current?.();
                }
            }, flyDuration);
            return () => clearTimeout(timer);
        }
    }, [animationPhase, flyDuration]); // Removed onComplete - using ref instead

    // Calculate CSS positions based on CardPosition (with DOM fallback)
    const startStyle = useMemo((): React.CSSProperties => {
        if (domPositions.start) {
            return {
                left: domPositions.start.left,
                top: domPositions.start.top,
                width: domPositions.start.width,
                height: domPositions.start.height,
            };
        }
        // Fallback during initial render (before useLayoutEffect runs)
        return getPositionStyle(fromPosition);
    }, [fromPosition, domPositions.start]);

    const endStyle = useMemo((): React.CSSProperties => {
        if (domPositions.end) {
            return {
                left: domPositions.end.left,
                top: domPositions.end.top,
                width: domPositions.end.width,
                height: domPositions.end.height,
            };
        }
        // Fallback during initial render (before useLayoutEffect runs)
        return getPositionStyle(toPosition);
    }, [toPosition, domPositions.end]);

    // Determine which style to apply based on animation phase
    const currentStyle = useMemo((): React.CSSProperties => {
        // Base rotation: 180° for opponent animations (their side is rotated in CSS)
        const baseRotation = needsRotation ? 180 : 0;
        // Final rotation includes target rotation (e.g., 90° for trash)
        const finalRotation = baseRotation + (targetRotation || 0);

        const baseStyle: React.CSSProperties = {
            position: 'fixed',
            zIndex: 2000,
            pointerEvents: 'none',
            // CRITICAL: Clip overflow and contain the card
            overflow: 'hidden',
        };

        if (animationPhase === 'waiting') {
            // Not ready yet - don't show anything
            return {
                ...baseStyle,
                transform: baseRotation ? `rotate(${baseRotation}deg)` : 'none',
                opacity: 0,
                visibility: 'hidden',
            };
        }

        if (animationPhase === 'idle' || animationPhase === 'highlight') {
            // At start position - use base rotation only
            return {
                ...baseStyle,
                ...startStyle,
                transform: baseRotation ? `rotate(${baseRotation}deg)` : 'none',
                transition: 'none',
            };
        } else if (animationPhase === 'flying') {
            // Animating to end position - interpolate rotation
            return {
                ...baseStyle,
                ...endStyle,
                transform: finalRotation ? `rotate(${finalRotation}deg)` : 'none',
                transition: `left ${flyDuration}ms ${easing}, top ${flyDuration}ms ${easing}, width ${flyDuration}ms ${easing}, height ${flyDuration}ms ${easing}, transform ${flyDuration}ms ${easing}`,
            };
        } else {
            // Complete - at end position with final rotation
            return {
                ...baseStyle,
                ...endStyle,
                transform: finalRotation ? `rotate(${finalRotation}deg)` : 'none',
                transition: 'none',
                opacity: 0, // Hide when complete
            };
        }
    }, [animationPhase, startStyle, endStyle, flyDuration, easing, needsRotation, targetRotation]);

    // Highlight glow style is now handled by CSS class .is-highlighting
    // No inline styles needed - the class is added in animationClass

    // Additional animation class based on type
    const animationClass = useMemo(() => {
        const classes = ['animated-card', `animation-${animation.type}`];

        if (animationPhase === 'waiting') {
            classes.push('is-waiting');
        }
        if (animationPhase === 'idle') {
            classes.push('is-idle');
        }
        if (animationPhase === 'highlight') {
            classes.push('is-highlighting');
        }
        if (animationPhase === 'flying') {
            classes.push('is-flying');
        }
        if (animationPhase === 'complete') {
            classes.push('is-complete');
        }

        // For flip animations: Add direction class for CSS to use correct keyframes
        if (flipDirection === 'toFaceUp') {
            classes.push('flip-to-face-up');
        }

        return classes.join(' ');
    }, [animation.type, animationPhase, flipDirection]);

    // Determine if card should show face-up or face-down
    const showFaceUp = useMemo(() => {
        // CRITICAL: Opponent draw animations should ALWAYS show face-down
        // Player should not see what opponent draws (they draw from their own deck)
        if (animation.type === 'draw' && fromPosition.owner === 'opponent') {
            return false; // Always face-down for opponent draws
        }

        // FLIP ANIMATIONS: Show ORIGINAL state (before flip) - CSS 3D rotation handles the visual flip
        // card.isFaceUp is the state BEFORE the flip in the snapshot
        // CSS rotates the container: 0° → 180° (toFaceDown) or 180° → 0° (toFaceUp)
        // backface-visibility: hidden ensures only the correct face is visible during rotation
        if (flipDirection) {
            // Always show the original face - CSS does the rotation to reveal the other side
            return card.isFaceUp;
        }

        // For play animation, use targetIsFaceUp if provided, otherwise fall back to card.isFaceUp
        // targetIsFaceUp tells us how the card will be displayed at its destination
        if (animatingCard.targetIsFaceUp !== undefined) {
            return animatingCard.targetIsFaceUp;
        }
        return card.isFaceUp;
    }, [flipDirection, animationPhase, card.isFaceUp, animatingCard.targetIsFaceUp, animation.type, fromPosition.owner]);

    // Don't render until we have positions (during 'waiting' phase, we render but hidden)
    // Once we move to 'idle', we should have positions

    return (
        <div
            ref={cardRef}
            className={animationClass}
            style={currentStyle}
        >
            {/* Render card at actual size (no scaling) - CSS handles sizing via 100% */}
            <div className="animated-card-inner">
                <CardComponent
                    card={card}
                    isFaceUp={showFaceUp}
                />
            </div>
        </div>
    );
};

// =============================================================================
// DOM POSITION HELPERS
// =============================================================================

/**
 * Gets the actual card dimensions from CSS (responsive-aware).
 * Reads computed styles from an existing card or calculates from lane.
 */
function getCardDimensions(): { width: number; height: number; stackOffset: number } {
    // Try to get dimensions from an existing card in a lane
    const existingCard = document.querySelector('.lane-stack .card-component') as HTMLElement;
    if (existingCard) {
        const style = window.getComputedStyle(existingCard);
        const width = parseFloat(style.width) || 100;
        const height = parseFloat(style.height) || 140;
        // Stack offset is the 'top' value divided by the card index
        // We can get it from CSS variable or default to calculated value
        const top = parseFloat(style.top) || 0;
        // Default offset based on screen size
        const screenWidth = window.innerWidth;
        let stackOffset = 64; // default
        if (screenWidth <= 1024) stackOffset = 50; // tablet
        if (screenWidth <= 768) stackOffset = 42; // small tablet
        return { width, height, stackOffset };
    }

    // Fallback: estimate based on screen width
    const screenWidth = window.innerWidth;
    if (screenWidth <= 768) {
        return { width: 70, height: 98, stackOffset: 42 };
    } else if (screenWidth <= 1024) {
        return { width: 85, height: 119, stackOffset: 50 };
    }
    return { width: 100, height: 140, stackOffset: 64 };
}

/**
 * Tries to find the actual DOM element for a card position and get its bounding rect.
 *
 * The GameScreen now renders snapshot data directly when animation is active.
 * So we simply find elements in the real DOM - no snapshot-specific selectors needed.
 *
 * Structure:
 * - .game-screen .game-main-area .game-board
 *   - .opponent-hand-area
 *   - .opponent-side .lanes .lane .lane-stack
 *   - .player-side .lanes .lane .lane-stack
 * - .game-screen .game-main-area .player-action-area .player-hand-area
 */
function getDOMPosition(position: CardPosition): DOMRect | null {
    try {
        if (position.type === 'hand') {
            // Find the hand area in the game screen
            const handArea = position.owner === 'player'
                ? document.querySelector('.game-main-area .player-hand-area')
                : document.querySelector('.game-board .opponent-hand-area');

            if (handArea) {
                const cards = handArea.querySelectorAll('.card-component');
                if (cards[position.handIndex]) {
                    return cards[position.handIndex].getBoundingClientRect();
                } else {
                    const dims = getCardDimensions();

                    if (cards.length > 0) {
                        const lastCard = cards[cards.length - 1];
                        const lastRect = lastCard.getBoundingClientRect();
                        const cardSpacing = dims.width * 0.35;
                        const indexDiff = position.handIndex - (cards.length - 1);
                        const newX = lastRect.left + (cardSpacing * indexDiff);
                        return new DOMRect(newX, lastRect.top, lastRect.width, lastRect.height);
                    } else {
                        const handRect = handArea.getBoundingClientRect();
                        const startX = handRect.left + (handRect.width - dims.width) / 2;
                        const startY = handRect.top + (handRect.height - dims.height) / 2;
                        return new DOMRect(startX, startY, dims.width, dims.height);
                    }
                }
            }
        }

        if (position.type === 'lane') {
            const gameBoard = document.querySelector('.game-main-area .game-board');
            if (gameBoard) {
                const side = position.owner === 'player'
                    ? gameBoard.querySelector('.player-side:not(.opponent-side)')
                    : gameBoard.querySelector('.opponent-side');

                if (side) {
                    const lanes = side.querySelectorAll('.lane-stack');

                    if (lanes[position.laneIndex]) {
                        const lane = lanes[position.laneIndex] as HTMLElement;
                        const cards = lane.querySelectorAll('.card-component');

                        if (cards[position.cardIndex]) {
                            return cards[position.cardIndex].getBoundingClientRect();
                        }

                        const dims = getCardDimensions();
                        const laneRect = lane.getBoundingClientRect();
                        const centerX = laneRect.left + (laneRect.width - dims.width) / 2;

                        if (cards.length > 0) {
                            const lastCard = cards[cards.length - 1];
                            const lastCardRect = lastCard.getBoundingClientRect();
                            const isOpponent = position.owner === 'opponent';
                            const offsetDirection = isOpponent ? -1 : 1;
                            const newTop = lastCardRect.top + (offsetDirection * dims.stackOffset);
                            return new DOMRect(centerX, newTop, dims.width, dims.height);
                        }

                        const isOpponent = position.owner === 'opponent';
                        const calculatedTop = isOpponent
                            ? laneRect.bottom - dims.height
                            : laneRect.top;
                        return new DOMRect(centerX, calculatedTop, dims.width, dims.height);
                    }
                }
            }
        }

        if (position.type === 'deck') {
            const selector = `.deck-pile.${position.owner} .pile-card-wrapper`;
            const deckArea = document.querySelector(selector);
            if (deckArea) {
                return deckArea.getBoundingClientRect();
            }
        }

        if (position.type === 'trash') {
            const selector = `.trash-pile.${position.owner} .pile-card-wrapper`;
            const trashArea = document.querySelector(selector);
            if (trashArea) {
                return trashArea.getBoundingClientRect();
            }
        }
    } catch (e) {
        console.warn('[AnimatedCard] Could not get DOM position:', e);
    }

    return null;
}

// =============================================================================
// FALLBACK POSITION CALCULATION
// =============================================================================

/**
 * Converts a CardPosition to CSS positioning styles.
 * Used as fallback when DOM positions aren't available.
 */
function getPositionStyle(position: CardPosition): React.CSSProperties {
    const CARD_WIDTH = 100;
    const CARD_HEIGHT = 140;
    const LANE_GAP = 20;
    const CARD_STACK_OFFSET = 64;
    const BOARD_WIDTH = window.innerWidth;
    const BOARD_HEIGHT = window.innerHeight;

    const getLaneX = (laneIndex: number) => {
        const totalLanesWidth = 3 * CARD_WIDTH + 2 * LANE_GAP;
        const startX = (BOARD_WIDTH - totalLanesWidth) / 2;
        return startX + laneIndex * (CARD_WIDTH + LANE_GAP);
    };

    switch (position.type) {
        case 'lane': {
            const x = getLaneX(position.laneIndex);
            const isOpponent = position.owner === 'opponent';
            const baseY = isOpponent
                ? BOARD_HEIGHT * 0.15
                : BOARD_HEIGHT * 0.45;
            const y = baseY + position.cardIndex * CARD_STACK_OFFSET;

            return { left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT };
        }

        case 'hand': {
            const isOpponent = position.owner === 'opponent';
            const handWidth = 6 * (CARD_WIDTH * 0.7);
            const startX = (BOARD_WIDTH - handWidth) / 2;
            const x = startX + position.handIndex * (CARD_WIDTH * 0.7);
            const y = isOpponent ? 20 : BOARD_HEIGHT - CARD_HEIGHT - 80;

            return { left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT };
        }

        case 'deck': {
            const isOpponent = position.owner === 'opponent';
            return {
                left: BOARD_WIDTH - CARD_WIDTH - 40,
                top: isOpponent ? 20 : BOARD_HEIGHT - CARD_HEIGHT - 80,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
            };
        }

        case 'trash': {
            const isOpponent = position.owner === 'opponent';
            return {
                left: 40,
                top: isOpponent ? 20 : BOARD_HEIGHT - CARD_HEIGHT - 80,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                opacity: 0,
                transform: 'scale(0.8)',
            };
        }

        case 'offscreen': {
            return {
                left: BOARD_WIDTH / 2 - CARD_WIDTH / 2,
                top: -CARD_HEIGHT - 20,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                opacity: 0,
            };
        }

        default:
            return {
                left: BOARD_WIDTH / 2 - CARD_WIDTH / 2,
                top: BOARD_HEIGHT / 2 - CARD_HEIGHT / 2,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
            };
    }
}
