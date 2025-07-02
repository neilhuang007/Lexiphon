export default async function handler(req, res) {
    console.log('=== DEEPSEEK API CALLED ===');
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
        const { prompt, systemPrompt, messages } = req.body;

        console.log('DeepSeek API Key:', process.env.DEEPSEEK_API_KEY ? 'Present' : 'MISSING!');
        console.log('Has messages:', !!messages);
        console.log('Prompt length:', prompt?.length || 0);

        let requestMessages;

        // If messages array provided, use it (for conversation format)
        if (messages && Array.isArray(messages)) {
            requestMessages = [
                {role: 'system', content: systemPrompt},
                ...messages.slice(0, -1) // All messages except the last one which is in prompt
            ];
        } else {
            // Fallback to simple format
            requestMessages = [
                {role: 'system', content: systemPrompt},
                {role: 'user', content: prompt}
            ];
        }

        const requestBody = {
            model: 'deepseek-chat',
            messages: requestMessages,
            stream: false,
            temperature: 1.3
        };

        console.log('Request to DeepSeek:', JSON.stringify(requestBody, null, 2));

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        const responseText = await response.text();
        console.log('DeepSeek Status:', response.status);
        console.log('DeepSeek Response:', responseText);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Failed to parse response as JSON:', responseText);
            data = { error: responseText };
        }

        res.status(response.status).json(data);
    } catch (error) {
        console.error('=== DEEPSEEK ERROR ===');
        console.error('Error details:', error);
        res.status(500).json({
            error: 'API call failed',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}