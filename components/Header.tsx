/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface HeaderProps {
  title: string;
  onBack?: () => void;
}

export function Header({ title, onBack }: HeaderProps) {
  return (
    <header className="app-header">
      <h2>{title}</h2>
      {onBack && (
        <button className="btn btn-back" onClick={onBack}>
          Back
        </button>
      )}
    </header>
  );
}