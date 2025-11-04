import React, { useState, useCallback, useRef, useEffect } from 'react';
import { UrlInputForm } from './components/UrlInputForm';
import { Disclaimer } from './components/Disclaimer';
import { Loader } from './components/Loader';
import { fetchWebsiteSource, downloadZipFile, retryFailedDownloads } from './services/downloader';
import { InspectorView } from './components/InspectorView';
import { AlertTriangleIcon, RefreshCwIcon, CodeIcon, HistoryIcon } from './components/Icons';
import { AppPhase, NetworkLogEntry, HistoryEntry } from './types';
import { HistorySidebar } from './components/HistorySidebar';
import { getKV, setKV, getSession, setSession, deleteSession as idbDeleteSession, clearAll as idbClearAll } from './utils/idb';
import { ThemeSwitcher } from './components/ThemeSwitcher';


declare const JSZip: any;

const formatEtr = (ms: number): string => {
  if (ms < 5000) return 'Just a moment...';
  if (ms < 30000) return 'Less than 30 seconds remaining...';
  if (ms < 60000) return 'Less than a minute remaining...';
  const minutes = Math.floor(ms / 60000);
  return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining...`;
};

type Theme = 'light' | 'dark';

const App: React.FC = () => {
  const [url, setUrl] = useState<string>('');
  const [phase, setPhase] = useState<AppPhase>('initial');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [etr, setEtr] = useState<string>('');
  const [warnings, setWarnings] = useState<{url: string; message: string}[]>([]);
  const [scanResult, setScanResult] = useState<{ zip: any; networkLog: NetworkLogEntry[]; internalLinks: string[] } | null>(null);
  const [failedDownloads, setFailedDownloads] = useState<string[]>([]);
  const [siteName, setSiteName] = useState<string>('');
  const downloadStartTimeRef = useRef<number | null>(null);
  const avgTimeRef = useRef(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  // --- Theme Management ---
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };


  // --- Session Management ---

  const loadSession = useCallback(async (sessionUrl: string, sessionData?: any) => {
    try {
      let dataToLoad = sessionData;
      if (!dataToLoad) {
        dataToLoad = await getSession(sessionUrl);
      }

      if (!dataToLoad) {
        throw new Error("Session data not found in database.");
      }

      setPhase('viewing'); // Show loading in viewing state
      setProgressMessage('Loading session from history...');

      const zip = new JSZip();
      // Load from Blob instead of Base64
      await zip.loadAsync(dataToLoad.scanResult.zipAsBlob);
      
      setUrl(sessionUrl);
      setPhase(dataToLoad.phase);
      setSiteName(dataToLoad.siteName);
      setScanResult({ zip, networkLog: dataToLoad.scanResult.networkLog, internalLinks: dataToLoad.scanResult.internalLinks || [] });
      setFailedDownloads(dataToLoad.failedDownloads);
      setWarnings(dataToLoad.warnings);
      setRetryAttempt(dataToLoad.retryAttempt);
      setError(null);
      setSaveError(null);
      setProgressMessage('');
      
      // Update last active URL in IndexedDB
      await setKV('lastActiveUrl', sessionUrl);

    } catch (e) {
      console.error("Failed to load session:", e);
      setError("Could not load the saved session. It might be corrupted or in an old format.");
      await handleReset(true); // Reset to initial state
    }
  }, []);

  const deleteSession = useCallback(async (urlToDelete: string) => {
    await idbDeleteSession(urlToDelete);
    const oldHistory = await getKV<HistoryEntry[]>('history') || [];
    const newHistory = oldHistory.filter((h) => h.url !== urlToDelete);
    await setKV('history', newHistory);
    
    const lastActive = await getKV<string>('lastActiveUrl');
    if (lastActive === urlToDelete) {
        await setKV('lastActiveUrl', null);
        await handleReset(true);
    }
    setHistory(newHistory);
  }, []);

  const clearHistory = useCallback(async () => {
    await idbClearAll();
    setHistory([]);
    await handleReset(true);
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const historyData = await getKV<HistoryEntry[]>('history') || [];
        const urlToLoad = await getKV<string>('lastActiveUrl');
        setHistory(historyData);
        if (urlToLoad) {
          const sessionData = await getSession(urlToLoad);
          if (sessionData) {
            await loadSession(urlToLoad, sessionData);
          }
        }
      } catch (e) {
        console.error("Error loading initial data from IndexedDB, clearing storage.", e);
        await idbClearAll();
      } finally {
        setIsLoaded(true);
      }
    };
    loadInitialData();
  }, [loadSession]);

  useEffect(() => {
    if (!isLoaded || phase === 'downloading' || phase === 'retrying' || !scanResult) {
      return;
    }

    const attemptSaveWithCleanup = async (sessionDataToSave: any) => {
        const MAX_CLEANUP_ATTEMPTS = 5; // Prevent infinite loops

        for (let attempt = 0; attempt < MAX_CLEANUP_ATTEMPTS; attempt++) {
            try {
                const newHistoryEntry = { url, siteName, timestamp: sessionDataToSave.timestamp };
                
                const otherHistory = (await getKV<HistoryEntry[]>('history') || []).filter((h: HistoryEntry) => h.url !== url);
                const newHistory = [newHistoryEntry, ...otherHistory].sort((a, b) => b.timestamp - a.timestamp);

                await setSession(sessionDataToSave);
                await setKV('history', newHistory);
                await setKV('lastActiveUrl', url);

                setHistory(newHistory);
                return; // Success!

            } catch (e: any) {
                // Check for Quota Exceeded error
                if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                    console.warn(`IndexedDB quota exceeded. Attempting to clear oldest session (Attempt ${attempt + 1}).`);
                    
                    const historyToClean = await getKV<HistoryEntry[]>('history') || [];
                    const prunableHistory = historyToClean.filter((h) => h.url !== url);

                    if (prunableHistory.length === 0) {
                        // There are no *other* sessions to delete. The current one is just too big.
                        throw new Error("The website source is too large to save, and no older sessions can be cleared to make space.");
                    }

                    // Sort to find the oldest entry (ascending by timestamp)
                    const sortedPrunableHistory = prunableHistory.sort((a, b) => a.timestamp - b.timestamp);
                    const oldestSession = sortedPrunableHistory.shift();
                    
                    if (oldestSession) {
                        console.log(`Pruning session: ${oldestSession.url}`);
                        await idbDeleteSession(oldestSession.url);
                        const newHistoryAfterPrune = historyToClean.filter((h) => h.url !== oldestSession.url);
                        await setKV('history', newHistoryAfterPrune);
                    } else {
                        throw new Error("Failed to identify an old session to prune.");
                    }
                } else {
                    throw e;
                }
            }
        }
        
        throw new Error(`Failed to save session after ${MAX_CLEANUP_ATTEMPTS} cleanup attempts. The current website's source might be too large.`);
    };

    const saveData = async () => {
      try {
        // Generate a Blob instead of Base64: more efficient for IndexedDB
        const zipAsBlob = await scanResult.zip.generateAsync({ type: 'blob' });
        const sessionData = {
          url,
          phase,
          siteName,
          scanResult: { zipAsBlob, networkLog: scanResult.networkLog, internalLinks: scanResult.internalLinks },
          failedDownloads,
          warnings,
          retryAttempt,
          timestamp: Date.now(),
        };
        await attemptSaveWithCleanup(sessionData);
        setSaveError(null); // Clear any previous save errors on success
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("Failed to save session:", e);
        setSaveError(errorMessage);
      }
    };

    saveData();
  }, [phase, scanResult, siteName, failedDownloads, warnings, retryAttempt, url, isLoaded]);


  const handleReset = async (fullReset = false) => {
    setUrl('');
    setPhase('initial');
    setError(null);
    setSaveError(null);
    setProgressMessage('');
    setEtr('');
    setWarnings([]);
    setScanResult(null);
    setFailedDownloads([]);
    setSiteName('');
    setRetryAttempt(0);
    downloadStartTimeRef.current = null;
    avgTimeRef.current = 0; // Reset ETR smoother
    if (fullReset) {
      await setKV('lastActiveUrl', null);
    }
  };

  const handleProgressUpdate = useCallback((progress: { message: string; downloaded: number; total: number }) => {
    const progressText = progress.total > 0
      ? `[${progress.downloaded}/${progress.total}] ${progress.message}`
      : progress.message;
    setProgressMessage(progressText);

    // Start calculating ETR after a few downloads for accuracy, and use smoothing.
    if (progress.downloaded > 5 && progress.total > 0 && downloadStartTimeRef.current) {
        const now = Date.now();
        const elapsedTime = now - downloadStartTimeRef.current;
        const currentAvgTimePerResource = elapsedTime / progress.downloaded;

        // Use Exponential Moving Average for smoothing to prevent wild ETR jumps.
        const SMOOTHING_FACTOR = 0.1;
        avgTimeRef.current = avgTimeRef.current === 0
            ? currentAvgTimePerResource
            : (currentAvgTimePerResource * SMOOTHING_FACTOR) + (avgTimeRef.current * (1 - SMOOTHING_FACTOR));
        
        const smoothedAvgTime = avgTimeRef.current;
        const estimatedTotalTime = smoothedAvgTime * progress.total;
        const remainingTime = estimatedTotalTime - elapsedTime;
      
        if (remainingTime > 1000) {
            setEtr(formatEtr(remainingTime));
        } else if (progress.downloaded < progress.total) {
            setEtr('Finishing up...');
        } else {
            setEtr('');
        }
    } else if (progress.total > 0) {
        // Don't show "Calculating..." which can be frustrating.
        // The main progress message is sufficient until ETR is ready.
        setEtr('');
    }
  }, []);
  
  const handleAddWarning = useCallback((warning: {url: string; message: string}) => {
    setWarnings(prev => [...prev, warning]);
  }, []);

  const handleFetch = useCallback(async (fetchUrl: string, options: { headers: Record<string, string>, userAgent: string }, engine: 'v1' | 'v2') => {
    if (!fetchUrl) {
      setError('Please enter a valid URL.');
      setPhase('error');
      return;
    }
    await handleReset();
    setUrl(fetchUrl);
    avgTimeRef.current = 0; // Ensure ETR smoother is reset

    setPhase('downloading');
    downloadStartTimeRef.current = Date.now();
    setProgressMessage('Initializing...');

    try {
      const fullUrl = fetchUrl.startsWith('http') ? fetchUrl : `https://${fetchUrl}`;
      const urlObject = new URL(fullUrl);
      const name = urlObject.hostname;
      setSiteName(name);

      const { zip, networkLog, failedUrls, internalLinks } = await fetchWebsiteSource(fullUrl, options, handleProgressUpdate, handleAddWarning, engine);
      setScanResult({ zip, networkLog, internalLinks });
      
      if (failedUrls.length > 0) {
          setFailedDownloads(failedUrls);
          setPhase('post-download-prompt');
      } else {
          setPhase('viewing');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to fetch website source. ${errorMessage}`);
      setPhase('error');
      console.error(err);
    } finally {
        downloadStartTimeRef.current = null;
        setEtr('');
    }
  }, [handleProgressUpdate, handleAddWarning]);
  
  const handleSkipRetry = () => {
    setPhase('viewing');
  };

  const handleRetry = async () => {
    if (!scanResult || failedDownloads.length === 0) return;

    setPhase('retrying');
    setRetryAttempt(prev => prev + 1);
    setEtr('');
    setProgressMessage('Starting forceful retry...');

    try {
        const { zip, networkLog, stillFailedUrls } = await retryFailedDownloads(
            failedDownloads,
            scanResult.zip,
            scanResult.networkLog,
            (progress) => {
                 const progressText = progress.total > 0
                    ? `[${progress.downloaded}/${progress.total}] ${progress.message}`
                    : progress.message;
                setProgressMessage(progressText);
            }
        );
        setScanResult({ zip, networkLog, internalLinks: scanResult.internalLinks });

        if (stillFailedUrls.length > 0) {
            setFailedDownloads(stillFailedUrls);
            setPhase('post-download-prompt'); 
        } else {
            setFailedDownloads([]);
            setPhase('viewing'); 
        }
    } catch (err) {
        console.error("Retry failed:", err);
        setError("An error occurred during the retry process. Continuing with available files.");
        setPhase('viewing'); 
    }
  };

  const handleDownload = useCallback(async () => {
    if (!scanResult?.zip || !siteName) return;
    const sanitizedSiteName = siteName.replace(/\./g, '_');
    await downloadZipFile(scanResult.zip, sanitizedSiteName);
  }, [scanResult, siteName]);

  const isLoading = phase === 'downloading' || phase === 'retrying';

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center dark:bg-gray-900">
        <Loader />
        <p className="mt-4 text-gray-500 dark:text-gray-400">Loading application...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-gray-800 dark:text-gray-200 font-sans">
      <div className="w-full max-w-6xl">
        <header className="text-center mb-8 relative">
          <div className="inline-flex items-center gap-3 mb-2">
            <span className="bg-white/50 dark:bg-gray-900/50 p-2 rounded-lg backdrop-blur-sm">
              <CodeIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </span>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white" style={{textShadow: '1px 1px 3px rgba(0,0,0,0.2)'}}>Website Source Inspector</h1>
          </div>
          <div className="absolute top-0 right-0 flex items-center gap-2">
             <ThemeSwitcher theme={theme} onToggle={toggleTheme} />
             <button
                onClick={() => setIsHistoryOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 rounded-lg hover:bg-white/80 dark:hover:bg-gray-700/80 backdrop-blur-sm"
                aria-label="Open inspection history"
            >
                <HistoryIcon className="h-5 w-5" />
                History
            </button>
          </div>
          <p className="text-lg text-gray-700 dark:text-gray-300" style={{textShadow: '1px 1px 2px rgba(0,0,0,0.1)'}}>
            Fetch a website's static source, then use AI to analyze its architecture, security, and secrets.
          </p>
        </header>

        <main className="bg-transparent p-0">
          {phase === 'viewing' && scanResult ? (
            <InspectorView
              result={scanResult}
              siteName={siteName}
              onDownload={handleDownload}
              onReset={() => handleReset(true)}
              saveError={saveError}
            />
          ) : (
             <div className="bg-white/70 dark:bg-slate-800 backdrop-blur-lg p-4 sm:p-8 rounded-xl shadow-2xl border border-white/30 dark:border-slate-700/50">
              <UrlInputForm
                url={url}
                setUrl={setUrl}
                onFetch={handleFetch}
                phase={phase}
              />

              {isLoading && (
                <div className="mt-6 text-center">
                  <Loader />
                  <p 
                    className="text-blue-600 dark:text-blue-300 animate-pulse font-medium"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {progressMessage}
                  </p>
                  {etr && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {etr}
                    </p>
                  )}
                </div>
              )}

              {isLoading && warnings.length > 0 && (
                  <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-yellow-200 dark:border-yellow-700 bg-yellow-50/80 dark:bg-yellow-900/30 p-3 text-left shadow-inner">
                      <h4 className="flex items-center gap-2 font-semibold text-yellow-800 dark:text-yellow-300 mb-2">
                          <AlertTriangleIcon className="h-5 w-5 flex-shrink-0" />
                          Download Warnings
                      </h4>
                      <ul className="space-y-2 pl-1">
                          {warnings.map((warn, index) => (
                              <li key={index} className="text-sm text-yellow-900 dark:text-yellow-300">
                                  <p className="font-semibold break-all">
                                      Skipped: <code className="font-mono bg-yellow-100 dark:bg-yellow-800/50 p-1 rounded-md text-xs">{warn.url}</code>
                                  </p>
                                  <p className="text-xs text-yellow-700 dark:text-yellow-500 pl-2">
                                      <strong>Reason:</strong> {warn.message}
                                  </p>
                              </li>
                          ))}
                      </ul>
                  </div>
              )}

              {error && (
                <div 
                  className="mt-6 bg-red-50/80 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-lg border border-red-200 dark:border-red-600"
                  role="alert"
                >
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                          <AlertTriangleIcon className="h-6 w-6 flex-shrink-0" />
                          <div>
                            <h3 className="font-semibold">An Error Occurred</h3>
                            <p className="text-sm">{error}</p>
                          </div>
                      </div>
                      <button
                          onClick={() => handleReset(true)}
                          className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-800/50 rounded-md hover:bg-red-200 dark:hover:bg-red-800/80 transition-colors flex-shrink-0"
                      >
                          <RefreshCwIcon className="mr-2 h-4 w-4" />
                          Try Again
                      </button>
                  </div>
                </div>
              )}

              {(phase === 'initial' || phase === 'error') && (
                <div className="mt-8">
                  <Disclaimer />
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="mt-8 text-center text-sm text-gray-700 dark:text-gray-300" style={{textShadow: '1px 1px 2px rgba(0,0,0,0.1)'}}>
          <p>Analyze any website's static front-end assets with the power of AI.</p>
        </footer>
      </div>

       {phase === 'post-download-prompt' && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="retry-modal-title">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full transform transition-all">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 dark:bg-yellow-900/50 sm:mx-0 sm:h-10 sm:w-10">
                            <AlertTriangleIcon className="h-6 w-6 text-yellow-600 dark:text-yellow-400" aria-hidden="true" />
                        </div>
                        <div className="mt-0 text-left flex-grow">
                            <h3 className="text-lg leading-6 font-bold text-gray-900 dark:text-white" id="retry-modal-title">
                                {retryAttempt === 0 ? 'Incomplete Download' : 'Retry Unsuccessful'}
                            </h3>
                            <div className="mt-2">
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                     {retryAttempt === 0
                                        ? `${failedDownloads.length} asset(s) failed to download, possibly due to network restrictions (CORS). You can proceed, or attempt a Force Retry. This enhanced process uses multiple proxies and even employs AI to find public CDN alternatives for common libraries.`
                                        : `Still unable to fetch ${failedDownloads.length} asset(s). This may be due to strict server security. You can try another Force Retry or continue without them.`
                                    }
                                </p>
                                <div className="mt-3 max-h-32 overflow-y-auto rounded-md bg-gray-50 dark:bg-gray-700/50 p-2 border border-gray-200 dark:border-gray-700">
                                    <ul className="text-xs font-mono text-gray-600 dark:text-gray-400 space-y-1">
                                        {failedDownloads.map((file, i) => <li key={i} className="truncate" title={file}>{file}</li>)}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                    <button
                        type="button"
                        className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                        onClick={handleRetry}
                    >
                        <RefreshCwIcon className="-ml-1 mr-2 h-5 w-5"/>
                        Force Retry
                    </button>
                    <button
                        type="button"
                        className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-700 text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 sm:mt-0 sm:w-auto sm:text-sm"
                        onClick={handleSkipRetry}
                    >
                        Continue without them
                    </button>
                </div>
            </div>
        </div>
    )}
     <HistorySidebar
        isOpen={isHistoryOpen}
        history={history}
        onClose={() => setIsHistoryOpen(false)}
        onLoad={loadSession}
        onDelete={deleteSession}
        onClear={clearHistory}
      />
    </div>
  );
};

export default App;