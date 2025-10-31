import React from 'react';
import { InfoIcon, ServerIcon, SparklesIcon, ShieldAlertIcon } from './Icons';

export const Disclaimer: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50/80 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
        <div className="flex items-start gap-3">
          <InfoIcon className="h-6 w-6 mt-0.5 flex-shrink-0 text-blue-500" />
          <div>
            <h4 className="font-bold">How It Works: An Advanced Static Analysis</h4>
            <p className="text-sm mt-1">
              This tool performs an exhaustive static analysis to mirror a browser's "Sources" tab. It's designed to capture the complete frontend codebase of a website through a powerful, multi-layered process.
            </p>
            <ul className="list-disc list-inside text-sm mt-2 space-y-2">
              <li>
                <strong>Initial Fetch & HTML Parse:</strong> It begins by downloading the main HTML document, just like a browser. It then meticulously parses the Document Object Model (DOM) to find all initially linked resources like stylesheets, scripts, and images.
              </li>
              <li>
                <strong>Recursive Asset Discovery:</strong> For every CSS, font, or image file it finds, it adds it to a download queue. This process is recursive—it will even find images referenced within CSS files.
              </li>
               <li>
                <strong>AST-Powered JavaScript Analysis:</strong> This is where the magic happens. Instead of simple text matching, we use a true JavaScript parser (`acorn`) to build an Abstract Syntax Tree (AST) for every JS file. By understanding the code's structure, it can reliably detect:
                <ul className="list-['-_'] list-inside pl-4 mt-1">
                    <li>Dynamic `import()` expressions.</li>
                    <li>Asset URLs inside `fetch()` calls.</li>
                    <li>String literals that point to other scripts, JSON files, or media assets.</li>
                </ul>
                Any resource found this way is added to the download queue, ensuring even dynamically-loaded assets are captured.
              </li>
            </ul>
          </div>
        </div>
      </div>

       <div className="bg-red-50/80 dark:bg-red-900/30 text-red-800 dark:text-red-300 p-4 rounded-lg border border-red-200 dark:border-red-700">
        <div className="flex items-start gap-3">
          <ShieldAlertIcon className="h-6 w-6 mt-0.5 flex-shrink-0 text-red-500" />
          <div>
            <h4 className="font-bold">AI Security Scanner</h4>
            <p className="text-sm mt-1">
             Our AI security analysis inspects the downloaded **frontend code** for common vulnerabilities like Cross-Site Scripting (XSS), hardcoded API keys, and insecure dependencies. It's a powerful tool for identifying client-side risks.
            </p>
          </div>
        </div>
      </div>

       <div className="bg-gray-100/80 dark:bg-gray-800/60 text-gray-700 dark:text-gray-400 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <ServerIcon className="h-6 w-6 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-gray-200">Frontend vs. Backend</h4>
            <p className="text-sm mt-1">
              This tool provides a complete picture of the **client-side (frontend)** code. For security reasons, no tool can access a website's **server-side (backend)** source code. However, our AI will infer the backend technology and can identify client-side code patterns that suggest potential backend vulnerabilities, providing a comprehensive view of the entire probable tech stack.
            </p>
          </div>
        </div>
      </div>
      
       <div className="bg-yellow-50/80 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 p-4 rounded-lg border border-yellow-200 dark:border-yellow-700">
        <div className="flex items-start gap-3">
          <SparklesIcon className="h-6 w-6 mt-0.5 flex-shrink-0 text-yellow-500" />
          <div>
            <h4 className="font-bold">AI-Powered Dynamic Inference</h4>
            <p className="text-sm mt-1">
             While JavaScript is not executed live, our AI assistant scans the entire downloaded codebase. It can identify likely API endpoints, explain the purpose of complex functions, and answer questions about the site's dynamic capabilities—giving you a powerful glimpse into how the application would behave when live.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};