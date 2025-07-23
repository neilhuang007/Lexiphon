// pages/api/transcribe.js
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb'   // allow up to ~10 MB of base64 payload
        }
    }
};

export default async function handler(req, res) {
    console.log('=== TRANSCRIBE API CALLED ===');

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, xi-api-key');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { model_id, audio, filename, language_code } = req.body;
    console.log('Request data:', { model_id, hasAudio: !!audio, filename, language_code });

    if (!model_id || !audio) {
        return res.status(400).json({ error: 'Missing model_id or audio' });
    }

    // Check if API key exists
    if (!process.env.ELEVENLABS_API_KEY) {
        console.error('ELEVENLABS_API_KEY is not set');
        return res.status(500).json({ error: 'Server configuration error', details: 'API key not configured' });
    }

    try {
        // strip off "data:audio/webm;base64," or similar
        const base64Data = audio.split(',')[1];
        if (!base64Data) {
            return res.status(400).json({ error: 'Invalid audio data format' });
        }

        const buf = Buffer.from(base64Data, 'base64');
        console.log('Audio buffer size:', buf.length, 'bytes');

        // Detect MIME type from data URL
        const mimeMatch = audio.match(/^data:([^;]+);/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'audio/webm';
        console.log('Detected MIME type:', mimeType);

        // build multipart via Web API
        const form = new FormData();
        form.append('model_id', model_id);
        form.append(
            'file',
            new Blob([buf], { type: mimeType }),
            filename || 'audio.webm'
        );
        if (language_code && language_code !== 'auto') {
            form.append('language_code', language_code);
        }

        console.log('Calling ElevenLabs API...');
        const elevenRes = await fetch(
            'https://api.elevenlabs.io/v1/speech-to-text',
            {
                method: 'POST',
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY
                },
                body: form
            }
        );

        console.log('ElevenLabs Response Status:', elevenRes.status);
        console.log('ElevenLabs Response Headers:', elevenRes.headers);

        // First, get the response as text
        const responseText = await elevenRes.text();
        console.log('ElevenLabs Raw Response:', responseText.substring(0, 200));

        // Try to parse as JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse ElevenLabs response as JSON');
            console.error('Response text:', responseText);

            // If it's an HTML error page, try to extract meaningful info
            if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
                return res.status(elevenRes.status).json({
                    error: 'ElevenLabs API error',
                    details: 'Received HTML response instead of JSON. This usually indicates an authentication or server error.',
                    status: elevenRes.status
                });
            }

            return res.status(elevenRes.status).json({
                error: 'Invalid response from transcription service',
                details: responseText.substring(0, 100),
                status: elevenRes.status
            });
        }

        console.log('ElevenLabs Parsed Response:', data);

        // Check for API errors
        if (!elevenRes.ok) {
            console.error('ElevenLabs API error:', data);
            return res.status(elevenRes.status).json({
                error: data.error || 'Transcription failed',
                details: data.message || data.detail || 'Unknown error',
                status: elevenRes.status
            });
        }

        // Success
        return res.status(200).json(data);

    } catch (err) {
        console.error('=== TRANSCRIBE ERROR ===', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            error: 'Transcription failed',
            details: err.message,
            type: err.constructor.name
        });
    }
}