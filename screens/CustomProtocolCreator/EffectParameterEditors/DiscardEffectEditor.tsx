/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DiscardEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

export const DiscardEffectEditor: React.FC<{ params: DiscardEffectParams; onChange: (params: DiscardEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    const countType = params.countType || 'fixed';
    const isVariable = (params as any).variableCount;
    const showOffset = countType === 'equal_to_discarded';

    const source = params.source || 'hand';

    return (
        <div className="param-editor">
            <h4>Discard Effect</h4>

            {/* Source */}
            <label>
                Source
                <select
                    value={source}
                    onChange={e => onChange({ ...params, source: e.target.value as any })}
                >
                    <option value="hand">From Hand</option>
                    <option value="top_deck_own">Top of Own Deck (automatic)</option>
                    <option value="top_deck_opponent">Top of Opponent's Deck (automatic)</option>
                    <option value="entire_deck">Entire Deck (automatic)</option>
                </select>
                {(source === 'top_deck_own' || source === 'top_deck_opponent') && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Deck discard is automatic - no player choice needed.
                        The discarded card's value is saved for follow-up effects.
                    </small>
                )}
                {source === 'entire_deck' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        Discards all cards from your deck to trash automatically.
                    </small>
                )}
            </label>

            {/* Count Type - only for hand discard */}
            {source === 'hand' && (
                <label>
                    Count Type
                    <select
                        value={countType}
                        onChange={e => onChange({ ...params, countType: e.target.value as any })}
                    >
                        <option value="fixed">Fixed Count</option>
                        <option value="equal_to_discarded">Equal to Previously Discarded (Plague-2)</option>
                    </select>
                </label>
            )}

            {/* Fixed Count Options - only for hand discard */}
            {source === 'hand' && countType === 'fixed' && (
                <label>
                    Count
                    <select
                        value={isVariable ? 'variable' : params.count.toString()}
                        onChange={e => {
                            const val = e.target.value;
                            if (val === 'variable') {
                                onChange({ ...params, variableCount: true, count: 1 } as any);
                            } else if (val === 'all') {
                                const { variableCount, ...rest } = params as any;
                                onChange({ ...rest, count: 'all' as any });
                            } else {
                                const { variableCount, ...rest } = params as any;
                                onChange({ ...rest, count: parseInt(val) });
                            }
                        }}
                    >
                        <option value="1">1 card</option>
                        <option value="2">2 cards</option>
                        <option value="3">3 cards</option>
                        <option value="all">All cards (entire hand)</option>
                        <option value="variable">1 or more cards (variable)</option>
                    </select>
                </label>
            )}

            {/* Offset for Dynamic Count - only for hand discard */}
            {source === 'hand' && showOffset && (
                <label>
                    Offset (add to count)
                    <input
                        type="number"
                        value={params.countOffset || 0}
                        onChange={e => onChange({ ...params, countOffset: parseInt(e.target.value) })}
                        min="-5"
                        max="5"
                    />
                </label>
            )}

            {/* Actor - only for hand discard */}
            {source === 'hand' && (
                <label>
                    Actor
                    <select value={params.actor} onChange={e => onChange({ ...params, actor: e.target.value as any })}>
                        <option value="self">Self</option>
                        <option value="opponent">Opponent</option>
                        <option value="both">Both Players</option>
                    </select>
                    {params.actor === 'both' && (
                        <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                            Both players discard simultaneously (automatic, no selection needed).
                        </small>
                    )}
                </label>
            )}

            {/* Random selection - only available when actor is opponent and source is hand */}
            {source === 'hand' && params.actor === 'opponent' && (
                <label>
                    <input
                        type="checkbox"
                        checked={params.random || false}
                        onChange={e => onChange({ ...params, random: e.target.checked })}
                    />
                    Random selection (opponent can't choose which card)
                    <small style={{ display: 'block', marginLeft: '24px', marginTop: '4px', color: '#8A79E8' }}>
                        A random card is discarded instead of opponent choosing.
                    </small>
                </label>
            )}

            {/* Discard destination - for Assimilation-1 Bottom */}
            {source === 'hand' && (
                <label>
                    Discard to
                    <select
                        value={params.discardTo || 'own_trash'}
                        onChange={e => onChange({ ...params, discardTo: e.target.value as 'own_trash' | 'opponent_trash' })}
                    >
                        <option value="own_trash">Own trash (default)</option>
                        <option value="opponent_trash">Opponent's trash</option>
                    </select>
                    {params.discardTo === 'opponent_trash' && (
                        <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                            Card goes to opponent's trash instead of your own.
                        </small>
                    )}
                </label>
            )}

        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateDiscardText = (params: DiscardEffectParams): string => {
    const isVariable = (params as any).variableCount;
    const countType = params.countType || 'fixed';
    let countText = '';

    if (countType === 'equal_to_discarded') {
        const offset = params.countOffset || 0;
        const offsetText = offset > 0 ? ` + ${offset}` : offset < 0 ? ` - ${Math.abs(offset)}` : '';
        countText = `(amount discarded${offsetText}) cards`;
    } else if (isVariable) {
        countText = '1 or more cards';
    } else if (params.count === 'all') {
        countText = 'your hand';
    } else {
        const cardWord = params.count === 1 ? 'card' : 'cards';
        countText = `${params.count} ${cardWord}`;
    }

    if (params.actor === 'opponent') {
        if (params.count === 'all') {
            return `Opponent discards their hand.`;
        }
        return `Opponent discards ${countText}.`;
    } else {
        return `Discard ${countText}.`;
    }
};
