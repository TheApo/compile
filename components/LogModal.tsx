/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LogEntry } from '../types';

interface LogModalProps {
  log: LogEntry[];
  onClose: () => void;
}

export function LogModal({ log, onClose }: LogModalProps) {
  const formatLogEntry = (entry: LogEntry) => {
    let prefix = '';

    // Add phase marker if present
    if (entry.phase) {
      const phaseLabel = entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1);
      prefix += `[${phaseLabel}] `;
    }

    // Add source card if present (and different from message)
    if (entry.sourceCard && !entry.message.startsWith(entry.sourceCard)) {
      prefix += `${entry.sourceCard}: `;
    }

    return `${prefix}${entry.message}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content log-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-back modal-close-btn" onClick={onClose}>X</button>
        <h2>Game Log</h2>
        <ol className="log-list">
          {log.map((entry, index) => {
            // Only apply custom paddingLeft if there's an indentLevel (effect-related logs)
            // Otherwise, let CSS handle it (game setup logs, etc.)
            const hasCustomIndent = entry.indentLevel !== undefined;
            const style: React.CSSProperties = hasCustomIndent
              ? { paddingLeft: `${entry.indentLevel * 20 + 40}px` }
              : {};

            // Make top-level effect logs bold
            if (hasCustomIndent && entry.indentLevel === 0) {
              style.fontWeight = 'bold';
            }

            return (
              <li
                key={index}
                className={`log-entry log-entry-${entry.player}`}
                style={style}
              >
                {formatLogEntry(entry)}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}