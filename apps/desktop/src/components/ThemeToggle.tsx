import React from 'react';
import { useAppState, useDispatch } from '../state/store';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function ThemeToggle({ className = '', showLabel = false }: ThemeToggleProps) {
  const s = useAppState();
  const dispatch = useDispatch();
  const isDark = s.theme === 'dark';

  const handleToggle = () => {
    dispatch({ type: 'TOGGLE_THEME' });
  };

  return (
    <button
      type="button"
      className={`theme-stylish-toggle ${isDark ? 'is-dark' : 'is-light'} ${className}`}
      onClick={handleToggle}
      title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
      aria-label="Toggle application theme"
    >
      <div className="toggle-track">
        {/* Glow halo */}
        <span className="toggle-glow" />

        {/* Sliding thumb knob */}
        <span className="toggle-thumb">
          {/* Sun icon with rays */}
          <span className="toggle-icon-wrap icon-sun">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          </span>

          {/* Moon icon with crater crescent */}
          <span className="toggle-icon-wrap icon-moon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </span>
        </span>

        {/* Ambient track stars / rays */}
        <span className="track-stars">
          <i className="star s1" />
          <i className="star s2" />
        </span>
      </div>

      {showLabel && (
        <span className="theme-toggle-label">
          {isDark ? 'Dark Mode' : 'Light Mode'}
        </span>
      )}
    </button>
  );
}
