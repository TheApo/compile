/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Player, Difficulty, GameState } from '../types';
import { uniqueProtocols } from '../data/cards';

const STATS_KEY = 'compile_game_statistics';
const STATS_VERSION = 1;

export interface GameStatistics {
    version: number;

    global: {
        totalGamesPlayed: number;
        totalGamesWon: number;
        totalGamesLost: number;
        totalPlaytime: number; // in seconds
        fastestWin: number | null; // in seconds
        longestGame: number | null; // in seconds
        lastGameDuration: number | null; // in seconds
        currentStreak: number; // positive = win streak, negative = lose streak
        longestWinStreak: number;
        longestLoseStreak: number;
    };

    protocols: {
        [protocolName: string]: {
            timesUsed: number;
            wins: number;
            losses: number;
        };
    };

    aiDifficulty: {
        easy: { played: number; wins: number; losses: number };
        normal: { played: number; wins: number; losses: number };
        hard: { played: number; wins: number; losses: number };
    };

    cards: {
        played: { [cardName: string]: number };
        deleted: { [cardName: string]: number };
    };

    actions: {
        totalCardsDrawn: number;
        totalCardsPlayed: number;
        totalShifts: number;
        totalDeletes: number;
        totalDiscards: number;
        totalFlips: number;
        totalCompiles: number;
        totalRefreshes: number;
    };

    control: {
        gamesWithControl: number;
        gamesWithoutControl: number;
        playerRearranges: number;  // Player's rearranges (own + opponent protocols)
        aiRearranges: number;       // AI's rearranges
        totalRearranges: number;    // Sum of player + AI
    };

    coinFlip: {
        headsChosen: number;
        tailsChosen: number;
        headsWon: number;
        tailsWon: number;
    };
}

export function initializeStatistics(): GameStatistics {
    // Initialize ALL protocols dynamically from cards.ts with 0 usage so they appear in "Least Used Protocols"
    const allProtocols = uniqueProtocols; // Dynamically loaded from cards.ts

    const initialProtocols: { [key: string]: { timesUsed: number; wins: number; losses: number } } = {};
    allProtocols.forEach(protocol => {
        initialProtocols[protocol] = { timesUsed: 0, wins: 0, losses: 0 };
    });

    return {
        version: STATS_VERSION,
        global: {
            totalGamesPlayed: 0,
            totalGamesWon: 0,
            totalGamesLost: 0,
            totalPlaytime: 0,
            fastestWin: null,
            longestGame: null,
            lastGameDuration: null,
            currentStreak: 0,
            longestWinStreak: 0,
            longestLoseStreak: 0,
        },
        protocols: initialProtocols,
        aiDifficulty: {
            easy: { played: 0, wins: 0, losses: 0 },
            normal: { played: 0, wins: 0, losses: 0 },
            hard: { played: 0, wins: 0, losses: 0 },
        },
        cards: {
            played: {},
            deleted: {},
        },
        actions: {
            totalCardsDrawn: 0,
            totalCardsPlayed: 0,
            totalShifts: 0,
            totalDeletes: 0,
            totalDiscards: 0,
            totalFlips: 0,
            totalCompiles: 0,
            totalRefreshes: 0,
        },
        control: {
            gamesWithControl: 0,
            gamesWithoutControl: 0,
            playerRearranges: 0,
            aiRearranges: 0,
            totalRearranges: 0,
        },
        coinFlip: {
            headsChosen: 0,
            tailsChosen: 0,
            headsWon: 0,
            tailsWon: 0,
        },
    };
}

export function loadStatistics(): GameStatistics {
    try {
        const stored = localStorage.getItem(STATS_KEY);
        if (!stored) {
            return initializeStatistics();
        }
        const parsed = JSON.parse(stored) as any;

        // Ensure ALL protocols exist (migration for existing stats) - dynamically loaded from cards.ts
        const allProtocols = uniqueProtocols; // Automatically includes Anarchy and any future protocols

        const migratedProtocols = { ...(parsed.protocols || {}) };
        allProtocols.forEach(protocol => {
            if (!migratedProtocols[protocol]) {
                migratedProtocols[protocol] = { timesUsed: 0, wins: 0, losses: 0 };
            }
        });

        // Always ensure control and coinFlip fields exist (migration)
        const stats: GameStatistics = {
            ...parsed,
            version: STATS_VERSION,
            global: {
                ...parsed.global,
                lastGameDuration: parsed.global?.lastGameDuration || null,
            },
            protocols: migratedProtocols,
            control: {
                gamesWithControl: parsed.control?.gamesWithControl || 0,
                gamesWithoutControl: parsed.control?.gamesWithoutControl || 0,
                playerRearranges: parsed.control?.playerRearranges || 0,
                aiRearranges: parsed.control?.aiRearranges || 0,
                // Keep existing totalRearranges, don't reset it!
                totalRearranges: parsed.control?.totalRearranges || 0,
            },
            coinFlip: parsed.coinFlip || {
                headsChosen: 0,
                tailsChosen: 0,
                headsWon: 0,
                tailsWon: 0,
            },
            actions: {
                ...parsed.actions,
                totalCompiles: parsed.actions?.totalCompiles || 0,
                totalRefreshes: parsed.actions?.totalRefreshes || 0,
            },
        };

        // Save migrated version if needed (add new fields or protocols)
        const needsMigration = !parsed.control?.playerRearranges ||
                               !parsed.coinFlip ||
                               !parsed.actions?.totalCompiles ||
                               Object.keys(migratedProtocols).length !== Object.keys(parsed.protocols || {}).length;

        if (needsMigration) {
            saveStatistics(stats);
        }

        return stats;
    } catch (error) {
        console.error('Failed to load statistics:', error);
        return initializeStatistics();
    }
}

export function saveStatistics(stats: GameStatistics): void {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (error) {
        console.error('Failed to save statistics:', error);
    }
}

export function updateStatisticsOnGameEnd(
    stats: GameStatistics,
    winner: Player,
    playerProtocols: string[],
    difficulty: Difficulty,
    gameDurationSeconds: number,
    useControl: boolean = false,
    playerStats?: { cardsPlayed: number; cardsDrawn: number; cardsDiscarded: number; cardsDeleted: number; cardsFlipped: number; cardsShifted: number; handsRefreshed: number },
    compilesCount?: number
): GameStatistics {
    const playerWon = winner === 'player';

    // Deep copy all nested objects to prevent mutations
    const newGlobal = { ...stats.global };
    const newProtocols = { ...stats.protocols };
    const newAiDifficulty = {
        easy: { ...stats.aiDifficulty.easy },
        normal: { ...stats.aiDifficulty.normal },
        hard: { ...stats.aiDifficulty.hard }
    };
    const newControl = { ...stats.control };
    const newActions = { ...stats.actions };
    const newCoinFlip = { ...stats.coinFlip };
    const newCards = {
        played: { ...stats.cards.played },
        deleted: { ...stats.cards.deleted }
    };

    // Update global stats
    newGlobal.totalGamesPlayed++;
    if (playerWon) {
        newGlobal.totalGamesWon++;
    } else {
        newGlobal.totalGamesLost++;
    }
    newGlobal.totalPlaytime += gameDurationSeconds;

    // Update fastest/longest/last game
    if (playerWon) {
        if (newGlobal.fastestWin === null || gameDurationSeconds < newGlobal.fastestWin) {
            newGlobal.fastestWin = gameDurationSeconds;
        }
    }
    if (newGlobal.longestGame === null || gameDurationSeconds > newGlobal.longestGame) {
        newGlobal.longestGame = gameDurationSeconds;
    }
    newGlobal.lastGameDuration = gameDurationSeconds;

    // Update streaks
    if (playerWon) {
        if (newGlobal.currentStreak >= 0) {
            newGlobal.currentStreak++;
        } else {
            newGlobal.currentStreak = 1;
        }
        if (newGlobal.currentStreak > newGlobal.longestWinStreak) {
            newGlobal.longestWinStreak = newGlobal.currentStreak;
        }
    } else {
        if (newGlobal.currentStreak <= 0) {
            newGlobal.currentStreak--;
        } else {
            newGlobal.currentStreak = -1;
        }
        if (Math.abs(newGlobal.currentStreak) > newGlobal.longestLoseStreak) {
            newGlobal.longestLoseStreak = Math.abs(newGlobal.currentStreak);
        }
    }

    // Update protocol stats (deep copy each protocol)
    playerProtocols.forEach(protocol => {
        if (!newProtocols[protocol]) {
            newProtocols[protocol] = { timesUsed: 0, wins: 0, losses: 0 };
        } else {
            // Deep copy the protocol stats
            newProtocols[protocol] = { ...newProtocols[protocol] };
        }
        newProtocols[protocol].timesUsed++;
        if (playerWon) {
            newProtocols[protocol].wins++;
        } else {
            newProtocols[protocol].losses++;
        }
    });

    // Update AI difficulty stats
    newAiDifficulty[difficulty].played++;
    if (playerWon) {
        newAiDifficulty[difficulty].wins++;
    } else {
        newAiDifficulty[difficulty].losses++;
    }

    // Update control mechanic stats
    if (useControl) {
        newControl.gamesWithControl++;
    } else {
        newControl.gamesWithoutControl++;
    }

    // Update action stats from game stats
    if (playerStats) {
        newActions.totalCardsPlayed += playerStats.cardsPlayed;
        newActions.totalCardsDrawn += playerStats.cardsDrawn;
        newActions.totalDiscards += playerStats.cardsDiscarded;
        newActions.totalDeletes += playerStats.cardsDeleted;
        newActions.totalFlips += playerStats.cardsFlipped;
        newActions.totalShifts += playerStats.cardsShifted;
        newActions.totalRefreshes += playerStats.handsRefreshed;
    }

    if (compilesCount !== undefined) {
        newActions.totalCompiles += compilesCount;
    }

    // Return new stats with all updated nested objects
    return {
        version: stats.version,
        global: newGlobal,
        protocols: newProtocols,
        aiDifficulty: newAiDifficulty,
        cards: newCards,
        actions: newActions,
        control: newControl,
        coinFlip: newCoinFlip
    };
}

export function trackCardPlayed(stats: GameStatistics, cardName: string): GameStatistics {
    const newStats = {
        ...stats,
        cards: {
            ...stats.cards,
            played: { ...stats.cards.played }
        }
    };
    if (!newStats.cards.played[cardName]) {
        newStats.cards.played[cardName] = 0;
    }
    newStats.cards.played[cardName]++;
    return newStats;
}

export function trackCardDeleted(stats: GameStatistics, cardName: string): GameStatistics {
    const newStats = {
        ...stats,
        cards: {
            ...stats.cards,
            deleted: { ...stats.cards.deleted }
        }
    };
    if (!newStats.cards.deleted[cardName]) {
        newStats.cards.deleted[cardName] = 0;
    }
    newStats.cards.deleted[cardName]++;
    return newStats;
}

export function trackRearrange(stats: GameStatistics, actor: 'player' | 'opponent'): GameStatistics {
    const newStats = {
        ...stats,
        control: { ...stats.control }  // Deep copy control object!
    };

    if (actor === 'player') {
        newStats.control.playerRearranges++;
    } else {
        newStats.control.aiRearranges++;
    }
    newStats.control.totalRearranges++;

    return newStats;
}

export function trackCoinFlip(stats: GameStatistics, choice: 'heads' | 'tails', won: boolean): GameStatistics {
    const newStats = {
        ...stats,
        coinFlip: { ...stats.coinFlip }  // Deep copy coinFlip object!
    };

    if (choice === 'heads') {
        newStats.coinFlip.headsChosen++;
        if (won) {
            newStats.coinFlip.headsWon++;
        }
    } else {
        newStats.coinFlip.tailsChosen++;
        if (won) {
            newStats.coinFlip.tailsWon++;
        }
    }

    return newStats;
}

// Helper functions for UI
export function getWinRate(stats: GameStatistics): number {
    if (stats.global.totalGamesPlayed === 0) return 0;
    return (stats.global.totalGamesWon / stats.global.totalGamesPlayed) * 100;
}

export function getAverageGameDuration(stats: GameStatistics): number {
    if (stats.global.totalGamesPlayed === 0) return 0;
    return Math.floor(stats.global.totalPlaytime / stats.global.totalGamesPlayed);
}

export function getFavoriteProtocols(stats: GameStatistics): Array<{ protocol: string; timesUsed: number; winRate: number }> {
    const protocols = Object.entries(stats.protocols)
        .map(([protocol, data]) => ({
            protocol,
            timesUsed: data.timesUsed,
            winRate: data.timesUsed > 0 ? (data.wins / data.timesUsed) * 100 : 0,
        }))
        .sort((a, b) => b.timesUsed - a.timesUsed);

    return protocols.slice(0, 5);
}

export function getBestWinRateProtocols(stats: GameStatistics): Array<{ protocol: string; timesUsed: number; winRate: number }> {
    const protocols = Object.entries(stats.protocols)
        .filter(([_, data]) => data.timesUsed >= 3) // Minimum 3 games
        .map(([protocol, data]) => ({
            protocol,
            timesUsed: data.timesUsed,
            winRate: (data.wins / data.timesUsed) * 100,
        }))
        .sort((a, b) => b.winRate - a.winRate);

    return protocols.slice(0, 5);
}

export function getLeastUsedProtocols(stats: GameStatistics): Array<{ protocol: string; timesUsed: number; winRate: number }> {
    const protocols = Object.entries(stats.protocols)
        .map(([protocol, data]) => ({
            protocol,
            timesUsed: data.timesUsed,
            winRate: data.timesUsed > 0 ? (data.wins / data.timesUsed) * 100 : 0,
        }))
        .sort((a, b) => a.timesUsed - b.timesUsed); // Ascending order (least used first)

    return protocols.slice(0, 5);
}

export function getMostPlayedCards(stats: GameStatistics): Array<{ card: string; count: number }> {
    const cards = Object.entries(stats.cards.played)
        .map(([card, count]) => ({ card, count }))
        .sort((a, b) => b.count - a.count);

    return cards.slice(0, 5);
}

export function getMostDeletedCards(stats: GameStatistics): Array<{ card: string; count: number }> {
    const cards = Object.entries(stats.cards.deleted)
        .map(([card, count]) => ({ card, count }))
        .sort((a, b) => b.count - a.count);

    return cards.slice(0, 5);
}

export function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}
