/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Player, Difficulty, GameState } from '../types';
import { uniqueProtocols } from '../data/cards';
import { getCustomProtocolNames } from '../logic/customProtocols/loadDefaultProtocols';

const STATS_KEY = 'compile_game_statistics';

/**
 * Get all protocol names (hardcoded + custom)
 * This ensures custom protocols like Ice, Corruption, etc. appear in statistics
 */
const getAllProtocolNames = (): string[] => {
    const hardcodedProtocols = uniqueProtocols;
    const customProtocols = getCustomProtocolNames();

    // Combine and deduplicate (some protocols exist in both)
    const allProtocols = new Set([...hardcodedProtocols, ...customProtocols]);
    return Array.from(allProtocols).sort();
};
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
        totalReturns: number;  // NEW: Track total returns

        // Detailed breakdown by player/AI
        detailedStats: {
            cardsPlayed: {
                total: number;
                player: number;
                ai: number;
                playerFromHand: number;
                playerFromEffect: number;
                aiFromHand: number;
                aiFromEffect: number;
            };
            cardsDrawn: {
                total: number;
                player: number;
                ai: number;
                playerFromRefresh: number;
                playerFromEffect: number;
                aiFromRefresh: number;
                aiFromEffect: number;
            };
            discards: {
                total: number;
                player: number;
                ai: number;
            };
            deletes: {
                total: number;
                player: number;
                ai: number;
            };
            flips: {
                total: number;
                player: number;
                ai: number;
            };
            shifts: {
                total: number;
                player: number;
                ai: number;
            };
            returns: {
                total: number;
                player: number;
                ai: number;
            };
            compiles: {
                total: number;
                player: number;
                ai: number;
                playerFirstCompile: number;
                playerRecompile: number;
                aiFirstCompile: number;
                aiRecompile: number;
            };
            refreshes: {
                total: number;
                player: number;
                ai: number;
                playerCardsDrawn: number;   // Sum of all cards drawn in player refreshes
                aiCardsDrawn: number;       // Sum of all cards drawn in AI refreshes
            };
        };
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
    // Initialize ALL protocols (hardcoded + custom) with 0 usage so they appear in "Least Used Protocols"
    const allProtocols = getAllProtocolNames(); // Includes both hardcoded and custom protocols

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
            totalReturns: 0,
            detailedStats: {
                cardsPlayed: { total: 0, player: 0, ai: 0, playerFromHand: 0, playerFromEffect: 0, aiFromHand: 0, aiFromEffect: 0 },
                cardsDrawn: { total: 0, player: 0, ai: 0, playerFromRefresh: 0, playerFromEffect: 0, aiFromRefresh: 0, aiFromEffect: 0 },
                discards: { total: 0, player: 0, ai: 0 },
                deletes: { total: 0, player: 0, ai: 0 },
                flips: { total: 0, player: 0, ai: 0 },
                shifts: { total: 0, player: 0, ai: 0 },
                returns: { total: 0, player: 0, ai: 0 },
                compiles: { total: 0, player: 0, ai: 0, playerFirstCompile: 0, playerRecompile: 0, aiFirstCompile: 0, aiRecompile: 0 },
                refreshes: { total: 0, player: 0, ai: 0, playerCardsDrawn: 0, aiCardsDrawn: 0 },
            },
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

        // Ensure ALL protocols exist (migration for existing stats) - includes both hardcoded and custom
        const allProtocols = getAllProtocolNames(); // Automatically includes Ice, Corruption, etc.

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
                totalReturns: parsed.actions?.totalReturns || 0,
                // Migrate detailedStats with defaults for new fields
                detailedStats: {
                    cardsPlayed: {
                        total: parsed.actions?.detailedStats?.cardsPlayed?.total || 0,
                        player: parsed.actions?.detailedStats?.cardsPlayed?.player || 0,
                        ai: parsed.actions?.detailedStats?.cardsPlayed?.ai || 0,
                        playerFromHand: parsed.actions?.detailedStats?.cardsPlayed?.playerFromHand || 0,
                        playerFromEffect: parsed.actions?.detailedStats?.cardsPlayed?.playerFromEffect || 0,
                        aiFromHand: parsed.actions?.detailedStats?.cardsPlayed?.aiFromHand || 0,
                        aiFromEffect: parsed.actions?.detailedStats?.cardsPlayed?.aiFromEffect || 0,
                    },
                    cardsDrawn: {
                        total: parsed.actions?.detailedStats?.cardsDrawn?.total || 0,
                        player: parsed.actions?.detailedStats?.cardsDrawn?.player || 0,
                        ai: parsed.actions?.detailedStats?.cardsDrawn?.ai || 0,
                        playerFromRefresh: parsed.actions?.detailedStats?.cardsDrawn?.playerFromRefresh || 0,
                        playerFromEffect: parsed.actions?.detailedStats?.cardsDrawn?.playerFromEffect || 0,
                        aiFromRefresh: parsed.actions?.detailedStats?.cardsDrawn?.aiFromRefresh || 0,
                        aiFromEffect: parsed.actions?.detailedStats?.cardsDrawn?.aiFromEffect || 0,
                    },
                    discards: {
                        total: parsed.actions?.detailedStats?.discards?.total || 0,
                        player: parsed.actions?.detailedStats?.discards?.player || 0,
                        ai: parsed.actions?.detailedStats?.discards?.ai || 0,
                    },
                    deletes: {
                        total: parsed.actions?.detailedStats?.deletes?.total || 0,
                        player: parsed.actions?.detailedStats?.deletes?.player || 0,
                        ai: parsed.actions?.detailedStats?.deletes?.ai || 0,
                    },
                    flips: {
                        total: parsed.actions?.detailedStats?.flips?.total || 0,
                        player: parsed.actions?.detailedStats?.flips?.player || 0,
                        ai: parsed.actions?.detailedStats?.flips?.ai || 0,
                    },
                    shifts: {
                        total: parsed.actions?.detailedStats?.shifts?.total || 0,
                        player: parsed.actions?.detailedStats?.shifts?.player || 0,
                        ai: parsed.actions?.detailedStats?.shifts?.ai || 0,
                    },
                    returns: {
                        total: parsed.actions?.detailedStats?.returns?.total || 0,
                        player: parsed.actions?.detailedStats?.returns?.player || 0,
                        ai: parsed.actions?.detailedStats?.returns?.ai || 0,
                    },
                    compiles: {
                        total: parsed.actions?.detailedStats?.compiles?.total || 0,
                        player: parsed.actions?.detailedStats?.compiles?.player || 0,
                        ai: parsed.actions?.detailedStats?.compiles?.ai || 0,
                        playerFirstCompile: parsed.actions?.detailedStats?.compiles?.playerFirstCompile || 0,
                        playerRecompile: parsed.actions?.detailedStats?.compiles?.playerRecompile || 0,
                        aiFirstCompile: parsed.actions?.detailedStats?.compiles?.aiFirstCompile || 0,
                        aiRecompile: parsed.actions?.detailedStats?.compiles?.aiRecompile || 0,
                    },
                    refreshes: {
                        total: parsed.actions?.detailedStats?.refreshes?.total || 0,
                        player: parsed.actions?.detailedStats?.refreshes?.player || 0,
                        ai: parsed.actions?.detailedStats?.refreshes?.ai || 0,
                        playerCardsDrawn: parsed.actions?.detailedStats?.refreshes?.playerCardsDrawn || 0,
                        aiCardsDrawn: parsed.actions?.detailedStats?.refreshes?.aiCardsDrawn || 0,
                    },
                },
            },
        };

        // Save migrated version if needed (add new fields or protocols)
        const needsMigration = !parsed.control?.playerRearranges ||
                               !parsed.coinFlip ||
                               !parsed.actions?.totalCompiles ||
                               !parsed.actions?.detailedStats ||
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

/**
 * Reset all statistics to default values
 */
export function resetStatistics(): void {
    try {
        localStorage.removeItem(STATS_KEY);
    } catch (error) {
        console.error('Failed to reset statistics:', error);
    }
}

export interface DetailedGameStatsInput {
    cardsPlayed?: { playerFromHand: number; playerFromEffect: number; aiFromHand: number; aiFromEffect: number };
    cardsDrawn?: { playerFromRefresh: number; playerFromEffect: number; aiFromRefresh: number; aiFromEffect: number };
    compiles?: { playerFirstCompile: number; playerRecompile: number; aiFirstCompile: number; aiRecompile: number };
    refreshes?: { playerCardsDrawn: number; aiCardsDrawn: number };
}

export function updateStatisticsOnGameEnd(
    stats: GameStatistics,
    winner: Player,
    playerProtocols: string[],
    difficulty: Difficulty,
    gameDurationSeconds: number,
    useControl: boolean = false,
    playerStats?: { cardsPlayed: number; cardsDrawn: number; cardsDiscarded: number; cardsDeleted: number; cardsFlipped: number; cardsShifted: number; cardsReturned?: number; handsRefreshed: number },
    compilesCount?: number,
    opponentStats?: { cardsPlayed: number; cardsDrawn: number; cardsDiscarded: number; cardsDeleted: number; cardsFlipped: number; cardsShifted: number; cardsReturned?: number; handsRefreshed: number },
    detailedGameStats?: DetailedGameStatsInput
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

    // Deep copy detailedStats
    const newDetailedStats = {
        cardsPlayed: { ...stats.actions.detailedStats.cardsPlayed },
        cardsDrawn: { ...stats.actions.detailedStats.cardsDrawn },
        discards: { ...stats.actions.detailedStats.discards },
        deletes: { ...stats.actions.detailedStats.deletes },
        flips: { ...stats.actions.detailedStats.flips },
        shifts: { ...stats.actions.detailedStats.shifts },
        returns: { ...stats.actions.detailedStats.returns },
        compiles: { ...stats.actions.detailedStats.compiles },
        refreshes: { ...stats.actions.detailedStats.refreshes },
    };

    // Update action stats from game stats
    if (playerStats) {
        newActions.totalCardsPlayed += playerStats.cardsPlayed;
        newActions.totalCardsDrawn += playerStats.cardsDrawn;
        newActions.totalDiscards += playerStats.cardsDiscarded;
        newActions.totalDeletes += playerStats.cardsDeleted;
        newActions.totalFlips += playerStats.cardsFlipped;
        newActions.totalShifts += playerStats.cardsShifted;
        newActions.totalRefreshes += playerStats.handsRefreshed;
        newActions.totalReturns += playerStats.cardsReturned || 0;

        // Update detailed stats - player totals
        newDetailedStats.cardsPlayed.total += playerStats.cardsPlayed;
        newDetailedStats.cardsPlayed.player += playerStats.cardsPlayed;
        newDetailedStats.cardsDrawn.total += playerStats.cardsDrawn;
        newDetailedStats.cardsDrawn.player += playerStats.cardsDrawn;
        newDetailedStats.discards.total += playerStats.cardsDiscarded;
        newDetailedStats.discards.player += playerStats.cardsDiscarded;
        newDetailedStats.deletes.total += playerStats.cardsDeleted;
        newDetailedStats.deletes.player += playerStats.cardsDeleted;
        newDetailedStats.flips.total += playerStats.cardsFlipped;
        newDetailedStats.flips.player += playerStats.cardsFlipped;
        newDetailedStats.shifts.total += playerStats.cardsShifted;
        newDetailedStats.shifts.player += playerStats.cardsShifted;
        newDetailedStats.returns.total += playerStats.cardsReturned || 0;
        newDetailedStats.returns.player += playerStats.cardsReturned || 0;
        newDetailedStats.refreshes.total += playerStats.handsRefreshed;
        newDetailedStats.refreshes.player += playerStats.handsRefreshed;
    }

    // Update AI stats
    if (opponentStats) {
        newActions.totalCardsPlayed += opponentStats.cardsPlayed;
        newActions.totalCardsDrawn += opponentStats.cardsDrawn;
        newActions.totalDiscards += opponentStats.cardsDiscarded;
        newActions.totalDeletes += opponentStats.cardsDeleted;
        newActions.totalFlips += opponentStats.cardsFlipped;
        newActions.totalShifts += opponentStats.cardsShifted;
        newActions.totalRefreshes += opponentStats.handsRefreshed;
        newActions.totalReturns += opponentStats.cardsReturned || 0;

        // Update detailed stats - AI totals
        newDetailedStats.cardsPlayed.total += opponentStats.cardsPlayed;
        newDetailedStats.cardsPlayed.ai += opponentStats.cardsPlayed;
        newDetailedStats.cardsDrawn.total += opponentStats.cardsDrawn;
        newDetailedStats.cardsDrawn.ai += opponentStats.cardsDrawn;
        newDetailedStats.discards.total += opponentStats.cardsDiscarded;
        newDetailedStats.discards.ai += opponentStats.cardsDiscarded;
        newDetailedStats.deletes.total += opponentStats.cardsDeleted;
        newDetailedStats.deletes.ai += opponentStats.cardsDeleted;
        newDetailedStats.flips.total += opponentStats.cardsFlipped;
        newDetailedStats.flips.ai += opponentStats.cardsFlipped;
        newDetailedStats.shifts.total += opponentStats.cardsShifted;
        newDetailedStats.shifts.ai += opponentStats.cardsShifted;
        newDetailedStats.returns.total += opponentStats.cardsReturned || 0;
        newDetailedStats.returns.ai += opponentStats.cardsReturned || 0;
        newDetailedStats.refreshes.total += opponentStats.handsRefreshed;
        newDetailedStats.refreshes.ai += opponentStats.handsRefreshed;
    }

    // Update detailed source breakdown (from hand vs from effect, etc.)
    if (detailedGameStats) {
        if (detailedGameStats.cardsPlayed) {
            newDetailedStats.cardsPlayed.playerFromHand += detailedGameStats.cardsPlayed.playerFromHand;
            newDetailedStats.cardsPlayed.playerFromEffect += detailedGameStats.cardsPlayed.playerFromEffect;
            newDetailedStats.cardsPlayed.aiFromHand += detailedGameStats.cardsPlayed.aiFromHand;
            newDetailedStats.cardsPlayed.aiFromEffect += detailedGameStats.cardsPlayed.aiFromEffect;
        }
        if (detailedGameStats.cardsDrawn) {
            newDetailedStats.cardsDrawn.playerFromRefresh += detailedGameStats.cardsDrawn.playerFromRefresh;
            newDetailedStats.cardsDrawn.playerFromEffect += detailedGameStats.cardsDrawn.playerFromEffect;
            newDetailedStats.cardsDrawn.aiFromRefresh += detailedGameStats.cardsDrawn.aiFromRefresh;
            newDetailedStats.cardsDrawn.aiFromEffect += detailedGameStats.cardsDrawn.aiFromEffect;
        }
        if (detailedGameStats.compiles) {
            newDetailedStats.compiles.playerFirstCompile += detailedGameStats.compiles.playerFirstCompile;
            newDetailedStats.compiles.playerRecompile += detailedGameStats.compiles.playerRecompile;
            newDetailedStats.compiles.aiFirstCompile += detailedGameStats.compiles.aiFirstCompile;
            newDetailedStats.compiles.aiRecompile += detailedGameStats.compiles.aiRecompile;
            // Calculate player/ai totals from firstCompile + recompile
            newDetailedStats.compiles.player += detailedGameStats.compiles.playerFirstCompile + detailedGameStats.compiles.playerRecompile;
            newDetailedStats.compiles.ai += detailedGameStats.compiles.aiFirstCompile + detailedGameStats.compiles.aiRecompile;
            // Calculate total from player + ai
            newDetailedStats.compiles.total += detailedGameStats.compiles.playerFirstCompile + detailedGameStats.compiles.playerRecompile +
                                               detailedGameStats.compiles.aiFirstCompile + detailedGameStats.compiles.aiRecompile;
        }
        if (detailedGameStats.refreshes) {
            newDetailedStats.refreshes.playerCardsDrawn += detailedGameStats.refreshes.playerCardsDrawn;
            newDetailedStats.refreshes.aiCardsDrawn += detailedGameStats.refreshes.aiCardsDrawn;
        }
    }

    if (compilesCount !== undefined) {
        newActions.totalCompiles += compilesCount;
        // NOTE: detailedStats.compiles.total is now calculated from firstCompile + recompile above
    }

    // Assign updated detailedStats to newActions
    newActions.detailedStats = newDetailedStats;

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
