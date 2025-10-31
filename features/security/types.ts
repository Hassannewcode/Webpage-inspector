export type VulnerabilitySeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';

export interface Finding {
    title: string;
    riskCategory: string; // e.g., "Critical Risk Vulnerabilities"
    description: string;
    severity: VulnerabilitySeverity;
    findingType: string; // e.g., "Remote Code Execution", "Cross-Site Scripting"
    filePath: string;
    lineNumber?: number;
    codeSnippet?: string;
    recommendation: string;
    sourceModule: string;
}

export interface SecurityHeaderInfo {
    header: string;
    present: boolean;
    value?: string;
    recommendation: string;
}

export interface ScanResult {
    findings: Finding[];
    headerCheck: SecurityHeaderInfo[];
}

export interface ModuleStatus {
    name: string;
    status: 'pending' | 'running' | 'complete' | 'error';
}