import React, { useState, useMemo, useEffect } from 'react';
import { ScanResult, Finding, VulnerabilitySeverity } from '../types';
import { InfoIcon, ChevronRightIcon, CheckCircleIcon, RefreshCwIcon, TrophyIcon } from '../../../components/Icons';

interface ScanResultsProps {
    results: ScanResult;
    scanTime: number; // in milliseconds
    bestTime?: number | null; // in milliseconds
    onReset: () => void;
    onRescan: (keywords: string) => void;
}

const severityOrder: Record<VulnerabilitySeverity, number> = {
    'Critical': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Informational': 5
};

const riskCategoryOrder = [
    'Critical Risk Vulnerabilities', 'High Risk Vulnerabilities', 'Medium-Dangerous Levels', 'Business Logic Flaws', 'Low Risk Vulnerabilities'
];

const getSeverityClasses = (severity: VulnerabilitySeverity) => {
    switch (severity) {
        case 'Critical': return 'bg-red-700 text-white border-red-900';
        case 'High': return 'bg-red-500 text-white border-red-700';
        case 'Medium': return 'bg-yellow-500 text-black border-yellow-700';
        case 'Low': return 'bg-blue-500 text-white border-blue-700';
        case 'Informational': return 'bg-gray-400 text-white border-gray-600';
        default: return 'bg-gray-200 text-black border-gray-400';
    }
};

const SeverityBadge: React.FC<{ severity: VulnerabilitySeverity }> = ({ severity }) => (
    <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${getSeverityClasses(severity)}`}>
        {severity}
    </span>
);

const formatTime = (ms: number) => (ms / 1000).toFixed(2);

export const ScanResultsV2: React.FC<ScanResultsProps> = ({ results, scanTime, bestTime, onReset, onRescan }) => {
    const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
    const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
    const [searchKeywords, setSearchKeywords] = useState('');

    const isNewRecord = bestTime !== null && bestTime !== undefined && scanTime < bestTime;

    const findingsByRiskCategory = useMemo(() => {
        return results.findings.reduce((acc, finding) => {
            const category = finding.riskCategory || 'Uncategorized';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(finding);
            return acc;
        }, {} as Record<string, Finding[]>);
    }, [results.findings]);

    const sortedRiskCategories = useMemo(() => {
        return Object.keys(findingsByRiskCategory).sort((a, b) => {
            const indexA = riskCategoryOrder.indexOf(a);
            const indexB = riskCategoryOrder.indexOf(b);
            if (indexA === -1 && indexB === -1) return a.localeCompare(b);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
    }, [findingsByRiskCategory]);

    useEffect(() => {
        if (sortedRiskCategories.length > 0) setOpenCategories(new Set([sortedRiskCategories[0]]));
        else setOpenCategories(new Set());
        setSelectedFinding(null);
    }, [sortedRiskCategories]);

    const summary = useMemo(() => {
        const counts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0, Informational: 0 };
        results.findings.forEach(f => { counts[f.severity as VulnerabilitySeverity]++; });
        return counts;
    }, [results.findings]);

    const toggleCategory = (category: string) => {
        setOpenCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    };

    const handleRescan = () => onRescan(searchKeywords);

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-slate-900">
            <header className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold">Security Scan Report (V2 Engine)</h2>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
                            {Object.entries(summary).map(([severity, count]) => (
                                Number(count) > 0 && (
                                    <div key={severity} className="flex items-center gap-2">
                                        <span className={`h-3 w-3 rounded-full ${getSeverityClasses(severity as VulnerabilitySeverity)}`}></span>
                                        <span className="text-sm font-medium">{severity}: <strong>{count as React.ReactNode}</strong></span>
                                    </div>
                                )
                            ))}
                        </div>
                    </div>
                     <div className="flex gap-2">
                         <button onClick={onReset} className="px-3 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">
                            New Scan
                         </button>
                    </div>
                </div>
                 <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="rescan-input-v2" className="text-sm font-medium text-gray-700 dark:text-gray-300">Refine Scan</label>
                        <div className="flex gap-2 mt-1">
                            <input id="rescan-input-v2" type="text" value={searchKeywords} onChange={(e) => setSearchKeywords(e.target.value)}
                                placeholder="e.g., 'authentication', 'payment'"
                                className="flex-grow w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRescan(); }}
                            />
                            <button onClick={handleRescan} className="inline-flex items-center justify-center px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                <RefreshCwIcon className="h-4 w-4 mr-2" />
                                Refine
                            </button>
                        </div>
                    </div>
                     <div className="text-center md:text-right">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Scan Performance</label>
                        <div className={`mt-1 p-2 rounded-lg text-center ${isNewRecord ? 'bg-yellow-100 dark:bg-yellow-900/50' : 'bg-gray-100 dark:bg-gray-700/50'}`}>
                            {isNewRecord && (
                                <div className="flex items-center justify-center gap-2 text-yellow-600 dark:text-yellow-300 font-bold text-sm mb-1">
                                    <TrophyIcon className="h-4 w-4" />
                                    New Record!
                                </div>
                            )}
                            <p className="text-sm">Scan Time: <span className="font-bold font-mono">{formatTime(scanTime)}s</span></p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {bestTime ? `Best: ${formatTime(bestTime)}s` : 'First run with V2 engine.'}
                            </p>
                        </div>
                    </div>
                </div>
            </header>
            
            <div className="flex-grow flex overflow-hidden">
                <aside className="w-2/5 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
                    {sortedRiskCategories.map(category => (
                        <div key={category} className="border-b border-gray-200 dark:border-gray-700">
                            <button onClick={() => toggleCategory(category)} className="w-full flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">
                                <h3 className="font-bold text-sm text-left">{category} ({findingsByRiskCategory[category].length})</h3>
                                <ChevronRightIcon className={`h-5 w-5 transition-transform ${openCategories.has(category) ? 'rotate-90' : ''}`} />
                            </button>
                            {openCategories.has(category) && (
                                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {findingsByRiskCategory[category]
                                        .sort((a,b) => severityOrder[a.severity] - severityOrder[b.severity])
                                        .map((finding, idx) => (
                                        <li key={idx} onClick={() => setSelectedFinding(finding)} className={`p-3 cursor-pointer border-l-4 ${selectedFinding === finding ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-500' : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/80'}`}>
                                            <div className="flex justify-between items-start gap-2">
                                                <p className="font-semibold text-sm truncate">{finding.title}</p>
                                                <SeverityBadge severity={finding.severity} />
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">{finding.filePath}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </aside>

                <main className="w-3/5 overflow-y-auto p-6">
                    {selectedFinding ? (
                         <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
                            <SeverityBadge severity={selectedFinding.severity} />
                            <h3 className="mt-2">{selectedFinding.title}</h3>

                            <p>{selectedFinding.description}</p>

                            <h4>Details</h4>
                            <ul>
                                <li><strong>File:</strong> <code>{selectedFinding.filePath}</code></li>
                                {selectedFinding.lineNumber && <li><strong>Line:</strong> {selectedFinding.lineNumber}</li>}
                                <li><strong>Finding Type:</strong> {selectedFinding.findingType}</li>
                                <li><strong>Source:</strong> {selectedFinding.sourceModule}</li>
                            </ul>

                            {selectedFinding.codeSnippet && (
                                <>
                                    <h4>Code Snippet</h4>
                                    <pre><code className="language-clike">{selectedFinding.codeSnippet}</code></pre>
                                </>
                            )}
                            
                             {selectedFinding.recommendation && (
                                <>
                                    <h4>Recommendation</h4>
                                    <p>{selectedFinding.recommendation}</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                           {results.findings.length > 0 ? (
                                <>
                                <InfoIcon className="h-12 w-12 mb-4" />
                                <h3 className="text-lg font-semibold">Select a finding to view details</h3>
                                <p>Choose an item from the list on the left to see the full report.</p>
                                </>
                           ) : (
                                <>
                                <CheckCircleIcon className="h-12 w-12 mb-4 text-green-500" />
                                <h3 className="text-lg font-semibold">No significant code vulnerabilities found!</h3>
                                <p>The automated scan did not detect any high-risk issues in the application code.</p>
                                </>
                           )}
                           <div className="mt-8 w-full prose prose-sm dark:prose-invert">
                               <h4>HTTP Header Analysis</h4>
                               <table className="w-full">
                                   <thead><tr><th>Header</th><th>Status</th></tr></thead>
                                   <tbody>
                                    {results.headerCheck.map(h => (
                                        <tr key={h.header}>
                                            <td><code>{h.header}</code></td>
                                            <td>{h.present ? <span className="text-green-500 font-bold">Present</span> : <span className="text-red-500 font-bold">Missing</span>}</td>
                                        </tr>
                                    ))}
                                   </tbody>
                               </table>
                               <p className="text-xs text-gray-400">Note: Missing headers reduce security but may be intentional. See recommendations for best practices.</p>
                           </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};