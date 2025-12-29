/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useAnimationQueue } from '../contexts/AnimationQueueContext';
import { AnimatedCard } from './AnimatedCard';
import { ANIMATION_DURATIONS } from '../constants/animationTiming';
import '../styles/animations.css';

/**
 * AnimationOverlay - Renders the flying card animation on top of the game board.
 *
 * This component:
 * 1. Is a TRANSPARENT overlay that blocks all user input during animations
 * 2. Renders only the animating card(s) - the GameScreen shows the snapshot data
 * 3. Calls onAnimationComplete when the animation finishes
 *
 * NOTE: The GameScreen now renders using snapshot data during animation,
 * so this overlay doesn't need to render the board - it just shows the flying card.
 */
export const AnimationOverlay: React.FC = () => {
    const { currentAnimation, onAnimationComplete, skipAllAnimations } = useAnimationQueue();

    // Ref for tracking animation completion
    const animationCompleteRef = useRef(false);

    // Reset completion tracking when animation changes
    useEffect(() => {
        animationCompleteRef.current = false;
    }, [currentAnimation?.id]);

    /**
     * Handle animation completion.
     * Called by AnimatedCard when CSS animation ends or by fallback timeout.
     */
    const handleAnimationComplete = useCallback(() => {
        if (animationCompleteRef.current) return;
        animationCompleteRef.current = true;
        onAnimationComplete();
    }, [onAnimationComplete]);

    /**
     * Fallback timeout to ensure animations complete even if CSS events fail.
     * Timeout matches the ACTUAL animation timing in AnimatedCard.tsx:
     * - DOM_DETECTION_DELAY: 100ms
     * - HIGHLIGHT_DURATION: 500ms (only for opponent actions)
     * - flyDuration: from ANIMATION_DURATIONS (or custom duration for multi-card)
     */
    useEffect(() => {
        if (!currentAnimation) return;

        // DOM detection delay before animation starts
        const domDetectionDelay = 100;

        // Fly duration: use custom duration if provided, otherwise use ANIMATION_DURATIONS
        const flyDuration = currentAnimation.duration
            || ANIMATION_DURATIONS[currentAnimation.type]
            || 400;

        // Check if this is an opponent action that needs highlight phase
        const isOpponentAction = currentAnimation.animatingCard?.isOpponentAction ?? false;
        const highlightTime = isOpponentAction ? 500 : 0;

        // Buffer for safety
        const buffer = 500;

        // For multi-card animations (compile, draw), account for stagger delays
        let staggerTime = 0;
        if (currentAnimation.animatingCards) {
            const maxDelay = Math.max(...currentAnimation.animatingCards.map(c => c.startDelay || 0));
            staggerTime = maxDelay;
        }
        if (currentAnimation.multiAnimatingCards) {
            const maxDelay = Math.max(...currentAnimation.multiAnimatingCards.map(c => c.startDelay || 0));
            staggerTime = maxDelay;
        }

        const timeout = domDetectionDelay + highlightTime + flyDuration + staggerTime + buffer;

        const timer = setTimeout(() => {
            if (!animationCompleteRef.current) {
                console.warn(`[AnimationOverlay] Fallback timeout triggered for ${currentAnimation.type} animation after ${timeout}ms`);
                handleAnimationComplete();
            }
        }, timeout);

        return () => clearTimeout(timer);
    }, [currentAnimation, handleAnimationComplete]);

    /**
     * Handle keyboard shortcuts (Escape to skip animations).
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && currentAnimation) {
                console.log('[AnimationOverlay] Skipping animations via Escape key');
                skipAllAnimations();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentAnimation, skipAllAnimations]);

    // Don't render if no animation is playing
    if (!currentAnimation) {
        return null;
    }

    return (
        <div
            className="animation-overlay"
            // Block all pointer events during animation
            style={{ pointerEvents: 'all' }}
            // Clicking the overlay could optionally skip the animation
            onClick={(e) => {
                // Prevent click from propagating to game elements
                e.stopPropagation();
                // Optional: Skip on click (uncomment to enable)
                // skipAllAnimations();
            }}
        >
            {/* NOTE: The GameScreen now renders snapshot data directly.
                This overlay only contains the flying card animation. */}

            {/* Render the animating card(s) */}
            {currentAnimation.animatingCard && (
                <AnimatedCard
                    animation={currentAnimation}
                    onComplete={handleAnimationComplete}
                />
            )}

            {/* For compile animations with multiple cards */}
            {currentAnimation.animatingCards && currentAnimation.animatingCards.map((item, index) => (
                <AnimatedCard
                    key={item.card.id}
                    animation={{
                        ...currentAnimation,
                        animatingCard: {
                            card: item.card,
                            fromPosition: {
                                type: 'lane',
                                owner: item.owner,
                                laneIndex: currentAnimation.laneIndex ?? 0,
                                cardIndex: index,
                            },
                            toPosition: { type: 'trash', owner: item.owner },
                        },
                    }}
                    startDelay={item.startDelay}
                    onComplete={index === currentAnimation.animatingCards!.length - 1 ? handleAnimationComplete : undefined}
                />
            ))}

            {/* For multi-draw animations (multiAnimatingCards) */}
            {currentAnimation.multiAnimatingCards && currentAnimation.multiAnimatingCards.map((item, index) => (
                <AnimatedCard
                    key={`multi-${item.card.id}-${index}`}
                    animation={{
                        ...currentAnimation,
                        animatingCard: {
                            card: item.card,
                            fromPosition: item.fromPosition,
                            toPosition: item.toPosition,
                        },
                    }}
                    startDelay={item.startDelay}
                    onComplete={index === currentAnimation.multiAnimatingCards!.length - 1 ? handleAnimationComplete : undefined}
                />
            ))}

            {/* Debug info (only in development) */}
            {process.env.NODE_ENV === 'development' && (
                <div className="animation-debug-info">
                    <span>Animation: {currentAnimation.type}</span>
                    {currentAnimation.animatingCard && (
                        <span>Card: {currentAnimation.animatingCard.card.protocol}-{currentAnimation.animatingCard.card.value}</span>
                    )}
                </div>
            )}
        </div>
    );
};
