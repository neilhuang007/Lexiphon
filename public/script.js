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

    currentCategory = category;

    // Update active class for category items
    document.querySelectorAll('.category-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const selectedItem = document.querySelector(`.category-item[data-category="${category}"]`);
    if (selectedItem) {
        selectedItem.classList.add('active');
    }

    // Use Handler Registry to manage the right panel clearing
    if (window.HandlerRegistry) {
        // This will deactivate all current handlers and clear the panel
        window.HandlerRegistry.setActiveCategory(category);
    }

    // Reprocess existing transcript with new category handlers
    if (fullTranscript && processedChunks.size > 0) {
        console.log('Reprocessing transcript for category:', category);
        reprocessTranscriptForCategory();
    }
}

async function reprocessTranscriptForCategory() {
    console.log('[reprocessTranscriptForCategory] Starting reprocessing');
    
    // Small delay to ensure handlers are fully mounted
    await new Promise(resolve => setTimeout(resolve, 100));

    const handlers = window.HandlerRegistry.getActiveHandlers();
    console.log(`[reprocessTranscriptForCategory] Processing ${processedChunks.size} chunks with ${handlers.length} handlers`);

    // Process each existing chunk with new handlers
    for (const [chunkId, correctedText] of processedChunks.entries()) {
        if (correctedText && correctedText.trim()) {
            const [startIndex, endIndex] = chunkId.split('-').map(Number);

            for (const handler of handlers) {
                console.log(`[reprocessTranscriptForCategory] Processing chunk ${chunkId} with handler ${handler.name}`);
                await handler.processChunk(correctedText, {
                    chunkId: chunkId,
                    startIndex: startIndex,
                    endIndex: endIndex
                });
            }
        }
    }

    console.log('[reprocessTranscriptForCategory] Updating transcript display');
    updateTranscriptionDisplay();
    
    // Also trigger a delayed update to ensure all state is propagated
    setTimeout(() => {
        console.log('[reprocessTranscriptForCategory] Final transcript update');
        updateTranscriptionDisplay();
    }, 200);
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

    // Set up volume monitoring
    if (audioContext) {
        const source = audioContext.createMediaStreamSource(mediaStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        // Monitor volume periodically
        const monitorVolume = () => {
            if (recorder.state === 'recording') {
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(dataArray);
                volumeAnalyzer.analyzeVolume(dataArray);
                requestAnimationFrame(monitorVolume);
            }
        };
        monitorVolume();
    }

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

        // Check file size (10MB limit for base64)
        const maxSize = 7 * 1024 * 1024; // 7MB to be safe with base64 overhead
        if (file.size > maxSize) {
            throw new Error('File too large. Maximum size is 7MB.');
        }

        // Convert file to base64
        const reader = new FileReader();
        const base64Audio = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        console.log('Uploading file:', file.name, 'Size:', file.size, 'Type:', file.type);

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

        const responseText = await res.text();
        console.log('Raw response:', responseText.substring(0, 200));

        let json;
        try {
            json = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse response:', responseText);
            throw new Error(`Server returned invalid response: ${responseText.substring(0, 100)}`);
        }

        if (!res.ok) {
            console.error('Upload Error Response:', json);
            throw new Error(`Upload error: ${json.error || 'Unknown error'} - ${json.details || ''}`);
        }

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

    // Analyze for silence-based chunking
    if (audioContext && currentRecorder && currentRecorder.state === 'recording') {
        const analyser = audioContext.createAnalyser();
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        const isSilent = volumeAnalyzer.analyzeVolume(dataArray);

        if (isSilent) {
            console.log('Silence detected, processing chunk');
            processSmartChunk();
        }
    }

    async function processSmartChunk() {
        const words = fullTranscript.split(/\s+/).filter(w => w.length > 0);
        const processedWordCount = Array.from(processedChunks.values())
            .map(chunk => chunk.split(/\s+/).filter(w => w.length > 0).length)
            .reduce((a, b) => a + b, 0);

        if (processedWordCount >= words.length) return;

        // Get unprocessed text
        const unprocessedWords = words.slice(processedWordCount);
        const unprocessedText = unprocessedWords.join(' ');

        // Find sentence boundary
        const boundaryIndex = findSentenceBoundary(unprocessedText);

        if (boundaryIndex > 0) {
            // Process up to the sentence boundary
            const chunkText = unprocessedText.substring(0, boundaryIndex);
            const chunkWords = chunkText.split(/\s+/).filter(w => w.length > 0);

            const startIndex = processedWordCount;
            const endIndex = processedWordCount + chunkWords.length;
            const chunkId = `${startIndex}-${endIndex}`;

            if (!processedChunks.has(chunkId)) {
                activeCorrections++;
                updateCorrectionStatus();

                try {
                    const correctedText = await correctTyposForChunk(chunkText);
                    if (correctedText && correctedText.trim()) {
                        processedChunks.set(chunkId, correctedText);

                        // Notify handlers
                        const activeHandlers = window.HandlerRegistry.getActiveHandlers();
                        for (const handler of activeHandlers) {
                            await handler.processChunk(correctedText, {
                                chunkId: chunkId,
                                startIndex: startIndex,
                                endIndex: endIndex
                            });
                        }
                    }
                } finally {
                    activeCorrections--;
                    updateCorrectionStatus();
                }

                updateTranscriptionDisplay();
            }
        } else if (unprocessedWords.length > BASE_CHUNK_SIZE * 2) {
            // Force process if too much backlog
            const chunkSize = Math.min(BASE_CHUNK_SIZE, unprocessedWords.length);
            const chunkWords = unprocessedWords.slice(0, chunkSize);
            const chunkText = chunkWords.join(' ');

            const startIndex = processedWordCount;
            const endIndex = processedWordCount + chunkWords.length;
            const chunkId = `${startIndex}-${endIndex}`;

            if (!processedChunks.has(chunkId)) {
                processedChunks.set(chunkId, chunkText + '...');
                updateTranscriptionDisplay();
            }
        }
    }

    updateTranscriptionDisplay();

    // Fallback to word count based chunking
    const words = fullTranscript.split(/\s+/).filter(w => w.length > 0);
    const processedWordCount = Array.from(processedChunks.values())
        .map(chunk => chunk.split(/\s+/).filter(w => w.length > 0).length)
        .reduce((a, b) => a + b, 0);

    const backlog = words.length - processedWordCount;

    // Only process if we have enough backlog and no silence-based processing
    if (backlog >= BASE_CHUNK_SIZE && !volumeAnalyzer.isSilent) {
        processSmartChunk();
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
            // Process ANY remaining words when forcing, regardless of size
            if (forceProcessRemaining && end > i) {
                chunks.push({
                    id,
                    text: words.slice(i, end).join(' '),
                    startIndex: i,
                    endIndex: end
                });
            } else if (end - i >= chunkSize) {
                // Normal processing - full chunks only
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
        // Get the selected AI agent for the current category
        const selectedAgent = window.SettingsHandler ? 
            window.SettingsHandler.getAgentForCategory(currentCategory) : 
            'deepseek';
        
        console.log(`Using ${selectedAgent} for transcription correction`);
        
        let response;
        if (selectedAgent === 'gemini') {
            // Call Gemini API directly
            const geminiResponse = await fetch('/api/gemini', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    systemPrompt: "You are a transcription editor for economics lectures",
                    useJsonOutput: false
                })
            });

            if (!geminiResponse.ok) {
                console.error('Gemini API error, falling back to DeepSeek');
                response = await callDeepSeek(prompt, "You are a transcription editor for economics lectures");
            } else {
                const data = await geminiResponse.json();
                response = data.choices[0].message.content;
            }
        } else {
            // Use DeepSeek
            response = await callDeepSeek(prompt, "You are a transcription editor for economics lectures");
        }
        
        const cleaned = response.trim();
        if (cleaned === '""' || cleaned === "''") return '';
        return cleaned;
    } catch (e) {
        console.error('Correction error:', e);
        return text;
    }
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

                // Notify all active handlers
                const activeHandlers = window.HandlerRegistry.getActiveHandlers();
                for (const handler of activeHandlers) {
                    await handler.processChunk(correctedText, {
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
        const isProcessingChunk = activeCorrections > 0;
        const backlog = remainingWords.length;
        // If actively processing, show as processing-text
        if (isProcessingChunk) {
            html += `<span class="processing-text">${escapeHtml(remainingText)}</span>`;
        } else if (backlog < BASE_CHUNK_SIZE) {
            // Small remaining text treated as processed
            const highlighted = applyHighlightsWithPriority(remainingText, 'remaining');
            html += `<span class="processed-chunk">${highlighted}</span>`;
        } else {
            html += `<span class="unprocessed-text">${escapeHtml(remainingText)}</span>`;
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

function applyHighlightsWithPriority(text, chunkId) {
    // Collect highlights from all active handlers
    const highlights = [];

    // Get all active handlers
    const activeHandlers = window.HandlerRegistry.getActiveHandlers();
    console.log(`Applying highlights for chunk ${chunkId}, active handlers:`, activeHandlers.length);

    activeHandlers.forEach(handler => {
        const state = handler.getState();
        console.log(`Handler ${handler.name} state:`, state.customData);
        console.log(`Handler ${handler.name} mounted:`, handler._mounted);

        // Process terms
        if (state.customData.terms && state.customData.terms instanceof Map) {
            state.customData.terms.forEach((termData, termKey) => {
                // Use the actual term name from the data, not the key
                const termName = termData.term || termKey;
                const regex = new RegExp(`\\b${escapeRegex(termName)}\\b`, 'gi');
                let match;
                while ((match = regex.exec(text)) !== null) {
                    highlights.push({
                        type: 'term',
                        start: match.index,
                        end: match.index + match[0].length,
                        text: match[0],
                        data: termKey,
                        priority: match[0].length
                    });
                }
            });
        }

        // Process events
        if (state.customData.events && state.customData.events instanceof Map) {
            console.log(`Processing ${state.customData.events.size} events for highlighting`);

            state.customData.events.forEach((eventData, eventKey) => {
                // Ensure searchTerms exist
                if (!eventData.searchTerms || !Array.isArray(eventData.searchTerms)) {
                    console.warn(`No search terms for event ${eventKey}`, eventData);
                    return;
                }

                console.log(`Searching for event "${eventKey}" with terms:`, eventData.searchTerms);

                eventData.searchTerms.forEach(searchTerm => {
                    try {
                        // More flexible regex - allow partial word matches for longer terms
                        const isShortTerm = searchTerm.length <= 4;
                        const regexPattern = isShortTerm 
                            ? `\\b${escapeRegex(searchTerm)}\\b` 
                            : escapeRegex(searchTerm);
                        const regex = new RegExp(regexPattern, 'gi');
                        let match;
                        while ((match = regex.exec(text)) !== null) {
                            console.log(`Found match for "${searchTerm}" at position ${match.index}`);
                            highlights.push({
                                type: 'event',
                                start: match.index,
                                end: match.index + match[0].length,
                                text: match[0],
                                data: eventKey,
                                priority: 1000 + match[0].length
                            });
                        }
                    } catch (regexError) {
                        console.error(`Regex error for term "${searchTerm}":`, regexError);
                    }
                });
            });
        }
    });

    console.log(`Total highlights found: ${highlights.length}`);

    // Sort and resolve overlaps
    highlights.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return b.priority - a.priority;
    });

    const finalHighlights = [];
    for (const highlight of highlights) {
        let canAdd = true;
        for (let i = finalHighlights.length - 1; i >= 0; i--) {
            const existing = finalHighlights[i];
            if (highlight.start < existing.end && highlight.end > existing.start) {
                if (highlight.priority > existing.priority) {
                    finalHighlights.splice(i, 1);
                } else {
                    canAdd = false;
                    break;
                }
            }
        }
        if (canAdd) {
            finalHighlights.push(highlight);
        }
    }

    finalHighlights.sort((a, b) => a.start - b.start);

    let result = '';
    let lastIndex = 0;

    for (const highlight of finalHighlights) {
        result += escapeHtml(text.substring(lastIndex, highlight.start));
        if (highlight.type === 'event') {
            result += `<span class="highlighted-event" data-event="${highlight.data}" data-chunk="${chunkId}">${escapeHtml(highlight.text)}</span>`;
        } else {
            result += `<span class="highlighted-term" data-term="${highlight.data}" data-chunk="${chunkId}">${escapeHtml(highlight.text)}</span>`;
        }
        lastIndex = highlight.end;
    }

    result += escapeHtml(text.substring(lastIndex));
    return result;
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
    console.log('Clearing transcription content and all handler states');
    
    // Clear transcript and processing data
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

    // Clear all handler states and localStorage
    if (window.HandlerRegistry) {
        // Clear all handler localStorage
        const allHandlers = window.HandlerRegistry.getAll();
        allHandlers.forEach(handler => {
            const storageKey = `handler-state-${handler.name}`;
            localStorage.removeItem(storageKey);
            console.log(`Cleared localStorage for handler: ${handler.name}`);
        });
        
        // Get current category to re-activate after clearing
        const currentCategory = window.HandlerRegistry.activeCategory || 'finance';
        
        // Clear all handlers completely
        window.HandlerRegistry.clearAll();
        
        // Re-register all handlers with fresh state
        setTimeout(() => {
            console.log('Re-registering handlers with fresh state');
            registerHandlers();
            window.HandlerRegistry.setActiveCategory(currentCategory);
        }, 100);
    }

    // Clear UI elements
    const transcriptionArea = document.getElementById('transcriptionArea');
    if (transcriptionArea) {
        transcriptionArea.innerHTML = `<div class="transcription-placeholder">Start recording or upload an audio file to begin transcription</div>`;
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

let volumeAnalyzer = new VolumeAnalyzer();

// Smart sentence boundary detection
function findSentenceBoundary(text) {
    // Find the last complete sentence
    const sentenceEnders = /[.!?]\s*$/;
    const abbreviations = /(?:Mr|Mrs|Dr|Ms|Prof|Sr|Jr)\.\s*$/i;

    // Work backwards to find a good break point
    for (let i = text.length - 1; i >= 0; i--) {
        const substring = text.substring(0, i + 1);

        // Check if this ends with sentence punctuation
        if (sentenceEnders.test(substring)) {
            // Make sure it's not an abbreviation
            if (!abbreviations.test(substring)) {
                return i + 1;
            }
        }
    }

    // If no sentence boundary found, look for other natural breaks
    const softBreaks = /[,:;]\s*$/;
    for (let i = text.length - 1; i >= 0; i--) {
        const substring = text.substring(0, i + 1);
        if (softBreaks.test(substring)) {
            return i + 1;
        }
    }

    return -1; // No good boundary found
}


// script.js

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Init Lexiphon with Handler Framework');

    try {
        await loadCategoryPrompts();
    } catch (error) {
        console.error('Error loading prompts:', error);
        throw new Error('Failed to load prompt configuration files');
    }

    // Initialize the right‑panel framework
    if (window.RightPanelManager) {
        window.RightPanelManager.init();
    }

    // ─── FIXED: register all handlers up front and activate finance ───
    if (window.BaseHandler && window.HandlerRegistry) {
        registerHandlers();
        window.HandlerRegistry.setActiveCategory('finance');
    } else {
        // (fallback for mic permission if needed)
        microphoneGranted = true;
        await requestMicrophonePermission();
    }
    // ────────────────────────────────────────────────────────────────

    // Sidebar, resizer, notes UI
    initializeSidebar();
    initNudgeResizer();
    initNotesPlaceholder();

    // Audio visualizer
    if (window.AudioVisualizer) {
        window.AudioVisualizer.waitForContainerReady(() => {
            window.AudioVisualizer.createBars();
        });
    }

    // Recording controls
    document.getElementById('recordBtn').addEventListener('click', toggleRecording);
    document.getElementById('clear-btn').addEventListener('click', clearContent);

    // File upload
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
                }
            }
        }, 250);
    });

    console.log('Ready.');
});

// script.js

function registerHandlers() {
    // Finance handlers (only domain with terms and events analysis)
    const financeTermsHandler = new FinanceTermsHandler();
    const financeEventsHandler = new FinanceEventsHandler();

    window.HandlerRegistry.register(financeTermsHandler);
    window.HandlerRegistry.register(financeEventsHandler);

    // Universal settings handler for all categories
    const settingsHandler = new SettingsHandler({
        name: 'settings',
        displayName: 'Settings',
        icon: '⚙️',
        description: 'Configure AI agent settings'
    });

    // Register settings handler for each category
    ['finance', 'cs', 'history'].forEach(category => {
        const categorySettingsHandler = new SettingsHandler({
            name: `${category}-settings`,
            displayName: 'Settings',
            icon: '⚙️',
            category: category,
            description: `Configure AI agent for ${category === 'cs' ? 'computer science' : category} analysis`
        });
        window.HandlerRegistry.register(categorySettingsHandler);
    });
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

    // Remove duplicate registration - already done above
}


