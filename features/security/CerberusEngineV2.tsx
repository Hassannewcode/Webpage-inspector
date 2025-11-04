import React, { useState, useCallback } from 'react';
import { NetworkLogEntry } from '../../types';
import { ScanResult, ModuleStatus } from './types';
import { runV2Scan } from './scannerV2';
import { ScanInitiatorV2 } from './componentsV2/ScanInitiatorV2';
import { ScanInProgressV2 } from './componentsV2/ScanInProgressV2';
import { ScanResultsV2 } from './componentsV2/ScanResultsV2';
import { getKV, setKV } from '../../utils/idb';

interface CerberusEngineProps {
    zip: any;
    networkLog: NetworkLogEntry[];
    onScanStart: () => void;
    onScanEnd: () => void;
}

type ScanPhase = 'idle' | 'running' | 'complete';

const initialModules: ModuleStatus[] = [
    { name: "SAST & Secret Scanning", status: 'pending' },
    { name: "Dependency Analysis", status: 'pending' },
    { name: "HTTP Header Check", status: 'pending' }
];

export const CerberusEngineV2: React.FC<CerberusEngineProps> = ({ zip, networkLog, onScanStart, onScanEnd }) => {
    const [phase, setPhase] = useState<ScanPhase>('idle');
    const [results, setResults] = useState<ScanResult | null>(null);
    const [moduleStatus, setModuleStatus] = useState<ModuleStatus[]>(initialModules);
    const [currentTask, setCurrentTask] = useState('');
    const [scanProgress, setScanProgress] = useState({ completed: 0, total: 1 });
    const [etr, setEtr] = useState('');
    const [scanTime, setScanTime] = useState(0);
    const [bestTime, setBestTime] = useState<number | null>(null);

    const runScan = useCallback(async (keywords: string = '') => {
        onScanStart();
        setPhase('running');
        setCurrentTask('Initializing engine...');
        setScanProgress({ completed: 0, total: 1 });
        setEtr('');
        setModuleStatus(initialModules);
        const startTime = performance.now();

        const scanResults = await runV2Scan(
            zip,
            networkLog,
            {
                onModuleUpdate: (name, status) => {
                    setModuleStatus(prev => prev.map(m => m.name === name ? { ...m, status } : m));
                },
                onTaskUpdate: setCurrentTask,
                onProgressUpdate: setScanProgress,
                onEtrUpdate: setEtr,
            },
            keywords
        );
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        setScanTime(duration);

        // Check for new record
        const previousBest = await getKV<number>('scannerV2BestTime');
        setBestTime(previousBest || null);

        if (!previousBest || duration < previousBest) {
            await setKV('scannerV2BestTime', duration);
            setBestTime(duration);
        }

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
        return <ScanInitiatorV2 onStartScan={() => runScan()} />;
    }
    if (phase === 'running') {
        return <ScanInProgressV2 
                    moduleStatus={moduleStatus} 
                    currentTask={currentTask}
                    scanProgress={scanProgress}
                    etr={etr}
                />;
    }
    if (phase === 'complete' && results) {
        return <ScanResultsV2 
                    results={results} 
                    scanTime={scanTime}
                    bestTime={bestTime}
                    onReset={handleReset} 
                    onRescan={runScan} 
                />;
    }

    return null;
};