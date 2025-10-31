// This file's functions are now synchronous and use local libraries for speed.

declare const js_beautify: any;
declare const css_beautify: any;
declare const html_beautify: any;

/**
 * Rewrites relative URLs within a block of code to be absolute.
 * @param content The code content (e.g., HTML, CSS).
 * @param baseUrl The base URL to resolve relative paths against.
 * @param regex A regex to find URLs, with a capturing group for the URL part.
 * @param urlGroupIndex The index of the capturing group that contains the URL.
 * @returns The content with URLs rewritten.
 */
const rewriteUrls = (content: string, baseUrl: string, regex: RegExp, urlGroupIndex: number): string => {
    // Use a function as the replacement to dynamically build the new URL
    return content.replace(regex, (match, ...args) => {
        const urlPart = args[urlGroupIndex - 1]; // Capturing groups are 1-indexed in args
        
        // Only process valid-looking, non-absolute, non-data URLs
        if (urlPart && !/^(https?|data|blob):/.test(urlPart) && !urlPart.startsWith('//')) {
            try {
                const absoluteUrl = new URL(urlPart, baseUrl).href;
                // Replace only the URL part within the full match
                return match.replace(urlPart, absoluteUrl);
            } catch (e) {
                // Ignore invalid URLs, return the original match
                return match;
            }
        }
        return match;
    });
};

/**
 * Applies various URL-rewriting regexes based on the language.
 * @param content The code content.
 * @param language The language of the code.
 * @param baseUrl The base URL for resolving paths.
 * @returns The content with rewritten URLs.
 */
const rewriteAllRelativeUrls = (content: string, language: string, baseUrl: string): string => {
    let rewrittenContent = content;
    try {
        switch (language) {
            case 'markup': // HTML, XML, SVG
            case 'html':
                // Handles src="", href="", poster="", data=""
                rewrittenContent = rewriteUrls(rewrittenContent, baseUrl, /(?:src|href|poster|data)\s*=\s*["']([^"']+)["']/gi, 1);
                // Handles inline style="...url(...)"
                rewrittenContent = rewriteUrls(rewrittenContent, baseUrl, /url\((['"]?)(.*?)\1\)/gi, 2);
                break;
            case 'css':
                // Handles url(...) and @import "..."
                rewrittenContent = rewriteUrls(rewrittenContent, baseUrl, /url\((['"]?)(.*?)\1\)/gi, 2);
                rewrittenContent = rewriteUrls(rewrittenContent, baseUrl, /@import\s*["'](.*?)["']/gi, 1);
                break;
            case 'javascript':
                 // Cautiously rewrite string literals that look like paths
                 rewrittenContent = rewriteUrls(rewrittenContent, baseUrl, /["']((?:\.\/|\.\.\/|\/)[^"']+)["']/gi, 1);
                 break;
        }
    } catch (e) {
        console.error("URL rewriting failed:", e);
    }
    return rewrittenContent;
};

/**
 * Formats code using the js-beautify library loaded in the browser.
 * This is a non-AI, local-only operation.
 * @param content The raw code content.
 * @param language The language to format.
 * @returns The formatted code.
 */
const formatCodeLocally = (content: string, language: string): string => {
    try {
        const options = { indent_size: 2, space_in_empty_paren: true, preserve_newlines: false };
        switch (language) {
            case 'javascript':
            case 'json':
                if (typeof js_beautify !== 'undefined') {
                    return js_beautify(content, options);
                }
                break;
            case 'css':
                if (typeof css_beautify !== 'undefined') {
                    return css_beautify(content, { indent_size: 2 });
                }
                break;
            case 'html':
            case 'markup':
                if (typeof html_beautify !== 'undefined') {
                    return html_beautify(content, options);
                }
                break;
        }
    } catch (e) {
        console.error("Local beautification failed:", e);
    }
    // If beautifier not found or failed, return original content
    return content;
};


/**
 * A lightweight, synchronous formatter that uses local libraries for prettifying code and then rewrites URLs.
 * @param content The raw code content.
 * @param language The language of the code.
 * @param baseUrl The base URL of the original website.
 * @returns The formatted code as a string.
 */
export const formatCode = (content: string, language: string, baseUrl: string): string => {
    const prettifiedContent = formatCodeLocally(content, language);
    return rewriteAllRelativeUrls(prettifiedContent, language, baseUrl);
};

/**
 * "Deobfuscates" code by un-minifying and formatting it using a fast, non-AI local library.
 * This function also un-minifies other languages (CSS, HTML) using local libraries.
 * Finally, it rewrites all relative URLs to be absolute.
 * @param content The raw code content.
 * @param language The language of the code.
 * @param baseUrl The base URL of the original website.
 * @returns The fully processed code as a string.
 */
export const deobfuscate = (content: string, language: string, baseUrl: string): string => {
    // The fastest "deobfuscation" without AI is to format the code, which un-minifies it.
    const formattedContent = formatCodeLocally(content, language);
    return rewriteAllRelativeUrls(formattedContent, language, baseUrl);
};
