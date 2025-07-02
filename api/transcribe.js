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

    try {
        // strip off “data:audio/webm;base64,”
        const b64 = audio.split(',')[1];
        const buf = Buffer.from(b64, 'base64');

        // build multipart via Web API
        const form = new FormData();
        form.append('model_id', model_id);
        form.append(
            'file',
            new Blob([buf], { type: 'audio/webm' }),
            filename || 'audio.webm'
        );
        if (language_code && language_code !== 'auto') {
            form.append('language_code', language_code);
        }

        const elevenRes = await fetch(
            'https://api.elevenlabs.io/v1/speech-to-text',
            {
                method: 'POST',
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY
                    // do NOT manually spread form.getHeaders() here
                },
                body: form
            }
        );

        const data = await elevenRes.json();
        console.log('ElevenLabs Status:', elevenRes.status, data);
        return res.status(elevenRes.status).json(data);

    } catch (err) {
        console.error('=== TRANSCRIBE ERROR ===', err);
        return res.status(500).json({ error: 'Transcription failed', details: err.message });
    }
}
