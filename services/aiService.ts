import { GoogleGenAI, Chat, GenerateContentResponse, Type } from '@google/genai';
import { AiChatMessage, LighthouseAudit, PageVitals, TechStack } from '../types';

// Do not ask for API_KEY, it's handled externally.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const model = 'gemini-2.5-flash';
const proModel = 'gemini-2.5-pro';

export const createAiChat = (context: string): Chat => {
  const chat: Chat = ai.chats.create({
    model,
    config: {
      systemInstruction: `You are an expert web developer and security analyst. The user has provided you with the complete source code of a website, including a file list and all file contents. Your knowledge is now confined to this provided source code. Answer the user's questions based *only* on the provided files. Do not guess or use external knowledge. When you reference a file, use its full path. Your responses should be formatted in Markdown. \n\nCONTEXT:\n${context}`,
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

export const analyzeTechStack = async (fileList: string, htmlContent: string): Promise<TechStack> => {
    const prompt = `
        Analyze the provided file list and HTML content to identify the website's technology stack.
        
        File List:
        ${fileList}

        HTML <head> content:
        ${htmlContent.match(/<head>([\s\S]*?)<\/head>/)?.[1] || ''}

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
        Simulate a Lighthouse audit based on the provided file list and HTML content.
        Analyze the code for best practices, performance, accessibility, and SEO.
        Do not mention that you are an AI or that this is a simulation.
        
        File List:
        ${fileList}
        
        HTML content (first 5000 chars):
        ${htmlContent.slice(0, 5000)}

        Your Task:
        1. Generate a score from 0-100 for each of the four categories: performance, accessibility, seo, bestPractices.
        2. Generate a detailed 'report' in Markdown format. The report should have a section for each category, listing specific findings, potential issues, and actionable recommendations based on the provided code. For example, if you see large image files, mention them. If you see missing alt tags, point them out.
        
        Return ONLY a single JSON object.
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

export const scanForApiEndpoints = async (jsContent: string, keywords: string): Promise<any[]> => {
    const prompt = `
        Analyze the following concatenated JavaScript files to identify potential API endpoints AND client-side page routes.

        Look for:
        1. API calls using 'fetch', 'axios', or 'XMLHttpRequest'.
        2. Client-side routing definitions (e.g., in React Router <Route path="...">, Vue Router, or Angular Router) that define application paths.
        
        ${keywords ? `The user is specifically interested in items related to these keywords: "${keywords}". Prioritize these.` : ''}

        For each item found, extract the following information:
        - type: Classify as either 'API_ENDPOINT' or 'INTERNAL_ROUTE'.
        - method: For API_ENDPOINT, the HTTP method (e.g., 'GET', 'POST'). For INTERNAL_ROUTE, you may omit this field or set it to an empty string.
        - path: The URL, path, or route pattern.
        - purpose: A brief, inferred description of what the endpoint or route does.
        - clueFile: The name of the source file where the clue was found (from the '--- FILE: ... ---' markers).

        Return ONLY an array of JSON objects. If nothing is found, return an empty array.

        JavaScript Content:
        ${jsContent.slice(0, 50000)}
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: proModel,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        type: { type: Type.STRING, enum: ['API_ENDPOINT', 'INTERNAL_ROUTE'] },
                        method: { type: Type.STRING },
                        path: { type: Type.STRING },
                        purpose: { type: Type.STRING },
                        clueFile: { type: Type.STRING },
                    },
                    required: ['type', 'path', 'purpose', 'clueFile'],
                }
            }
        }
    });
    
    try {
        return JSON.parse(response.text);
    } catch(e) {
        console.error("Failed to parse API endpoints JSON:", response.text, e);
        throw new Error("AI returned an invalid response for the API scan.");
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