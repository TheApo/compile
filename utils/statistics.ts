/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Player, Difficulty, GameState } from '../types';

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
    // Initialize all 15 protocols with 0 usage so they appear in "Least Used Protocols"
    const allProtocols = [
        'Apathy', 'Darkness', 'Death', 'Fire', 'Gravity',
        'Hate', 'Life', 'Light', 'Love', 'Metal',
        'Plague', 'Psychic', 'Speed', 'Spirit', 'Water'
    ];

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

        // Ensure all 15 protocols exist (migration for existing stats)
        const allProtocols = [
            'Apathy', 'Darkness', 'Death', 'Fire', 'Gravity',
            'Hate', 'Life', 'Light', 'Love', 'Metal',
            'Plague', 'Psychic', 'Speed', 'Spirit', 'Water'
        ];

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
    const newStats = { ...stats };
    const playerWon = winner === 'player';

    // Update global stats
    newStats.global.totalGamesPlayed++;
    if (playerWon) {
        newStats.global.totalGamesWon++;
    } else {
        newStats.global.totalGamesLost++;
    }
    newStats.global.totalPlaytime += gameDurationSeconds;

    // Update fastest/longest/last game
    if (playerWon) {
        if (newStats.global.fastestWin === null || gameDurationSeconds < newStats.global.fastestWin) {
            newStats.global.fastestWin = gameDurationSeconds;
        }
    }
    if (newStats.global.longestGame === null || gameDurationSeconds > newStats.global.longestGame) {
        newStats.global.longestGame = gameDurationSeconds;
    }
    newStats.global.lastGameDuration = gameDurationSeconds;

    // Update streaks
    if (playerWon) {
        if (newStats.global.currentStreak >= 0) {
            newStats.global.currentStreak++;
        } else {
            newStats.global.currentStreak = 1;
        }
        if (newStats.global.currentStreak > newStats.global.longestWinStreak) {
            newStats.global.longestWinStreak = newStats.global.currentStreak;
        }
    } else {
        if (newStats.global.currentStreak <= 0) {
            newStats.global.currentStreak--;
        } else {
            newStats.global.currentStreak = -1;
        }
        if (Math.abs(newStats.global.currentStreak) > newStats.global.longestLoseStreak) {
            newStats.global.longestLoseStreak = Math.abs(newStats.global.currentStreak);
        }
    }

    // Update protocol stats
    playerProtocols.forEach(protocol => {
        if (!newStats.protocols[protocol]) {
            newStats.protocols[protocol] = { timesUsed: 0, wins: 0, losses: 0 };
        }
        newStats.protocols[protocol].timesUsed++;
        if (playerWon) {
            newStats.protocols[protocol].wins++;
        } else {
            newStats.protocols[protocol].losses++;
        }
    });

    // Update AI difficulty stats
    newStats.aiDifficulty[difficulty].played++;
    if (playerWon) {
        newStats.aiDifficulty[difficulty].wins++;
    } else {
        newStats.aiDifficulty[difficulty].losses++;
    }

    // Update control mechanic stats
    if (useControl) {
        newStats.control.gamesWithControl++;
    } else {
        newStats.control.gamesWithoutControl++;
    }

    // Update action stats from game stats
    if (playerStats) {
        newStats.actions.totalCardsPlayed += playerStats.cardsPlayed;
        newStats.actions.totalCardsDrawn += playerStats.cardsDrawn;
        newStats.actions.totalDiscards += playerStats.cardsDiscarded;
        newStats.actions.totalDeletes += playerStats.cardsDeleted;
        newStats.actions.totalFlips += playerStats.cardsFlipped;
        newStats.actions.totalShifts += playerStats.cardsShifted;
        newStats.actions.totalRefreshes += playerStats.handsRefreshed;
    }

    if (compilesCount !== undefined) {
        newStats.actions.totalCompiles += compilesCount;
    }

    return newStats;
}

export function trackCardPlayed(stats: GameStatistics, cardName: string): GameStatistics {
    const newStats = { ...stats };
    if (!newStats.cards.played[cardName]) {
        newStats.cards.played[cardName] = 0;
    }
    newStats.cards.played[cardName]++;
    return newStats;
}

export function trackCardDeleted(stats: GameStatistics, cardName: string): GameStatistics {
    const newStats = { ...stats };
    if (!newStats.cards.deleted[cardName]) {
        newStats.cards.deleted[cardName] = 0;
    }
    newStats.cards.deleted[cardName]++;
    return newStats;
}

export function trackRearrange(stats: GameStatistics, actor: 'player' | 'opponent'): GameStatistics {
    const newStats = { ...stats };

    if (actor === 'player') {
        newStats.control.playerRearranges++;
    } else {
        newStats.control.aiRearranges++;
    }
    newStats.control.totalRearranges++;

    return newStats;
}

export function trackCoinFlip(stats: GameStatistics, choice: 'heads' | 'tails', won: boolean): GameStatistics {
    const newStats = { ...stats };

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
