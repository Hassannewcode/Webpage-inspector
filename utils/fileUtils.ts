import { FileNode } from '../types';

/**
 * Builds a hierarchical file tree from a flat list of file paths.
 * @param files A list of objects, each with a 'name' property representing the full file path.
 * @returns An array of root-level FileNode objects.
 */
export function buildFileTree(files: { name: string }[]): FileNode[] {
    const root: FileNode = { name: '__root__', path: '', children: [] };
    
    // Using a Map is more efficient for lookups than searching an array repeatedly.
    const nodeMap: Map<string, FileNode> = new Map();
    nodeMap.set('', root); // Add the root to the map

    // Sort files alphabetically to ensure parent directories are processed before their contents.
    const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name));

    for (const file of sortedFiles) {
        const parts = file.name.split('/').filter(p => p);
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            // If a node for the current path doesn't exist, create it.
            if (!nodeMap.has(currentPath)) {
                const parentNode = nodeMap.get(parentPath);
                if (!parentNode) continue; // Should not happen with sorted input

                const isDirectory = i < parts.length - 1;

                const newNode: FileNode = {
                    name: part,
                    path: currentPath,
                };

                // Directories get a 'children' array.
                if (isDirectory) {
                    newNode.children = [];
                }
                
                // Ensure parent's children array exists before pushing.
                if (!parentNode.children) {
                    parentNode.children = [];
                }
                parentNode.children.push(newNode);
                nodeMap.set(currentPath, newNode);
            }
        }
    }
    
    // Recursively sort all children arrays to ensure folders appear before files.
    const sortChildren = (node: FileNode) => {
        if (node.children) {
            node.children.sort((a, b) => {
                // Folder before file
                if (a.children && !b.children) return -1;
                if (!a.children && b.children) return 1;
                // Alphabetical sort for items of the same type
                return a.name.localeCompare(b.name);
            });
            // Recurse for each child that is a directory
            node.children.forEach(child => {
                if (child.children) {
                    sortChildren(child);
                }
            });
        }
    };
    
    sortChildren(root);

    return root.children || [];
}

export const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const getLanguageFromPath = (path: string): string => {
    const extension = path.split('.').pop()?.toLowerCase() || '';
    switch (extension) {
        case 'js': case 'mjs': return 'javascript';
        case 'jsx': return 'jsx';
        case 'ts': return 'typescript';
        case 'tsx': return 'tsx';
        case 'css': return 'css';
        case 'html': case 'xml': case 'svg': return 'markup';
        case 'json': return 'json';
        case 'md': return 'markdown';
        case 'sh': return 'bash';
        case 'py': return 'python';
        case 'java': return 'java';
        default: return 'clike'; // A safe default
    }
};