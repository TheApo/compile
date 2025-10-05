/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Header } from '../components/Header';
import {
    loadStatistics,
    getWinRate,
    getFavoriteProtocols,
    getBestWinRateProtocols,
    getMostPlayedCards,
    getMostDeletedCards,
    formatTime,
} from '../utils/statistics';
import '../styles/StatisticsScreen.css';

interface StatisticsScreenProps {
    onBack: () => void;
}

export function StatisticsScreen({ onBack }: StatisticsScreenProps) {
    const stats = loadStatistics();
    const winRate = getWinRate(stats);
    const favoriteProtocols = getFavoriteProtocols(stats);
    const bestProtocols = getBestWinRateProtocols(stats);
    const mostPlayedCards = getMostPlayedCards(stats);
    const mostDeletedCards = getMostDeletedCards(stats);

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
                        {stats.global.fastestWin && (
                            <div className="stat-item">
                                <span className="stat-label">Fastest Win</span>
                                <span className="stat-value">{formatTime(stats.global.fastestWin)}</span>
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

                {/* Actions Stats - Full Width */}
                <section className="stats-section full-width">
                    <h2 className="section-title">Actions</h2>
                    <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                        <div className="stat-item">
                            <span className="stat-label">Cards Played</span>
                            <span className="stat-value">{stats.actions.totalCardsPlayed}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Cards Drawn</span>
                            <span className="stat-value">{stats.actions.totalCardsDrawn}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Discards</span>
                            <span className="stat-value">{stats.actions.totalDiscards}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Deletes</span>
                            <span className="stat-value">{stats.actions.totalDeletes}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Flips</span>
                            <span className="stat-value">{stats.actions.totalFlips}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Shifts</span>
                            <span className="stat-value">{stats.actions.totalShifts}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Compiles</span>
                            <span className="stat-value">{stats.actions.totalCompiles}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Refreshes</span>
                            <span className="stat-value">{stats.actions.totalRefreshes}</span>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
