import React, { useState, useEffect } from 'react';
import { getEthicalQuestion, evaluateEthicalResponse } from '../services/aiService';
import { LoaderIcon, CheckCircleIcon, AlertTriangleIcon, XIcon, ShieldAlertIcon } from './Icons';

interface EthicsSurveyModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

export const EthicsSurveyModal: React.FC<EthicsSurveyModalProps> = ({ onClose, onSuccess }) => {
    const [question, setQuestion] = useState('');
    const [userResponse, setUserResponse] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluationResult, setEvaluationResult] = useState<{ evaluation: 'pass' | 'fail'; reasoning: string } | null>(null);

    useEffect(() => {
        const fetchQuestion = async () => {
            try {
                const q = await getEthicalQuestion();
                setQuestion(q);
                setUserResponse(''); // Ensure response is blank when question loads
            } catch (error) {
                console.error("Failed to fetch ethical question:", error);
                setQuestion("Failed to load question. Please describe the ethical course of action upon finding a critical security flaw in a web application.");
                setUserResponse('');
            } finally {
                setIsLoading(false);
            }
        };
        fetchQuestion();
    }, []);

    const handleSubmit = async () => {
        if (!userResponse.trim() || isEvaluating) return;
        setIsEvaluating(true);
        setEvaluationResult(null);
        try {
            const result = await evaluateEthicalResponse(question, userResponse);
            setEvaluationResult(result);
            if (result.evaluation === 'pass') {
                setTimeout(onSuccess, 1500);
            }
        } catch (error) {
            console.error("Failed to evaluate response:", error);
            setEvaluationResult({ evaluation: 'fail', reasoning: 'An error occurred during evaluation. Please try again.' });
        } finally {
            setIsEvaluating(false);
        }
    };

    return (
        <div 
            className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4" 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="ethics-modal-title"
            onClick={onClose}
        >
            <div 
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full transform transition-all"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg leading-6 font-bold text-gray-900 dark:text-white flex items-center gap-3" id="ethics-modal-title">
                        <ShieldAlertIcon className="h-6 w-6 text-red-500" />
                        AI Ethical Sincerity Check
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="h-6 w-6" />
                    </button>
                </header>
                <div className="p-6">
                     <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Access to the Deep Security Audit is restricted. To proceed, demonstrate your understanding of ethical hacking and responsible disclosure by responding to the following AI-generated penetration testing scenario.
                    </p>
                    {isLoading ? (
                        <div className="text-center py-10">
                            <LoaderIcon className="h-8 w-8 animate-spin mx-auto text-blue-500" />
                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Generating scenario...</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="question" className="block text-sm font-bold text-gray-800 dark:text-gray-200">Security Scenario:</label>
                                <p id="question" className="mt-1 text-sm text-gray-700 dark:text-gray-300 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">{question}</p>
                            </div>
                            <div>
                                <label htmlFor="response" className="block text-sm font-bold text-gray-800 dark:text-gray-200">Your Proposed Course of Action:</label>
                                <textarea
                                    id="response"
                                    rows={8}
                                    value={userResponse}
                                    onChange={(e) => setUserResponse(e.target.value)}
                                    placeholder="Write your own detailed, step-by-step ethical response here. Your answer will be evaluated by the AI for sincerity and process."
                                    className="w-full mt-1 p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    disabled={isEvaluating}
                                />
                            </div>
                        </div>
                    )}
                </div>
                {evaluationResult && (
                    <div className={`mx-6 mb-4 p-3 rounded-lg flex items-start gap-3 border ${evaluationResult.evaluation === 'pass' ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700' : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700'}`}>
                        {evaluationResult.evaluation === 'pass' ? <CheckCircleIcon className="h-5 w-5 mt-0.5 text-green-500 flex-shrink-0" /> : <AlertTriangleIcon className="h-5 w-5 mt-0.5 text-red-500 flex-shrink-0" />}
                        <div>
                            <h4 className="font-semibold">{evaluationResult.evaluation === 'pass' ? 'Check Passed' : 'Check Failed'}</h4>
                            <p className="text-sm">{evaluationResult.reasoning}</p>
                        </div>
                    </div>
                )}
                <footer className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                    <button
                        type="button"
                        className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-wait"
                        onClick={handleSubmit}
                        disabled={isEvaluating || isLoading || !!(evaluationResult?.evaluation === 'pass')}
                    >
                        {isEvaluating ? <><LoaderIcon className="animate-spin -ml-1 mr-3 h-5 w-5" />Evaluating...</> : 'Submit for Review'}
                    </button>
                    <button
                        type="button"
                        className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-700 text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 sm:mt-0 sm:w-auto sm:text-sm"
                        onClick={onClose}
                        disabled={isEvaluating}
                    >
                        Cancel
                    </button>
                </footer>
            </div>
        </div>
    );
};