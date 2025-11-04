import React from 'react';

interface EngineSwitcherProps {
  version: 'v1' | 'v2';
  setVersion: (version: 'v1' | 'v2') => void;
  disabled: boolean;
}

export const EngineSwitcher: React.FC<EngineSwitcherProps> = ({ version, setVersion, disabled }) => {
  const isV2 = version === 'v2';

  return (
    <button
      onClick={() => setVersion(isV2 ? 'v1' : 'v2')}
      disabled={disabled}
      className={`relative flex items-center w-[120px] h-10 p-1 rounded-full cursor-pointer transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 ${
        disabled ? 'cursor-not-allowed bg-gray-300 dark:bg-gray-700' : 'bg-gray-700 dark:bg-gray-900'
      }`}
      role="switch"
      aria-checked={isV2}
      aria-label="Toggle Scanner Engine between V1 and V2"
    >
      <div
        className={`absolute top-1 left-1 w-[calc(50%-4px)] h-8 bg-white rounded-full shadow-md transition-transform duration-300 ease-in-out ${
          isV2 ? 'transform translate-x-full' : ''
        }`}
      />
      <span
        className={`relative z-10 w-1/2 text-center text-sm font-serif font-bold transition-colors duration-300 ${
          !isV2 ? 'text-black' : 'text-white'
        } ${disabled ? 'text-gray-500 dark:text-gray-500' : ''}`}
        aria-hidden="true"
      >
        V1
      </span>
      <span
        className={`relative z-10 w-1/2 text-center text-sm font-serif font-bold transition-colors duration-300 ${
          isV2 ? 'text-black' : 'text-white'
        } ${disabled ? 'text-gray-500 dark:text-gray-500' : ''}`}
        aria-hidden="true"
      >
        V2
      </span>
    </button>
  );
};
