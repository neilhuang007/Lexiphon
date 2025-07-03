// Global variables
let currentRecorder = null;
let audioChunks = [];
let isRecording = false;
let fullTranscript = '';
let correctedTranscript = '';
let detectedTerms = new Map();
let detectedEvents = new Map();
let processedChunks = new Map();
let isProcessing = false;
let activeCorrections = 0;
let isProcessingRemaining = false;
let audioContext = null;
let silenceTimer = null;
let microphoneGranted = false;
let mediaStream = null;
let recordingTimer = null;
let uploadQueue = [];
let activeUploads = 0;
const MAX_CONCURRENT_UPLOADS = 4;
const BASE_CHUNK_SIZE = 25;

// Update the DeepSeek function
async function callDeepSeek(prompt, systemPrompt = "You are an helpful, intelligent assistant") {
    const response = await fetch('/api/deepseek', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, systemPrompt })
    });

    if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

function detectBrowser() {
    const ua = navigator.userAgent;
    const info = {
        userAgent: ua,
        vendor: navigator.vendor,
        platform: navigator.platform,
        language: navigator.language,
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        AudioContext: !!(window.AudioContext || window.webkitAudioContext)
    };
    console.log('Browser:', info);
    return info;
}

async function requestMicrophonePermission() {
    console.log('Requesting mic...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('MediaDevices API not supported');
        showError('Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Edge.');
        return;
    }

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100
            }
        });

        console.log('Mic granted');
        microphoneGranted = true;
        document.getElementById('permissionModal').style.display = 'none';

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

    } catch (error) {
        console.error('Mic error:', error);
        handleMicrophoneError(error);
    }
}

async function checkMicrophonePermission() {
    try {
        if (!navigator.permissions || !navigator.mediaDevices) {
            return false;
        }

        const result = await navigator.permissions.query({name: 'microphone'});
        return result.state === 'granted';
    } catch (e) {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                return false;
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            const hasMic = devices.some(device => device.kind === 'audioinput' && device.label);
            return hasMic;
        } catch (err) {
            return false;
        }
    }
}

function handleMicrophoneError(error) {
    let errorMessage = 'Microphone error: ';

    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'Microphone permission denied.';
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone found.';
    } else {
        errorMessage += error.message || 'Unknown';
    }

    showError(errorMessage);
    document.getElementById('permissionModal').style.display = 'flex';
}

function createRecorder() {
    if (!mediaStream) return null;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

    const recorder = new MediaRecorder(mediaStream, {mimeType});
    const chunks = [];

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            chunks.push(e.data);
        }
    };

    recorder.onstop = () => {
        if (chunks.length > 0) {
            const blob = new Blob(chunks, {type: 'audio/webm'});
            uploadQueue.push(blob);
            updateUploadStatus();
            processAudioQueue();
        }
    };

    return recorder;
}

async function processAudioQueue() {
    while (uploadQueue.length > 0 && activeUploads < MAX_CONCURRENT_UPLOADS) {
        const audioData = uploadQueue.shift();
        activeUploads++;
        processAudioChunk(audioData).finally(() => {
            activeUploads--;
            updateUploadStatus();

            if (!isRecording && uploadQueue.length === 0 && activeUploads === 0) {
                updateStatus('ready');
            }

            processAudioQueue();
        });
    }
}

function updateUploadStatus() {
    const indicator = document.getElementById('uploadIndicator');
    const status = document.getElementById('uploadQueueStatus');

    if (uploadQueue.length > 0 || activeUploads > 0) {
        indicator.style.display = 'inline-flex';
        status.textContent = `Queue: ${uploadQueue.length} | Active: ${activeUploads}`;
    } else {
        indicator.style.display = 'none';
    }
}

function updateCorrectionStatus() {
    const indicator = document.getElementById('correctionIndicator');
    if (activeCorrections > 0) {
        indicator.style.display = 'inline-flex';
    } else {
        indicator.style.display = 'none';
    }
}

async function processAudioChunk(blob) {
    updateStatus('transcribing');

    try {
        // Convert blob to base64
        const reader = new FileReader();
        const base64Audio = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        // Send as JSON instead of FormData
        const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model_id: 'scribe_v1',
                audio: base64Audio,
                filename: 'audio.webm',
                language_code: document.getElementById('languageSelect').value
            })
        });

        console.log('Response status:', res.status);

        if (!res.ok) {
            const errorData = await res.text();
            console.error('API Error Response:', errorData);
            throw new Error(`STT error: ${res.status} - ${errorData}`);
        }

        const json = await res.json();
        console.log('Transcription result:', json);

        const text = json.text || '';

        if (text) {
            appendToTranscription(text + ' ');
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(() => {
                processRemainingText();
            }, 2000);
        }

        if (isRecording) {
            updateStatus('recording');
        } else if (uploadQueue.length === 0 && activeUploads === 0) {
            updateStatus('ready');
        }
    } catch (err) {
        console.error('STT error:', err);
        showError('Transcription error: ' + err.message);
        if (isRecording) {
            updateStatus('recording');
        } else {
            updateStatus('ready');
        }
    }
}

async function handleAudioUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    updateStatus('transcribing');

    try {
        // Convert file to base64
        const reader = new FileReader();
        const base64Audio = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });

        const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model_id: 'scribe_v1',
                audio: base64Audio,
                filename: file.name,
                language_code: document.getElementById('languageSelect').value
            })
        });

        console.log('Upload response status:', res.status);

        if (!res.ok) {
            const errorData = await res.text();
            console.error('Upload Error Response:', errorData);
            throw new Error(`Upload error: ${res.status} - ${errorData}`);
        }

        const json = await res.json();
        console.log('Upload result:', json);

        const text = json.text || '';

        if (text) {
            appendToTranscription(text + ' ');
            processRemainingText();
        } else {
            showError('No speech detected in file.');
        }
    } catch (err) {
        console.error('Upload error:', err);
        showError('Error processing file: ' + err.message);
    } finally {
        updateStatus('ready');
        e.target.value = '';
    }
}

function checkBrowserSupport() {
    const hasMediaDevices = !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
    const hasMediaRecorder = !!window.MediaRecorder;
    return hasMediaDevices && hasMediaRecorder;
}

function showError(message) {
    const container = document.getElementById('errorContainer');
    container.innerHTML = `<div class="error-message">${message}</div>`;
    setTimeout(() => {
        container.innerHTML = '';
    }, 5000);
}

function updateStatus(state) {
    const indicator = document.getElementById('statusIndicator');
    const text = document.getElementById('statusText');
    if (state === 'recording') {
        indicator.classList.add('recording');
        text.textContent = 'Recording';
    } else if (state === 'transcribing') {
        text.textContent = 'Transcribing...';
    } else {
        indicator.classList.remove('recording');
        text.textContent = 'Ready';
    }
}

function appendToTranscription(text) {
    const area = document.getElementById('transcriptionArea');
    if (area.querySelector('.transcription-placeholder')) area.innerHTML = '';

    fullTranscript += text;

    const words = fullTranscript.split(/\s+/).filter(w => w.length > 0);
    const processedWordCount = Array.from(processedChunks.values())
        .map(chunk => chunk.split(/\s+/).filter(w => w.length > 0).length)
        .reduce((a, b) => a + b, 0);

    // Always use updateTranscriptionDisplay for consistent rendering
    updateTranscriptionDisplay();

    const backlog = words.length - processedWordCount;
    const chunkSize = backlog > 100 ? Math.min(100, BASE_CHUNK_SIZE * 3) : BASE_CHUNK_SIZE;

    if (backlog >= chunkSize) {
        processNewChunks(false, chunkSize);
    }
}


function getCompleteWordChunks(txt, forceProcessRemaining = false, chunkSize = BASE_CHUNK_SIZE) {
    const words = txt.split(/\s+/).filter(w => w.length > 0);
    const chunks = [];
    const processedWordCount = Array.from(processedChunks.values())
        .map(chunk => chunk.split(/\s+/).filter(w => w.length > 0).length)
        .reduce((a, b) => a + b, 0);

    for (let i = processedWordCount; i < words.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, words.length);
        const id = `${i}-${end}`;

        if (!processedChunks.has(id)) {
            if (end - i >= chunkSize || (forceProcessRemaining && end > i)) {
                chunks.push({
                    id,
                    text: words.slice(i, end).join(' '),
                    startIndex: i,
                    endIndex: end
                });
            }
        }
    }
    return chunks;
}

async function processNewChunks(forceProcessRemaining = false, chunkSize = BASE_CHUNK_SIZE) {
    const chunks = getCompleteWordChunks(fullTranscript, forceProcessRemaining, chunkSize);

    const chunkPromises = chunks.map(async (chunk) => {
        activeCorrections++;
        updateCorrectionStatus();

        try {
            const correctedText = await correctTyposForChunk(chunk.text);
            if (correctedText && correctedText.trim()) {
                processedChunks.set(chunk.id, correctedText);
                processTextForTerms(correctedText, chunk.id);
                processTextForEvents(correctedText, chunk.id);
            } else {
                processedChunks.set(chunk.id, '');
            }
        } finally {
            activeCorrections--;
            updateCorrectionStatus();
        }
    });

    await Promise.all(chunkPromises);
    updateTranscriptionDisplay();
}

async function processRemainingText() {
    if (isProcessingRemaining) return;

    const words = fullTranscript.split(/\s+/).filter(w => w.length > 0);
    const processedWordCount = Array.from(processedChunks.values())
        .map(chunk => chunk.split(/\s+/).filter(w => w.length > 0).length)
        .reduce((a, b) => a + b, 0);

    if (words.length > processedWordCount) {
        isProcessingRemaining = true;
        await processNewChunks(true);
        isProcessingRemaining = false;
    }
}

async function correctTyposForChunk(text) {
    if (!text.trim()) return '';

    // Build conversation history with 4 key examples
    const conversation = [
        {
            role: "user",
            content: "Clean up lecture transcriptions: fix spelling, add punctuation/capitalization, remove interruptions like (laugh), [inaudible], etc. If no meaningful content, return empty string. If sentence is unfinished at the end, keep it. Return ONLY cleaned text."
        },
        {
            role: "assistant",
            content: "I'll clean up transcriptions by fixing errors and removing interruptions while preserving meaningful content."
        },
        {
            role: "user",
            content: "(background noise) (students chatting) (inaudible) (coughing)"
        },
        {
            role: "assistant",
            content: ""
        },
        {
            role: "user",
            content: "so the inflasion rate (student talking) have you seen the recent movie. is incresing rapedly wat do you think"
        },
        {
            role: "assistant",
            content: "So the inflation rate is increasing rapidly. What do you think?"
        },
        {
            role: "user",
            content: "I tried and I tried. In 2011, the dark web was really difficult, so I just forgot about it. And then about a year later, I"
        },
        {
            role: "assistant",
            content: "I tried and I tried. In 2011, the dark web was really difficult, so I just forgot about it. And then about a year later, I"
        },
        {
            role: "user",
            content: "Anybody ever heard of Mt. Gox? (mouse clicking) Does that sound familiar? No. It was the first place to buy Bitcoin and it was 404. The website."
        },
        {
            role: "assistant",
            content: "Anybody ever heard of Mt. Gox? Does that sound familiar? No. It was the first place to buy Bitcoin and it was 404. The website."
        },
        {
            role: "user",
            content: text
        }
    ];

    try {
        const messages = conversation.map(msg => ({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content
        }));

        const response = await fetch('/api/deepseek', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: messages[messages.length - 1].content,
                systemPrompt: "You are a helpful intelligent assistant",
                messages: messages
            })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const cleaned = data.choices[0].message.content.trim();

        // Handle edge cases
        if (cleaned === '""' || cleaned === "''" || cleaned.toLowerCase() === 'empty string') {
            return '';
        }

        return cleaned;
    } catch (e) {
        console.error('Correction error:', e);
        return text;
    }
}

function saveCursorPosition() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const area = document.getElementById('transcriptionArea');
    const pre = range.cloneRange();
    pre.selectNodeContents(area);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return {start, end: start + range.toString().length};
}

function restoreCursorPosition(pos) {
    if (!pos) return;
    const area = document.getElementById('transcriptionArea');
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let charCount = 0, node, startNode = null, startOffset = 0;
    while ((node = walker.nextNode())) {
        const len = node.textContent.length;
        if (charCount + len >= pos.start) {
            startNode = node;
            startOffset = pos.start - charCount;
            break;
        }
        charCount += len;
    }
    if (startNode) {
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.setStart(startNode, Math.min(startOffset, startNode.length));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) {
        }
    }
}

let readingAnimationId = null;

function startReadingAnimation(text) {
    if (readingAnimationId) {
        clearTimeout(readingAnimationId);
    }

    const container = document.getElementById('processing-text');
    if (!container) return;

    container.innerHTML = `
        <span class="reading-highlight"></span>
        <span class="processing-text-content">${text}</span>
    `;

    setTimeout(() => {
        const highlight = container.querySelector('.reading-highlight');
        if (highlight) {
            highlight.style.width = '100%';
        }
    }, 50);

    readingAnimationId = setTimeout(() => {
        readingAnimationId = null;
    }, 3000);
}

function updateTranscriptionDisplay() {
    const area = document.getElementById('transcriptionArea');

    // Check if transcription area has focus
    const hasFocus = area === document.activeElement;
    let pos = null;
    let isAtEnd = false;

    // Only save position if transcription area has focus
    if (hasFocus) {
        pos = saveCursorPosition();
        isAtEnd = pos && pos.start === area.innerText.length;
    }

    if (!fullTranscript) {
        area.innerHTML = '<div class="transcription-placeholder">Start recording or upload an audio file to begin transcription</div>';
        return;
    }

    let html = '';
    const words = fullTranscript.split(/\s+/).filter(w => w.length > 0);
    let wordIndex = 0;

    processedChunks.forEach((correctedText, chunkId) => {
        const [start, end] = chunkId.split('-').map(Number);
        const highlightedChunk = applyHighlightsWithPriority(correctedText, chunkId);
        html += `<span class="processed-chunk">${highlightedChunk}</span> `;
        wordIndex = end;
    });

    if (wordIndex < words.length) {
        const remainingWords = words.slice(wordIndex);
        const remainingText = remainingWords.join(' ');

        const isProcessingChunk = activeCorrections > 0 && wordIndex === Array.from(processedChunks.values())
            .map(chunk => chunk.split(/\s+/).filter(w => w.length > 0).length)
            .reduce((a, b) => a + b, 0);

        if (isProcessingChunk) {
            html += `<span class="processing-text" id="processing-text">${remainingText}</span>`;
            setTimeout(() => startReadingAnimation(remainingText), 50);
        } else {
            html += remainingText;
        }
    }

    area.innerHTML = html.trim();

    // Only restore cursor if area had focus
    if (hasFocus) {
        if (isAtEnd) {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(area);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        } else if (pos) {
            restoreCursorPosition(pos);
        }
    }

    // Re-attach event listeners
    document.querySelectorAll('.highlighted-term').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const term = el.getAttribute('data-term');
            scrollToElement(el);
            highlightCard(`term-${term.toLowerCase().replace(/\s+/g, '-')}`);
        });
    });

    document.querySelectorAll('.highlighted-event').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const event = el.getAttribute('data-event');
            scrollToElement(el);
            highlightCard(`event-${event}`);
        });
    });
}

async function processTextForTerms(text, chunkId) {
    if (!text.trim()) return;
    document.getElementById('processingIndicator').style.display = 'inline-flex';

    // Build conversation history for few-shot learning
    const conversation = [
        {
            role: "user",
            content: "Extract complex economics/finance/business terms from lecture transcripts. Focus on technical terms, financial instruments, and economic theories. Return JSON only: {\"terms\": [{\"term\": \"...\", \"definition\": \"...\", \"historicalContext\": \"...\"}]}"
        },
        {
            role: "assistant",
            content: "I'll extract complex economic terms and provide their definitions and historical context in JSON format."
        },
        {
            role: "user",
            content: "The Federal Reserve announced changes to interest rates affecting monetary policy"
        },
        {
            role: "assistant",
            content: "{\"terms\": [{\"term\": \"Federal Reserve\", \"definition\": \"The central banking system of the United States responsible for monetary policy\", \"historicalContext\": \"Established in 1913 after financial panics to provide stable monetary framework\"}, {\"term\": \"monetary policy\", \"definition\": \"Actions by central banks to influence money supply and interest rates\", \"historicalContext\": \"Modern monetary policy evolved from Keynesian economics in the 1930s\"}]}"
        },
        {
            role: "user",
            content: "Companies are issuing more bonds and ETFs in the derivatives market"
        },
        {
            role: "assistant",
            content: "{\"terms\": [{\"term\": \"bonds\", \"definition\": \"Debt securities where investors loan money to entities for defined periods at fixed interest rates\", \"historicalContext\": \"First government bonds trace to 1694 Bank of England, corporate bonds emerged in 1800s railroad expansion\"}, {\"term\": \"ETFs\", \"definition\": \"Exchange-Traded Funds - securities tracking indexes traded like stocks\", \"historicalContext\": \"First ETF launched 1993, revolutionized passive investing\"}, {\"term\": \"derivatives\", \"definition\": \"Financial contracts whose value depends on underlying assets\", \"historicalContext\": \"Modern derivatives market began with 1972 Chicago Mercantile Exchange currency futures\"}]}"
        },
        {
            role: "user",
            content: "The company makes money by selling products"
        },
        {
            role: "assistant",
            content: "{\"terms\": []}"
        },
        {
            role: "user",
            content: text
        }
    ];

    try {
        // Create messages array from conversation
        const messages = conversation.map(msg => ({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content
        }));

        const requestBody = {
            model: 'deepseek-chat',
            messages: messages,
            stream: false,
            temperature: 1.3
        };

        const response = await fetch('/api/deepseek', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: messages[messages.length - 1].content,
                systemPrompt: "You are an helpful, intelligent assistant",
                messages: messages // Pass full conversation
            })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const content = data.choices[0].message.content;

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const json = JSON.parse(jsonMatch[0]);
            if (json.terms && json.terms.length > 0) {
                json.terms.forEach(t => {
                    if (!detectedTerms.has(t.term.toLowerCase())) {
                        detectedTerms.set(t.term.toLowerCase(), t);
                        addTermCard(t);
                    }
                });
                updateTranscriptionDisplay();
            }
        }
    } catch (e) {
        console.error('Term error:', e);
    } finally {
        if (!isProcessing) {
            document.getElementById('processingIndicator').style.display = 'none';
        }
    }
}

async function processTextForEvents(text, chunkId) {
    if (!text.trim()) return;

    // Build conversation history for event detection
    const conversation = [
        {
            role: "user",
            content: "Identify historical events mentioned in lecture transcripts. if the same event is mentioned multiple times, only return 1 occurrence of that event and quote the entire text from start to end. Return JSON: {\"events\": [{\"quote\": \"exact quote\", \"event\": \"event name\", \"description\": \"detailed description\"}]}"
        },
        {
            role: "assistant",
            content: "I'll identify historical events with their quotes and descriptions in JSON format."
        },
        {
            role: "user",
            content: "Another event is IRS 2014, where roughly a year later, the IRS issued notice 2014-21, declaring that Bitcoin is treated as property rather than currency."
        },
        {
            role: "assistant",
            content: "{\"events\": [{\"quote\": \"IRS 2014, where roughly a year later, the IRS issued notice 2014-21\", \"event\": \"Notice 2014-21\", \"description\": \"IRS guidance issued in 2014 that classified Bitcoin and cryptocurrencies as property for tax purposes rather than currency, establishing foundational tax treatment for digital assets in the United States\"}]}"
        },
        {
            role: "user",
            content: "So where does Bitcoin gain its value? Bitcoin gained its value primarily through FinCEN in March 2013. It basically classified Bitcoin as a money service business."
        },
        {
            role: "assistant",
            content: "{\"events\": [{\"quote\": \"through FinCEN in March 2013\", \"event\": \"FIN-2013-G001\", \"description\": \"In March 2013, the Financial Crimes Enforcement Network (FinCEN) issued guidance FIN-2013-G001, marking the U.S. government's first formal policy on cryptocurrency. It classified all Bitcoin exchanges as Money Services Businesses (MSBs) subject to Bank Secrecy Act registration and reporting, while exempting individual miners and ordinary users from MSB obligations\"}]}"
        },
        {
            role: "user",
            content: "Inflation happens when prices rise across the economy"
        },
        {
            role: "assistant",
            content: "{\"events\": []}"
        },
        {
            role: "user",
            content: "The 2008 financial crisis was triggered by the housing market collapse"
        },
        {
            role: "assistant",
            content: "{\"events\": [{\"quote\": \"2008 financial crisis was triggered by the housing market collapse\", \"event\": \"2008 Financial Crisis\", \"description\": \"Global financial crisis triggered by the collapse of the U.S. housing bubble, subprime mortgage failures, and the bankruptcy of Lehman Brothers, leading to worldwide recession and unprecedented government interventions including bank bailouts and quantitative easing\"}]}"
        },
        {
            role: "user",
            content: text
        }
    ];

    try {
        const messages = conversation.map(msg => ({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content
        }));

        const requestBody = {
            model: 'deepseek-chat',
            messages: messages,
            stream: false,
            temperature: 1.3
        };

        const response = await fetch('/api/deepseek', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: messages[messages.length - 1].content,
                systemPrompt: "You are an helpful, intelligent assistant",
                messages: messages
            })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const content = data.choices[0].message.content;
        console.log('Event detection response:', content);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const json = JSON.parse(jsonMatch[0]);
            if (json.events && json.events.length > 0) {
                json.events.forEach(e => {
                    const eventKey = e.event.toLowerCase().replace(/\s+/g, '-');
                    if (!detectedEvents.has(eventKey)) {
                        e.chunkId = chunkId;
                        e.searchTerms = generateEventSearchTerms(e.event);
                        if (e.quote && !e.searchTerms.includes(e.quote)) {
                            e.searchTerms.push(e.quote);
                        }
                        console.log(`Event detected: ${e.event}, search terms:`, e.searchTerms);
                        detectedEvents.set(eventKey, e);
                        addEventCard(e, eventKey);
                    }
                });
                updateTranscriptionDisplay();
            }
        }
    } catch (e) {
        console.error('Event detection error:', e);
    }
}

// Add this missing function after processTextForEvents
function generateEventSearchTerms(eventName) {
    const terms = [eventName];
    const lowerEvent = eventName.toLowerCase();

    // Extract key parts of the event name
    if (lowerEvent.includes('financial crisis') || lowerEvent.includes('2008')) {
        terms.push('financial crisis', 'crisis', '2008', 'subprime');
    }
    if (lowerEvent.includes('black tuesday')) {
        terms.push('Black Tuesday', 'black', 'Tuesday', '1929', 'crash', 'market crash');
    }
    if (lowerEvent.includes('great depression')) {
        terms.push('Great Depression', 'depression', '1930s', 'economic depression');
    }
    if (lowerEvent.includes('dot-com') || lowerEvent.includes('dotcom')) {
        terms.push('dot-com', 'dotcom', 'tech bubble', 'bubble', 'internet bubble');
    }
    if (lowerEvent.includes('brexit')) {
        terms.push('Brexit', 'EU', 'referendum', 'European Union');
    }
    if (lowerEvent.includes('2014-21') || lowerEvent.includes('notice')) {
        terms.push('2014-21', 'IRS', 'notice', 'Bitcoin', 'property');
    }
    if (lowerEvent.includes('fincen') || lowerEvent.includes('2013')) {
        terms.push('FinCEN', 'March 2013', '2013', 'money service', 'Bitcoin');
    }

    // Add partial matches from the event name
    const words = eventName.split(/\s+/);
    words.forEach(word => {
        if (word.length > 3 && !['the', 'and', 'for', 'with'].includes(word.toLowerCase())) {
            terms.push(word);
        }
    });

    // Remove duplicates
    return [...new Set(terms)];
}

function addTermCard(termData) {
    const container = document.getElementById('termsContainer');
    const placeholder = container.querySelector('.no-terms');
    if (placeholder) placeholder.remove();

    const card = document.createElement('div');
    card.className = 'term-card';
    card.id = `term-${termData.term.toLowerCase().replace(/\s+/g, '-')}`;
    card.innerHTML = `
        <h3>${termData.term}</h3>
        <div class="term-definition">${termData.definition}</div>
        <div class="term-context">${termData.historicalContext}</div>
    `;

    card.addEventListener('click', () => {
        scrollToLastOccurrence(termData.term, false);
        highlightCard(card.id);
    });
    container.insertBefore(card, container.firstChild);
}

// Replace the addEventCard function
function addEventCard(eventData, eventKey) {
    const container = document.getElementById('termsContainer');
    const placeholder = container.querySelector('.no-terms');
    if (placeholder) placeholder.remove();

    const card = document.createElement('div');
    card.className = 'event-card';
    card.id = `event-${eventKey}`;
    card.innerHTML = `
        <h3>${eventData.event}</h3>
        <div class="event-quote">"${eventData.quote}"</div>
        <div class="event-description">${eventData.description}</div>
    `;

    card.addEventListener('click', () => {
        scrollToLastOccurrence(eventData.event, true);
        highlightCard(card.id);
    });
    container.insertBefore(card, container.firstChild);
}

function scrollToElement(element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('highlight-focus');
    setTimeout(() => {
        element.classList.remove('highlight-focus');
    }, 2000);
}

function scrollToLastOccurrence(searchText, isEvent = false) {
    const area = document.getElementById('transcriptionArea');
    let targetElements = [];

    if (isEvent) {
        // For events, find all highlighted events with matching data-event attribute
        const eventKey = searchText.toLowerCase().replace(/\s+/g, '-');
        targetElements = Array.from(area.querySelectorAll(`.highlighted-event[data-event="${eventKey}"]`));
    } else {
        // For terms, find all highlighted terms with matching data-term attribute
        const termKey = searchText.toLowerCase();
        targetElements = Array.from(area.querySelectorAll('.highlighted-term')).filter(el => {
            return el.getAttribute('data-term').toLowerCase() === termKey;
        });
    }

    if (targetElements.length > 0) {
        // Get the last occurrence
        const lastElement = targetElements[targetElements.length - 1];
        scrollToElement(lastElement);
    }
}


function highlightCard(id) {
    const card = document.getElementById(id);
    if (card) {
        card.scrollIntoView({behavior: 'smooth', block: 'center'});
        const isEvent = id.startsWith('event-');
        card.style.borderColor = isEvent ? 'rgba(245, 158, 11, 0.6)' : 'rgba(16, 185, 129, 0.5)';
        card.style.boxShadow = isEvent ? '0 8px 32px rgba(245, 158, 11, 0.3)' : '0 8px 32px rgba(16, 185, 129, 0.3)';
        setTimeout(() => {
            card.style.borderColor = '';
            card.style.boxShadow = '';
        }, 2000);
    }
}

async function toggleRecording() {
    if (!checkBrowserSupport()) {
        showError('Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Edge.');
        return;
    }

    if (!microphoneGranted) {
        await requestMicrophonePermission();
        if (!microphoneGranted) return;
    }

    const btn = document.getElementById('recordBtn');

    if (isRecording) {
        isRecording = false;
        clearInterval(recordingTimer);

        if (currentRecorder && currentRecorder.state === 'recording') {
            currentRecorder.stop();
        }

        btn.textContent = 'Start Recording';
        btn.classList.remove('recording');

        if (window.AudioVisualizer) {
            window.AudioVisualizer.stop();
        }

        updateStatus('ready');
        setTimeout(processRemainingText, 500);
    } else {
        isRecording = true;
        uploadQueue = [];
        activeUploads = 0;

        try {
            currentRecorder = createRecorder();
            currentRecorder.start();

            recordingTimer = setInterval(() => {
                if (isRecording) {
                    if (currentRecorder && currentRecorder.state === 'recording') {
                        currentRecorder.stop();
                    }
                    currentRecorder = createRecorder();
                    if (currentRecorder) {
                        currentRecorder.start();
                    }
                }
            }, 15000);

            btn.textContent = 'Stop Recording';
            btn.classList.add('recording');

            if (window.AudioVisualizer && mediaStream) {
                await window.AudioVisualizer.init(mediaStream);
            }

            updateStatus('recording');
        } catch (e) {
            console.error('Record error:', e);
            isRecording = false;
            showError('Failed to record.');
        }
    }
}

function clearContent() {
    console.log('Clearing transcription content');
    fullTranscript = '';
    correctedTranscript = '';
    processedChunks.clear();
    detectedTerms.clear();
    detectedEvents.clear();
    isProcessingRemaining = false;
    audioChunks = [];
    uploadQueue = [];
    activeUploads = 0;
    clearTimeout(silenceTimer);
    clearInterval(recordingTimer);
    document.getElementById('transcriptionArea').innerHTML = `<div class="transcription-placeholder">Start recording or upload an audio file to begin transcription</div>`;
    document.getElementById('termsContainer').innerHTML = `<div class="no-terms">Economic terms and events will appear here as they're detected</div>`;
    updateUploadStatus();
}

function applyHighlightsWithPriority(text, chunkId) {
    // First, collect all potential highlights
    const highlights = [];

    // Collect term highlights
    detectedTerms.forEach((data, term) => {
        const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
            highlights.push({
                type: 'term',
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
                data: term,
                priority: match[0].length // Longer terms have higher priority
            });
        }
    });

    // Collect event highlights
    detectedEvents.forEach((data, eventKey) => {
        // Ensure searchTerms exists
        if (!data.searchTerms) {
            data.searchTerms = generateEventSearchTerms(data.event);
            if (data.quote) {
                data.searchTerms.push(data.quote);
            }
        }

        // Try each search term
        data.searchTerms.forEach(searchTerm => {
            const regex = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, 'gi');
            let match;
            while ((match = regex.exec(text)) !== null) {
                highlights.push({
                    type: 'event',
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[0],
                    data: eventKey,
                    priority: 1000 + match[0].length // Events have higher priority than terms
                });
            }
        });
    });

    // Sort highlights by start position, then by priority (descending)
    highlights.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return b.priority - a.priority;
    });

    // Resolve overlaps - improved logic
    const finalHighlights = [];

    for (const highlight of highlights) {
        let canAdd = true;

        // Check against all existing highlights
        for (let i = finalHighlights.length - 1; i >= 0; i--) {
            const existing = finalHighlights[i];

            // Check for overlap
            if (highlight.start < existing.end && highlight.end > existing.start) {
                // There's an overlap
                if (highlight.priority > existing.priority) {
                    // Current highlight has higher priority, remove the existing one
                    finalHighlights.splice(i, 1);
                } else {
                    // Existing highlight has higher priority, don't add current
                    canAdd = false;
                    break;
                }
            }
        }

        if (canAdd) {
            finalHighlights.push(highlight);
        }
    }

    // Sort final highlights by position
    finalHighlights.sort((a, b) => a.start - b.start);

    // Apply highlights to text
    let result = '';
    let lastIndex = 0;

    for (const highlight of finalHighlights) {
        // Add unhighlighted text before this highlight
        result += escapeHtml(text.substring(lastIndex, highlight.start));

        // Add highlighted text
        if (highlight.type === 'event') {
            result += `<span class="highlighted-event" data-event="${highlight.data}" data-chunk="${chunkId}">${escapeHtml(highlight.text)}</span>`;
        } else {
            result += `<span class="highlighted-term" data-term="${highlight.data}" data-chunk="${chunkId}">${escapeHtml(highlight.text)}</span>`;
        }

        lastIndex = highlight.end;
    }

    // Add remaining text
    result += escapeHtml(text.substring(lastIndex));

    return result;
}

// Helper function to escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}



// Sidebar Toggle Function
function initializeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const appContainer = document.querySelector('.app-container');
    const toggleBtn = document.getElementById('sidebarToggle');

    if (toggleBtn) {
        // Toggle functionality
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            appContainer.classList.toggle('sidebar-collapsed');

            // Save state to localStorage
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });

        // Restore saved state
        const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
            appContainer.classList.add('sidebar-collapsed');
        }
    }
}


function initNudgeResizer() {
    const container = document.querySelector('.main-container');
    const topPane = document.querySelector('.transcription-area');
    const bottomPane = document.querySelector('.notes-area');

    // Create wrapper for transcription area
    const transcriptionWrapper = document.createElement('div');
    transcriptionWrapper.className = 'transcription-wrapper';
    transcriptionWrapper.style.flex = topPane.style.flex || '0 0 60%';
    topPane.parentNode.insertBefore(transcriptionWrapper, topPane);
    transcriptionWrapper.appendChild(topPane);

    // Remove flex from transcription area since wrapper handles it
    topPane.style.flex = 'unset';
    topPane.style.height = '100%';

    // Create copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"></path></svg>`;
    copyBtn.title = 'Copy transcript';
    transcriptionWrapper.appendChild(copyBtn);

    copyBtn.addEventListener('click', async () => {
        const text = topPane.innerText.replace('Start recording or upload an audio file to begin transcription', '').trim();
        try {
            await navigator.clipboard.writeText(text);
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = '✓';
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"></path></svg>`;
            }, 2000);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    });

    // Create resize handle inside the transcription wrapper at the bottom
    const handle = document.createElement('div');
    handle.className = 'nudge-handle';
    handle.setAttribute('title', 'Drag to resize');
    transcriptionWrapper.appendChild(handle);

    let dragging = false;

    handle.addEventListener('mousedown', e => {
        dragging = true;
        handle.classList.add('dragging');
        document.body.classList.add('resizing');
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;

        const { top, height } = container.getBoundingClientRect();
        const relY = e.clientY - top;
        let pct = (relY / height) * 100;

        // Constrain between 20% and 80%
        pct = Math.max(20, Math.min(80, pct));

        // Update wrapper flex
        transcriptionWrapper.style.flex = `0 0 ${pct}%`;
        bottomPane.style.flex = `0 0 ${100 - pct}%`;

        // Store the preference
        localStorage.setItem('transcriptionRatio', pct);
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            handle.classList.remove('dragging');
            document.body.classList.remove('resizing');
        }
    });

    // Restore saved ratio
    const savedRatio = localStorage.getItem('transcriptionRatio');
    if (savedRatio) {
        transcriptionWrapper.style.flex = `0 0 ${savedRatio}%`;
        bottomPane.style.flex = `0 0 ${100 - savedRatio}%`;
    }
}

function initNotesPlaceholder() {
    const notesArea = document.getElementById('notesArea');

    // Set initial placeholder
    if (!notesArea.textContent.trim()) {
        notesArea.setAttribute('data-placeholder', 'Add notes here...');
    }

    // Monitor for changes
    notesArea.addEventListener('input', function() {
        if (this.textContent.trim()) {
            this.removeAttribute('data-placeholder');
        } else {
            this.setAttribute('data-placeholder', 'Add notes here...');
        }
    });

    // Handle focus to ensure placeholder works
    notesArea.addEventListener('focus', function() {
        // Clean up any browser-inserted elements if truly empty
        if (!this.textContent.trim()) {
            this.innerHTML = '';
            this.setAttribute('data-placeholder', 'Add notes here...');
        }
    });
}



document.addEventListener('DOMContentLoaded', async () => {
    console.log('Init EconSpeak with DeepSeek');

    detectBrowser();

    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
        document.getElementById('permissionModal').style.display = 'flex';
    } else {
        microphoneGranted = true;
        await requestMicrophonePermission();
    }

    // Record button
    document.getElementById('recordBtn').addEventListener('click', toggleRecording);
    document.getElementById('clear-btn').addEventListener('click', clearContent);

    // Upload button - make sure this event listener exists
    const audioUpload = document.getElementById('audioUpload');
    if (audioUpload) {
        audioUpload.addEventListener('change', handleAudioUpload);
        console.log('Audio upload listener attached');
    } else {
        console.error('audioUpload element not found!');
    }

    window.requestMicrophonePermission = requestMicrophonePermission;

    initializeSidebar();

    initNudgeResizer();

    initNotesPlaceholder()

    console.log('Ready.');
});