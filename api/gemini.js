import { GoogleGenAI } from '@google/genai';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

export default async function handler(req, res) {
    console.log('=== GEMINI API CALLED ===');
    console.log('Method:', req.method);
    console.log('Body:', req.body);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { prompt, systemPrompt, messages, useJsonOutput = false } = req.body;

        console.log('Gemini API Key:', process.env.GEMINI_API_KEY ? 'Present' : 'MISSING!');

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Gemini API key not configured' });
        }

        // Configure proxy if needed
        const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://127.0.0.1:10809';
        console.log('Configuring proxy:', proxyUrl);
        
        try {
            const proxyAgent = new ProxyAgent(proxyUrl);
            setGlobalDispatcher(proxyAgent);
            console.log('Proxy configured successfully');
        } catch (proxyError) {
            console.warn('Proxy configuration failed, continuing without proxy:', proxyError.message);
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const modelName = "gemini-2.5-flash";

        // Build the prompt content
        let promptContent;
        if (messages && Array.isArray(messages)) {
            // Convert conversation to proper format
            promptContent = messages.map(msg => {
                if (msg.role === 'system') return `System: ${msg.content}`;
                if (msg.role === 'user') return `User: ${msg.content}`;
                if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
                return msg.content;
            }).join('\n\n');
        } else {
            promptContent = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
        }

        if (useJsonOutput) {
            promptContent += '\n\nPlease respond with valid JSON only.';
        }

        console.log('Request to Gemini:', promptContent.substring(0, 200) + '...');

        const response = await ai.models.generateContent({
            model: modelName,
            contents: promptContent
        });
        const responseText = response.text;

        console.log('Gemini Response:', responseText.substring(0, 200) + '...');

        // Convert Gemini response to OpenAI-compatible format
        const openAICompatibleResponse = {
            choices: [{
                message: {
                    content: responseText,
                    role: 'assistant'
                },
                finish_reason: 'stop'
            }],
            usage: {}
        };
        
        res.status(200).json(openAICompatibleResponse);
    } catch (error) {
        console.error('=== GEMINI ERROR ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({
            error: 'API call failed',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
