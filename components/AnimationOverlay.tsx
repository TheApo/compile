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
 * PhaseTransitionTimer - Helper component for phase transition animations.
 * Just runs a timer and calls onComplete - no visual rendering needed.
 * The GameInfoPanel handles the visual animation via props.
 */
const PhaseTransitionTimer: React.FC<{
    duration: number;
    onComplete: () => void;
    animationId: string;
}> = ({ duration, onComplete, animationId }) => {
    const hasCompletedRef = useRef(false);

    useEffect(() => {
        hasCompletedRef.current = false;

        const timer = setTimeout(() => {
            if (!hasCompletedRef.current) {
                hasCompletedRef.current = true;
                onComplete();
            }
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onComplete, animationId]);

    // Return null - no visual element needed
    // Input blocking happens at GameScreen level based on isAnimating
    return null;
};

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
     * EMERGENCY Fallback timeout - only triggers if AnimatedCard's onComplete fails.
     * This is NOT for timing the animation - AnimatedCard handles that.
     * This is just a safety net to prevent stuck animations.
     *
     * Set to 2x the expected animation time to ensure AnimatedCard has
     * plenty of time to call onComplete normally.
     */
    useEffect(() => {
        if (!currentAnimation) return;

        // Use 2x the animation duration as emergency fallback
        // AnimatedCard should ALWAYS complete before this
        const flyDuration = currentAnimation.duration
            || ANIMATION_DURATIONS[currentAnimation.type]
            || 400;

        // Emergency timeout = 2x normal duration (generous safety margin)
        const emergencyTimeout = flyDuration * 2 + 500;

        const timer = setTimeout(() => {
            if (!animationCompleteRef.current) {
                console.error(`[AnimationOverlay] EMERGENCY fallback triggered for ${currentAnimation.type} after ${emergencyTimeout}ms - AnimatedCard.onComplete failed!`);
                handleAnimationComplete();
            }
        }, emergencyTimeout);

        return () => clearTimeout(timer);
    }, [currentAnimation, handleAnimationComplete]);

    /**
     * Handle keyboard shortcuts (Escape to skip animations).
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && currentAnimation) {
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

    // Special handling for phaseTransition - no card animation, just timer
    // The GameInfoPanel handles the visual animation via props
    if (currentAnimation.type === 'phaseTransition') {
        return (
            <PhaseTransitionTimer
                duration={currentAnimation.duration}
                onComplete={handleAnimationComplete}
                animationId={currentAnimation.id}
            />
        );
    }

    // Special handling for delay - no visual, just waits (for AI "thinking" time)
    if (currentAnimation.type === 'delay') {
        return (
            <PhaseTransitionTimer
                duration={currentAnimation.duration}
                onComplete={handleAnimationComplete}
                animationId={currentAnimation.id}
            />
        );
    }

    // Special handling for flip animations:
    // - Player flips: card stays in place, board's CSS transition animates it
    // - Opponent flips (isOpponentAction): use AnimatedCard for highlight phase
    if (currentAnimation.type === 'flip') {
        const isOpponentFlip = currentAnimation.animatingCard?.isOpponentAction;

        if (!isOpponentFlip) {
            // Player flip: just timer, board CSS handles animation
            return (
                <PhaseTransitionTimer
                    duration={currentAnimation.duration}
                    onComplete={handleAnimationComplete}
                    animationId={currentAnimation.id}
                />
            );
        }
        // Opponent flip: fall through to render AnimatedCard with highlight
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
                    key={currentAnimation.id}  // CRITICAL: Forces remount for each animation
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

        </div>
    );
};
