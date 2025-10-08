/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Player, Difficulty } from '../types';
import {
    GameStatistics,
    loadStatistics,
    saveStatistics,
    updateStatisticsOnGameEnd,
    trackCardPlayed,
    trackCardDeleted,
    trackCoinFlip,
    trackRearrange,
} from '../utils/statistics';

export function useStatistics(
    playerProtocols: string[],
    difficulty: Difficulty,
    useControl: boolean
) {
    const [statistics, setStatistics] = useState<GameStatistics>(() => loadStatistics());
    const gameStartTimeRef = useRef<number | null>(null);

    // Start tracking game time
    const startGame = useCallback(() => {
        gameStartTimeRef.current = Date.now();
    }, []);

    // Track card played by player (for "most played cards" list)
    const trackPlayerCardPlayed = useCallback((cardProtocol: string, cardValue: number) => {
        setStatistics(prevStats => {
            const cardName = `${cardProtocol}-${cardValue}`;
            const newStats = trackCardPlayed(prevStats, cardName);
            saveStatistics(newStats);
            return newStats;
        });
    }, []);

    // Track card deleted by player (for "most deleted cards" list)
    const trackPlayerCardDeleted = useCallback((cardProtocol: string, cardValue: number) => {
        setStatistics(prevStats => {
            const cardName = `${cardProtocol}-${cardValue}`;
            const newStats = trackCardDeleted(prevStats, cardName);
            saveStatistics(newStats);
            return newStats;
        });
    }, []);

    // Track coin flip choice and result
    const trackPlayerCoinFlip = useCallback((choice: 'heads' | 'tails', won: boolean) => {
        setStatistics(prevStats => {
            const newStats = trackCoinFlip(prevStats, choice, won);
            saveStatistics(newStats);
            return newStats;
        });
    }, []);

    // Track protocol rearrange (from Control mechanic or compile/refresh)
    const trackPlayerRearrange = useCallback(() => {
        setStatistics(prevStats => {
            const newStats = trackRearrange(prevStats);
            saveStatistics(newStats);
            return newStats;
        });
    }, []);

    // End game and update statistics
    const endGame = useCallback((winner: Player, playerStats?: { cardsPlayed: number; cardsDrawn: number; cardsDiscarded: number; cardsDeleted: number; cardsFlipped: number; cardsShifted: number; handsRefreshed: number }, compilesCount?: number) => {
        if (gameStartTimeRef.current === null) return;

        const gameDurationSeconds = Math.floor((Date.now() - gameStartTimeRef.current) / 1000);

        setStatistics(prevStats => {
            const newStats = updateStatisticsOnGameEnd(
                prevStats,
                winner,
                playerProtocols,
                difficulty,
                gameDurationSeconds,
                useControl,
                playerStats,
                compilesCount
            );
            saveStatistics(newStats);
            return newStats;
        });

        gameStartTimeRef.current = null;
    }, [playerProtocols, difficulty, useControl]);

    return {
        statistics,
        startGame,
        endGame,
        trackPlayerCardPlayed,
        trackPlayerCardDeleted,
        trackPlayerCoinFlip,
        trackPlayerRearrange,
    };
}
