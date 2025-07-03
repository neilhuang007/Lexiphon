// Audio Visualizer Module
const AudioVisualizer = {
    context: null,
    analyser: null,
    source: null,
    animationId: null,
    dataArray: null,
    bufferLength: 0,
    isInitialized: false,

    init: async function(stream) {
        try {
            if (this.context) {
                this.destroy();
            }

            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.context.createAnalyser();

            // Configure for frequency analysis
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;

            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);

            this.source = this.context.createMediaStreamSource(stream);
            this.source.connect(this.analyser);

            this.createBars();
            this.isInitialized = true;
            this.start();

            console.log('AudioVisualizer initialized successfully');
        } catch (error) {
            console.error('AudioVisualizer init error:', error);
        }
    },

    createBars: function() {
        const container = document.getElementById('visualizerContainer');
        if (!container) return;

        container.innerHTML = '';
        const barCount = 16; // Apple Music style bar count

        for (let i = 0; i < barCount; i++) {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';
            container.appendChild(bar);
        }
    },

    start: function() {
        if (!this.isInitialized) return;

        const bars = document.querySelectorAll('.visualizer-bar');
        const barCount = bars.length;

        const draw = () => {
            this.animationId = requestAnimationFrame(draw);

            // Get frequency data
            this.analyser.getByteFrequencyData(this.dataArray);

            // Process bars with logarithmic scaling for better visual distribution
            for (let i = 0; i < barCount; i++) {
                // Map bars to frequency bins with emphasis on lower frequencies
                const freqIndex = Math.floor(Math.pow(i / barCount, 1.5) * this.bufferLength * 0.5);
                const value = this.dataArray[freqIndex] || 0;

                // Scale height (Apple Music uses subtle heights)
                const height = Math.max(2, (value / 255) * 16);
                bars[i].style.height = `${height}px`;

                // Subtle opacity variation based on intensity
                const opacity = 0.5 + (value / 255) * 0.5;
                bars[i].style.opacity = opacity;
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
            bar.style.opacity = '0.7';
        });
    },

    destroy: function() {
        this.stop();
        this.isInitialized = false;

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
    }
};

// Export for use in script.js
window.AudioVisualizer = AudioVisualizer;

// Audio File Visualizer Module - Simple bars like recording
const AudioFileVisualizer = {
    animationId: null,
    isPlaying: false,

    visualizeFile(file) {
        const container = document.getElementById('visualizerContainer');
        if (!container) return;

        // Clear any existing content
        container.innerHTML = '';

        // Create the same 16 bars as recording visualization
        const barCount = 16;
        for (let i = 0; i < barCount; i++) {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';
            container.appendChild(bar);
        }

        // Start animation to show file is loaded
        this.startFileAnimation();
    },

    startFileAnimation() {
        const bars = document.querySelectorAll('.visualizer-bar');
        let frame = 0;

        const animate = () => {
            frame++;
            bars.forEach((bar, i) => {
                // Create a wave effect
                const offset = (frame + i * 10) * 0.05;
                const height = Math.sin(offset) * 8 + 8; // 0-16px range
                bar.style.height = `${Math.max(4, height)}px`;
                bar.style.opacity = '0.7';
            });

            this.animationId = requestAnimationFrame(animate);
        };

        animate();
        this.isPlaying = true;
    },

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Reset bars to minimal height
        const bars = document.querySelectorAll('.visualizer-bar');
        bars.forEach(bar => {
            bar.style.height = '4px';
            bar.style.opacity = '0.7';
        });

        this.isPlaying = false;
    },

    clear() {
        this.stop();
        const container = document.getElementById('visualizerContainer');
        if (container) container.innerHTML = '';
    }
};

// Export for use in script.js
window.AudioFileVisualizer = AudioFileVisualizer;