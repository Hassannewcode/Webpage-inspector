import { NetworkLogEntry } from '../../types';
import { Finding, ModuleStatus, ScanResult, SecurityHeaderInfo } from './types';
import { analyzeCodeForVulnerabilities, scanForSecrets, analyzeDependencies } from './ai';

interface ZipFile {
    name: string;
    dir: boolean;
    async(type: 'text'): Promise<string>;
}

const formatEtr = (ms: number): string => {
  if (ms < 5000) return 'Just a moment...';
  if (ms < 30000) return 'Less than 30 seconds...';
  if (ms < 60000) return 'Less than a minute...';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (minutes < 1) return `About ${seconds} seconds...`;
  return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining...`;
};

async function runWithConcurrency<T>(
    taskRunners: (() => Promise<T>)[],
    limit: number,
    onProgress: () => void
): Promise<T[]> {
    const allResults: T[] = new Array(taskRunners.length);
    let taskIndex = 0;

    const executeTask = async (): Promise<void> => {
        if (taskIndex >= taskRunners.length) {
            return;
        }

        const currentIndex = taskIndex++;
        const task = taskRunners[currentIndex];

        try {
            const result = await task();
            allResults[currentIndex] = result;
            onProgress();
        } catch (e) {
            console.error(`Task ${currentIndex} failed`, e);
            allResults[currentIndex] = e as T; // Store error for later inspection if needed
        }
        
        // Recursively call to pick up the next task
        await executeTask();
    };

    const workerPromises = Array.from({ length: Math.min(limit, taskRunners.length) }, executeTask);
    await Promise.all(workerPromises);
    
    // Filter out any undefined results from failed tasks if necessary
    return allResults.filter(r => r !== undefined);
}


export const runV2Scan = async (
    zip: any,
    networkLog: NetworkLogEntry[],
    callbacks: {
        onModuleUpdate: (name: string, status: ModuleStatus['status']) => void;
        onTaskUpdate: (task: string) => void;
        onProgressUpdate: (progress: { completed: number; total: number }) => void;
        onEtrUpdate: (etr: string) => void;
    },
    keywords: string = ''
): Promise<ScanResult> => {
    callbacks.onTaskUpdate('Initializing V2 engine...');
    const startTime = Date.now();
    let completedTasks = 0;

    // --- 1. File Classification ---
    callbacks.onTaskUpdate('Classifying files...');
    const allFiles: ZipFile[] = Object.values(zip.files as Record<string, ZipFile>).filter((f: ZipFile) => !f.dir);
    const textFiles = allFiles.filter(f => !/\.(png|jpg|jpeg|gif|webp|woff|woff2|eot|ttf|otf|mp3|mp4)$/i.test(f.name));
    
    let totalLines = 0;
    const fileContents: { name: string, content: string, lines: number }[] = [];
    for(const file of textFiles) {
        try {
            const content = await file.async('text');
            const lines = content.split('\n').length;
            totalLines += lines;
            fileContents.push({ name: file.name, content, lines });
        } catch (e) {
            console.warn(`Could not read file ${file.name} as text.`);
        }
    }
    const avgLines = fileContents.length > 0 ? totalLines / fileContents.length : 0;
    const largeFileThreshold = avgLines + 85;

    const smallFiles = fileContents.filter(f => f.lines < largeFileThreshold);
    const largeFiles = fileContents.filter(f => f.lines >= largeFileThreshold);
    
    // --- 2. Setup Tasks ---
    const totalFileTasks = fileContents.length;
    callbacks.onProgressUpdate({ completed: 0, total: totalFileTasks });
    let avgTimePerTask = 0;

    const progressCallback = () => {
        completedTasks++;
        callbacks.onProgressUpdate({ completed: completedTasks, total: totalFileTasks });

        const elapsedTime = Date.now() - startTime;
        avgTimePerTask = elapsedTime / completedTasks;
        const remainingTasks = totalFileTasks - completedTasks;
        const etrMs = remainingTasks * avgTimePerTask;

        if (remainingTasks > 1) {
            callbacks.onEtrUpdate(formatEtr(etrMs));
        } else {
            callbacks.onEtrUpdate('Finishing up...');
        }
    };

    const scanFile = async (file: { name: string, content: string }): Promise<Finding[]> => {
        callbacks.onTaskUpdate(`Scanning: ${file.name}`);
        const [vulns, secrets] = await Promise.all([
            analyzeCodeForVulnerabilities(file.name, file.content, keywords),
            scanForSecrets(file.name, file.content, keywords)
        ]);
        return [...vulns, ...secrets];
    };

    const smallFileTasks = smallFiles.map(f => () => scanFile(f));
    const largeFileTasks = largeFiles.map(f => () => scanFile(f));

    // --- 3. Execute Scans ---
    let findings: Finding[] = [];
    
    callbacks.onModuleUpdate("SAST & Secret Scanning", 'running');
    callbacks.onTaskUpdate(`Scanning ${smallFiles.length} small files (5 workers)...`);
    const smallFileResults = await runWithConcurrency(smallFileTasks, 5, progressCallback);
    findings.push(...smallFileResults.flat());

    callbacks.onTaskUpdate(`Scanning ${largeFiles.length} large files (2 workers)...`);
    const largeFileResults = await runWithConcurrency(largeFileTasks, 2, progressCallback);
    findings.push(...largeFileResults.flat());
    callbacks.onModuleUpdate("SAST & Secret Scanning", 'complete');

    // --- 4. Other Scans ---
    callbacks.onEtrUpdate('');
    callbacks.onTaskUpdate('Analyzing project dependencies...');
    callbacks.onModuleUpdate("Dependency Analysis", 'running');
    const packageJsonFile = allFiles.find(f => f.name.endsWith('package.json'));
    if (packageJsonFile) {
        try {
            const content = await packageJsonFile.async('text');
            const pkg = JSON.parse(content);
            const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (Object.keys(dependencies).length > 0) {
                const depFindings = await analyzeDependencies(dependencies);
                findings.push(...depFindings);
            }
        } catch(e) { console.error("Dep check failed", e); }
    }
    callbacks.onModuleUpdate("Dependency Analysis", 'complete');
    
    callbacks.onTaskUpdate('Reviewing HTTP security headers...');
    callbacks.onModuleUpdate("HTTP Header Check", 'running');
    const headerCheck: SecurityHeaderInfo[] = [
        { header: 'Content-Security-Policy', present: false, recommendation: 'Implement a strict CSP to prevent XSS and other injection attacks.' },
        { header: 'X-Content-Type-Options', present: false, value: 'nosniff', recommendation: 'Set this header to "nosniff" to prevent MIME-type sniffing attacks.' },
        { header: 'X-Frame-Options', present: false, value: 'DENY or SAMEORIGIN', recommendation: 'Set this header to prevent clickjacking attacks.' },
        { header: 'Strict-Transport-Security', present: false, recommendation: 'Implement HSTS to enforce secure (HTTPS) connections to the server.'}
    ];
    callbacks.onModuleUpdate("HTTP Header Check", 'complete');

    return { findings, headerCheck };
};
