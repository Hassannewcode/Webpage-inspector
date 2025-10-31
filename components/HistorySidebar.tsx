import React from 'react';
import { HistoryIcon, Trash2Icon, XIcon } from './Icons';
import { HistoryEntry } from '../types';

interface HistorySidebarProps {
  isOpen: boolean;
  history: HistoryEntry[];
  onClose: () => void;
  onLoad: (url: string) => void;
  onDelete: (url: string) => void;
  onClear: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({ isOpen, history, onClose, onLoad, onDelete, onClear }) => {
  if (!isOpen) return null;

  const handleLoad = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    onLoad(url);
    onClose();
  };

  const handleDelete = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    onDelete(url);
  };
  
  const handleClear = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (window.confirm("Are you sure you want to delete all inspection history? This action cannot be undone.")) {
          onClear();
      }
  }

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 z-40" onClick={onClose} role="dialog" aria-modal="true">
      <aside
        className="fixed top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-gray-800 shadow-xl transform transition-transform translate-x-0 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        aria-label="Inspection History"
      >
        <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800 dark:text-gray-200">
            <HistoryIcon className="h-6 w-6" />
            Inspection History
          </h2>
          <button onClick={onClose} className="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">
            <XIcon className="h-6 w-6" />
          </button>
        </header>
        <div className="flex-grow overflow-y-auto">
          {history.length === 0 ? (
            <div className="text-center p-8 text-gray-500 dark:text-gray-400">
              <p>No history yet.</p>
              <p className="text-sm">Completed inspections will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {history.map((item) => (
                <li key={item.url} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer group" onClick={(e) => handleLoad(e, item.url)}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-blue-600 dark:text-blue-400 truncate" title={item.siteName}>{item.siteName}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate" title={item.url}>{item.url}</p>
                      <p className="text-xs text-gray-400 mt-1">{new Date(item.timestamp).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, item.url)}
                      className="p-2 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      aria-label={`Delete ${item.siteName}`}
                    >
                      <Trash2Icon className="h-5 w-5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {history.length > 0 && (
          <footer className="p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
            <button onClick={handleClear} className="w-full text-center px-4 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:text-red-300 dark:bg-red-900/50 dark:hover:bg-red-900 rounded-md">
              Clear All History
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
};