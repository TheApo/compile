/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Header } from '../components/Header';
import {
    loadStatistics,
    resetStatistics,
    getWinRate,
    getFavoriteProtocols,
    getBestWinRateProtocols,
    getLeastUsedProtocols,
    getMostPlayedCards,
    getMostDeletedCards,
    formatTime,
    getAverageGameDuration,
} from '../utils/statistics';
import '../styles/StatisticsScreen.css';

type ActionType = 'played' | 'drawn' | 'discards' | 'deletes' | 'flips' | 'shifts' | 'returns' | 'compiles' | 'refreshes' | null;

interface StatisticsScreenProps {
    onBack: () => void;
}

export function StatisticsScreen({ onBack }: StatisticsScreenProps) {
    const [stats, setStats] = useState(() => loadStatistics());
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const winRate = getWinRate(stats);
    const averageGameDuration = getAverageGameDuration(stats);
    const favoriteProtocols = getFavoriteProtocols(stats);
    const bestProtocols = getBestWinRateProtocols(stats);
    const leastUsedProtocols = getLeastUsedProtocols(stats);
    const mostPlayedCards = getMostPlayedCards(stats);
    const mostDeletedCards = getMostDeletedCards(stats);

    const [expandedAction, setExpandedAction] = useState<ActionType>(null);

    const handleResetStats = () => {
        resetStatistics();
        setStats(loadStatistics());
        setShowResetConfirm(false);
    };

    const toggleAction = (action: ActionType) => {
        setExpandedAction(prev => prev === action ? null : action);
    };

    const totalGames = stats.global.totalGamesPlayed;
    const d = stats.actions.detailedStats;

    // Helper to calculate average per game
    const avgPerGame = (value: number) => totalGames > 0 ? (value / totalGames).toFixed(1) : '0.0';

    // Helper to calculate average cards per refresh
    const avgCardsPerRefresh = (cardsDrawn: number, refreshCount: number) =>
        refreshCount > 0 ? (cardsDrawn / refreshCount).toFixed(1) : '0.0';

    // Calculate derived values from detail fields (more accurate than stored totals)
    // Cards Drawn: fromRefresh + fromEffect = player/ai, to exclude initial 5 cards
    const cardsDrawnPlayer = d.cardsDrawn.playerFromRefresh + d.cardsDrawn.playerFromEffect;
    const cardsDrawnAi = d.cardsDrawn.aiFromRefresh + d.cardsDrawn.aiFromEffect;
    const cardsDrawnTotal = cardsDrawnPlayer + cardsDrawnAi;

    // Cards Played: fromHand + fromEffect = player/ai
    const cardsPlayedPlayer = d.cardsPlayed.playerFromHand + d.cardsPlayed.playerFromEffect;
    const cardsPlayedAi = d.cardsPlayed.aiFromHand + d.cardsPlayed.aiFromEffect;
    const cardsPlayedTotal = cardsPlayedPlayer + cardsPlayedAi;

    // Compiles: firstCompile + recompile = player/ai
    const compilesPlayer = d.compiles.playerFirstCompile + d.compiles.playerRecompile;
    const compilesAi = d.compiles.aiFirstCompile + d.compiles.aiRecompile;
    const compilesTotal = compilesPlayer + compilesAi;

    // Discards: player + ai = total
    const discardsTotal = d.discards.player + d.discards.ai;

    // Deletes: player + ai = total
    const deletesTotal = d.deletes.player + d.deletes.ai;

    // Flips: player + ai = total
    const flipsTotal = d.flips.player + d.flips.ai;

    // Shifts: player + ai = total
    const shiftsTotal = d.shifts.player + d.shifts.ai;

    // Returns: player + ai = total
    const returnsTotal = d.returns.player + d.returns.ai;

    // Refreshes: player + ai = total
    const refreshesTotal = d.refreshes.player + d.refreshes.ai;

    return (
        <div className="screen statistics-screen">
            <Header title="STATISTICS" onBack={onBack} />

            <div className="stats-content">
                {/* Overview Section */}
                <section className="stats-section">
                    <h2 className="section-title">Overview</h2>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">Games Played</span>
                            <span className="stat-value">{stats.global.totalGamesPlayed}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Win Rate</span>
                            <span className="stat-value">{winRate.toFixed(1)}%</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Games Won</span>
                            <span className="stat-value win">{stats.global.totalGamesWon}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Games Lost</span>
                            <span className="stat-value loss">{stats.global.totalGamesLost}</span>
                        </div>
                    </div>
                </section>

                {/* Streaks */}
                <section className="stats-section">
                    <h2 className="section-title">Streaks</h2>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">Current Streak</span>
                            <span className={`stat-value ${stats.global.currentStreak > 0 ? 'win' : stats.global.currentStreak < 0 ? 'loss' : ''}`}>
                                {stats.global.currentStreak > 0 ? `+${stats.global.currentStreak}` : stats.global.currentStreak}
                            </span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Best Win Streak</span>
                            <span className="stat-value win">{stats.global.longestWinStreak}</span>
                        </div>
                    </div>
                </section>

                {/* Playtime */}
                <section className="stats-section">
                    <h2 className="section-title">Playtime</h2>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">Total Playtime</span>
                            <span className="stat-value">{formatTime(stats.global.totalPlaytime)}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Average Game</span>
                            <span className="stat-value">{formatTime(averageGameDuration)}</span>
                        </div>
                        {stats.global.fastestWin && (
                            <div className="stat-item">
                                <span className="stat-label">Fastest Win</span>
                                <span className="stat-value">{formatTime(stats.global.fastestWin)}</span>
                            </div>
                        )}
                        {stats.global.longestGame && (
                            <div className="stat-item">
                                <span className="stat-label">Longest Game</span>
                                <span className="stat-value">{formatTime(stats.global.longestGame)}</span>
                            </div>
                        )}
                        {stats.global.lastGameDuration && (
                            <div className="stat-item">
                                <span className="stat-label">Last Game</span>
                                <span className="stat-value">{formatTime(stats.global.lastGameDuration)}</span>
                            </div>
                        )}
                    </div>
                </section>

                {/* AI Difficulty Stats */}
                <section className="stats-section">
                    <h2 className="section-title">AI Performance</h2>
                    <div className="ai-stats">
                        {(['easy', 'normal', 'hard'] as const).map(diff => {
                            const data = stats.aiDifficulty[diff];
                            const diffWinRate = data.played > 0 ? (data.wins / data.played) * 100 : 0;
                            return (
                                <div key={diff} className="ai-item">
                                    <span className="ai-name">{diff}</span>
                                    <span className="ai-record">
                                        <span className="win">{data.wins}W</span> - <span className="loss">{data.losses}L</span>
                                    </span>
                                    <span className="ai-winrate">({diffWinRate.toFixed(1)}%)</span>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Best Win Rate Protocols */}
                {bestProtocols.length > 0 && (
                    <section className="stats-section">
                        <h2 className="section-title">Best Win Rate</h2>
                        <div className="protocol-list">
                            {bestProtocols.map((proto, index) => (
                                <div key={proto.protocol} className="protocol-item">
                                    <span className="protocol-rank">{index + 1}.</span>
                                    <span className="protocol-name">{proto.protocol}</span>
                                    <span className="protocol-stats win">
                                        {proto.winRate.toFixed(0)}% · {proto.timesUsed}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Favorite Protocols */}
                {favoriteProtocols.length > 0 && (
                    <section className="stats-section">
                        <h2 className="section-title">Favorite Protocols</h2>
                        <div className="protocol-list">
                            {favoriteProtocols.map((proto, index) => (
                                <div key={proto.protocol} className="protocol-item">
                                    <span className="protocol-rank">{index + 1}.</span>
                                    <span className="protocol-name">{proto.protocol}</span>
                                    <span className="protocol-stats">
                                        {proto.timesUsed} · {proto.winRate.toFixed(0)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Least Used Protocols */}
                {leastUsedProtocols.length > 0 && (
                    <section className="stats-section">
                        <h2 className="section-title">Least Used Protocols</h2>
                        <div className="protocol-list">
                            {leastUsedProtocols.map((proto, index) => (
                                <div key={proto.protocol} className="protocol-item">
                                    <span className="protocol-rank">{index + 1}.</span>
                                    <span className="protocol-name">{proto.protocol}</span>
                                    <span className="protocol-stats">
                                        {proto.timesUsed} · {proto.winRate.toFixed(0)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Most Played Cards */}
                {mostPlayedCards.length > 0 && (
                    <section className="stats-section">
                        <h2 className="section-title">Most Played Cards</h2>
                        <div className="card-list">
                            {mostPlayedCards.map((card, index) => (
                                <div key={card.card} className="card-item">
                                    <span className="card-rank">{index + 1}.</span>
                                    <span className="card-name">{card.card}</span>
                                    <span className="card-count">{card.count}×</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Most Deleted Cards */}
                {mostDeletedCards.length > 0 && (
                    <section className="stats-section">
                        <h2 className="section-title">Most Deleted Cards</h2>
                        <div className="card-list">
                            {mostDeletedCards.map((card, index) => (
                                <div key={card.card} className="card-item">
                                    <span className="card-rank">{index + 1}.</span>
                                    <span className="card-name">{card.card}</span>
                                    <span className="card-count">{card.count}×</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Control Mechanic Stats */}
                <section className="stats-section">
                    <h2 className="section-title">Control Mechanic</h2>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">With Control</span>
                            <span className="stat-value">{stats.control.gamesWithControl}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Without Control</span>
                            <span className="stat-value">{stats.control.gamesWithoutControl}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Your Rearranges</span>
                            <span className="stat-value">{stats.control.playerRearranges}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">AI Rearranges</span>
                            <span className="stat-value">{stats.control.aiRearranges}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Total Rearranges</span>
                            <span className="stat-value">{stats.control.totalRearranges}</span>
                        </div>
                    </div>
                </section>

                {/* Coin Flip Stats */}
                <section className="stats-section">
                    <h2 className="section-title">Coin Flip</h2>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">Heads Chosen</span>
                            <span className="stat-value">{stats.coinFlip.headsChosen} ({stats.coinFlip.headsChosen > 0 ? ((stats.coinFlip.headsWon / stats.coinFlip.headsChosen) * 100).toFixed(0) : 0}%)</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Tails Chosen</span>
                            <span className="stat-value">{stats.coinFlip.tailsChosen} ({stats.coinFlip.tailsChosen > 0 ? ((stats.coinFlip.tailsWon / stats.coinFlip.tailsChosen) * 100).toFixed(0) : 0}%)</span>
                        </div>
                    </div>
                </section>

                {/* Actions Stats - Full Width with Clickable Tiles */}
                <section className="stats-section full-width">
                    <h2 className="section-title">Actions (click for details)</h2>
                    <div className="actions-container">
                        <div
                            className={`stat-item clickable ${expandedAction === 'played' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('played')}
                        >
                            <span className="stat-label">Cards Played</span>
                            <span className="stat-value">{cardsPlayedTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'drawn' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('drawn')}
                        >
                            <span className="stat-label">Cards Drawn</span>
                            <span className="stat-value">{cardsDrawnTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'discards' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('discards')}
                        >
                            <span className="stat-label">Discards</span>
                            <span className="stat-value">{discardsTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'deletes' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('deletes')}
                        >
                            <span className="stat-label">Deletes</span>
                            <span className="stat-value">{deletesTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'flips' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('flips')}
                        >
                            <span className="stat-label">Flips</span>
                            <span className="stat-value">{flipsTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'shifts' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('shifts')}
                        >
                            <span className="stat-label">Shifts</span>
                            <span className="stat-value">{shiftsTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'returns' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('returns')}
                        >
                            <span className="stat-label">Returns</span>
                            <span className="stat-value">{returnsTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'compiles' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('compiles')}
                        >
                            <span className="stat-label">Compiles</span>
                            <span className="stat-value">{compilesTotal}</span>
                        </div>
                        <div
                            className={`stat-item clickable ${expandedAction === 'refreshes' ? 'expanded' : ''}`}
                            onClick={() => toggleAction('refreshes')}
                        >
                            <span className="stat-label">Refreshes</span>
                            <span className="stat-value">{refreshesTotal}</span>
                        </div>
                    </div>

                    {/* Detail Box - appears below the tiles when one is selected */}
                    {expandedAction === 'played' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Cards Played</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{cardsPlayedTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{cardsPlayedPlayer}</span></div>
                                    <div className="detail-row"><span className="detail-label">Von Hand</span><span className="detail-value">{d.cardsPlayed.playerFromHand}</span></div>
                                    <div className="detail-row"><span className="detail-label">Durch Effekt</span><span className="detail-value">{d.cardsPlayed.playerFromEffect}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(cardsPlayedPlayer)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{cardsPlayedAi}</span></div>
                                    <div className="detail-row"><span className="detail-label">Von Hand</span><span className="detail-value">{d.cardsPlayed.aiFromHand}</span></div>
                                    <div className="detail-row"><span className="detail-label">Durch Effekt</span><span className="detail-value">{d.cardsPlayed.aiFromEffect}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(cardsPlayedAi)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'drawn' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Cards Drawn</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{cardsDrawnTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{cardsDrawnPlayer}</span></div>
                                    <div className="detail-row"><span className="detail-label">Durch Refresh</span><span className="detail-value">{d.cardsDrawn.playerFromRefresh}</span></div>
                                    <div className="detail-row"><span className="detail-label">Durch Effekt</span><span className="detail-value">{d.cardsDrawn.playerFromEffect}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(cardsDrawnPlayer)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{cardsDrawnAi}</span></div>
                                    <div className="detail-row"><span className="detail-label">Durch Refresh</span><span className="detail-value">{d.cardsDrawn.aiFromRefresh}</span></div>
                                    <div className="detail-row"><span className="detail-label">Durch Effekt</span><span className="detail-value">{d.cardsDrawn.aiFromEffect}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(cardsDrawnAi)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'discards' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Discards</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{discardsTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.discards.player}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.discards.player)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.discards.ai}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.discards.ai)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'deletes' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Deletes</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{deletesTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.deletes.player}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.deletes.player)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.deletes.ai}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.deletes.ai)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'flips' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Flips</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{flipsTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.flips.player}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.flips.player)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.flips.ai}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.flips.ai)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'shifts' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Shifts</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{shiftsTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.shifts.player}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.shifts.player)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.shifts.ai}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.shifts.ai)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'returns' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Returns</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{returnsTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.returns.player}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.returns.player)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.returns.ai}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.returns.ai)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'compiles' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Compiles</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{compilesTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{compilesPlayer}</span></div>
                                    <div className="detail-row"><span className="detail-label">First-Compile</span><span className="detail-value">{d.compiles.playerFirstCompile}</span></div>
                                    <div className="detail-row"><span className="detail-label">Re-Compile</span><span className="detail-value">{d.compiles.playerRecompile}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(compilesPlayer)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{compilesAi}</span></div>
                                    <div className="detail-row"><span className="detail-label">First-Compile</span><span className="detail-value">{d.compiles.aiFirstCompile}</span></div>
                                    <div className="detail-row"><span className="detail-label">Re-Compile</span><span className="detail-value">{d.compiles.aiRecompile}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(compilesAi)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {expandedAction === 'refreshes' && (
                        <div className="action-details-section">
                            <h3 className="section-title">Refreshes</h3>
                            <div className="action-details-total">
                                <span className="detail-label">Gesamt</span>
                                <span className="detail-value">{refreshesTotal}</span>
                            </div>
                            <div className="action-details-columns">
                                <div className="action-details-column player">
                                    <div className="column-header">Player</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.refreshes.player}</span></div>
                                    <div className="detail-row"><span className="detail-label">Karten / Refresh</span><span className="detail-value">{avgCardsPerRefresh(d.refreshes.playerCardsDrawn, d.refreshes.player)}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.refreshes.player)}</span></div>
                                </div>
                                <div className="action-details-column ai">
                                    <div className="column-header">AI</div>
                                    <div className="detail-row"><span className="detail-label">Total</span><span className="detail-value">{d.refreshes.ai}</span></div>
                                    <div className="detail-row"><span className="detail-label">Karten / Refresh</span><span className="detail-value">{avgCardsPerRefresh(d.refreshes.aiCardsDrawn, d.refreshes.ai)}</span></div>
                                    <div className="detail-row"><span className="detail-label">Avg / Spiel</span><span className="detail-value">{avgPerGame(d.refreshes.ai)}</span></div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {/* Reset Statistics Button */}
                <section className="stats-section reset-section">
                    <button
                        className="reset-stats-button"
                        onClick={() => setShowResetConfirm(true)}
                    >
                        Reset All Statistics
                    </button>
                </section>
            </div>

            {/* Reset Confirmation Modal */}
            {showResetConfirm && (
                <div className="reset-modal-overlay" onClick={() => setShowResetConfirm(false)}>
                    <div className="reset-modal" onClick={e => e.stopPropagation()}>
                        <h3>Reset Statistics?</h3>
                        <p>This will permanently delete all your statistics. This action cannot be undone.</p>
                        <div className="reset-modal-buttons">
                            <button className="cancel-button" onClick={() => setShowResetConfirm(false)}>
                                Cancel
                            </button>
                            <button className="confirm-reset-button" onClick={handleResetStats}>
                                Reset
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
