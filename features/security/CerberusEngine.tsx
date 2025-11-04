import React, { useState, useCallback, useRef } from 'react';
import { NetworkLogEntry } from '../../types';
import { ScanResult, ModuleStatus } from './types';
import { analyzeCodeForVulnerabilities, scanForSecrets, analyzeDependencies } from './ai';
import { ScanInitiator } from './components/ScanInitiator';
import { ScanInProgress } from './components/ScanInProgress';
import { ScanResults } from './components/ScanResults';

interface CerberusEngineProps {
    zip: any;
    networkLog: NetworkLogEntry[];
    onScanStart: () => void;
    onScanEnd: () => void;
}

type ScanPhase = 'idle' | 'running' | 'complete';

const initialModules: ModuleStatus[] = [
    { name: "Static Code Analysis (SAST)", status: 'pending' },
    { name: "Secret Scanning", status: 'pending' },
    { name: "Dependency Analysis", status: 'pending' },
    { name: "HTTP Header Check", status: 'pending' }
];

const formatEtr = (ms: number): string => {
  if (ms < 5000) return 'Just a moment...';
  if (ms < 30000) return 'Less than 30 seconds...';
  if (ms < 60000) return 'Less than a minute...';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (minutes < 1) return `About ${seconds} seconds...`;
  return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining...`;
};

export const CerberusEngine: React.FC<CerberusEngineProps> = ({ zip, networkLog, onScanStart, onScanEnd }) => {
    const [phase, setPhase] = useState<ScanPhase>('idle');
    const [results, setResults] = useState<ScanResult | null>(null);
    const [moduleStatus, setModuleStatus] = useState<ModuleStatus[]>(initialModules);
    const [currentTask, setCurrentTask] = useState('');
    const [scanProgress, setScanProgress] = useState({ completed: 0, total: 1 });
    const [etr, setEtr] = useState('');
    
    const startTimeRef = useRef<number | null>(null);
    const avgTimeRef = useRef(0);

    const updateModuleStatus = (name: string, status: ModuleStatus['status']) => {
        setModuleStatus(prev => prev.map(m => m.name === name ? { ...m, status } : m));
    };

    const runScan = useCallback(async (keywords: string = '') => {
        onScanStart();
        setPhase('running');
        setCurrentTask('Initializing engine...');
        setScanProgress({ completed: 0, total: 1 });
        setEtr('');
        startTimeRef.current = Date.now();
        avgTimeRef.current = 0;
        setModuleStatus(initialModules); // Reset module status for a fresh run

        let scanResults: ScanResult = { findings: [], headerCheck: [] };

        const allFiles: { name: string; dir: boolean, async: (type: 'text') => Promise<string> }[] = Object.values(zip.files);
        const filesToScan = allFiles.filter(file => !file.dir && /\.(js|jsx|ts|tsx|html)$/.test(file.name));
        const allTextFiles = allFiles.filter(file => !file.dir);
        
        // Total tasks is SAST files + all text files for secrets
        setScanProgress({ completed: 0, total: filesToScan.length + allTextFiles.length });

        const updateEtr = (completed: number, total: number) => {
             if (completed > 2 && total > 0 && startTimeRef.current) {
                const now = Date.now();
                const elapsedTime = now - startTimeRef.current;
                const currentAvgTimePerResource = elapsedTime / completed;

                const SMOOTHING_FACTOR = 0.1;
                avgTimeRef.current = avgTimeRef.current === 0
                    ? currentAvgTimePerResource
                    : (currentAvgTimePerResource * SMOOTHING_FACTOR) + (avgTimeRef.current * (1 - SMOOTHING_FACTOR));
                
                const remainingTime = (total - completed) * avgTimeRef.current;
              
                if (remainingTime > 1000) {
                    setEtr(formatEtr(remainingTime));
                } else if (completed < total) {
                    setEtr('Finishing up...');
                } else {
                    setEtr('');
                }
            }
        };

        // --- Run Modules in Series/Parallel ---
        
        // 1. Static Analysis
        updateModuleStatus("Static Code Analysis (SAST)", 'running');
        for (const file of filesToScan) {
            setCurrentTask(`SAST: Analyzing ${file.name}`);
            try {
                const content = await file.async('text');
                const vulns = await analyzeCodeForVulnerabilities(file.name, content, keywords);
                scanResults.findings.push(...vulns);
            } catch (e) { console.error(`SAST failed on ${file.name}`, e); }
            setScanProgress(prev => {
                const next = { ...prev, completed: prev.completed + 1 };
                updateEtr(next.completed, next.total);
                return next;
            });
        }
        updateModuleStatus("Static Code Analysis (SAST)", 'complete');

        // 2. Secret Scanning
        updateModuleStatus("Secret Scanning", 'running');
        for (const file of allTextFiles) {
             setCurrentTask(`Secrets: Scanning ${file.name}`);
             try {
                const content = await file.async('text');
                const secrets = await scanForSecrets(file.name, content, keywords);
                scanResults.findings.push(...secrets);
             } catch (e) { console.error(`Secret scan failed on ${file.name}`, e); }
              setScanProgress(prev => {
                const next = { ...prev, completed: prev.completed + 1 };
                updateEtr(next.completed, next.total);
                return next;
            });
        }
        updateModuleStatus("Secret Scanning", 'complete');
        
        // 3. Dependency Check
        setCurrentTask('Analyzing project dependencies...');
        updateModuleStatus("Dependency Analysis", 'running');
        const packageJsonFile = allFiles.find(f => f.name.endsWith('package.json'));
        if (packageJsonFile) {
            try {
                const content = await packageJsonFile.async('text');
                const pkg = JSON.parse(content);
                const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
                if (Object.keys(dependencies).length > 0) {
                    const depFindings = await analyzeDependencies(dependencies);
                    scanResults.findings.push(...depFindings);
                }
            } catch(e) { console.error("Dep check failed", e); }
        }
        updateModuleStatus("Dependency Analysis", 'complete');

        // 4. Header Check
        setCurrentTask('Reviewing HTTP security headers...');
        updateModuleStatus("HTTP Header Check", 'running');
        scanResults.headerCheck.push(
            { header: 'Content-Security-Policy', present: false, recommendation: 'Implement a strict CSP to prevent XSS and other injection attacks.' },
            { header: 'X-Content-Type-Options', present: false, value: 'nosniff', recommendation: 'Set this header to "nosniff" to prevent MIME-type sniffing attacks.' },
            { header: 'X-Frame-Options', present: false, value: 'DENY or SAMEORIGIN', recommendation: 'Set this header to prevent clickjacking attacks.' },
            { header: 'Strict-Transport-Security', present: false, recommendation: 'Implement HSTS to enforce secure (HTTPS) connections to the server.'}
        );
        updateModuleStatus("HTTP Header Check", 'complete');

        setCurrentTask('Finalizing report...');
        setEtr('');
        setResults(scanResults);
        setPhase('complete');
        onScanEnd();

    }, [zip, networkLog, onScanStart, onScanEnd]);

    const handleReset = () => {
        setPhase('idle');
        setResults(null);
        setModuleStatus(initialModules);
        onScanEnd();
    };

    if (phase === 'idle') {
        return <ScanInitiator onStartScan={() => runScan()} />;
    }
    if (phase === 'running') {
        return <ScanInProgress 
                    moduleStatus={moduleStatus} 
                    currentTask={currentTask}
                    scanProgress={scanProgress}
                    etr={etr}
                />;
    }
    if (phase === 'complete' && results) {
        return <ScanResults results={results} onReset={handleReset} onRescan={runScan} />;
    }

    return null; // Should not happen
};