import { GoogleGenAI, GenerateContentResponse, Type } from '@google/genai';
import { Finding } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = 'gemini-2.5-pro'; // Use pro model for security analysis

export const analyzeCodeForVulnerabilities = async (filePath: string, fileContent: string, keywords: string = ''): Promise<Finding[]> => {
    // Truncate large files to avoid hitting token limits
    const content = fileContent.length > 100000 ? fileContent.slice(0, 100000) : fileContent;

    const prompt = `
        Act as a world-class penetration tester with deep expertise in web application security, cybersecurity, cybercrimes, cyber hacking, cybersecurity hacking, webpage exploitation, hacking and ethical hacking. Your task is to perform an exhaustive security review of the following code file and identify exploitable weaknesses and vulnerabilities. Go beyond common scanners; think like an attacker to find complex and critical flaws.

        File Path: ${filePath}

        ${keywords ? `This is a focused re-scan. Prioritize your analysis on code related to these user-provided keywords: "${keywords}".` : ''}

        Analyze for the following vulnerability classes, prioritizing critical and high-risk findings. For each finding, assign a 'riskCategory' and a specific 'findingType'.

        **1. Critical Risk Vulnerabilities:** These allow an attacker to take complete control of a server or exfiltrate massive amounts of sensitive data.
        - **Remote Code Execution (RCE):** The lightning strike. Look for insecure deserialization, OS command injection, or any mechanism allowing arbitrary code execution. RCE is often the entry point for a backdoor.
        - **Server-Side Request Forgery (SSRF):** Forcing the server to make requests to internal systems.
        - **Advanced Injection Attacks:** Beyond basic SQLi, look for NoSQL injection, template injection, OS Command injection. Specifically look for patterns of string concatenation in database queries.
        - **Insecure Data Handling:** Identify places where user input is used without proper sanitization or validation, especially when constructing file paths, database queries, or sending data to other systems. This is a common vector for data breaches.
        - **Supply Chain Attacks:** Check for dependencies loaded from untrusted URLs or patterns suggesting potential for compromise.
        - **Potential Backdoors:** The quiet occupation. A backdoor is a covert method to bypass security and maintain persistent access. Identify any hidden functionality, hardcoded credentials that bypass authentication, or suspicious-looking code that could provide persistent access. An RCE is often used to install a backdoor.

        **2. High Risk Vulnerabilities:** These can lead to extensive data breaches, financial fraud, and significant reputational damage.
        - **Broken Access Control & IDOR:** Find instances where a user could access data or functions they are not authorized for, especially via predictable identifiers (Insecure Direct Object References).
        - **Broken Authentication:** Analyze login forms, session management, and JWT handling for flaws like weak password policies, session fixation, or improper token validation.
        - **Sensitive Data Exposure:** Look for unencrypted storage or transmission of PII, financial data, or credentials.

        **3. Medium-Dangerous Levels:** These are common entry points for more severe attacks.
        - **Cross-Site Scripting (XSS):** Identify stored, reflected, and DOM-based XSS vulnerabilities. Pay attention to how data is rendered in the DOM.
        - **Security Misconfiguration:** Verbose error messages, improper CORS policies, default credentials. Specifically look for anchor tags (\`<a>\`) with \`target="_blank"\` that are missing the \`rel="noopener noreferrer"\` attribute, which can lead to tabnabbing attacks.

        **4. Business Logic Flaws:** These are weaknesses in the application's unique workflows. Infer potential flaws where application logic could be manipulated (e.g., changing item prices in a cart, bypassing workflow steps).

        For each vulnerability found, provide a detailed report as a JSON object. If no vulnerabilities are found, return an empty array.

        File Content:
        \`\`\`
        ${content}
        \`\`\`
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        riskCategory: { type: Type.STRING, description: "e.g., 'Critical Risk Vulnerabilities', 'High Risk Vulnerabilities'" },
                        description: { type: Type.STRING },
                        severity: { type: Type.STRING, enum: ['Critical', 'High', 'Medium', 'Low', 'Informational'] },
                        findingType: { type: Type.STRING, description: "e.g., 'Remote Code Execution', 'Cross-Site Scripting'" },
                        filePath: { type: Type.STRING, description: `The full path to the file, which is '${filePath}'` },
                        lineNumber: { type: Type.INTEGER, description: "The line number where the vulnerability occurs." },
                        codeSnippet: { type: Type.STRING, description: "The relevant line(s) of code." },
                        recommendation: { type: Type.STRING }
                    },
                    required: ['title', 'riskCategory', 'description', 'severity', 'findingType', 'filePath', 'recommendation']
                }
            }
        }
    });

    try {
        const results = JSON.parse(response.text) as Omit<Finding, 'sourceModule'>[];
        // Ensure filePath and sourceModule is correctly set for all findings
        return results.map((r) => ({ ...r, filePath, sourceModule: 'SAST' }));
    } catch (e) {
        console.error(`AI vulnerability scan failed for ${filePath}:`, e, response.text);
        return []; // Return empty array on failure
    }
};

export const scanForSecrets = async (filePath: string, fileContent: string, keywords: string = ''): Promise<Finding[]> => {
    if (/\.(png|jpg|jpeg|gif|webp|woff|woff2|eot|ttf|otf|mp3|mp4)$/.test(filePath)) {
        return []; // Skip binary files
    }
    
    const content = fileContent.length > 100000 ? fileContent.slice(0, 100000) : fileContent;
    
    const prompt = `
        Scan the following code file for hardcoded secrets like API keys, private keys, and connection strings.
        File Path: ${filePath}
        
        ${keywords ? `The user is particularly interested in secrets related to these keywords: "${keywords}". Pay close attention to variable names or comments containing these terms.` : ''}

        Look for patterns like:
        - High-entropy strings in variable assignments (e.g., API_KEY = '...').
        - Common key prefixes (e.g., "sk_live_", "pk_test_", "AIzaSy...").
        - Embedded JWTs.
        - Private key blocks (e.g., "-----BEGIN RSA PRIVATE KEY-----").

        For each secret found, provide details. If no secrets are found, return an empty array. Treat every found secret as a 'Critical' severity finding under the 'Critical Risk Vulnerabilities' risk category.

        File Content:
        \`\`\`
        ${content}
        \`\`\`
    `;
    
    const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "e.g., 'Hardcoded Generic API Key', 'Hardcoded Google Maps API Key'"},
                        findingType: { type: Type.STRING, description: "e.g., 'API Key', 'Private Key'" },
                        filePath: { type: Type.STRING, description: `The full path to the file, which is '${filePath}'` },
                        lineNumber: { type: Type.INTEGER },
                        codeSnippet: { type: Type.STRING, description: "The line of code containing the secret." },
                        recommendation: { type: Type.STRING, description: "Standard recommendation to use environment variables or a secrets manager."}
                    },
                    required: ['title', 'findingType', 'filePath', 'codeSnippet', 'recommendation']
                }
            }
        }
    });
    
    try {
        const results = JSON.parse(response.text) as any[];
        return results.map((r) => ({
            ...r,
            riskCategory: 'Critical Risk Vulnerabilities',
            description: `A hardcoded secret (${r.findingType}) was found in the source code. This exposes sensitive credentials and can lead to account takeover or unauthorized access.`,
            severity: 'Critical',
            sourceModule: 'Secret Scan',
            filePath,
        }));
    } catch(e) {
        console.error(`AI secret scan failed for ${filePath}:`, e, response.text);
        return [];
    }
};

export const analyzeDependencies = async (dependencies: { [key: string]: string }): Promise<Finding[]> => {
    const prompt = `
        Act as a security researcher specializing in supply chain security. You are given a list of dependencies from a package.json file. Your task is to identify any dependencies that are commonly associated with historical vulnerabilities (e.g., older versions of lodash, express, jquery, etc.).

        For each dependency you identify as potentially vulnerable (based on its name), create a realistic-sounding security finding. Do not make up CVE numbers. Instead, describe the *type* of vulnerability common to that library.

        Dependencies:
        ${JSON.stringify(dependencies, null, 2)}
        
        Example finding for an old jQuery: "The project uses jQuery, which has a history of Cross-Site Scripting (XSS) vulnerabilities in versions before 3.5.0. If an older version is used, the application may be at risk."
        Example finding for an old Lodash: "Older versions of the Lodash library (before 4.17.21) are susceptible to Prototype Pollution, which can lead to Remote Code Execution in some application contexts."

        If no dependencies with a history of common, severe vulnerabilities are identified, return an empty array. Focus only on high-impact, well-known issues.
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "e.g., 'Potential XSS in outdated jQuery'" },
                        description: { type: Type.STRING },
                        severity: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                        recommendation: { type: Type.STRING, description: "Advise user to check version and update." }
                    },
                    required: ['title', 'description', 'severity', 'recommendation']
                }
            }
        }
    });

    try {
        const results = JSON.parse(response.text) as any[];
        return results.map((r) => ({
            ...r,
            riskCategory: 'High Risk Vulnerabilities',
            findingType: 'Vulnerable Dependency',
            filePath: 'package.json',
            sourceModule: 'Dependency Analysis',
        }));
    } catch (e) {
        console.error(`AI dependency scan failed:`, e, response.text);
        return [];
    }
};