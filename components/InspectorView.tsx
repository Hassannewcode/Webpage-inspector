import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { NetworkLogEntry, ZippedFile, FileNode, AiChatMessage, TechStack, PageVitals } from '../types';
import { runLighthouseAudit, analyzeTechStack, scanForApiEndpoints, getPageVitals, createAiChat, explainFile } from '../services/aiService';
import { buildFileTree, formatBytes, getLanguageFromPath } from '../utils/fileUtils';
import { formatCode, deobfuscate } from '../utils/prettify';
import { DownloadIcon, RefreshCwIcon, FileTextIcon, ImageIcon, LoaderIcon, BotIcon, AlertTriangleIcon, ClipboardListIcon, DatabaseIcon, FileSearchIcon, SearchIcon, SparklesIcon, GaugeCircleIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, LayersIcon, NewspaperIcon, MessageSquareIcon, Wand2Icon, EyeIcon, XIcon, ShieldAlertIcon, SitemapIcon } from './Icons';
import { Chat } from '@google/genai';
import { EthicsSurveyModal } from './EthicsSurveyModal';
import { CerberusEngine } from '../features/security/CerberusEngine';

declare const Prism: any;
declare const marked: any;

// A more accurate, though still internal, representation of a JSZip file object.
// The `_data` object is an internal "reader" which holds the content and metadata.
interface ZipFile {
    name: string;
    dir: boolean;
    async(type: 'text' | 'base64' | 'arraybuffer'): Promise<string | ArrayBuffer>;
    _data?: {
        uncompressedSize: number;
        // The `data` property holds the raw, uncompressed content. It's typically
        // present for newly created files but not for files loaded from an archive
        // until they are decompressed.
        data?: ArrayBuffer | Uint8Array | string;
    };
}

const BINARY_EXTENSIONS = new Set([
  // Images (some are handled separately but good to have here for completeness)
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'svg',
  // Fonts
  'woff', 'woff2', 'eot', 'ttf', 'otf',
  // Media
  'mp3', 'mp4', 'webm', 'ogg', 'wav', 'mov', 'avi',
  // Documents & Archives
  'zip', 'gz', 'rar', '7z', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Executables / Binaries
  'exe', 'dll', 'bin', 'dat', 'wasm',
]);


// --- DEBOUNCE HOOK ---
function useDebounce(value: string, delay: number) {    
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}


// --- GAUGE COMPONENT ---
const Gauge: React.FC<{ score: number, category: string }> = ({ score, category }) => {
    const getScoreColor = (s: number) => {
        if (s >= 90) return 'text-green-500';
        if (s >= 50) return 'text-yellow-500';
        return 'text-red-500';
    };
    const circumference = 30 * 2 * Math.PI;
    const offset = circumference - (score / 100) * circumference;

    return (
        <div className="flex flex-col items-center justify-center text-center">
            <div className="relative inline-flex items-center justify-center">
                <svg className="w-24 h-24">
                    <circle className="text-gray-200 dark:text-gray-700" strokeWidth="6" stroke="currentColor" fill="transparent" r="30" cx="48" cy="48" />
                    <circle
                        className={`${getScoreColor(score)} transition-all duration-1000 ease-in-out`}
                        strokeWidth="6"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                        r="30"
                        cx="48"
                        cy="48"
                        style={{ transform: 'rotate(-90deg)', transformOrigin: '48px 48px' }}
                    />
                </svg>
                <span className={`absolute text-2xl font-bold ${getScoreColor(score)}`}>{score}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-300">{category}</p>
        </div>
    );
};


// --- AI CHAT COMPONENT ---
const AiChat: React.FC<{ zip: any }> = ({ zip }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<AiChatMessage[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatContentRef = useRef<HTMLDivElement>(null);
    const isInitialized = useRef(false);

    useEffect(() => {
        if (chatContentRef.current) {
            chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
        }
    }, [messages]);

    const initializeChat = useCallback(async () => {
        if (!zip || isInitialized.current) return;
        isInitialized.current = true;
        setIsLoading(true);

        try {
            let context = "File List:\n";
            const allFiles = Object.keys(zip.files).filter(name => !zip.files[name].dir);
            context += allFiles.join('\n') + "\n\n--- FILE CONTENTS ---\n";

            for (const fileName of allFiles) {
                const file = zip.file(fileName);
                if (file) {
                    try {
                        const content = await file.async('text');
                        context += `\n--- FILE: ${fileName} ---\n${content}\n`;
                    } catch (e) {
                         context += `\n--- FILE: ${fileName} ---\n[Binary or unreadable content]\n`;
                    }
                }
            }
            const chatSession = createAiChat(context);
            setChat(chatSession);
            setMessages([{ role: 'model', text: 'Hello! I am your AI code assistant. Ask me anything about this website\'s source code.' }]);
        } catch (e) {
            console.error("Failed to initialize AI Chat:", e);
            setMessages([{ role: 'model', text: 'Sorry, I was unable to initialize. Please try again later.' }]);
        } finally {
            setIsLoading(false);
        }
    }, [zip]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userInput.trim() || !chat || isLoading) return;

        const newUserMessage: AiChatMessage = { role: 'user', text: userInput };
        setMessages(prev => [...prev, newUserMessage]);
        setUserInput('');
        setIsLoading(true);

        try {
            const response = await chat.sendMessage({ message: userInput });
            setMessages(prev => [...prev, { role: 'model', text: response.text }]);
        } catch (error) {
            console.error("AI chat error:", error);
            setMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error. Please try again." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggle = () => {
        const willOpen = !isOpen;
        setIsOpen(willOpen);
        if (willOpen && !isInitialized.current) {
            initializeChat();
        }
    };

    return (
        <>
            <button
                onClick={handleToggle}
                className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white rounded-full p-4 shadow-lg hover:bg-blue-700 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900"
                aria-label="Toggle AI Assistant"
            >
                <MessageSquareIcon className="h-7 w-7" />
            </button>
            {isOpen && (
                <div className="fixed bottom-24 right-6 z-40 w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col h-[60vh] transform transition-all" role="dialog" aria-modal="true">
                    <header className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <h3 className="font-bold text-lg flex items-center gap-2"><BotIcon className="h-5 w-5 text-blue-500" /> AI Code Assistant</h3>
                        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">&times;</button>
                    </header>
                    <div ref={chatContentRef} className="flex-grow p-4 overflow-y-auto space-y-4">
                        {messages.map((msg, i) => (
                            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs md:max-w-sm p-3 rounded-lg ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                    <p className="text-sm" dangerouslySetInnerHTML={{__html: msg.text.replace(/\n/g, '<br />')}}/>
                                </div>
                            </div>
                        ))}
                         {isLoading && (
                            <div className="flex justify-start">
                                <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
                                   <LoaderIcon className="animate-spin h-5 w-5 text-gray-500" />
                                </div>
                            </div>
                        )}
                    </div>
                    <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <input
                            type="text"
                            value={userInput}
                            onChange={e => setUserInput(e.target.value)}
                            placeholder="Ask about the code..."
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            disabled={isLoading || !chat}
                        />
                    </form>
                </div>
            )}
        </>
    );
};


// --- FILE EXPLORER COMPONENT ---
const FileExplorer: React.FC<{ zip: any, baseUrl: string }> = ({ zip, baseUrl }) => {
    const [files, setFiles] = useState<ZippedFile[]>([]);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [selectedFile, setSelectedFile] = useState<ZippedFile | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [originalContent, setOriginalContent] = useState<string | null>(null);
    const [isLoadingContent, setIsLoadingContent] = useState(false);
    const [contentType, setContentType] = useState<'text' | 'image' | 'binary' | 'markdown'>('text');
    const [searchTerm, setSearchTerm] = useState('');
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
    const [markdownView, setMarkdownView] = useState<'rendered' | 'raw'>('rendered');
    const [isAiExplaining, setIsAiExplaining] = useState(false);
    const [aiExplanation, setAiExplanation] = useState<string | null>(null);
    const codeRef = useRef<HTMLElement>(null);

    // State for new formatting logic
    const [viewMode, setViewMode] = useState<'original' | 'formatted' | 'deobfuscated'>('original');

    useEffect(() => {
        const fileList: ZippedFile[] = Object.values(zip.files as Record<string, ZipFile>)
            .filter((file) => !file.dir)
            .map((file) => {
                let size = file._data?.uncompressedSize || 0;
                if (size === 0 && file._data?.data) {
                    const data = file._data.data;
                    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
                        size = data.byteLength;
                    } else if (typeof data === 'string') {
                        size = new Blob([data]).size;
                    }
                }
                return { name: file.name, size };
            });
        setFiles(fileList);
        const tree = buildFileTree(fileList);
        setFileTree(tree);

        const indexFile = fileList.find(f => f.name === 'index.html');
        if (indexFile) {
            handleFileClick(indexFile);
        } else if (fileList.length > 0) {
            handleFileClick(fileList[0]);
        }
    }, [zip]);

    const handleFileClick = useCallback(async (file: { name: string, size: number }) => {
        if (!zip) return;
        setSelectedFile(file);
        setIsLoadingContent(true);
        setFileContent(null);
        setOriginalContent(null);
        setViewMode('original'); // Reset view mode on new file selection

        const zipEntry = zip.file(file.name) as ZipFile | null;
        if (!zipEntry) { setIsLoadingContent(false); return; }

        const extension = file.name.split('.').pop()?.toLowerCase() || '';

        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(extension)) {
            setContentType('image');
            const base64Content = await zipEntry.async('base64') as string;
            setFileContent(`data:image/${extension === 'svg' ? 'svg+xml' : extension};base64,${base64Content}`);
        } else if (BINARY_EXTENSIONS.has(extension)) {
            setContentType('binary');
            setFileContent(`[Binary File: ${formatBytes(file.size)}] This file type (.${extension}) is not viewable as text. Download the ZIP package to inspect its contents.`);
        } else if (extension === 'md') {
            setContentType('markdown');
            setMarkdownView('rendered');
            try {
                const textContent = await zipEntry.async('text') as string;
                setFileContent(textContent);
                setOriginalContent(textContent);
            } catch (e) {
                setContentType('binary');
                setFileContent(`[Binary File: ${formatBytes(file.size)}] This file cannot be displayed as text. Download the ZIP package to inspect its contents.`);
            }
        } else {
            setContentType('text');
            try {
                const textContent = await zipEntry.async('text') as string;
                const replacementCharCount = (textContent.match(/\uFFFD/g) || []).length;
                const nonPrintableRatio = (textContent.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length / textContent.length;

                if (textContent.length > 100 && (replacementCharCount > textContent.length * 0.1 || nonPrintableRatio > 0.1)) {
                     setContentType('binary');
                     setFileContent(`[Binary File: ${formatBytes(file.size)}] This file appears to be binary or uses an unsupported text encoding. Download the ZIP package to inspect its contents.`);
                } else {
                    setFileContent(textContent);
                    setOriginalContent(textContent);
                }
            } catch (e) {
                setContentType('binary');
                setFileContent(`[Binary File: ${formatBytes(file.size)}] This file cannot be displayed as text. An error occurred while trying to read it. Download the ZIP package to inspect its contents.`);
            }
        }
        setIsLoadingContent(false);
    }, [zip]);
    
     useEffect(() => {
        if (codeRef.current && fileContent && (contentType === 'text' || (contentType ==='markdown' && markdownView === 'raw')) && typeof Prism !== 'undefined') {
            Prism.highlightElement(codeRef.current);
        }
      }, [fileContent, contentType, selectedFile, viewMode, markdownView]);

    const handleFormat = () => {
        if (!originalContent || !selectedFile) return;

        if (viewMode === 'formatted') {
            setFileContent(originalContent);
            setViewMode('original');
            return;
        }

        try {
            const language = getLanguageFromPath(selectedFile.name);
            const prettyContent = formatCode(originalContent, language, baseUrl);
            setFileContent(prettyContent);
            setViewMode('formatted');
        } catch (err) {
            console.error("Formatting failed", err);
            const errorMsg = `/* \n--- FORMATTING FAILED --- \n${err instanceof Error ? err.message : String(err)}\n */\n\n${originalContent}`;
            setFileContent(errorMsg);
        }
    };

    const handleDeobfuscate = () => {
        if (!originalContent || !selectedFile) return;

        if (viewMode === 'deobfuscated') {
            setFileContent(originalContent);
            setViewMode('original');
            return;
        }

        try {
            const language = getLanguageFromPath(selectedFile.name);
            const processedContent = deobfuscate(originalContent, language, baseUrl);
            setFileContent(processedContent);
            setViewMode('deobfuscated');
        } catch (err) {
            console.error("Deobfuscate failed", err);
            const errorMsg = `/* \n--- DEOBFUSCATE FAILED --- \n${err instanceof Error ? err.message : String(err)}\n */\n\n${originalContent}`;
            setFileContent(errorMsg);
        }
    };

    const handleExplainFile = async () => {
        if (!selectedFile) return;
        setIsAiExplaining(true);
        setAiExplanation(null);
        try {
            const isBinary = contentType === 'binary' || contentType === 'image';
            const explanation = await explainFile(selectedFile.name, isBinary, originalContent);
            setAiExplanation(explanation);
        } catch (err) {
            console.error("AI explanation failed", err);
            setAiExplanation(`Sorry, an error occurred while generating an explanation: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setIsAiExplaining(false);
        }
    };

    const toggleFolder = (path: string) => {
        setOpenFolders(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const renderTree = (nodes: FileNode[], level = 0) => {
        return nodes.map(node => {
            if (node.children) { // It's a folder
                const isOpen = openFolders.has(node.path);
                return (
                    <div key={node.path} style={{ paddingLeft: `${level * 16}px` }}>
                        <button onClick={() => toggleFolder(node.path)} className="w-full flex items-center text-left py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md">
                            <ChevronRightIcon className={`h-4 w-4 mr-1 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                            {isOpen ? <FolderOpenIcon className="h-5 w-5 mr-2 text-yellow-500" /> : <FolderIcon className="h-5 w-5 mr-2 text-yellow-500" />}
                            <span className="truncate font-medium">{node.name}</span>
                        </button>
                        {isOpen && <div>{renderTree(node.children, level + 1)}</div>}
                    </div>
                );
            } else { // It's a file
                const fileData = files.find(f => f.name === node.path);
                if (!fileData) return null;
                return (
                    <div key={node.path} style={{ paddingLeft: `${level * 16}px` }}>
                        <button onClick={() => handleFileClick(fileData)} className={`w-full text-left py-1 text-sm rounded-md flex items-center ${selectedFile?.name === node.path ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                           <div className="w-5 shrink-0" />
                           <FileTextIcon className="h-5 w-5 mr-2 flex-shrink-0"/>
                           <span className="truncate">{node.name}</span>
                        </button>
                    </div>
                );
            }
        });
    };

    const filteredFiles = useMemo(() => {
        if (!searchTerm) return files;
        return files.filter(file => file.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [files, searchTerm]);

    return (
        <div className="h-full flex flex-col md:flex-row">
            <aside className="w-full md:w-1/3 lg:w-1/4 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col">
                <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search files..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                        <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                </div>
                <div className="overflow-y-auto flex-grow p-2 space-y-0.5">
                    {searchTerm ? (
                        filteredFiles.map(file => (
                             <button key={file.name} onClick={() => handleFileClick(file)} className={`w-full text-left py-1 text-sm rounded-md flex items-center ${selectedFile?.name === file.name ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                                <FileTextIcon className="h-5 w-5 mr-2 flex-shrink-0"/>
                                <span className="truncate">{file.name}</span>
                            </button>
                        ))
                    ) : (
                        renderTree(fileTree)
                    )}
                </div>
            </aside>
            <main className="flex-grow overflow-hidden relative bg-[#2d2d2d] flex flex-col">
                 <div className="flex-shrink-0 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-1.5 flex justify-between items-center text-sm">
                    <span className="font-mono text-gray-600 dark:text-gray-400 truncate" title={selectedFile?.name}>{selectedFile?.name ?? 'No file selected'}</span>
                    {selectedFile && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-500">{formatBytes(selectedFile.size)}</span>
                             <button
                                onClick={handleExplainFile}
                                disabled={isAiExplaining}
                                className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 rounded-md hover:bg-green-200 dark:hover:bg-green-800/50 disabled:opacity-50 disabled:cursor-wait"
                            >
                                {isAiExplaining ? <LoaderIcon className="h-4 w-4 animate-spin"/> : <SparklesIcon className="h-4 w-4"/>}
                                AI Explain
                            </button>
                            {contentType === 'markdown' && (
                                <button
                                    onClick={() => setMarkdownView(prev => prev === 'rendered' ? 'raw' : 'rendered')}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700/50 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600/50"
                                >
                                    {markdownView === 'rendered' ? <FileTextIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                                    {markdownView === 'rendered' ? 'View Raw' : 'Render View'}
                                </button>
                            )}
                            {contentType === 'text' && (
                                <button
                                    onClick={handleFormat}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 rounded-md hover:bg-blue-200 dark:hover:bg-blue-800/50"
                                >
                                    <Wand2Icon className="h-4 w-4"/>
                                    {viewMode === 'formatted' ? 'Show Original' : 'Format'}
                                </button>
                            )}
                             {contentType === 'text' && (
                                <button
                                    onClick={handleDeobfuscate}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/50 rounded-md hover:bg-purple-200 dark:hover:bg-purple-800/50"
                                >
                                    <SparklesIcon className="h-4 w-4" />
                                    {viewMode === 'deobfuscated' ? 'Show Original' : 'Deobfuscate'}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex-grow overflow-hidden relative">
                     {isLoadingContent && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm z-10">
                            <div className="text-center text-white">
                                <LoaderIcon className="h-8 w-8 animate-spin mx-auto"/>
                                <p className="font-semibold mt-2">Loading...</p>
                            </div>
                        </div>
                    )}
                    
                    {!isLoadingContent && !fileContent && selectedFile ? (
                        <p className="p-4 text-gray-400">Could not load content for {selectedFile.name}.</p>
                    ) : !selectedFile ? (
                        <div className="flex items-center justify-center h-full text-gray-400">{files.length > 0 ? 'Select a file to view.' : 'No files found.'}</div>
                    ) : contentType === 'image' ? (
                        <div className="flex justify-center items-center h-full p-4 bg-gray-100 dark:bg-gray-800"><img src={fileContent ?? ''} alt={selectedFile.name} className="max-w-full max-h-full object-contain" /></div>
                    ) : contentType === 'binary' ? (
                        <div className="flex items-center justify-center h-full text-gray-400 p-4 text-center">{fileContent}</div>
                    ) : contentType === 'markdown' ? (
                        <div className="h-full w-full overflow-auto">
                            {markdownView === 'rendered' ? (
                                <div className="bg-white dark:bg-gray-900 min-h-full">
                                    <div 
                                        className="prose prose-sm sm:prose-base dark:prose-invert max-w-none p-4 sm:p-6" 
                                        dangerouslySetInnerHTML={{ __html: typeof marked !== 'undefined' ? marked.parse(fileContent || '') : (fileContent || '') }} 
                                    />
                                </div>
                            ) : (
                                <pre className="!m-0 !p-4 text-sm h-full w-full"><code ref={codeRef} className={`language-markdown`}>{fileContent}</code></pre>
                            )}
                        </div>
                    ) : (
                        <div className="h-full w-full overflow-auto"><pre className="!m-0 !p-4 text-sm h-full w-full" tabIndex={0}><code ref={codeRef} className={`language-${getLanguageFromPath(selectedFile.name)}`}>{fileContent}</code></pre></div>
                    )}
                </div>
            </main>
            {aiExplanation && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={() => setAiExplanation(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full transform transition-all" onClick={e => e.stopPropagation()}>
                        <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="font-bold text-lg flex items-center gap-2"><SparklesIcon className="h-5 w-5 text-green-500" /> AI Explanation for <code className="font-mono text-sm bg-gray-100 dark:bg-gray-700 p-1 rounded-md">{selectedFile?.name}</code></h3>
                            <button onClick={() => setAiExplanation(null)} className="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">
                                <XIcon className="h-6 w-6" />
                            </button>
                        </header>
                        <div className="p-4 sm:p-6 max-h-[60vh] overflow-y-auto">
                            <div 
                                className="prose prose-sm sm:prose-base dark:prose-invert max-w-none" 
                                dangerouslySetInnerHTML={{ __html: typeof marked !== 'undefined' ? marked.parse(aiExplanation) : aiExplanation }} 
                            />
                        </div>
                        <footer className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 sm:px-6 flex justify-end rounded-b-lg">
                            <button
                                type="button"
                                className="w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-700 text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 sm:w-auto sm:text-sm"
                                onClick={() => setAiExplanation(null)}
                            >
                                Close
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </div>
    );
};


// --- ANALYSIS VIEW COMPONENT ---
const AnalysisView: React.FC<{ zip: any, networkLog: NetworkLogEntry[], internalLinks: string[] }> = ({ zip, networkLog, internalLinks }) => {
    type AnalysisTab = 'assets' | 'pages' | 'api' | 'tech' | 'vitals';
    const [activeTab, setActiveTab] = useState<AnalysisTab>('assets');
    const [analysisCache, setAnalysisCache] = useState<Record<string, any>>({});
    const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
    
    // State for the new interactive API scanner
    const [apiKeywords, setApiKeywords] = useState('');
    const [apiResults, setApiResults] = useState<any[] | null>(null);
    const [isApiLoading, setIsApiLoading] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const runAnalysis = useCallback(async (type: AnalysisTab) => {
        if (analysisCache[type] || type === 'api' || type === 'pages') return;

        setIsLoading(prev => ({ ...prev, [type]: true }));
        try {
            let result;
            const allFiles: ZipFile[] = (Object.values(zip.files) as ZipFile[]).filter(f => !f.dir);
            const fileListStr = allFiles.map((f) => f.name).join('\n');
            const indexHtmlFile = zip.file('index.html');
            const htmlContent = indexHtmlFile ? await indexHtmlFile.async('text') : '';

            switch (type) {
                case 'tech':
                    result = await analyzeTechStack(fileListStr, htmlContent);
                    break;
                case 'vitals':
                    result = await getPageVitals(htmlContent);
                    break;
            }
            setAnalysisCache(prev => ({ ...prev, [type]: result }));
        } catch (error) {
            console.error(`Analysis failed for ${type}:`, error);
            setAnalysisCache(prev => ({ ...prev, [type]: { error: `Failed to fetch analysis. ${error instanceof Error ? error.message : ''}` }}));
        } finally {
            setIsLoading(prev => ({ ...prev, [type]: false }));
        }
    }, [zip, analysisCache]);

    const handleApiSearch = useCallback(async () => {
        setIsApiLoading(true);
        setApiResults(null);
        setApiError(null);

        try {
            let combinedJs = '';
            const allFiles: ZipFile[] = (Object.values(zip.files) as ZipFile[]).filter(f => !f.dir);
            // Pre-filter JS files to significantly reduce payload size and improve AI speed/accuracy
            const apiIndicators = /fetch|axios|XMLHttpRequest|api|http/i;

            for (const file of allFiles) {
                if (file.name.endsWith('.js')) {
                    try {
                        const content = await file.async('text');
                        // Only include files that contain potential API call keywords
                        if (apiIndicators.test(content as string)) {
                            combinedJs += `\n\n--- FILE: ${file.name} ---\n\n${content}`;
                        }
                    } catch (e) {
                        console.warn(`Could not read file ${file.name} for API scan.`, e);
                    }
                }
            }

            if (!combinedJs.trim()) {
                setApiResults([]);
                return;
            }

            const result = await scanForApiEndpoints(combinedJs, apiKeywords);
            setApiResults(result);

        } catch (error) {
            console.error("API scan failed:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during the scan.";
            setApiError(`Failed to fetch analysis. ${errorMessage}`);
        } finally {
            setIsApiLoading(false);
        }
    }, [zip, apiKeywords]);

    useEffect(() => {
        if (activeTab !== 'assets' && activeTab !== 'api' && activeTab !== 'pages' && !analysisCache[activeTab]) {
            runAnalysis(activeTab);
        }
    }, [activeTab, runAnalysis, analysisCache]);
    
    const TabButton = ({ id, label, icon }: { id: AnalysisTab, label: string, icon: React.ReactNode }) => (
        <button onClick={() => setActiveTab(id)} role="tab" aria-selected={activeTab === id} className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === id ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'}`}>
            {icon} {label}
        </button>
    );

    const renderContent = () => {
        const data = analysisCache[activeTab];
        const loading = isLoading[activeTab];

        if (loading) {
            return <div className="flex items-center justify-center h-full"><LoaderIcon className="h-8 w-8 animate-spin text-blue-500" /></div>;
        }
        if (data?.error) {
            return <div className="p-4 text-center text-red-500 dark:text-red-400">{data.error}</div>;
        }
        if (!data && activeTab !== 'assets' && activeTab !== 'api' && activeTab !== 'pages') return null;

        switch (activeTab) {
            case 'assets': return (
                <div className="overflow-y-auto h-full">
                     <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-700 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-800 sticky top-0">
                            <tr>
                                <th scope="col" className="px-4 py-3 w-1/2">URL</th>
                                <th scope="col" className="px-4 py-3">Status</th>
                                <th scope="col" className="px-4 py-3">Type</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {networkLog.map((entry, index) => (
                                <tr key={index}>
                                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white truncate" title={entry.url}>{entry.url}</td>
                                    <td className="px-4 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${entry.status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>{entry.status}</span></td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{entry.contentType}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
            case 'pages': return (
                <div className="overflow-y-auto h-full p-4 sm:p-6">
                    <h3 className="text-lg font-semibold mb-3">Discovered Internal Pages</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        The following pages were linked from the main document. This may not be a complete list, but it provides an overview of the site's structure.
                    </p>
                    {internalLinks.length > 0 ? (
                        <ul className="divide-y divide-gray-200 dark:divide-gray-700 border-t border-b border-gray-200 dark:border-gray-700">
                            {internalLinks.map((link, index) => (
                                <li key={index} className="p-3">
                                    <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-blue-600 dark:text-blue-400 hover:underline break-all">
                                        {link}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <SitemapIcon className="h-10 w-10 mx-auto mb-2" />
                            <p>No internal page links were found on the main HTML document.</p>
                        </div>
                    )}
                </div>
            );
            case 'tech': return (
                <div className="p-6 space-y-4">
                    {Object.entries(data as TechStack).map(([key, values]) => (
                        <div key={key}>
                            <h3 className="font-semibold capitalize text-gray-800 dark:text-gray-200">{key.replace(/([A-Z])/g, ' $1')}</h3>
                            {Array.isArray(values) && values.length > 0 ? (
                                <ul className="list-disc list-inside text-gray-600 dark:text-gray-400">
                                    {values.map((v: string) => <li key={v}>{v}</li>)}
                                </ul>
                            ) : <p className="text-sm text-gray-500">None detected.</p>}
                        </div>
                    ))}
                </div>
            );
             case 'vitals': return (
                <div className="p-6 space-y-3">
                     {Object.entries(data as PageVitals).map(([key, value]) => (
                        <div key={key}>
                            <h3 className="font-semibold capitalize text-gray-800 dark:text-gray-200">{key.replace(/([A-Z])/g, ' $1')}</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-2 rounded-md">{(value as React.ReactNode) || 'Not found'}</p>
                        </div>
                    ))}
                </div>
            );
            case 'api': return (
                <div className="p-4 sm:p-6 h-full flex flex-col">
                    <div className="flex-shrink-0">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                            Enter keywords (e.g., "login", "user") to find related API calls or client routes, or leave blank to scan for all. The AI will analyze only relevant JavaScript files for efficiency.
                        </p>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={apiKeywords}
                                onChange={(e) => setApiKeywords(e.target.value)}
                                placeholder="Keywords (optional)"
                                className="flex-grow w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                disabled={isApiLoading}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleApiSearch(); }}
                            />
                            <button
                                onClick={handleApiSearch}
                                disabled={isApiLoading}
                                className="inline-flex items-center justify-center px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-wait"
                            >
                                {isApiLoading ? <LoaderIcon className="animate-spin h-5 w-5" /> : <SearchIcon className="h-5 w-5" />}
                                <span className="ml-2">{isApiLoading ? 'Scanning...' : 'Scan'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 flex-grow overflow-y-auto relative">
                        {isApiLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-900/50">
                                <LoaderIcon className="h-8 w-8 animate-spin text-blue-500" />
                            </div>
                        )}
                        {apiError && (
                            <div className="p-4 text-center text-red-500 dark:text-red-400">{apiError}</div>
                        )}
                        {apiResults && (
                            apiResults.length > 0 ? (
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-gray-700 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                                        <tr>
                                            <th scope="col" className="px-4 py-3 w-28">Type / Method</th>
                                            <th scope="col" className="px-4 py-3">Path</th>
                                            <th scope="col" className="px-4 py-3">Purpose / Context</th>
                                            <th scope="col" className="px-4 py-3">Source File</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {apiResults.map((req: any, index: number) => (
                                            <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                <td className="px-4 py-2 font-mono font-semibold">
                                                    {req.type === 'INTERNAL_ROUTE' ? (
                                                        <span className="text-purple-600 dark:text-purple-400">ROUTE</span>
                                                    ) : (
                                                        <span className="text-blue-600 dark:text-blue-400">{req.method?.toUpperCase() || 'GET'}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white truncate font-mono" title={req.path}>{req.path}</td>
                                                <td className="px-4 py-2 text-gray-600 dark:text-gray-400" title={req.purpose}>{req.purpose}</td>
                                                <td className="px-4 py-2 text-gray-500 dark:text-gray-400 truncate" title={req.clueFile}>{req.clueFile}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="flex items-center justify-center h-full text-gray-500">
                                    <p>No potential API calls or routes found matching your criteria.</p>
                                </div>
                            )
                        )}
                        {!apiResults && !isApiLoading && (
                            <div className="flex items-center justify-center h-full text-gray-500">
                                <p>Click "Scan" to begin analysis.</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 px-2 flex-shrink-0" role="tablist">
                <TabButton id="assets" label={`Asset Log (${networkLog.length})`} icon={<ClipboardListIcon className="h-5 w-5"/>} />
                <TabButton id="pages" label={`Site Pages (${internalLinks.length})`} icon={<SitemapIcon className="h-5 w-5"/>} />
                <TabButton id="api" label="API & Route Scanner" icon={<DatabaseIcon className="h-5 w-5"/>} />
                <TabButton id="tech" label="Technology Stack" icon={<LayersIcon className="h-5 w-5"/>} />
                <TabButton id="vitals" label="Page Vitals" icon={<NewspaperIcon className="h-5 w-5"/>} />
            </div>
            <div className="flex-grow overflow-y-auto bg-white dark:bg-slate-900 relative">
                {renderContent()}
            </div>
        </div>
    );
};


// --- LIGHTHOUSE AUDIT COMPONENT ---
const LighthouseAudit: React.FC<{ zip: any }> = ({ zip }) => {
    const [auditResult, setAuditResult] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const hasRun = useRef(false);

    const runAudit = useCallback(async () => {
        if (hasRun.current) return;
        hasRun.current = true;
        setIsLoading(true);

        try {
            const allFiles = Object.keys(zip.files).filter(name => !zip.files[name].dir);
            const fileListStr = allFiles.join('\n');
            const indexHtmlFile = zip.file('index.html');
            const htmlContent = indexHtmlFile ? await indexHtmlFile.async('text') : '';
            const result = await runLighthouseAudit(fileListStr, htmlContent as string);
            setAuditResult(result);
        } catch (error) {
            console.error("Lighthouse audit failed:", error);
            setAuditResult({ error: `Failed to generate audit. ${error instanceof Error ? error.message : ''}` });
        } finally {
            setIsLoading(false);
        }
    }, [zip]);
    
    useEffect(() => {
        runAudit();
    }, [runAudit]);

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col items-center">
            {isLoading && (
                <div className="flex flex-col items-center justify-center h-full">
                    <LoaderIcon className="h-10 w-10 animate-spin text-blue-600" />
                    <p className="mt-4 text-lg font-semibold">Performing AI-Powered Audit...</p>
                </div>
            )}
            {auditResult?.error && <p className="p-4 text-red-500">{auditResult.error}</p>}
            {auditResult && !auditResult.error && (
                <div className="w-full max-w-4xl">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <Gauge score={auditResult.performance} category="Performance" />
                        <Gauge score={auditResult.accessibility} category="Accessibility" />
                        <Gauge score={auditResult.seo} category="SEO" />
                        <Gauge score={auditResult.bestPractices} category="Best Practices" />
                    </div>
                    <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none break-words overflow-y-auto h-full p-2 bg-gray-50 dark:bg-slate-900 rounded-lg">
                        <div dangerouslySetInnerHTML={{ __html: auditResult.report }} />
                    </div>
                </div>
            )}
        </div>
    );
};


// --- MAIN INSPECTOR VIEW ---
export const InspectorView: React.FC<{
  result: { zip: any; networkLog: NetworkLogEntry[]; internalLinks: string[] };
  siteName: string;
  onDownload: () => void;
  onReset: () => void;
  saveError: string | null;
}> = ({ result, siteName, onDownload, onReset, saveError }) => {
    type MainTab = 'explorer' | 'analysis' | 'security' | 'audit';
    const [activeTab, setActiveTab] = useState<MainTab>('explorer');
    const [isEthicsModalOpen, setIsEthicsModalOpen] = useState(false);
    const [hasPassedEthicsCheck, setHasPassedEthicsCheck] = useState(false);

    const handleOpenSecurityTab = () => {
        if (hasPassedEthicsCheck) {
            setActiveTab('security');
        } else {
            setIsEthicsModalOpen(true);
        }
    };
    
    const handleSurveySuccess = () => {
        setHasPassedEthicsCheck(true);
        setIsEthicsModalOpen(false);
        setActiveTab('security');
    };

     const baseUrl = useMemo(() => {
        const mainDocRequest = result.networkLog.find(entry => entry.contentType.includes('html') && entry.status === 'success');
        try {
            // Use the final URL from the network log to correctly handle redirects.
            if (mainDocRequest) {
                 return new URL(mainDocRequest.url).origin;
            }
        } catch (e) { console.error("Could not determine base URL from network log", e); }
        // Fallback for safety
        return `https://${siteName}`;
    }, [result.networkLog, siteName]);


    const TabButton = ({ id, label, icon, colorClass = 'blue', onClick }: { id: MainTab, label: string, icon: React.ReactNode, colorClass?: string, onClick?: () => void }) => {
        const activeClasses = `border-${colorClass}-600 text-${colorClass}-600 dark:text-${colorClass}-400 dark:border-${colorClass}-400`;
        const inactiveClasses = 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600';
        return (
            <button onClick={onClick || (() => setActiveTab(id))} role="tab" aria-selected={activeTab === id} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${activeTab === id ? activeClasses : inactiveClasses}`}>
                {icon} {label}
            </button>
        );
    };

    return (
        <div className="bg-white/70 dark:bg-slate-800 backdrop-blur-lg rounded-xl shadow-2xl border border-white/30 dark:border-slate-700/50">
            <div className="flex flex-col sm:flex-row justify-between items-start mb-4 gap-3 px-4 pt-4">
                <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Inspector</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 break-all">{siteName}</p>
                </div>
                <div className="flex gap-3 flex-shrink-0">
                    <button onClick={onDownload} className="inline-flex items-center justify-center px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors">
                        <DownloadIcon className="-ml-1 mr-2 h-5 w-5" /> Download .zip
                    </button>
                    <button onClick={onReset} className="inline-flex items-center justify-center px-4 py-2 font-semibold text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors">
                        <RefreshCwIcon className="-ml-1 mr-2 h-5 w-5" /> Start Over
                    </button>
                </div>
            </div>

            {saveError && (
              <div className="my-2 mx-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200 p-3 rounded-lg border border-yellow-200 dark:border-yellow-700 flex items-start gap-3" role="alert">
                  <AlertTriangleIcon className="h-5 w-5 flex-shrink-0 text-yellow-500 mt-0.5" />
                  <div>
                      <h4 className="font-semibold">Session Not Saved</h4>
                      <p className="text-sm mt-1">{saveError} The current inspection will not be available after you close the tab.</p>
                  </div>
              </div>
            )}

            <div className="border-t border-gray-200 dark:border-gray-700 h-[70vh] flex flex-col overflow-hidden">
                <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 px-2" role="tablist">
                    <TabButton id="explorer" label="File Explorer" icon={<FileSearchIcon className="h-5 w-5" />} />
                    <TabButton id="analysis" label="Analysis" icon={<SparklesIcon className="h-5 w-5" />} />
                    <TabButton id="security" label="Security" icon={<ShieldAlertIcon className="h-5 w-5" />} colorClass="red" onClick={handleOpenSecurityTab} />
                    <TabButton id="audit" label="AI Lighthouse Audit" icon={<GaugeCircleIcon className="h-5 w-5" />} />
                </div>

                <div className="flex-grow overflow-hidden bg-white dark:bg-gray-900/50 relative">
                    <div hidden={activeTab !== 'explorer'} className="h-full"><FileExplorer zip={result.zip} baseUrl={baseUrl} /></div>
                    <div hidden={activeTab !== 'analysis'} className="h-full"><AnalysisView zip={result.zip} networkLog={result.networkLog} internalLinks={result.internalLinks} /></div>
                    <div hidden={activeTab !== 'security'} className="h-full overflow-y-auto"><CerberusEngine zip={result.zip} networkLog={result.networkLog} /></div>
                    <div hidden={activeTab !== 'audit'} className="h-full overflow-y-auto"><LighthouseAudit zip={result.zip} /></div>
                </div>
            </div>
            
             {isEthicsModalOpen && (
                <EthicsSurveyModal
                    onClose={() => setIsEthicsModalOpen(false)}
                    onSuccess={handleSurveySuccess}
                />
            )}
            <AiChat zip={result.zip} />
        </div>
    );
};