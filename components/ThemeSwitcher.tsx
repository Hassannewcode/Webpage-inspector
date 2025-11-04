import React from 'react';
import { SunIcon, MoonIcon } from './Icons';

interface ThemeSwitcherProps {
  theme: 'light' | 'dark';
  onToggle: () => void;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ theme, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      className="p-2 rounded-full bg-white/50 dark:bg-gray-800/50 hover:bg-white/80 dark:hover:bg-gray-700/80 backdrop-blur-sm transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'light' ? (
        <MoonIcon className="h-5 w-5 text-gray-700" />
      ) : (
        <SunIcon className="h-5 w-5 text-yellow-300" />
      )}
    </button>
  );
};
