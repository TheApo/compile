/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Player } from '../types';

interface ToasterProps {
  message: string;
  player: Player;
}

// FIX: Changed component to React.FC to correctly handle React-specific props like 'key'.
export const Toaster: React.FC<ToasterProps> = ({ message, player }) => {
  return (
    <div className={`toaster toaster-${player}`}>
      {message}
    </div>
  );
}