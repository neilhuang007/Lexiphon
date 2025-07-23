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

// Category management
let categoryPrompts = {
    finance: { terms: null, events: null },
    cs: { terms: null, events: null },
    history: { terms: null, events: null }
};
let currentCategory = 'finance';

async function loadCategoryPrompts() {
    try {
        // Load all prompt files - use relative paths instead of absolute
        const promptFiles = [
            { category: 'finance', type: 'terms', path: './prompts/finance-terms.json' },
            { category: 'finance', type: 'events', path: './prompts/finance-events.json' },
            { category: 'cs', type: 'terms', path: './prompts/cs-terms.json' },
            { category: 'cs', type: 'events', path: './prompts/cs-events.json' },
            { category: 'history', type: 'terms', path: './prompts/history-terms.json' },
            { category: 'history', type: 'events', path: './prompts/history-events.json' }
        ];

        const loadPromises = promptFiles.map(async (file) => {
            try {
                const response = await fetch(file.path);
                if (response.ok) {
                    const data = await response.json();
                    categoryPrompts[file.category][file.type] = data;
                    console.log(`Loaded ${file.category} ${file.type} prompts`);
                } else {
                    throw new Error(`Failed to load ${file.path}: ${response.status}`);
                }
            } catch (e) {
                console.error(`Failed to load ${file.path}:`, e);
                throw e;
            }
        });

        await Promise.all(loadPromises);
        console.log('All prompts loaded:', categoryPrompts);
    } catch (error) {
        console.error('Error loading prompts:', error);
        throw new Error('Failed to load prompt configuration files');
    }
}

function switchCategory(category) {
    console.log('Switching to category:', category);

    // Map category to handler name
    const categoryToHandler = {
        'finance': 'finance-combined',
        'cs': 'cs-combined',
        'history': 'history-combined'
    };

    const handlerName = categoryToHandler[category];
    if (handlerName && window.HandlerRegistry) {
        try {
            window.HandlerRegistry.setActive(handlerName);
        } catch (error) {
            console.error('Handler not found:', handlerName);
            // Fallback to old behavior
            currentCategory = category;
        }
    } else {
        // Fallback if framework not loaded
        currentCategory = category;
    }

    // Update UI - remove active from all items
    document.querySelectorAll('.category-item').forEach(item => {
        item.classList.remove('active');
    });

    // Add active to clicked item
    const activeItem = document.querySelector(`.category-item[data-category="${category}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    // Update header
    const headerText = {
        finance: 'Finance & Business',
        cs: 'Computer Science',
        history: 'History'
    };
    document.querySelector('.app-header h3').textContent = headerText[category] || 'Finance & Business';

    // Clear existing content when switching
    clearContent();
}

async function callDeepSeek(prompt, systemPrompt = "You are a helpful assistant.", messages = null, useJsonOutput = false) {
    const body = messages
        ? {messages, useJsonOutput}
        : {prompt, systemPrompt, useJsonOutput};

    const response = await fetch('/api/deepseek', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('DeepSeek API error:', errorText);
        throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();

    // Handle occasional empty content when using JSON output
    if (useJsonOutput && (!data.choices[0].message.content || data.choices[0].message.content.trim() === '')) {
        console.warn('Empty JSON response, retrying...');
        // Retry once with slightly modified prompt
        return callDeepSeek(prompt, systemPrompt, messages, useJsonOutput);
    }

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
        // Process audio file for visualization
        if (window.AudioVisualizer) {
            await window.AudioVisualizer.processAudioFile(file);
        }

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

                // Notify active handler
                const activeHandler = window.HandlerRegistry.getActive();
                if (activeHandler) {
                    await activeHandler.processChunk(correctedText, {
                        chunkId: chunk.id,
                        startIndex: chunk.startIndex,
                        endIndex: chunk.endIndex
                    });
                }
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

    const prompt = `task is to clean up this lecture transcription: "${text}"

Rules:
1. Fix spelling
2. Add punctuation capitalization
3. Remove ALL unrelated content and indicators, ex. (laugh), [inaudible], (coughing), (mouse clicking) etc.
6. If no actual meaningful content, return empty string ""
7. Return ONLY the cleaned text or empty string, nothing else do not add quotation marks around the sentence, use a spartan tone of voice

Example:
Input: "(background noise) (students chatting) (inaudible) (coughing)"
Output: ""

Input: "(clears throat) So basically, um, like- like, the way this works is that when you type in the URL, you get a 404 error, which means page not found, and that's, uh (mumbles) kinda the joke there."
Output: So basically, the way this works is that when you type in the URL, you get a 404 error, which means page not found, and that's kinda the joke there.

Input: "Anybody ever heard of Mt. Gox? (mouse clicking) Does that sound familiar? No. It was the first place to buy Bitcoin and it was 404. The website."
Output: Anybody ever heard of Mt. Gox? Does that sound familiar? No. It was the first place to buy Bitcoin and it was 404. The website.`;

    try {
        const response = await callDeepSeek(prompt, "You are a transcription editor for economics lectures");
        const cleaned = response.trim();
        if (cleaned === '""' || cleaned === "''") return '';
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
            html += `<span class="processing-text">${remainingText}</span>`;
        } else {
            html += `<span class="unprocessed-text">${remainingText}</span>`;
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

    // Re-attach event listeners for handlers
    attachTranscriptEventListeners();
}

async function processTextForEvents(text, chunkId) {
    if (!text.trim()) return;

    const promptData = categoryPrompts[currentCategory]?.events;
    if (!promptData) {
        throw new Error(`No event prompts loaded for category: ${currentCategory}`);
    }

    // Build messages from loaded examples
    const messages = [
        {
            role: "system",
            content: promptData.systemPrompt
        },
        {
            role: "user",
            content: promptData.taskDescription + `\nExtract events from: "${promptData.examples[0].input}"`
        },
        {
            role: "assistant",
            content: JSON.stringify(promptData.examples[0].output)
        }
    ];

    // Add remaining examples
    for (let i = 1; i < promptData.examples.length; i++) {
        messages.push({
            role: "user",
            content: `Extract events from: "${promptData.examples[i].input}"`
        });
        messages.push({
            role: "assistant",
            content: JSON.stringify(promptData.examples[i].output)
        });
    }

    // Add the actual text to process
    messages.push({
        role: "user",
        content: `Extract events from: "${text}"`
    });

    try {
        const response = await callDeepSeek(null, null, messages, true);
        console.log('Event detection response:', response);

        let json;
        try {
            json = JSON.parse(response);
        } catch (parseError) {
            console.error('Failed to parse events JSON:', parseError);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                json = JSON.parse(jsonMatch[0]);
            } else {
                throw parseError;
            }
        }

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
    } catch (e) {
        console.error('Event detection error:', e);
        throw e;
    }
}

async function processTextForTerms(text, chunkId) {
    if (!text.trim()) return;
    document.getElementById('processingIndicator').style.display = 'inline-flex';

    const promptData = categoryPrompts[currentCategory]?.terms;
    if (!promptData) {
        throw new Error(`No term prompts loaded for category: ${currentCategory}`);
    }

    // Build messages from loaded examples
    const messages = [
        {
            role: "system",
            content: promptData.systemPrompt
        },
        {
            role: "user",
            content: promptData.taskDescription + `\n\nExtract terms from: "${promptData.examples[0].input}"`
        },
        {
            role: "assistant",
            content: JSON.stringify(promptData.examples[0].output)
        }
    ];

    // Add remaining examples
    for (let i = 1; i < promptData.examples.length; i++) {
        messages.push({
            role: "user",
            content: `Extract terms from: "${promptData.examples[i].input}"`
        });
        messages.push({
            role: "assistant",
            content: JSON.stringify(promptData.examples[i].output)
        });
    }

    // Add the actual text to process
    messages.push({
        role: "user",
        content: `Extract terms from: "${text}"`
    });

    try {
        const response = await callDeepSeek(null, null, messages, true);
        console.log('Terms response:', response);

        let json;
        try {
            json = JSON.parse(response);
        } catch (parseError) {
            console.error('Failed to parse terms JSON:', parseError);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                json = JSON.parse(jsonMatch[0]);
            } else {
                throw parseError;
            }
        }

        if (json.terms && json.terms.length > 0) {
            json.terms.forEach(t => {
                if (!detectedTerms.has(t.term.toLowerCase())) {
                    detectedTerms.set(t.term.toLowerCase(), t);
                    addTermCard(t);
                }
            });
            updateTranscriptionDisplay();
        }
    } catch (e) {
        console.error('Term error:', e);
        throw e;
    } finally {
        if (!isProcessing) {
            document.getElementById('processingIndicator').style.display = 'none';
        }
    }
}

function generateEventSearchTerms(eventName) {
    const terms = [eventName];
    const lowerEvent = eventName.toLowerCase();

    // Finance events
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

    // CS events
    if (lowerEvent.includes('iphone')) {
        terms.push('iPhone', 'Apple', 'launch', '2007', 'smartphone');
    }
    if (lowerEvent.includes('windows')) {
        terms.push('Windows', 'Microsoft', 'operating system', 'OS');
    }
    if (lowerEvent.includes('internet')) {
        terms.push('Internet', 'ARPANET', 'world wide web', 'WWW');
    }

    // History events
    if (lowerEvent.includes('berlin wall')) {
        terms.push('Berlin Wall', 'wall', 'Berlin', '1989', 'fall');
    }
    if (lowerEvent.includes('world war')) {
        terms.push('World War', 'war', 'WWI', 'WWII', 'global conflict');
    }
    if (lowerEvent.includes('revolution')) {
        terms.push('Revolution', 'revolutionary', 'uprising', 'revolt');
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
    element.scrollIntoView({behavior: 'smooth', block: 'center'});
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
            // Reset to default bar display
            window.AudioVisualizer.mode = 'realtime';
            window.AudioVisualizer.createBars();
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

    const transcriptionArea = document.getElementById('transcriptionArea');
    if (transcriptionArea) {
        transcriptionArea.innerHTML = `<div class="transcription-placeholder">Start recording or upload an audio file to begin transcription</div>`;
    }

    const termsContainer = document.getElementById('termsContainer');
    if (termsContainer) {
        termsContainer.innerHTML = `<div class="no-terms">Economic terms and events will appear here as they're detected</div>`;
    }

    updateUploadStatus();

    // Reset visualizer
    if (window.AudioVisualizer) {
        window.AudioVisualizer.destroy();
        // Small delay to ensure clean reset
        setTimeout(() => {
            window.AudioVisualizer.createBars();
        }, 100);
    }
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

    // Add category click handlers
    document.querySelectorAll('.category-item').forEach(item => {
        item.addEventListener('click', () => {
            const category = item.getAttribute('data-category');
            if (category) {
                switchCategory(category);
            }
        });
    });
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

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'transcription-buttons';
    transcriptionWrapper.appendChild(buttonContainer);

    // Create copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"></path></svg>`;
    copyBtn.title = 'Copy transcript';
    buttonContainer.appendChild(copyBtn);

    // Create export button
    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-button';
    exportBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M224,152v56a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V152a8,8,0,0,1,16,0v56H208V152a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,132.69V40a8,8,0,0,0-16,0v92.69L93.66,106.34a8,8,0,0,0-11.32,11.32Z"></path></svg>`;
    exportBtn.title = 'Export analysis';
    buttonContainer.appendChild(exportBtn);

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

    exportBtn.addEventListener('click', () => {
        exportAnalysis();
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

        const {top, height} = container.getBoundingClientRect();
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
    notesArea.addEventListener('input', function () {
        if (this.textContent.trim()) {
            this.removeAttribute('data-placeholder');
        } else {
            this.setAttribute('data-placeholder', 'Add notes here...');
        }
    });

    // Handle focus to ensure placeholder works
    notesArea.addEventListener('focus', function () {
        // Clean up any browser-inserted elements if truly empty
        if (!this.textContent.trim()) {
            this.innerHTML = '';
            this.setAttribute('data-placeholder', 'Add notes here...');
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Init Lexiphon with Handler Framework');

    try {
        // Load prompts first
        await loadCategoryPrompts();

        // Initialize framework components
        if (window.RightPanelManager) {
            window.RightPanelManager.init();
        }

        // Register handlers after prompt loading
        if (window.BaseHandler && window.HandlerRegistry) {
            registerHandlers();
            // Set default handler
            window.HandlerRegistry.setActive('finance-combined');
        } else {
            console.warn('Handler framework not loaded, falling back to legacy mode');
        }

    } catch (error) {
        showError('Failed to load configuration. Please check prompt files.');
        console.error(error);
    }

    detectBrowser();

    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
        document.getElementById('permissionModal').style.display = 'flex';
    } else {
        microphoneGranted = true;
        await requestMicrophonePermission();
    }

    // Initialize visualizer bars
    if (window.AudioVisualizer) {
        window.AudioVisualizer.createBars();
    }

    // Record button
    document.getElementById('recordBtn').addEventListener('click', toggleRecording);
    document.getElementById('clear-btn').addEventListener('click', clearContent);

    // Upload button
    const audioUpload = document.getElementById('audioUpload');
    if (audioUpload) {
        audioUpload.addEventListener('change', handleAudioUpload);
        console.log('Audio upload listener attached');
    }

    // Handle window resize for visualizer
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (window.AudioVisualizer) {
                if (window.AudioVisualizer.mode === 'file' && window.AudioVisualizer.originalFileAmplitudes.length > 0) {
                    window.AudioVisualizer.reprocessFileAmplitudes(window.AudioVisualizer.originalFileAmplitudes);
                } else if (window.AudioVisualizer.mode === 'realtime' && window.AudioVisualizer.isInitialized) {
                    window.AudioVisualizer.createBars();
                } else {
                    window.AudioVisualizer.createBars();
                }
            }
        }, 250);
    });

    window.requestMicrophonePermission = requestMicrophonePermission;

    initializeSidebar();
    initNudgeResizer();
    initNotesPlaceholder();

    // Initialize visualizer bars after container is ready
    if (window.AudioVisualizer) {
        window.AudioVisualizer.waitForContainerReady(() => {
            window.AudioVisualizer.createBars();
        });
    }

    console.log('Ready.');
});

function registerHandlers() {
    // Finance handlers
    const financeHandler = new FinanceCombinedHandler();
    window.HandlerRegistry.register(financeHandler);

    // CS handler
    const csHandler = new ComputerScienceHandler();
    window.HandlerRegistry.register(csHandler);

    // History handler
    const historyHandler = new HistoryHandler();
    window.HandlerRegistry.register(historyHandler);
}

function exportAnalysis() {
    const handler = window.HandlerRegistry.getActive();
    const transcript = document.getElementById('transcriptionArea').innerText
        .replace('Start recording or upload an audio file to begin transcription', '').trim();

    const data = {
        metadata: {
            exportedAt: new Date().toISOString(),
            category: handler ? handler.displayName : 'Unknown',
            duration: recordingTimer ? Math.floor(Date.now() - recordingTimer) / 1000 : 0
        },
        transcript: transcript,
        notes: document.getElementById('notesArea').innerText.trim()
    };

    // Add handler-specific data if available
    if (handler) {
        const handlerState = handler.getState();
        if (handlerState.customData.terms) {
            data.terms = Array.from(handlerState.customData.terms.values());
        }
        if (handlerState.customData.events) {
            data.events = Array.from(handlerState.customData.events.values());
        }
        if (handlerState.customData.summary) {
            data.summary = handlerState.customData.summary;
        }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lexiphon-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function attachTranscriptEventListeners() {
    const handler = window.HandlerRegistry?.getActive();
    if (!handler) return;

    // Listen for highlight events from handler
    handler.on('highlight-term', ({ termId }) => {
        const elements = document.querySelectorAll(`.highlighted-term[data-term="${termId}"]`);
        if (elements.length > 0) {
            const lastElement = elements[elements.length - 1];
            scrollToElement(lastElement);
        }
    });

    handler.on('highlight-event', ({ eventId }) => {
        const elements = document.querySelectorAll(`.highlighted-event[data-event="${eventId}"]`);
        if (elements.length > 0) {
            const lastElement = elements[elements.length - 1];
            scrollToElement(lastElement);
        }
    });

    // Click handlers for highlighted terms/events
    document.querySelectorAll('.highlighted-term').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const term = el.getAttribute('data-term');
            scrollToElement(el);
            // Notify handler
            handler.emit('term-clicked', { term });
        });
    });

    document.querySelectorAll('.highlighted-event').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const event = el.getAttribute('data-event');
            scrollToElement(el);
            // Notify handler
            handler.emit('event-clicked', { event });
        });
    });
}