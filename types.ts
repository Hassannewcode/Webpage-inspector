export type AppPhase = 'initial' | 'downloading' | 'post-download-prompt' | 'retrying' | 'completed' | 'viewing' | 'error';

export type NetworkLogStatus = 'success' | 'error';

export interface NetworkLogEntry {
    url: string;
    status: NetworkLogStatus;
    statusText: string;
    contentType: string;
}

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
