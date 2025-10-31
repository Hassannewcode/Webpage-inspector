import React from 'react';
import { ModuleStatus } from '../types';
import { LoaderIcon, CheckCircleIcon, AlertTriangleIcon } from '../../../components/Icons';

interface ScanInProgressProps {
    moduleStatus: ModuleStatus[];
    currentTask: string;
    scanProgress: { completed: number; total: number };
    etr: string;
}

const getStatusIcon = (status: ModuleStatus['status']) => {
    switch (status) {
        case 'pending':
            return <div className="h-6 w-6 rounded-full border-2 border-gray-400 dark:border-gray-600" />;
        case 'running':
            return <LoaderIcon className="h-6 w-6 animate-spin text-blue-500" />;
        case 'complete':
            return <CheckCircleIcon className="h-6 w-6 text-green-500" />;
        case 'error':
            return <AlertTriangleIcon className="h-6 w-6 text-red-500" />;
    }
};

const getStatusTextClass = (status: ModuleStatus['status']) => {
     switch (status) {
        case 'pending': return 'text-gray-500 dark:text-gray-500';
        case 'running': return 'text-blue-600 dark:text-blue-400 animate-pulse';
        case 'complete': return 'text-green-600 dark:text-green-400';
        case 'error': return 'text-red-600 dark:text-red-400';
    }
}

export const ScanInProgress: React.FC<ScanInProgressProps> = ({ moduleStatus, currentTask, scanProgress, etr }) => {
    const progress = scanProgress.total > 0 ? (scanProgress.completed / scanProgress.total) * 100 : 0;

    return (
        <div className="flex flex-col items-center justify-center h-full p-6 bg-gray-50 dark:bg-gray-900">
             <div className="absolute top-0 left-0 w-full h-full bg-grid-gray-200/[0.2] dark:bg-grid-gray-700/[0.2]"></div>
             <div className="relative z-10 w-full max-w-lg text-center">
                <h2 className="text-2xl font-bold mb-2">Deep Scan Engine Running...</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">The Security Intelligence Engine is analyzing the codebase. Please wait.</p>
                
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
                    <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.5s ease-in-out' }}></div>
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1 mb-4">
                    <span>Task {scanProgress.completed} of {scanProgress.total}</span>
                    <span className="font-semibold">{etr}</span>
                </div>
                
                <div className="h-12 flex items-center justify-center p-2 bg-gray-100 dark:bg-gray-800/50 rounded-lg mb-6">
                    <p className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate" title={currentTask}>
                       {currentTask}
                    </p>
                </div>


                <div className="space-y-3 text-left">
                    {moduleStatus.map(module => (
                        <div key={module.name} className="flex items-center gap-4 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                            <div className="flex-shrink-0">
                                {getStatusIcon(module.status)}
                            </div>
                            <div className="flex-grow">
                                <p className="font-semibold">{module.name}</p>
                                <p className={`text-sm capitalize ${getStatusTextClass(module.status)}`}>
                                    {module.status}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
