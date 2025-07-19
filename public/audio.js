// Audio Visualizer Module
const AudioVisualizer = {
    context: null,
    analyser: null,
    source: null,
    animationId: null,
    dataArray: null,
    bufferLength: 0,
    isInitialized: false,
    mode: 'realtime', // 'realtime' or 'file'
    fileAmplitudes: [],
    originalFileAmplitudes: [],
    resizeObserver: null,
    lastWidth: 0,

    // Initialize ResizeObserver to watch for width changes
    initResizeObserver: function() {
        if (this.resizeObserver) return;

        const container = document.getElementById('visualizerContainer');
        const parentContainer = document.querySelector('.audio-visualizer-inline');

        if (!container || !parentContainer) return;

        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;

                // Only recalculate if width actually changed by more than 1px
                if (Math.abs(width - this.lastWidth) > 1) {
                    console.log('Visualizer width changed:', this.lastWidth, '->', width);
                    this.lastWidth = width;

                    // Debounce the recalculation
                    clearTimeout(this.resizeTimeout);
                    this.resizeTimeout = setTimeout(() => {
                        this.handleResize();
                    }, 100);
                }
            }
        });

        // Observe the parent container for size changes
        this.resizeObserver.observe(parentContainer);
    },

    // Handle resize events
    handleResize: function() {
        if (this.mode === 'file' && this.originalFileAmplitudes.length > 0) {
            // Reprocess file amplitudes for new size
            this.reprocessFileAmplitudes(this.originalFileAmplitudes);
        } else if (this.mode === 'realtime' && this.isInitialized) {
            // Stop current animation
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }

            // Recreate bars for realtime mode
            this.createBars();

            // Restart animation if we're initialized
            if (this.isInitialized) {
                this.start();
            }
        } else {
            // Default - just recreate bars
            this.createBars();
        }
    },

    // Wait for container to be ready before measuring
    waitForContainerReady: function(callback) {
        const checkContainer = () => {
            const container = document.querySelector('.audio-visualizer-inline');
            if (container && container.offsetWidth > 0) {
                callback();
            } else {
                requestAnimationFrame(checkContainer);
            }
        };
        checkContainer();
    },

    // Calculate optimal number of bars based on container width
    calculateBarCount: function() {
        const container = document.getElementById('visualizerContainer');

        if (!container) return 60;

        // Force layout calculation
        container.style.display = 'flex';

        // Get the exact width of the visualizer container using getBoundingClientRect
        const rect = container.getBoundingClientRect();
        const containerWidth = rect.width;

        // Get the actual computed gap from CSS
        const containerStyle = window.getComputedStyle(container);
        const gapValue = containerStyle.gap || containerStyle.columnGap || '2px';
        const gap = parseFloat(gapValue) || 2;

        // Also check for padding
        const containerPaddingLeft = parseFloat(containerStyle.paddingLeft) || 0;
        const containerPaddingRight = parseFloat(containerStyle.paddingRight) || 0;

        // The actual available width for bars
        const availableWidth = containerWidth - containerPaddingLeft - containerPaddingRight;

        // Bar width based on screen size
        const barWidth = window.innerWidth < 768 ? 1.5 : 2;

        // Calculate exact number of bars that can fit
        // We have n bars and (n-1) gaps
        // totalWidth = (barWidth * n) + (gap * (n - 1))
        let barCount = Math.floor((availableWidth + gap) / (barWidth + gap));

        // Verify the calculation
        let actualWidth = (barWidth * barCount) + (gap * (barCount - 1));

        // If overflowing, reduce bar count
        while (actualWidth > availableWidth && barCount > 10) {
            barCount--;
            actualWidth = (barWidth * barCount) + (gap * (barCount - 1));
        }

        // Log for debugging
        console.log('Visualizer calculation:', {
            containerRect: rect.width,
            cssGap: gap,
            containerPadding: containerPaddingLeft + containerPaddingRight,
            availableWidth,
            barCount,
            barWidth,
            actualWidth,
            remaining: availableWidth - actualWidth,
            percentage: (actualWidth / availableWidth * 100).toFixed(1) + '%'
        });

        return Math.max(10, barCount);
    },

    init: async function(stream) {
        try {
            if (this.context) {
                this.destroy();
            }

            this.mode = 'realtime';
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.context.createAnalyser();

            // Configure for frequency analysis
            this.analyser.fftSize = 512; // Increased for better frequency resolution
            this.analyser.smoothingTimeConstant = 0.7; // Slightly less smoothing for more responsive animation
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;

            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);

            this.source = this.context.createMediaStreamSource(stream);
            this.source.connect(this.analyser);

            // Initialize resize observer
            this.initResizeObserver();

            this.createBars();
            this.isInitialized = true;
            this.start();

            console.log('AudioVisualizer initialized successfully');
        } catch (error) {
            console.error('AudioVisualizer init error:', error);
        }
    },

    // Process uploaded audio file
    processAudioFile: async function(file) {
        try {
            this.mode = 'file';
            this.fileAmplitudes = [];

            // Show loading state
            const container = document.getElementById('visualizerContainer');
            if (container) {
                container.style.opacity = '0.5';
            }

            // Initialize resize observer
            this.initResizeObserver();

            if (!this.context) {
                this.context = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Decode audio file
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

            const duration = audioBuffer.duration;
            const sampleRate = audioBuffer.sampleRate;
            const channelData = audioBuffer.getChannelData(0); // Use first channel

            // Calculate bar count and interval
            const barCount = this.calculateBarCount();
            const intervalDuration = duration / barCount;
            const samplesPerInterval = Math.floor(intervalDuration * sampleRate);

            // Calculate RMS amplitude for each interval
            for (let i = 0; i < barCount; i++) {
                const startSample = i * samplesPerInterval;
                const endSample = Math.min(startSample + samplesPerInterval, channelData.length);

                let sum = 0;
                for (let j = startSample; j < endSample; j++) {
                    sum += channelData[j] * channelData[j];
                }

                const rms = Math.sqrt(sum / (endSample - startSample));
                this.fileAmplitudes.push(rms);
            }

            // Normalize amplitudes
            const maxAmplitude = Math.max(...this.fileAmplitudes);
            if (maxAmplitude > 0) {
                this.fileAmplitudes = this.fileAmplitudes.map(amp => amp / maxAmplitude);
            }

            // Store original amplitudes for resize handling
            this.originalFileAmplitudes = [...this.fileAmplitudes];

            this.displayFileAmplitudes();

            // Remove loading state
            if (container) {
                container.style.opacity = '1';
            }

        } catch (error) {
            console.error('Error processing audio file:', error);
            // Reset on error
            const container = document.getElementById('visualizerContainer');
            if (container) {
                container.style.opacity = '1';
            }
            this.createBars();
        }
    },

    displayFileAmplitudes: function() {
        const container = document.getElementById('visualizerContainer');
        if (!container) return;

        container.innerHTML = '';

        // Add file mode class to parent
        const visualizerElement = document.querySelector('.audio-visualizer-inline');
        if (visualizerElement) {
            visualizerElement.classList.add('file-mode');
        }

        this.fileAmplitudes.forEach((amplitude, index) => {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';

            // Calculate height based on amplitude (4px minimum, 28px maximum)
            const height = Math.max(4, amplitude * 28);
            bar.style.height = `${height}px`;

            container.appendChild(bar);
        });
    },

    // Reprocess file amplitudes for new bar count without re-decoding
    reprocessFileAmplitudes: function(originalAmplitudes) {
        if (!originalAmplitudes || originalAmplitudes.length === 0) return;

        const newBarCount = this.calculateBarCount();
        const oldBarCount = originalAmplitudes.length;

        // If bar counts are similar, just redisplay
        if (Math.abs(newBarCount - oldBarCount) < 5) {
            this.fileAmplitudes = originalAmplitudes;
            this.displayFileAmplitudes();
            return;
        }

        // Resample amplitudes for new bar count
        this.fileAmplitudes = [];
        const ratio = oldBarCount / newBarCount;

        for (let i = 0; i < newBarCount; i++) {
            const startIdx = Math.floor(i * ratio);
            const endIdx = Math.floor((i + 1) * ratio);

            // Average amplitudes in this range
            let sum = 0;
            let count = 0;
            for (let j = startIdx; j < endIdx && j < oldBarCount; j++) {
                sum += originalAmplitudes[j];
                count++;
            }

            this.fileAmplitudes.push(count > 0 ? sum / count : 0);
        }

        this.displayFileAmplitudes();
    },

    createBars: function() {
        const container = document.getElementById('visualizerContainer');
        if (!container) return;

        // Don't clear if we're in realtime mode and animating
        const wasAnimating = this.mode === 'realtime' && this.animationId !== null;

        container.innerHTML = '';

        // Remove file mode class when creating new bars
        const visualizerElement = document.querySelector('.audio-visualizer-inline');
        if (visualizerElement && this.mode !== 'file') {
            visualizerElement.classList.remove('file-mode');
        }

        // Initialize resize observer if not already done
        this.initResizeObserver();

        // Calculate bar count
        const barCount = this.calculateBarCount();

        // Create bars
        for (let i = 0; i < barCount; i++) {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';
            container.appendChild(bar);
        }

        console.log(`Created ${barCount} bars in ${this.mode} mode`);
    },

    start: function() {
        if (!this.isInitialized || this.mode !== 'realtime') return;

        // Cancel any existing animation
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        const draw = () => {
            // Get current bars (they might have been recreated)
            const bars = document.querySelectorAll('.visualizer-bar');
            if (bars.length === 0) return;

            const barCount = bars.length;

            // Get frequency data
            this.analyser.getByteFrequencyData(this.dataArray);

            // Process bars with logarithmic scaling for better visual distribution
            for (let i = 0; i < barCount; i++) {
                // Map bars to frequency bins with emphasis on lower frequencies
                const freqIndex = Math.floor(Math.pow(i / barCount, 1.8) * this.bufferLength * 0.6);
                const value = this.dataArray[freqIndex] || 0;

                // Scale height with more dynamic range
                const normalizedValue = value / 255;
                const height = Math.max(4, normalizedValue * normalizedValue * 32); // Quadratic scaling for more dynamic movement
                bars[i].style.height = `${height}px`;
            }

            // Continue animation if still in realtime mode
            if (this.mode === 'realtime' && this.isInitialized) {
                this.animationId = requestAnimationFrame(draw);
            }
        };

        draw();
    },

    stop: function() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Reset bars to minimal height
        const bars = document.querySelectorAll('.visualizer-bar');
        bars.forEach(bar => {
            bar.style.height = '4px';
        });
    },

    destroy: function() {
        this.stop();
        this.isInitialized = false;
        this.mode = 'realtime';
        this.fileAmplitudes = [];
        this.originalFileAmplitudes = [];

        // Clean up resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        clearTimeout(this.resizeTimeout);

        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        if (this.context && this.context.state !== 'closed') {
            this.context.close();
        }

        this.context = null;
        this.analyser = null;
        this.dataArray = null;

        // Remove file mode class
        const visualizerElement = document.querySelector('.audio-visualizer-inline');
        if (visualizerElement) {
            visualizerElement.classList.remove('file-mode');
        }
    }
};

// Export for use in script.js
window.AudioVisualizer = AudioVisualizer;