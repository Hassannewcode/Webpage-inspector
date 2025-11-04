// This service centralizes the logic for discovering assets within different file types.
// It uses advanced techniques like AST parsing for JavaScript to find resources
// that simple regex-based methods would miss.

declare const acorn: any;

const CSS_URL_REGEX = /url\((['"]?)(.*?)\1\)|@import\s*['"](.*?)['"]/g;
// A regex for identifying strings that are likely file paths or URLs.
const URL_LIKE_STRING_REGEX = /^(https?:)?\/\/|\.\.?\/|\/[^\/]/;
const POTENTIAL_ASSET_EXTENSIONS = /\.(js|css|json|xml|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|mp4|webm|mp3|ogg)$/i;


/**
 * A helper to resolve a found URL against a base URL and add it to a Set.
 * @param url The found URL string.
 * @param baseUrl The base URL of the file where the URL was found.
 * @param resources The Set to add the resolved URL to.
 */
function addResource(url: string | null | undefined, baseUrl: string, resources: Set<string>) {
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
        try {
            resources.add(new URL(url, baseUrl).href);
        } catch (e) {
            console.warn(`Invalid URL found: ${url}`);
        }
    }
}

/**
 * Parses HTML content to find linked resources like CSS, JS, and images.
 * @param htmlContent The HTML content as a string.
 * @param baseUrl The base URL of the HTML page.
 * @returns An array of absolute URLs to resources.
 */
function findResourcesInHtml(htmlContent: string, baseUrl: string): string[] {
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    const resources = new Set<string>();
    const base = new URL(baseUrl);

    const resolveAndAdd = (url: string | null) => addResource(url, base.href, resources);
    
    const parseSrcset = (srcset: string | null) => {
        if (!srcset) return;
        srcset.split(',').map(part => part.trim().split(/\s+/)[0]).forEach(resolveAndAdd);
    };

    doc.querySelectorAll('link[href]').forEach(el => resolveAndAdd(el.getAttribute('href')));
    doc.querySelectorAll('script[src], img[src], audio[src], video[src], source[src], iframe[src], embed[src], object[data], track[src]').forEach(el => resolveAndAdd(el.getAttribute('src')));
    doc.querySelectorAll('img[srcset], source[srcset]').forEach(el => parseSrcset(el.getAttribute('srcset')));
    doc.querySelectorAll('video[poster]').forEach(el => resolveAndAdd(el.getAttribute('poster')));
    doc.querySelectorAll('[style]').forEach(el => {
        const style = el.getAttribute('style');
        if (style) {
            let match;
            CSS_URL_REGEX.lastIndex = 0;
            while ((match = CSS_URL_REGEX.exec(style)) !== null) {
                resolveAndAdd(match[2] || match[3]);
            }
        }
    });
    doc.querySelectorAll('style').forEach(styleTag => {
        const styleContent = styleTag.textContent;
        if (styleContent) {
            let match;
            CSS_URL_REGEX.lastIndex = 0;
            while ((match = CSS_URL_REGEX.exec(styleContent)) !== null) {
                resolveAndAdd(match[2] || match[3]);
            }
        }
    });

    return Array.from(resources);
}

/**
 * Parses HTML content to find internal navigation links.
 * @param htmlContent The HTML content as a string.
 * @param baseUrl The base URL of the HTML page.
 * @returns A Set of absolute URLs for internal pages.
 */
export function findInternalLinksInHtml(htmlContent: string, baseUrl: string): Set<string> {
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    const links = new Set<string>();
    const baseOrigin = new URL(baseUrl).origin;

    doc.querySelectorAll('a[href]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
            return;
        }

        try {
            const absoluteUrl = new URL(href, baseUrl);
            // Check if it's an internal link and not a link to a common asset file
            if (absoluteUrl.origin === baseOrigin && !POTENTIAL_ASSET_EXTENSIONS.test(absoluteUrl.pathname)) {
                links.add(absoluteUrl.href);
            }
        } catch (e) {
            // Ignore invalid URLs
        }
    });

    return links;
}

/**
 * Parses CSS content to find imported stylesheets and other resources.
 * @param cssContent The CSS content as a string.
 * @param baseUrl The base URL of the CSS file.
 * @returns An array of absolute URLs to resources.
 */
function findResourcesInCss(cssContent: string, baseUrl: string): string[] {
  const resources = new Set<string>();
  let match;
  CSS_URL_REGEX.lastIndex = 0;
  while ((match = CSS_URL_REGEX.exec(cssContent)) !== null) {
    addResource(match[2] || match[3], baseUrl, resources);
  }
  return Array.from(resources);
}

/**
 * Parses a Web App Manifest to find icons, screenshots, etc.
 * @param manifestContent The JSON content of the manifest file.
 * @param baseUrl The base URL of the manifest file.
 * @returns An array of absolute URLs to resources.
 */
function findResourcesInManifest(manifestContent: string, baseUrl: string): string[] {
    const resources = new Set<string>();
    try {
        const manifest = JSON.parse(manifestContent);
        const icons = manifest.icons || [];
        const screenshots = manifest.screenshots || [];
        
        const resolveAndAdd = (url: string) => addResource(url, baseUrl, resources);

        icons.forEach((icon: { src: string }) => resolveAndAdd(icon.src));
        screenshots.forEach((shot: { src: string }) => resolveAndAdd(shot.src));
        if (manifest.start_url) resolveAndAdd(manifest.start_url);

    } catch (e) {
        console.error("Failed to parse web manifest", e);
    }
    return Array.from(resources);
}

/**
 * Parses JavaScript code by building an Abstract Syntax Tree (AST) to find resource URLs.
 * This is far more reliable than regex for complex code.
 * @param jsContent The JavaScript code as a string.
 * @param baseUrl The base URL of the JavaScript file.
 * @returns An array of absolute URLs to resources.
 */
function findResourcesInJsAst(jsContent: string, baseUrl: string): string[] {
    const resources = new Set<string>();
    
    // Prevent Acorn from choking on empty files
    if (!jsContent || !jsContent.trim()) {
        return [];
    }
    
    try {
        const ast = acorn.parse(jsContent, { ecmaVersion: 2022, sourceType: 'module', silent: true });

        // Simple recursive walker to traverse the AST
        function walk(node: any) {
            if (!node) return;

            // Look for dynamic imports: import('...')
            if (node.type === 'ImportExpression' && node.source?.type === 'Literal') {
                addResource(node.source.value, baseUrl, resources);
            }

            // Look for string literals that look like URLs
            if (node.type === 'Literal' && typeof node.value === 'string') {
                const potentialUrl = node.value.trim();
                if (URL_LIKE_STRING_REGEX.test(potentialUrl) && POTENTIAL_ASSET_EXTENSIONS.test(potentialUrl)) {
                    addResource(potentialUrl, baseUrl, resources);
                }
            }

            // Recurse into child nodes
            for (const key in node) {
                if (node.hasOwnProperty(key)) {
                    const child = node[key];
                    if (typeof child === 'object' && child !== null) {
                        if (Array.isArray(child)) {
                            child.forEach(n => walk(n));
                        } else {
                            walk(child);
                        }
                    }
                }
            }
        }

        walk(ast);

    } catch (e) {
        // Suppress common, benign errors from empty or non-JS files, but log others.
        if (!(e instanceof Error && e.message.includes('Unexpected token (1:0)'))) {
            console.warn(`Failed to parse JS file with AST, falling back to regex. Error:`, e);
        }
        
        // Fallback for syntax errors Acorn can't handle
        const regex = /(['"`])((?:https?:)?\/\/[^\s'"`]+|\.\.?\/[^\s'"`]+|\/[^\s'"`]+)\1/g;
        let match;
        while ((match = regex.exec(jsContent)) !== null) {
            const url = match[2];
            if (POTENTIAL_ASSET_EXTENSIONS.test(url)) {
                 addResource(url, baseUrl, resources);
            }
        }
    }
    return Array.from(resources);
}

/**
 * Orchestrator function that determines which parser to use based on content type.
 * @param contentType The MIME type of the content.
 * @param content The file content as a string.
 * @param baseUrl The base URL of the file.
 * @returns A Promise that resolves to an array of found resource URLs.
 */
export async function findAllResources(contentType: string, content: string, baseUrl: string): Promise<string[]> {
    if (contentType.includes('html')) {
        return findResourcesInHtml(content, baseUrl);
    }
    if (contentType.includes('css')) {
        return findResourcesInCss(content, baseUrl);
    }
    if (contentType.includes('javascript') || contentType.includes('application/ecmascript')) {
        return findResourcesInJsAst(content, baseUrl);
    }
    if (contentType.includes('json') || baseUrl.endsWith('.webmanifest')) {
        // Might be a manifest file loaded with a generic json type
        return findResourcesInManifest(content, baseUrl);
    }
    return []; // No resources found for this content type
}