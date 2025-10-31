import { NetworkLogEntry } from '../types';
import { findAllResources, findInternalLinksInHtml } from './assetDiscovery';
import { findCdnUrl } from './aiService';

declare const JSZip: any;

// A simple in-memory cache to avoid re-downloading the same URL within a session
const fetchCache = new Map<string, Promise<Response>>();

// List of CORS proxies to try for difficult assets
const PROXIES = [
    'https://api.allorigins.win/raw?url=', // Primary
    'https://corsproxy.io/?',              // Secondary
    'https://thingproxy.freeboard.io/fetch/' // Tertiary
];

/**
 * Wraps the fetch call with a proxy and handles rotating through the proxy list on failure.
 * @param url The URL to fetch.
 *- @param proxyIndex The current index in the PROXIES array.
 * @returns A promise that resolves with the Response object.
 */
async function fetchWithProxy(url: string, proxyIndex = 0): Promise<Response> {
    if (proxyIndex >= PROXIES.length) {
        throw new Error('All proxies failed.');
    }
    const proxy = PROXIES[proxyIndex];
    // A simple way to handle different proxy URL structures
    const proxiedUrl = proxy.endsWith('=') ? proxy + encodeURIComponent(url) :
                       proxy.endsWith('?') ? proxy + encodeURIComponent(url) :
                       proxy + url;
    
    try {
        const response = await fetch(proxiedUrl);
        if (!response.ok) {
            // If this proxy gives a specific error (like 404, 500), try the next one.
            console.warn(`Proxy ${proxy} returned status ${response.status}. Trying next...`);
            return fetchWithProxy(url, proxyIndex + 1);
        }
        return response;
    } catch (err) {
        console.warn(`Proxy ${proxy} failed to connect for ${url}. Trying next...`);
        return fetchWithProxy(url, proxyIndex + 1);
    }
}


/**
 * Fetches a URL, using a cache to avoid redundant requests.
 * All requests are sent via a proxy to bypass browser CORS restrictions.
 * @param url The URL to fetch.
 * @param forceFresh If true, bypasses the cache and re-fetches the resource.
 */
async function cachedFetch(url: string, forceFresh = false): Promise<Response> {
    if (fetchCache.has(url) && !forceFresh) {
        return (await fetchCache.get(url)!).clone();
    }

    const requestPromise = fetchWithProxy(url);
    
    fetchCache.set(url, requestPromise);
    
    try {
        const response = await requestPromise;
        // The response is already checked for .ok in fetchWithProxy.
        // If it wasn't ok, an error would've been thrown after all proxies failed.
        return response.clone();
    } catch(e) {
        // If the fetch itself fails (e.g., all proxies down), remove the promise from the cache.
        fetchCache.delete(url);
        throw e;
    }
}


export const fetchWebsiteSource = async (
    url: string,
    onProgress: (progress: { message: string; downloaded: number; total: number }) => void,
    onWarning: (warning: { url: string; message: string }) => void
): Promise<{ zip: any; networkLog: NetworkLogEntry[]; failedUrls: string[]; internalLinks: string[] }> => {
    
    fetchCache.clear();
    const zip = new JSZip();
    const networkLog: NetworkLogEntry[] = [];
    const failedUrls: string[] = [];
    const internalLinks = new Set<string>();
    
    const downloadQueue = new Set<string>([url]);
    const processedUrls = new Set<string>();

    let downloadedCount = 0;

    while (downloadQueue.size > 0) {
        const currentUrl = downloadQueue.values().next().value;
        downloadQueue.delete(currentUrl);

        if (processedUrls.has(currentUrl)) {
            continue;
        }
        processedUrls.add(currentUrl);

        onProgress({ message: `Downloading: ${currentUrl}`, downloaded: downloadedCount, total: processedUrls.size + downloadQueue.size });

        try {
            const response = await cachedFetch(currentUrl);
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            
            networkLog.push({
                url: currentUrl,
                status: 'success',
                statusText: `${response.status} ${response.statusText}`,
                contentType: contentType,
            });

            const content = await response.blob();
            const relativePath = new URL(currentUrl).pathname.substring(1) || 'index.html';
            zip.file(relativePath, content);

            // If it's a text-based file, parse it for more resources
            if (contentType.includes('text') || contentType.includes('javascript') || contentType.includes('json')) {
                const textContent = await content.text();
                const newResources = await findAllResources(contentType, textContent, currentUrl);
                newResources.forEach(res => {
                    if (!processedUrls.has(res)) {
                        downloadQueue.add(res);
                    }
                });
                
                // If this is the root HTML document, scan it for internal page links
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
                status: 'error',
                statusText: errorMessage,
                contentType: 'unknown',
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
            const response = await cachedFetch(url, true); // forceFresh = true to retry
            if (!response.ok) throw new Error(`Retry failed with status: ${response.status}`);
            
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const logIndex = networkLog.findIndex(entry => entry.url === url);
            if (logIndex > -1) {
                networkLog[logIndex] = { url, status: 'success', statusText: `${response.status} ${response.statusText} (Retried)`, contentType };
            }

            const content = await response.blob();
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
                        const logIndex = networkLog.findIndex(entry => entry.url === url);
                        if (logIndex > -1) {
                            networkLog[logIndex] = { url, status: 'success', statusText: `${cdnResponse.status} ${cdnResponse.statusText} (via AI CDN)`, contentType };
                        }

                        const content = await cdnResponse.blob();
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