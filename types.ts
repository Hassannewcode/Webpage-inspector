export type AppPhase = 'initial' | 'downloading' | 'post-download-prompt' | 'retrying' | 'completed' | 'viewing' | 'error';

export type NetworkLogStatus = 'success' | 'error';

export type NetworkLogEntry = {
    url: string;
    status: number; // HTTP status code, e.g., 200, 404. 0 for internal errors.
    statusText: string; // e.g., "OK", "Not Found"
    contentType: string;
    initiator: string; // URL of the file that requested this resource. 'initial' for the root document.
    size: number; // size in bytes
    isError: boolean;
};


export interface FileNode {
    name: string;
    path: string;
    children?: FileNode[];
}

export interface ZippedFile {
  name: string;
  size: number;
}

export interface TechStack {
    cssFrameworks: string[];
    jsFrameworks: string[];
    buildTools: string[];
    fonts: string[];
}

export interface PageVitals {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
}

export interface LighthouseAudit {
    performance: number;
    accessibility: number;
    seo: number;
    bestPractices: number;
    report: string; // The HTML report content
}

export interface AiChatMessage {
    role: 'user' | 'model';
    text: string;
}

export interface HistoryEntry {
    url:string;
    siteName: string;
    timestamp: number;
}

export interface RecreatedFile {
    fileName: string;
    content: string;
}

export interface RecreationResult {
    success: boolean;
    reason?: string;
    files?: RecreatedFile[];
}

export interface ApiEndpoint {
    endpoint: string;
    method: string;
    purpose: string;
    filePath: string;
}