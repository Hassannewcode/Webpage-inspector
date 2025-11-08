import React, { useState, useCallback, useMemo } from 'react';
import { recreateWebsiteStreamed } from '../services/aiService';
import { RecreatedFile, RecreationResult } from '../types';
import { HammerIcon, LoaderIcon, AlertTriangleIcon, DownloadIcon, FileTextIcon, RefreshCwIcon, CodeIcon, CheckCircleIcon } from './Icons';
import { getLanguageFromPath } from '../utils/fileUtils';

declare const JSZip: any;
declare const Prism: any;

interface RecreationViewProps {
    zip: any;
}

type Phase = 'idle' | 'running' | 'success' | 'error';
type StepStatus = 'pending' | 'running' | 'complete';
interface Step {
    name: string;
    status: StepStatus;
}
type StreamedData = {
    type: 'status' | 'log' | 'verification' | 'file' | 'result';
    [key: string]: any;
};

const initialSteps: Step[] = [
    { name: 'Initial Analysis', status: 'pending' },
    { name: 'Code Pre-processing', status: 'pending' },
    { name: 'File Generation', status: 'pending' },
    { name: 'Verification', status: 'pending' },
    { name: 'Finalizing', status: 'pending' },
];

const getStatusIcon = (status: StepStatus) => {
    switch (status) {
        case 'pending':
            return <div className="h-5 w-5 rounded-full border-2 border-gray-400 dark:border-gray-600 flex-shrink-0" />;
        case 'running':
            return <LoaderIcon className="h-5 w-5 animate-spin text-blue-500 flex-shrink-0" />;
        case 'complete':
            return <CheckCircleIcon className="h-5 w-5 text-green-500 flex-shrink-0" />;
    }
};

export const RecreationView: React.FC<RecreationViewProps> = ({ zip }) => {
    const [phase, setPhase] = useState<Phase>('idle');
    const [finalResult, setFinalResult] = useState<RecreationResult | null>(null);
    const [recreatedFiles, setRecreatedFiles] = useState<RecreatedFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<RecreatedFile | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [steps, setSteps] = useState<Step[]>(initialSteps);
    const [liveLog, setLiveLog] = useState<string[]>([]);

    const originalFileCount = useMemo(() => Object.values(zip.files as Record<string, any>).filter(f => !f.dir).length, [zip]);
    const maxFileCount = useMemo(() => Math.max(2, Math.floor(originalFileCount * 0.7)), [originalFileCount]);
    const [fileCount, setFileCount] = useState<number>(() => Math.min(1, maxFileCount));
    
    const codeRef = React.useRef<HTMLElement>(null);
    const logRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (codeRef.current && selectedFile) {
            Prism.highlightElement(codeRef.current);
        }
    }, [selectedFile]);
    
     React.useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [liveLog]);

    React.useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleStartRecreation = useCallback(async () => {
        setPhase('running');
        setFinalResult(null);
        setRecreatedFiles([]);
        setSelectedFile(null);
        setSteps(initialSteps);
        setLiveLog(['[SYSTEM] Initiating AI recreation process...']);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);

        try {
            const textFiles: { name: string, content: string }[] = [];
            const zipFiles = Object.values(zip.files as Record<string, any>).filter(f => !f.dir);

            for (const file of zipFiles) {
                try {
                    const content = await file.async('text');
                    textFiles.push({ name: file.name, content });
                } catch (e) { /* Ignore binary files */ }
            }

            const stream = await recreateWebsiteStreamed(textFiles, fileCount);
            let buffer = '';
            for await (const chunk of stream) {
                buffer += chunk.text;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data: StreamedData = JSON.parse(line);
                        switch (data.type) {
                            case 'status':
                                setSteps(prev => prev.map(s => s.name === data.step ? { ...s, status: data.status } : s));
                                break;
                            case 'log':
                                setLiveLog(prev => [...prev, `[LOG] ${data.message}`]);
                                break;
                            case 'verification':
                                setLiveLog(prev => [...prev, `[VERIFY] ${data.message}`]);
                                break;
                            case 'file':
                                setRecreatedFiles(prev => [...prev, { fileName: data.fileName, content: data.content }]);
                                break;
                            case 'result':
                                setFinalResult(data);
                                if (data.success) {
                                    setPhase('success');
                                } else {
                                    setPhase('error');
                                }
                                break;
                        }
                    } catch (e) {
                        console.warn("Could not parse stream chunk as JSON:", line, e);
                        setLiveLog(prev => [...prev, `[PARSE_ERROR] Malformed AI response.`]);
                    }
                }
            }
        } catch (e) {
            console.error("Recreation failed:", e);
            setFinalResult({ success: false, reason: e instanceof Error ? e.message : 'An unknown error occurred.' });
            setPhase('error');
        }
    }, [zip, previewUrl, fileCount]);
    
    // Effect to auto-select file and create preview after success
    React.useEffect(() => {
        if (phase === 'success' && recreatedFiles.length > 0) {
             const indexHtmlFile = recreatedFiles.find(f => f.fileName === 'index.html');
             if (indexHtmlFile) {
                 setSelectedFile(indexHtmlFile);
                 const blob = new Blob([indexHtmlFile.content], { type: 'text/html' });
                 setPreviewUrl(URL.createObjectURL(blob));
             } else {
                 setSelectedFile(recreatedFiles[0]);
             }
        }
    }, [phase, recreatedFiles]);

    const handleDownload = async () => {
        if (!recreatedFiles.length) return;
        const newZip = new JSZip();
        recreatedFiles.forEach(file => newZip.file(file.fileName, file.content));
        const blob = await newZip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `recreated_site_${fileCount}_files.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    if (phase === 'idle') {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <HammerIcon className="h-16 w-16 text-purple-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">AI Website Re-creation</h2>
                <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-6">
                    Use a powerful AI to analyze the entire codebase and refactor it into a self-contained application with a <strong>1:1 visual and functional match</strong>. This is a highly experimental feature that pushes the boundaries of AI code generation.
                </p>
                <div className="w-full max-w-xs bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700 mb-8">
                  <label htmlFor="file-count-slider" className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    Max Number of Files: <span className="font-bold text-lg text-purple-600 dark:text-purple-400">{fileCount}</span>
                  </label>
                  <input
                    id="file-count-slider"
                    type="range"
                    min="1"
                    max={maxFileCount}
                    value={fileCount}
                    onChange={(e) => setFileCount(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-purple"
                  />
                   <style>{`.range-thumb-purple::-webkit-slider-thumb { background: #8b5cf6; } .range-thumb-purple::-moz-range-thumb { background: #8b5cf6; }`}</style>
                </div>
                <button
                    onClick={handleStartRecreation}
                    className="inline-flex items-center justify-center px-6 py-3 font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                >
                    <CodeIcon className="mr-2 h-5 w-5" />
                    Start AI Re-creation
                </button>
            </div>
        );
    }
    
    if (phase === 'running') {
        return (
            <div className="h-full flex flex-col p-4 sm:p-6 bg-gray-50 dark:bg-gray-900 overflow-hidden">
                <h3 className="text-xl font-semibold mb-1 text-center">AI Refactoring in Progress...</h3>
                <p className="text-gray-500 dark:text-gray-400 text-center mb-4">The AI is analyzing and rebuilding the application. Please do not navigate away.</p>
                <div className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-4 overflow-hidden">
                    <div className="md:col-span-1 bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                        <h4 className="font-semibold mb-3">Process Steps</h4>
                        <ul className="space-y-3">
                            {steps.map(step => (
                                <li key={step.name} className="flex items-center gap-3">
                                    {getStatusIcon(step.status)}
                                    <span className={`font-medium ${step.status === 'pending' ? 'text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>{step.name}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="md:col-span-2 bg-black rounded-lg p-4 flex flex-col border border-gray-700 overflow-hidden">
                        <h4 className="font-semibold text-gray-200 mb-2 font-mono">AI Live Log</h4>
                        <div ref={logRef} className="flex-grow overflow-y-auto font-mono text-xs text-green-400 space-y-1 pr-2">
                           {liveLog.map((log, i) => <p key={i} className="whitespace-pre-wrap">{log}</p>)}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    
    if (phase === 'error' && finalResult) {
         return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <AlertTriangleIcon className="h-12 w-12 text-red-500" />
                <h3 className="text-xl font-semibold mt-4">1:1 Re-creation Failed</h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-md my-2">The AI determined it could not create a perfect 1:1 replica with the given constraints for the following reason:</p>
                <p className="text-sm p-3 bg-red-50 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-700">{finalResult.reason}</p>
                 <button
                    onClick={() => setPhase('idle')}
                    className="mt-6 inline-flex items-center justify-center px-4 py-2 font-semibold text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                    <RefreshCwIcon className="mr-2 h-4 w-4" />
                    Try Again
                </button>
            </div>
         );
    }
    
    if (phase === 'success' && finalResult && recreatedFiles.length > 0) {
        return (
            <div className="h-full flex flex-col md:flex-row">
                <aside className="w-full md:w-1/3 lg:w-1/4 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 flex flex-col">
                     <header className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <h3 className="font-semibold text-sm">Generated Files ({recreatedFiles.length})</h3>
                        <button onClick={handleDownload} className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-purple-700 bg-purple-100 dark:bg-purple-900/50 rounded-md hover:bg-purple-200 dark:hover:bg-purple-800/50">
                           <DownloadIcon className="h-4 w-4"/> Download .zip
                        </button>
                     </header>
                     {recreatedFiles.find(f => f.fileName === 'server.js') && (
                        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                            <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-md text-xs">
                                <strong>To run locally:</strong> Download ZIP, run <code>npm install</code> then <code>node server.js</code>.
                            </div>
                        </div>
                     )}
                    <div className="overflow-y-auto flex-grow p-2">
                         {recreatedFiles.map(file => (
                             <button key={file.fileName} onClick={() => setSelectedFile(file)} className={`w-full text-left py-1 text-sm rounded-md flex items-center ${selectedFile?.fileName === file.fileName ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                                <FileTextIcon className="h-5 w-5 mr-2 flex-shrink-0"/>
                                <span className="truncate">{file.fileName}</span>
                            </button>
                        ))}
                    </div>
                </aside>
                <main className="flex-grow overflow-hidden flex flex-col">
                    <div className="flex-grow flex flex-col md:flex-row h-1/2">
                        <div className="w-full md:w-1/2 h-full flex flex-col border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
                             <h4 className="flex-shrink-0 p-2 text-sm font-semibold border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">Code: {selectedFile?.fileName}</h4>
                             <div className="flex-grow overflow-auto bg-[#2d2d2d]">
                                <pre className="!m-0 !p-4 text-sm h-full w-full">
                                    <code ref={codeRef} className={`language-${getLanguageFromPath(selectedFile?.fileName || '')}`}>
                                        {selectedFile?.content || 'Select a file to view its content.'}
                                    </code>
                                </pre>
                             </div>
                        </div>
                         <div className="w-full md:w-1/2 h-full flex flex-col">
                            <h4 className="flex-shrink-0 p-2 text-sm font-semibold border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">Live Preview</h4>
                             <div className="flex-grow overflow-auto bg-white">
                                {previewUrl ? (
                                    <iframe src={previewUrl} title="Live Preview" className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin"></iframe>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-500">
                                        <p>No index.html found for preview.</p>
                                    </div>
                                )}
                             </div>
                        </div>
                    </div>
                </main>
            </div>
        )
    }

    return null;
};