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
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content log-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-back modal-close-btn" onClick={onClose}>X</button>
        <h2>Game Log</h2>
        <ol className="log-list">
          {log.map((entry, index) => (
            <li key={index} className={`log-entry log-entry-${entry.player}`}>
              {entry.message}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}