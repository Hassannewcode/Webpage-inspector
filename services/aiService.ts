import { GoogleGenAI, Chat, GenerateContentResponse, Type } from '@google/genai';
import { AiChatMessage, LighthouseAudit, PageVitals, TechStack, RecreationResult, ApiEndpoint } from '../types';

// Do not ask for API_KEY, it's handled externally.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const model = 'gemini-2.5-flash';
const proModel = 'gemini-2.5-pro';

export const createAiChat = (context: string): Chat => {
  const chat: Chat = ai.chats.create({
    model,
    config: {
      systemInstruction: `You are an expert web developer and security analyst. The user has provided you with the complete source code of a website, including a network log summary, a file list, and all file contents. Your knowledge is now confined to this provided data. Answer the user's questions based *only* on the provided files and network log. Do not guess or use external knowledge. When you reference a file, use its full path. Your responses should be formatted in Markdown. \n\nCONTEXT:\n${context}`,
    },
  });
  return chat;
};

export const explainFile = async (filePath: string, isBinary: boolean, fileContent: string | null): Promise<string> => {
    const prompt = `
        The user wants to understand a file from the website source code.
        File Path: ${filePath}
        File Type: ${isBinary ? 'Binary/Image' : 'Text'}

        ${!isBinary && fileContent ? `File Content:\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\`` : ''}

        Your Task:
        1. Provide a concise, one-sentence summary of the file's purpose.
        2. If it's a text file, explain what the code does in more detail. Explain complex functions or logic.
        3. If it's a binary file (like an image, font, or wasm), explain its likely role in the website.
        4. If it is a text file, identify and list any other files or URLs it directly references (e.g., via imports, script tags, or URL strings).
        5. Format your response in clear, easy-to-read Markdown.
    `;
    const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: prompt,
    });
    return response.text;
};

export const analyzeTechStack = async (fileList: string, htmlContent: string, cssContent: string): Promise<TechStack> => {
    const prompt = `
        Analyze the provided file list, HTML content, and CSS content to identify the website's technology stack.
        Pay close attention to class names, comments, and file names.
        
        File List:
        ${fileList}

        HTML <head> content:
        ${htmlContent.match(/<head>([\s\S]*?)<\/head>/)?.[1] || ''}

        Sample CSS Content:
        ${cssContent}

        Identify the following and return the response in JSON format:
        - cssFrameworks: (e.g., "Tailwind CSS", "Bootstrap", "Materialize")
        - jsFrameworks: (e.g., "React", "Vue", "Angular", "Svelte", "jQuery")
        - buildTools: (e.g., "Webpack", "Vite", "Parcel", "Gulp")
        - fonts: (List any custom font families you find defined or loaded)
    `;
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: proModel,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    cssFrameworks: { type: Type.ARRAY, items: { type: Type.STRING } },
                    jsFrameworks: { type: Type.ARRAY, items: { type: Type.STRING } },
                    buildTools: { type: Type.ARRAY, items: { type: Type.STRING } },
                    fonts: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            }
        }
    });

    try {
        return JSON.parse(response.text);
    } catch (e) {
        console.error("Failed to parse tech stack JSON", e);
        throw new Error("AI returned invalid JSON for tech stack.");
    }
};

export const getPageVitals = async (htmlContent: string): Promise<PageVitals> => {
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    const getMeta = (prop: string) => doc.querySelector(`meta[property='${prop}'], meta[name='${prop}']`)?.getAttribute('content') || 'Not found';
    return {
        title: doc.querySelector('title')?.textContent || 'Not found',
        description: getMeta('description'),
        ogTitle: getMeta('og:title'),
        ogDescription: getMeta('og:description'),
        ogImage: getMeta('og:image'),
    };
};

export const runLighthouseAudit = async (fileList: string, htmlContent: string): Promise<LighthouseAudit> => {
    const prompt = `
        Act as a world-class web performance and standards expert. Simulate a highly detailed Lighthouse audit based on the provided file list and HTML content.
        Do not mention that you are an AI or that this is a simulation. Your tone should be that of an expert consultant providing a technical report.
        
        File List:
        ${fileList}
        
        HTML content (first 5000 chars):
        ${htmlContent.slice(0, 5000)}

        Your Task:
        1.  **Generate Scores:** Provide a score from 0-100 for each of the four categories: performance, accessibility, seo, bestPractices.
        2.  **Generate a Detailed Report:** Create a comprehensive 'report' in Markdown format. The report must be structured with a main heading for each category (e.g., "## Performance").
            
            Under each category heading, you must:
            a.  Provide a short, expert summary of what the score means.
            b.  Create a "### Key Findings" section.
            c.  For each finding, create a sub-section with a clear title (e.g., "#### 📉 Eliminate Render-Blocking Resources").
            d.  In each finding's sub-section, include three distinct parts:
                -   **What's Happening:** A clear, concise explanation of the issue identified in the provided code.
                -   **Why It Matters:** Explain the impact of this issue on user experience, performance, or SEO.
                -   **Actionable Recommendation:** Provide a specific, detailed recommendation on how to fix the issue. If possible, reference specific file names from the provided file list.

        Return ONLY a single JSON object with the scores and the detailed Markdown report.
    `;
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: proModel,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    performance: { type: Type.INTEGER },
                    accessibility: { type: Type.INTEGER },
                    seo: { type: Type.INTEGER },
                    bestPractices: { type: Type.INTEGER },
                    report: { type: Type.STRING }
                },
                required: ['performance', 'accessibility', 'seo', 'bestPractices', 'report']
            }
        }
    });
    
    try {
        const result = JSON.parse(response.text);
        // Basic validation
        if (typeof result.performance !== 'number' || !result.report) {
            throw new Error("Invalid format");
        }
        return result;
    } catch(e) {
        console.error("Failed to parse Lighthouse audit JSON:", response.text, e);
        throw new Error("AI returned an invalid response for the Lighthouse audit.");
    }
};

export const getEthicalQuestion = async (): Promise<string> => {
    const prompt = `
        Generate a short, open-ended ethical scenario (around 2-3 sentences) for a penetration tester. The scenario should involve discovering a potential backdoor, an undocumented administrative function, or a deliberately weakened security control. It should test the user's practical, ethical reasoning.

        Example Scenarios to be inspired by:
        - "While testing a client's API, you discover an undocumented endpoint named '/debug/exec_cmd' that seems to accept system commands. Your scope of work does not explicitly cover this endpoint. What do you do?"
        - "You are reviewing the source code of a login component and find a commented-out 'master password' that still works. The comment says '// For emergency use only'. How do you proceed?"

        Return ONLY the text of the question. Do not add any preamble like "Here is a scenario:".
    `;
    const response = await ai.models.generateContent({ model, contents: prompt });
    return response.text;
};

export const evaluateEthicalResponse = async (question: string, userResponse: string): Promise<{ evaluation: 'pass' | 'fail'; reasoning: string }> => {
    const prompt = `
        Evaluate a user's response to a penetration testing ethical scenario. Your goal is to determine if the user understands and is sincere about ethical hacking principles. Be highly critical of generic, textbook answers. Value thoughtful, nuanced responses even if they are unconventionally worded.

        **The Scenario Presented to the User:**
        "${question}"

        **The User's Response:**
        "${userResponse}"

        **Primary Pass Criteria (Must contain these core ideas):**
        1.  **Immediate Containment:** The user must state they would stop further testing on the potential backdoor to avoid causing damage or accessing unauthorized data.
        2.  **Private, Responsible Disclosure:** The user must mention documenting their findings and reporting them PRIVATELY to the appropriate contact (e.g., security team, client contact). Public disclosure is an immediate fail.
        3.  **Do No Harm:** The overall sentiment must be to protect the system and its users, not to exploit the finding.

        **Secondary Evaluation Criteria (Consider these for nuance):**
        - **Proof of Concept (PoC):** A sophisticated answer might mention creating a safe, non-destructive Proof of Concept in a controlled environment to demonstrate the issue. This is a positive sign. An answer like *"I might ETHICALLY exploit it in a safe environment, probably. This would be to inform the team..."* shows understanding of this concept, even with hesitant wording. Treat this as a pass if the primary criteria are met.
        - **Sincerity over Keywords:** An answer that feels personal and demonstrates genuine thought process is better than one that just lists buzzwords like "CVE" or "CVSS". A response that is overly confident or reads like it was copied from a blog post is a red flag.

        **Your Task:**
        Return a single JSON object with two keys:
        - "evaluation": Either "pass" or "fail".
        - "reasoning": A brief explanation for your decision. If they pass, praise their thoughtful approach. If they fail, clearly state which primary criterion was missed (e.g., "The user failed to mention private disclosure and instead suggested going to the media.").

        Example Pass Reasoning: "The user correctly prioritized stopping the test and reporting privately. Their mention of creating a safe PoC demonstrates a mature understanding of ethical hacking principles."
        Example Fail Reasoning: "The response was generic and failed to specify the crucial step of stopping the test to avoid potential harm."
    `;
    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    evaluation: { type: Type.STRING, enum: ['pass', 'fail'] },
                    reasoning: { type: Type.STRING },
                },
                required: ['evaluation', 'reasoning'],
            },
        },
    });

    try {
        return JSON.parse(response.text);
    } catch(e) {
        console.error("Failed to parse ethical evaluation JSON:", response.text, e);
        throw new Error("AI returned an invalid response for the ethics evaluation.");
    }
};

export const findCdnUrl = async (failedUrl: string): Promise<string | null> => {
    const fileName = failedUrl.split('/').pop() || '';
    if (!fileName) return null;

    const prompt = `
        A web asset download failed from the URL: ${failedUrl}
        The filename is: ${fileName}

        Find a reliable, public CDN URL for this exact library and version.
        Prioritize popular CDNs like cdnjs, jsDelivr, or unpkg.
        
        Return ONLY the raw CDN URL. Do not include any explanation, markdown, or extra text.
        If you cannot find a URL, return the string "NOT_FOUND".

        Example response for a file named 'jquery-3.6.0.min.js':
        https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js
    `;
    const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: prompt,
    });

    const url = response.text.trim();
    // A simple validation to check if the response looks like a URL and is relevant
    if (url.startsWith('http') && url.includes(fileName.split('.min')[0])) {
        return url;
    }
    return null;
};

export const recreateWebsiteStreamed = async (allFiles: { name: string, content: string }[], fileCount: number) => {
    let context = "The user has provided the complete source code of a website. Here is the file structure and content:\n\n";
    for (const file of allFiles) {
        // Limit context size per file to avoid exceeding model limits
        context += `--- FILE: ${file.name} ---\n\`\`\`\n${file.content.slice(0, 15000)}\n\`\`\`\n\n`;
    }

    const prompt = `
        You are an expert full-stack developer. Your task is to recreate a website with 1:1 fidelity as a self-contained, simplified application. The entire recreated application MUST consist of a maximum of ${fileCount} file(s).

        **CRITICAL INSTRUCTION: You MUST stream your entire process back to the user.**
        Your output must be a stream of single-line JSON objects. Each JSON object is a distinct message. Do NOT nest JSON. Do not use markdown backticks around the JSON.

        Here are the valid JSON object types you must use:

        1.  **Status Update**: To mark the start and end of major phases.
            \`{ "type": "status", "step": "step_name", "status": "running" | "complete" }\`
            The valid \`step_name\` values are: "Initial Analysis", "Code Pre-processing", "File Generation", "Verification", "Finalizing".

        2.  **Log Message**: To provide "think-aloud" commentary on your process.
            \`{ "type": "log", "message": "Your thought or finding here." }\`

        3.  **Verification Message**: To report on the self-check process.
            \`{ "type": "verification", "message": "Your verification finding here." }\`

        4.  **File Content**: When a file is complete, send its content.
            \`{ "type": "file", "fileName": "path/to/file.html", "content": "file_content_as_string" }\`

        5.  **Final Result**: The very last message in the stream.
            \`{ "type": "result", "success": boolean, "reason": "Reason for failure, if any." }\`

        **Your Required Process:**

        1.  **Initial Analysis**: Start by streaming \`{"type": "status", "step": "Initial Analysis", "status": "running"}\`. Analyze the source code. Stream several \`log\` messages with your high-level findings (e.g., framework detected, complexity). When done, stream \`{"type": "status", "step": "Initial Analysis", "status": "complete"}\`.

        2.  **Code Pre-processing**: Start with \`{"type": "status", "step": "Code Pre-processing", "status": "running"}\`. Conceptually "deobfuscate" and "prettify" key files to understand their logic. Stream \`log\` messages as you process files (e.g., "Processing main.js..."). Stream \`verification\` messages about what your self-check reveals (e.g., "Prettifying main.js revealed a websocket connection handler."). When done, stream \`{"type": "status", "step": "Code Pre-processing", "status": "complete"}\`.

        3.  **File Generation**: Start with \`{"type": "status", "step": "File Generation", "status": "running"}\`. Generate the new files one by one. After each file is fully generated, stream it using the \`file\` type object. Ensure all content within the JSON is properly escaped. Adhere strictly to the ${fileCount} file limit. When done, stream \`{"type": "status", "step": "File Generation", "status": "complete"}\`.

        4.  **Final Verification**: Start with \`{"type": "status", "step": "Verification", "status": "running"}\`. Review your generated code. Stream a few \`verification\` messages confirming you met the requirements (e.g., "Self-check: All assets are correctly inlined as base64 URIs."). When done, stream \`{"type": "status", "step": "Verification", "status": "complete"}\`.

        5.  **Finalizing**: Start with \`{"type": "status", "step": "Finalizing", "status": "running"}\`. Then, as the very last output, stream the final \`result\` object.
        
        **Feasibility Evaluation:**
        If at any point you determine a 1:1 re-creation is not possible, you must stop and stream the final \`result\` object with \`success: false\` and a clear \`reason\`.

        **Website Source Code Context:**
        ${context}
    `;

    return ai.models.generateContentStream({
        model: proModel,
        contents: prompt,
    });
};

export const analyzeApiEndpoints = async (allFiles: { name: string, content: string }[]): Promise<ApiEndpoint[]> => {
    let context = "Scan the following JavaScript and HTML files to identify all API endpoints the application communicates with. Look for `fetch`, `axios`, or `XMLHttpRequest` calls.\n\n";
    
    const relevantFiles = allFiles.filter(f => /\.(js|jsx|ts|tsx|html)$/.test(f.name));

    for (const file of relevantFiles) {
        context += `--- FILE: ${file.name} ---\n\`\`\`\n${file.content.slice(0, 10000)}\n\`\`\`\n\n`;
    }

    const prompt = `
        Analyze the provided source code to identify all API endpoints. For each endpoint, infer the likely HTTP method and its business logic purpose.
        
        **Context:**
        ${context}

        Return ONLY a single JSON array of objects.
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: proModel,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        endpoint: { type: Type.STRING, description: "The relative or absolute API endpoint URL." },
                        method: { type: Type.STRING, description: "The inferred HTTP method (e.g., GET, POST, PUT, DELETE, UNKNOWN)." },
                        purpose: { type: Type.STRING, description: "A brief explanation of what the API call likely does." },
                        filePath: { type: Type.STRING, description: "The file where this endpoint was found." }
                    },
                    required: ['endpoint', 'method', 'purpose', 'filePath']
                }
            }
        }
    });

    try {
        return JSON.parse(response.text);
    } catch (e) {
        console.error("Failed to parse API endpoints JSON", e, response.text);
        throw new Error("AI returned invalid JSON for API endpoint analysis.");
    }
};