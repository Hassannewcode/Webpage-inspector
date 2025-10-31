import React from 'react';
import { DownloadIcon, LoaderIcon } from './Icons';
import { AppPhase } from '../types';

interface UrlInputFormProps {
  url: string;
  setUrl: (url: string) => void;
  onFetch: (url: string) => void;
  phase: AppPhase;
}

export const UrlInputForm: React.FC<UrlInputFormProps> = ({ url, setUrl, onFetch, phase }) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onFetch(url);
  };

  const isLoading = phase === 'downloading' || phase === 'retrying';

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="url-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Website URL
      </label>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          id="url-input"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="e.g., example.com"
          className="flex-grow w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow outline-none"
          disabled={isLoading}
          aria-label="Website URL"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center px-6 py-3 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed transition-colors duration-200"
          disabled={isLoading || !url}
        >
          {isLoading ? (
            <><LoaderIcon className="animate-spin -ml-1 mr-3 h-5 w-5" />Fetching...</>
          ) : (
            <><DownloadIcon className="-ml-1 mr-2 h-5 w-5" />Fetch Source</>
          )}
        </button>
      </div>
    </form>
  );
};