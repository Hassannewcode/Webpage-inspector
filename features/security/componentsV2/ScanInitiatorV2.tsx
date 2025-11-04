import React from 'react';
import { ShieldAlertIcon } from '../../../components/Icons';
import { TargetIcon, KeyIcon, PackageSearchIcon, ShieldCheckIcon } from './CustomIcons';

interface ScanInitiatorProps {
    onStartScan: () => void;
}

export const ScanInitiatorV2: React.FC<ScanInitiatorProps> = ({ onStartScan }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-gray-50 dark:bg-gray-900">
            <div className="absolute top-0 left-0 w-full h-full bg-grid-gray-200/[0.2] dark:bg-grid-gray-700/[0.2]"></div>
            <div className="relative z-10">
                <ShieldAlertIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <h2 className="text-3xl font-bold mb-2">Deep Scan Intelligence Engine V2</h2>
                <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
                    Engage our experimental V2 engine to perform a deep security analysis. This version uses a multitasking approach, scanning smaller files in parallel first to deliver results faster, before tackling larger and more complex files.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-4xl mx-auto mb-10 text-left">
                    <div className="bg-white/50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <TargetIcon className="h-8 w-8 text-blue-500 mb-2" />
                        <h3 className="font-semibold">Parallel SAST Scanning</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Scans multiple code files at once for vulnerabilities like RCE, SQLi, and XSS.</p>
                    </div>
                     <div className="bg-white/50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <KeyIcon className="h-8 w-8 text-yellow-500 mb-2" />
                        <h3 className="font-semibold">Concurrent Secret Scanning</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Hunts for hardcoded API keys and credentials across many files simultaneously.</p>
                    </div>
                     <div className="bg-white/50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <PackageSearchIcon className="h-8 w-8 text-green-500 mb-2" />
                        <h3 className="font-semibold">Smart Prioritization</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Analyzes small, simple files first to provide quick initial findings.</p>
                    </div>
                     <div className="bg-white/50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <ShieldCheckIcon className="h-8 w-8 text-purple-500 mb-2" />
                        <h3 className="font-semibold">Comprehensive Analysis</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Includes Header, Configuration, and Dependency checks just like V1.</p>
                    </div>
                </div>

                <button
                    onClick={onStartScan}
                    className="inline-flex items-center justify-center px-8 py-3 font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-transform hover:scale-105"
                >
                    <ShieldAlertIcon className="mr-2 h-5 w-5" />
                    Start V2 Security Scan
                </button>
            </div>
        </div>
    );
};
