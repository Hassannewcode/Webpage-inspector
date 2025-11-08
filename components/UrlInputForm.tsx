import React, { useState, useEffect } from 'react';
import { DownloadIcon, LoaderIcon, ChevronRightIcon, InfoIcon, ShieldAlertIcon } from './Icons';
import { AppPhase } from '../types';

// --- Configuration for Auto Emulation ---
const emulationConfig = {
    devices: {
        desktop: { name: 'Desktop', os: ['windows', 'macos', 'linux'] },
        mobile: { name: 'Mobile', os: ['ios', 'android'] },
    },
    os: {
        windows: { name: 'Windows', browsers: ['chrome', 'firefox', 'edge'] },
        macos: { name: 'macOS', browsers: ['chrome', 'firefox', 'safari'] },
        linux: { name: 'Linux', browsers: ['chrome', 'firefox'] },
        ios: { name: 'iOS (iPhone)', browsers: ['safari'] },
        android: { name: 'Android', browsers: ['chrome'] },
    },
    browsers: {
        chrome: { name: 'Chrome' },
        firefox: { name: 'Firefox' },
        safari: { name: 'Safari' },
        edge: { name: 'Edge' },
    }
};

// --- Helper Functions for Auto Emulation ---

const generateUserAgent = (device: string, os: string, browser: string): string => {
    // Simplified User-Agent generation for demonstration
    const chromeVersion = `115.0.0.0`;
    const firefoxVersion = `115.0`;
    const safariVersion = `605.1.15`;
    const edgeVersion = `115.0.1901.188`;

    if (browser === 'chrome') {
        if (os === 'windows') return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
        if (os === 'macos') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
        if (os === 'android') return `Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
    }
    if (browser === 'firefox') {
        if (os === 'windows') return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${firefoxVersion}) Gecko/20100101 Firefox/${firefoxVersion}`;
        if (os === 'macos') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${firefoxVersion}) Gecko/20100101 Firefox/${firefoxVersion}`;
    }
    if (browser === 'safari') {
        if (os === 'macos') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/${safariVersion}`;
        if (os === 'ios') return `Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/${safariVersion} (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1`;
    }
     if (browser === 'edge') {
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 Edg/${edgeVersion}`;
    }
    // Fallback
    return navigator.userAgent;
};

const getRandomItem = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];

const generateRandomHeaders = (): Record<string, string> => {
    const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.8', 'fr-FR,fr;q=0.9', 'de-DE,de;q=0.9'];
    const referers = ['https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/', 'https://t.co/'];
    return {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': getRandomItem(languages),
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': getRandomItem(referers),
    };
};

interface UrlInputFormProps {
  url: string;
  setUrl: (url: string) => void;
  onFetch: (fetchUrl: string, options: { headers: Record<string, string>, userAgent: string }) => void;
  phase: AppPhase;
}

export const UrlInputForm: React.FC<UrlInputFormProps> = ({ url, setUrl, onFetch, phase }) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  
  // New state for advanced options
  const [emulationMode, setEmulationMode] = useState<'auto' | 'manual'>('auto');
  
  // State for Auto Emulation
  const [device, setDevice] = useState<keyof typeof emulationConfig.devices>('desktop');
  const [os, setOs] = useState<keyof typeof emulationConfig.os>('windows');
  const [browser, setBrowser] = useState<keyof typeof emulationConfig.browsers>('chrome');
  const [randomizeHeaders, setRandomizeHeaders] = useState(true);

  // State for Manual Override
  const [manualUserAgent, setManualUserAgent] = useState('');
  const [manualCookie, setManualCookie] = useState('');
  const [manualAuth, setManualAuth] = useState('');
  const [manualReferer, setManualReferer] = useState('');
  const [manualCustom, setManualCustom] = useState('');

  // Effect to keep OS and Browser consistent with Device selection
  useEffect(() => {
    const validOses = emulationConfig.devices[device].os;
    if (!validOses.includes(os)) {
      const newOs = validOses[0] as keyof typeof emulationConfig.os;
      setOs(newOs);
      const validBrowsers = emulationConfig.os[newOs].browsers;
      if (!validBrowsers.includes(browser)) {
          setBrowser(validBrowsers[0] as keyof typeof emulationConfig.browsers);
      }
    } else {
       const validBrowsers = emulationConfig.os[os].browsers;
       if (!validBrowsers.includes(browser)) {
           setBrowser(validBrowsers[0] as keyof typeof emulationConfig.browsers);
       }
    }
  }, [device, os, browser]);


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    let headersToSend: Record<string, string> = {};
    let userAgentToSend = '';
    
    if (emulationMode === 'auto') {
        userAgentToSend = generateUserAgent(device, os, browser);
        if (randomizeHeaders) {
            headersToSend = generateRandomHeaders();
        } else {
            headersToSend = { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8' };
        }
    } else { // Manual mode
        userAgentToSend = manualUserAgent || navigator.userAgent;
        if (manualCookie) headersToSend['Cookie'] = manualCookie;
        if (manualAuth) headersToSend['Authorization'] = manualAuth;
        if (manualReferer) headersToSend['Referer'] = manualReferer;
        
        // Parse and merge custom headers
        if (manualCustom) {
            manualCustom.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const key = parts.shift()!.trim();
                    const value = parts.join(':').trim();
                    if (key && value) {
                        headersToSend[key] = value;
                    }
                }
            });
        }
    }
    
    onFetch(url, { headers: headersToSend, userAgent: userAgentToSend });
  };
  
  const isLoading = phase === 'downloading' || phase === 'retrying';

  return (
    <form onSubmit={handleSubmit}>
        <div className="flex flex-col sm:flex-row gap-3 items-start">
            <div className="flex-grow w-full">
                <label htmlFor="url-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Website URL
                </label>
                <input
                  id="url-input"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g., example.com"
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow outline-none"
                  disabled={isLoading}
                  aria-label="Website URL"
                />
            </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row gap-3 items-center">
            <button
              type="submit"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed transition-colors duration-200"
              disabled={isLoading || !url}
            >
              {isLoading ? (
                <><LoaderIcon className="animate-spin -ml-1 mr-3 h-5 w-5" />Fetching...</>
              ) : (
                <><DownloadIcon className="-ml-1 mr-2 h-5 w-5" />Fetch Source</>
              )}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left">
               Use the global <strong>Engine Switcher</strong> in the header to choose between Classic (V1) or Multitasking (V2) engines.
            </p>
        </div>
      
      <div className="mt-4">
        <button type="button" onClick={() => setIsAdvancedOpen(!isAdvancedOpen)} className="flex items-center text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
             <ChevronRightIcon className={`h-4 w-4 mr-1 transition-transform ${isAdvancedOpen ? 'rotate-90' : ''}`} />
             Advanced Options: Device & Network Emulation
        </button>
        {isAdvancedOpen && (
            <div className="mt-3 p-4 bg-gray-50/80 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-700 rounded-lg space-y-6">
                
                {/* --- Mode Toggle --- */}
                <div className="flex justify-center bg-gray-200 dark:bg-gray-800 p-1 rounded-lg">
                    <button type="button" onClick={() => setEmulationMode('auto')} className={`w-1/2 py-2 text-sm font-semibold rounded-md transition-colors ${emulationMode === 'auto' ? 'bg-white dark:bg-gray-700 shadow' : 'text-gray-600 dark:text-gray-300'}`}>Auto Emulation</button>
                    <button type="button" onClick={() => setEmulationMode('manual')} className={`w-1/2 py-2 text-sm font-semibold rounded-md transition-colors ${emulationMode === 'manual' ? 'bg-white dark:bg-gray-700 shadow' : 'text-gray-600 dark:text-gray-300'}`}>Manual Override</button>
                </div>

                {/* --- Auto Emulation View --- */}
                {emulationMode === 'auto' && (
                    <div className="space-y-4 animate-fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label htmlFor="device-type" className="block text-sm font-medium mb-1">Device Type</label>
                                <select id="device-type" value={device} onChange={e => setDevice(e.target.value as any)} className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg">
                                    {Object.entries(emulationConfig.devices).map(([key, val]) => <option key={key} value={key}>{val.name}</option>)}
                                </select>
                            </div>
                             <div>
                                <label htmlFor="os-type" className="block text-sm font-medium mb-1">Operating System</label>
                                <select id="os-type" value={os} onChange={e => setOs(e.target.value as any)} className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg">
                                    {emulationConfig.devices[device].os.map(osKey => <option key={osKey} value={osKey}>{emulationConfig.os[osKey as keyof typeof emulationConfig.os].name}</option>)}
                                </select>
                            </div>
                             <div>
                                <label htmlFor="browser-type" className="block text-sm font-medium mb-1">Browser</label>
                                <select id="browser-type" value={browser} onChange={e => setBrowser(e.target.value as any)} className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg">
                                    {emulationConfig.os[os].browsers.map(browserKey => <option key={browserKey} value={browserKey}>{emulationConfig.browsers[browserKey as keyof typeof emulationConfig.browsers].name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center">
                            <input type="checkbox" id="random-headers" checked={randomizeHeaders} onChange={e => setRandomizeHeaders(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                            <label htmlFor="random-headers" className="ml-2 block text-sm">Spoof & randomize common headers (Referer, Accept-Language, etc.)</label>
                        </div>
                    </div>
                )}
                
                {/* --- Manual Override View --- */}
                {emulationMode === 'manual' && (
                    <div className="space-y-4 animate-fade-in">
                         <div className="bg-blue-50/80 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 p-3 rounded-lg border border-blue-200 dark:border-blue-700 flex items-start gap-3 text-xs">
                            <InfoIcon className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />
                            <span>
                                Use this for advanced cases like scanning a page behind a login. Open Developer Tools (F12) in another tab, go to the Network tab, right-click the page request, and copy the relevant header values.
                            </span>
                        </div>
                        <div>
                             <label htmlFor="manual-ua" className="block text-sm font-medium mb-1">User-Agent</label>
                             <input type="text" id="manual-ua" value={manualUserAgent} onChange={e => setManualUserAgent(e.target.value)} placeholder={navigator.userAgent} className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"/>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <div>
                                <label htmlFor="manual-cookie" className="block text-sm font-medium mb-1">Cookie</label>
                                <input type="text" id="manual-cookie" value={manualCookie} onChange={e => setManualCookie(e.target.value)} placeholder="session_id=...; user_token=..." className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"/>
                            </div>
                             <div>
                                <label htmlFor="manual-auth" className="block text-sm font-medium mb-1">Authorization</label>
                                <input type="text" id="manual-auth" value={manualAuth} onChange={e => setManualAuth(e.target.value)} placeholder="Bearer ey..." className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"/>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="manual-custom" className="block text-sm font-medium mb-1">Other Headers</label>
                            <textarea id="manual-custom" rows={4} value={manualCustom} onChange={e => setManualCustom(e.target.value)} placeholder={`Header-Name: Value\nAnother-Header: AnotherValue`} className="w-full p-2 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                         <div className="bg-red-50/80 dark:bg-red-900/30 text-red-800 dark:text-red-300 p-3 rounded-lg border border-red-200 dark:border-red-700 flex items-start gap-2 text-sm">
                            <ShieldAlertIcon className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
                            <div>
                                <strong>Security Warning:</strong> Headers can contain session cookies and authorization tokens. Treat them like passwords and never share them.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

       <style>{`
            .animate-fade-in {
                animation: fadeIn 0.5s ease-in-out;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `}</style>
    </form>
  );
};