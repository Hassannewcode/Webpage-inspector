import { NetworkLogEntry } from '../types';
import { findAllResources, findInternalLinksInHtml } from './assetDiscovery';
import { findCdnUrl } from './aiService';

declare const JSZip: any;

// A simple in-memory cache to avoid re-downloading the same URL within a session
const fetchCache = new Map<string, Promise<Response>>();

// List of CORS proxies to try for difficult assets
const PROXIES = [
    'https://api.allorigins.win/raw?url=',      // Primary
    'https://corsproxy.io/?',                   // Secondary
    'https://api.codetabs.com/v1/proxy?quest=', // Added
    'https://corsproxy.org/?',                  // Added
    'https://thingproxy.freeboard.io/fetch/',   // Tertiary
    'https://cors.eu.org/',
    'https://cors-anywhere.herokuapp.com/',
];

/**
 * Wraps the fetch call with a proxy and handles rotating through the proxy list on failure.
 * @param url The URL to fetch.
 * @param options The fetch options including custom headers.
 * @param proxyIndex The current index in the PROXIES array.
 * @returns A promise that resolves with the Response object.
 */
async function fetchWithProxy(url: string, options: RequestInit, proxyIndex = 0): Promise<Response> {
    if (proxyIndex >= PROXIES.length) {
        throw new Error('All proxies failed.');
    }
    const proxy = PROXIES[proxyIndex];
    // A simple way to handle different proxy URL structures
    const proxiedUrl = proxy.endsWith('=') ? proxy + encodeURIComponent(url) :
                       proxy.endsWith('?') ? proxy + encodeURIComponent(url) :
                       proxy + url;
    
    try {
        // Note: some proxies may not forward all headers. allorigins.win is known to strip some.
        const response = await fetch(proxiedUrl, options);
        if (!response.ok) {
            // If this proxy gives a specific error (like 404, 500), try the next one.
            console.warn(`Proxy ${proxy} returned status ${response.status}. Trying next...`);
            return fetchWithProxy(url, options, proxyIndex + 1);
        }
        return response;
    } catch (err) {
        console.warn(`Proxy ${proxy} failed to connect for ${url}. Trying next...`);
        return fetchWithProxy(url, options, proxyIndex + 1);
    }
}


/**
 * Fetches a URL, using a cache to avoid redundant requests.
 * All requests are sent via a proxy to bypass browser CORS restrictions.
 * @param url The URL to fetch.
 * @param options The fetch options including custom headers.
 * @param forceFresh If true, bypasses the cache and re-fetches the resource.
 */
async function cachedFetch(url: string, options: RequestInit, forceFresh = false): Promise<Response> {
    if (fetchCache.has(url) && !forceFresh) {
        return (await fetchCache.get(url)!).clone();
    }

    const requestPromise = fetchWithProxy(url, options);
    
    fetchCache.set(url, requestPromise);
    
    try {
        const response = await requestPromise;
        return response.clone();
    } catch(e) {
        fetchCache.delete(url);
        throw e;
    }
}

// --- V2 Worker-based Downloader ---

// The code for our web worker is defined here as a string.
// This allows us to create it on-the-fly without needing a separate file.
const workerCode = `
    const PROXIES = [
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?',
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://corsproxy.org/?',
        'https://thingproxy.freeboard.io/fetch/',
        'https://cors.eu.org/',
        'https://cors-anywhere.herokuapp.com/',
    ];

    async function fetchWithProxy(url, options, proxyIndex = 0) {
        if (proxyIndex >= PROXIES.length) {
            throw new Error('All proxies failed for ' + url);
        }
        const proxy = PROXIES[proxyIndex];
        const proxiedUrl = proxy.endsWith('=') ? proxy + encodeURIComponent(url) :
                           proxy.endsWith('?') ? proxy + encodeURIComponent(url) :
                           proxy + url;

        try {
            const response = await fetch(proxiedUrl, options);
            // For server errors (5xx), it's a proxy issue, so try the next one.
            if (response.status >= 500 && response.status < 600) {
                console.warn(\`Proxy \${proxy} returned status \${response.status}. Trying next...\`);
                return fetchWithProxy(url, options, proxyIndex + 1);
            }
            // For client errors (4xx) or success, the proxy worked. Return the response.
            return response;
        } catch (err) {
            console.warn(\`Proxy \${proxy} failed to connect for \${url}. Trying next...\`);
            return fetchWithProxy(url, options, proxyIndex + 1);
        }
    }

    self.onmessage = async (event) => {
        const { url, options } = event.data;
        try {
            const response = await fetchWithProxy(url, options);
            const blob = await response.blob();
            const contentType = response.headers.get('content-type') || 'application/octet-stream';

            self.postMessage({
                status: 'success',
                url: url,
                blob: blob,
                contentType: contentType,
                httpStatus: response.status,
                statusText: response.statusText,
            });
        } catch (error) {
            self.postMessage({
                status: 'error',
                url: url,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    };
`;

const runWorkerDownload = (
    url: string,
    options: { headers: Record<string, string>, userAgent: string },
    onProgress: (progress: { message: string; downloaded: number; total: number }) => void,
    onWarning: (warning: { url: string; message: string }) => void
): Promise<{ zip: any; networkLog: NetworkLogEntry[]; failedUrls: string[]; internalLinks: string[] }> => {
    return new Promise(async (resolve, reject) => {
        const CONCURRENCY = navigator.hardwareConcurrency || 4;
        const zip = new JSZip();
        const networkLog: NetworkLogEntry[] = [];
        const failedUrls: string[] = [];
        const internalLinks = new Set<string>();

        const downloadQueue: { url: string, initiator: string }[] = [];
        const processedUrls = new Set<string>();
        let downloadedCount = 0;
        let activeWorkers = 0;
        const originalUrl = url;

        const workers: Worker[] = [];
        const idleWorkers: Worker[] = [];

        const fetchOptions: RequestInit = { headers: { ...options.headers } };
        if (options.userAgent) {
            (fetchOptions.headers as Record<string, string>)['User-Agent'] = options.userAgent;
        }

        const cleanup = () => {
            workers.forEach(w => w.terminate());
        };

        const checkCompletion = () => {
            if (downloadQueue.length === 0 && activeWorkers === 0) {
                onProgress({ message: 'Finalizing ZIP file...', downloaded: downloadedCount, total: processedUrls.size });
                cleanup();
                resolve({ zip, networkLog, failedUrls, internalLinks: Array.from(internalLinks) });
            }
        };

        const assignWork = (worker: Worker) => {
            if (downloadQueue.length > 0) {
                const { url, initiator } = downloadQueue.shift()!;
                activeWorkers++;
                worker.postMessage({ url, options: fetchOptions, initiator });
            } else {
                idleWorkers.push(worker);
                checkCompletion();
            }
        };

        const handleWorkerMessage = async (event: MessageEvent) => {
            const worker = event.target as Worker;
            const data = event.data;
            const logEntry = networkLog.find(entry => entry.url === data.url);
            const initiator = logEntry ? logEntry.initiator : 'Unknown';

            activeWorkers--;

            if (data.status === 'success') {
                const { url, blob, contentType, httpStatus, statusText } = data;
                
                // Update network log entry
                if (logEntry) {
                   Object.assign(logEntry, { status: httpStatus, statusText, contentType, size: blob.size, isError: httpStatus >= 400 });
                }

                if (httpStatus < 400) {
                    const relativePath = new URL(url).pathname.substring(1) || 'index.html';
                    zip.file(relativePath, blob);

                    if (contentType.includes('text') || contentType.includes('javascript') || contentType.includes('json')) {
                        try {
                            const textContent = await blob.text();
                            const newResources = await findAllResources(contentType, textContent, url);
                            newResources.forEach(res => {
                                if (!processedUrls.has(res)) {
                                    processedUrls.add(res);
                                    downloadQueue.push({ url: res, initiator: url });
                                    networkLog.push({ url: res, initiator: url, status: 0, statusText: 'Queued', contentType: 'unknown', size: 0, isError: false });
                                    if(idleWorkers.length > 0) {
                                      const idleWorker = idleWorkers.shift()!;
                                      assignWork(idleWorker);
                                    }
                                }
                            });
                        } catch (e) {
                           console.warn(`Could not parse text content from ${url}`, e);
                        }
                    }
                    downloadedCount++;
                    onProgress({ message: `Downloaded: ${url.split('/').pop()}`, downloaded: downloadedCount, total: processedUrls.size });
                } else {
                    failedUrls.push(url);
                    onWarning({ url, message: `Download failed with status: ${httpStatus}`});
                }

            } else { // Handle worker error
                const { url, error } = data;
                failedUrls.push(url);
                if (logEntry) {
                    Object.assign(logEntry, { status: 0, statusText: 'Worker Error', isError: true });
                }
                onWarning({ url, message: `Download failed. ${error}` });
            }

            assignWork(worker);
        };
        
        try {
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            for (let i = 0; i < CONCURRENCY; i++) {
                const worker = new Worker(workerUrl);
                worker.onmessage = handleWorkerMessage;
                worker.onerror = (e) => console.error("A fatal worker error occurred:", e);
                workers.push(worker);
                idleWorkers.push(worker);
            }
            URL.revokeObjectURL(workerUrl);

            onProgress({ message: `Fetching main page: ${url}`, downloaded: 0, total: 1 });
            processedUrls.add(url);
            const initialResponse = await cachedFetch(url, fetchOptions, true);
            const contentType = initialResponse.headers.get('content-type') || 'text/html';
            const initialBlob = await initialResponse.blob();
            
            networkLog.push({ url, status: initialResponse.status, statusText: initialResponse.statusText, contentType, initiator: 'Initial Request', size: initialBlob.size, isError: !initialResponse.ok });
            
            if (!initialResponse.ok) {
                throw new Error(`Failed to fetch main page: ${initialResponse.statusText}`);
            }

            const relativePath = new URL(url).pathname.substring(1) || 'index.html';
            zip.file(relativePath, initialBlob);
            downloadedCount++;

            const textContent = await initialBlob.text();
            const initialResources = await findAllResources(contentType, textContent, url);
            initialResources.forEach(res => {
                if (!processedUrls.has(res)) {
                    processedUrls.add(res);
                    downloadQueue.push({ url: res, initiator: url });
                     networkLog.push({ url: res, initiator: url, status: 0, statusText: 'Queued', contentType: 'unknown', size: 0, isError: false });
                }
            });
            const pageLinks = findInternalLinksInHtml(textContent, url);
            pageLinks.forEach(link => internalLinks.add(link));

            onProgress({ message: 'Starting asset download...', downloaded: downloadedCount, total: processedUrls.size });
            workers.forEach(assignWork);

        } catch (error) {
            cleanup();
            reject(error);
        }
    });
};


export const fetchWebsiteSource = async (
    url: string,
    options: { headers: Record<string, string>, userAgent: string },
    onProgress: (progress: { message: string; downloaded: number; total: number }) => void,
    onWarning: (warning: { url: string; message: string }) => void,
    engine: 'v1' | 'v2' = 'v1'
): Promise<{ zip: any; networkLog: NetworkLogEntry[]; failedUrls: string[]; internalLinks: string[] }> => {
    
    fetchCache.clear();

    if (engine === 'v2') {
        return runWorkerDownload(url, options, onProgress, onWarning);
    }

    // --- V1 Engine: Classic Sequential Downloader ---
    const zip = new JSZip();
    const networkLog: NetworkLogEntry[] = [];
    const failedUrls: string[] = [];
    const internalLinks = new Set<string>();
    
    const downloadQueue: { url: string, initiator: string }[] = [{ url, initiator: 'Initial Request' }];
    const processedUrls = new Set<string>([url]);

    let downloadedCount = 0;
    
    const fetchOptions: RequestInit = {
        headers: { ...options.headers },
    };
    if (options.userAgent) {
        (fetchOptions.headers as Record<string,string>)['User-Agent'] = options.userAgent;
    }

    while (downloadQueue.length > 0) {
        const { url: currentUrl, initiator } = downloadQueue.shift()!;

        onProgress({ message: `Downloading: ${currentUrl}`, downloaded: downloadedCount, total: processedUrls.size });

        try {
            const response = await cachedFetch(currentUrl, fetchOptions);
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            
            const content = await response.blob();
            const size = content.size;

            networkLog.push({
                url: currentUrl,
                status: response.status,
                statusText: response.statusText,
                contentType: contentType,
                initiator,
                size,
                isError: !response.ok
            });

            if (!response.ok) {
                 throw new Error(`HTTP error! status: ${response.status}`);
            }

            const relativePath = new URL(currentUrl).pathname.substring(1) || 'index.html';
            zip.file(relativePath, content);

            if (contentType.includes('text') || contentType.includes('javascript') || contentType.includes('json')) {
                const textContent = await content.text();
                const newResources = await findAllResources(contentType, textContent, currentUrl);
                newResources.forEach(res => {
                    if (!processedUrls.has(res)) {
                        processedUrls.add(res);
                        downloadQueue.push({ url: res, initiator: currentUrl });
                    }
                });
                
                if (currentUrl === url && contentType.includes('html')) {
                    const pageLinks = findInternalLinksInHtml(textContent, currentUrl);
                    pageLinks.forEach(link => internalLinks.add(link));
                }
            }
             downloadedCount++;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Failed to download ${currentUrl}:`, error);
            failedUrls.push(currentUrl);
            networkLog.push({
                url: currentUrl,
                status: 0,
                statusText: 'Download Failed',
                contentType: 'unknown',
                initiator,
                size: 0,
                isError: true
            });
            onWarning({ url: currentUrl, message: `Download failed. ${errorMessage}` });
        }
        onProgress({ message: `Processing...`, downloaded: downloadedCount, total: processedUrls.size });
    }
    
    onProgress({ message: 'Finalizing ZIP file...', downloaded: downloadedCount, total: processedUrls.size });
    return { zip, networkLog, failedUrls, internalLinks: Array.from(internalLinks) };
};


export const retryFailedDownloads = async (
    failedUrls: string[],
    zip: any,
    networkLog: NetworkLogEntry[],
    onProgress: (progress: { message:string; downloaded: number; total: number }) => void
): Promise<{ zip: any; networkLog: NetworkLogEntry[]; stillFailedUrls: string[] }> => {
    const stillFailedUrls: string[] = [];
    let downloadedCount = 0;

    for (const url of failedUrls) {
        let success = false;
        let lastError: Error | null = null;
        onProgress({ message: `Force retrying: ${url}`, downloaded: downloadedCount, total: failedUrls.length });
        
        try {
            // Attempt 1: Re-fetch with proxies
            const response = await cachedFetch(url, {}, true); // forceFresh = true to retry
            if (!response.ok) throw new Error(`Retry failed with status: ${response.status}`);
            
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const content = await response.blob();
            const size = content.size;

            const logIndex = networkLog.findIndex(entry => entry.url === url);
            if (logIndex > -1) {
                networkLog[logIndex] = { 
                    ...networkLog[logIndex],
                    status: response.status, 
                    statusText: `${response.statusText} (Retried)`, 
                    contentType,
                    size,
                    isError: false,
                };
            }

            const relativePath = new URL(url).pathname.substring(1) || new URL(url).hostname + '.html';
            zip.file(relativePath, content);
            
            success = true;
            downloadedCount++;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            // Attempt 2: If proxy fetch fails, try AI CDN finder for common libs
            console.warn(`Proxy retry failed for ${url}. Attempting AI CDN lookup.`);
            onProgress({ message: `AI lookup for: ${url.split('/').pop()}`, downloaded: downloadedCount, total: failedUrls.length });
            
            const isCommonLib = /\.(js|css)$/i.test(url) && !url.includes('data:');
            
            if (isCommonLib) {
                try {
                    const cdnUrl = await findCdnUrl(url);
                    if (cdnUrl) {
                        onProgress({ message: `Found CDN: ${cdnUrl}`, downloaded: downloadedCount, total: failedUrls.length });
                        // Fetch from CDN URL directly (no proxy needed)
                        const cdnResponse = await fetch(cdnUrl);
                        if (!cdnResponse.ok) throw new Error(`CDN fetch failed with status: ${cdnResponse.status}`);
                        
                        const contentType = cdnResponse.headers.get('content-type') || 'application/octet-stream';
                        const content = await cdnResponse.blob();
                        const size = content.size;

                        const logIndex = networkLog.findIndex(entry => entry.url === url);
                        if (logIndex > -1) {
                            networkLog[logIndex] = {
                                ...networkLog[logIndex], 
                                status: cdnResponse.status, 
                                statusText: `${cdnResponse.statusText} (via AI CDN)`, 
                                contentType,
                                size,
                                isError: false,
                            };
                        }

                        const relativePath = new URL(url).pathname.substring(1) || new URL(url).hostname + '.html';
                        zip.file(relativePath, content);

                        success = true;
                        downloadedCount++;
                    }
                } catch (aiError) {
                     console.error(`AI CDN lookup/fetch failed for ${url}:`, aiError);
                     lastError = aiError instanceof Error ? aiError : new Error(String(aiError));
                }
            }
        }

        if (!success) {
            stillFailedUrls.push(url);
            const logIndex = networkLog.findIndex(entry => entry.url === url);
            if (logIndex > -1) {
                 networkLog[logIndex].statusText += ` | Retry failed: ${lastError ? lastError.message : 'Unknown'}`;
            }
        }
    }
    
    onProgress({ message: `Retry complete.`, downloaded: downloadedCount, total: failedUrls.length });
    return { zip, networkLog, stillFailedUrls };
};

/**
 * Converts a Blob object to a Base64 Data URI.
 * @param blob The blob to convert.
 * @returns A promise that resolves with the Data URI string.
 */
async function blobToDataURI(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Attempts to re-download failed assets, convert them to Data URIs, and patch the source files.
 * This version uses a two-step fallback: direct fetch via proxy, then AI CDN lookup for JS/CSS.
 */
export const retryFailedDownloadsAsDataURI = async (
    failedUrls: string[],
    zip: any,
    networkLog: NetworkLogEntry[],
    onProgress: (progress: { message: string; downloaded: number; total: number }) => void
): Promise<{ zip: any; networkLog: NetworkLogEntry[]; stillFailedUrls: string[] }> => {
    const stillFailedUrls: string[] = [];
    let downloadedCount = 0;
    const total = failedUrls.length;

    const initiatorsToPatch: Map<string, { failedUrl: string, dataUri: string }[]> = new Map();

    for (const url of failedUrls) {
        onProgress({ message: `Resolving: ${url}`, downloaded: downloadedCount, total });

        let blob: Blob | null = null;
        let lastError: Error | null = null;

        try {
            // Attempt 1: Re-fetch with proxies
            const response = await cachedFetch(url, {}, true);
            if (!response.ok) throw new Error(`Fetch failed with status: ${response.status}`);
            blob = await response.blob();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(`Direct fetch for Data URI failed for ${url}. Attempting AI CDN lookup.`, lastError);

            // Attempt 2: AI CDN finder for common libs
            const isCommonLib = /\.(js|css)$/i.test(url) && !url.includes('data:');
            if (isCommonLib) {
                try {
                    onProgress({ message: `AI lookup: ${url.split('/').pop()}`, downloaded: downloadedCount, total });
                    const cdnUrl = await findCdnUrl(url);
                    if (cdnUrl) {
                        onProgress({ message: `Found CDN: ${cdnUrl}`, downloaded: downloadedCount, total });
                        const cdnResponse = await fetch(cdnUrl); // direct fetch, no proxy
                        if (!cdnResponse.ok) throw new Error(`CDN fetch failed with status: ${cdnResponse.status}`);
                        blob = await cdnResponse.blob();
                    }
                } catch (aiError) {
                    console.error(`AI CDN lookup/fetch failed for ${url}:`, aiError);
                    lastError = aiError instanceof Error ? aiError : new Error(String(aiError));
                }
            }
        }
        
        if (blob) {
            try {
                const dataUri = await blobToDataURI(blob);

                const initiatorUrls = [...new Set(networkLog
                    .filter(entry => entry.url === url && entry.initiator !== 'Initial Request')
                    .map(entry => entry.initiator)
                )];
                
                for (const initiatorUrl of initiatorUrls) {
                    if (!initiatorsToPatch.has(initiatorUrl)) {
                        initiatorsToPatch.set(initiatorUrl, []);
                    }
                    initiatorsToPatch.get(initiatorUrl)!.push({ failedUrl: url, dataUri });
                }
                
                const logIndex = networkLog.findIndex(entry => entry.url === url);
                if (logIndex > -1) {
                    networkLog[logIndex] = { ...networkLog[logIndex], status: 200, statusText: 'OK (Resolved as Data URI)', isError: false, size: blob.size };
                }
                downloadedCount++;
            } catch (processingError) {
                console.error(`Failed to process blob for ${url}:`, processingError);
                stillFailedUrls.push(url);
            }
        } else {
            console.error(`Failed to resolve ${url} as Data URI after all attempts. Last error:`, lastError);
            stillFailedUrls.push(url);
        }
    }
    
    // Second pass: Patch the initiator files
    for (const [initiatorUrl, replacements] of initiatorsToPatch.entries()) {
        onProgress({ message: `Patching source: ${initiatorUrl.split('/').pop()}`, downloaded: downloadedCount, total });
        try {
            const initiatorPath = new URL(initiatorUrl).pathname.substring(1) || 'index.html';
            const zipFile = zip.file(initiatorPath);
            if (zipFile) {
                let content = await zipFile.async('text');
                for (const { failedUrl, dataUri } of replacements) {
                    const urlToReplaceObject = new URL(failedUrl);
                    const variations = [
                        failedUrl,
                        urlToReplaceObject.pathname,
                        urlToReplaceObject.pathname.substring(1),
                        failedUrl.substring(failedUrl.lastIndexOf('/') + 1)
                    ];
                    
                    const escapedVariations = [...new Set(variations.filter(v => v))]
                        .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                        .join('|');
                        
                    const regex = new RegExp(escapedVariations, 'g');
                    content = content.replace(regex, dataUri);
                }
                zip.file(initiatorPath, content);
            } else {
                 console.warn(`Could not find initiator file in zip for URL: ${initiatorUrl}`);
            }
        } catch (error) {
            console.error(`Failed to patch initiator file ${initiatorUrl}:`, error);
        }
    }

    onProgress({ message: `Data URI resolution complete.`, downloaded: downloadedCount, total });
    return { zip, networkLog, stillFailedUrls };
};


export const downloadZipFile = async (zip: any, siteName: string) => {
    try {
        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `${siteName}_source.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    } catch (error) {
        console.error("Failed to generate or download ZIP file:", error);
        alert("An error occurred while creating the ZIP file for download.");
    }
};