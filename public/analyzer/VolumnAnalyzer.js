class VolumeAnalyzer {
    constructor() {
        this.volumeHistory = [];
        this.silenceThreshold = 0.01;
        this.silenceDuration = 500; // ms
        this.lastSoundTime = Date.now();
        this.chunks = [];
        this.currentChunk = '';
    }

    analyzeVolume(dataArray) {
        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length) / 255;

        this.volumeHistory.push({
            volume: rms,
            timestamp: Date.now()
        });

        // Keep only recent history (last 2 seconds)
        const cutoff = Date.now() - 2000;
        this.volumeHistory = this.volumeHistory.filter(v => v.timestamp > cutoff);

        // Detect silence
        if (rms > this.silenceThreshold) {
            this.lastSoundTime = Date.now();
            return false; // Not silent
        }

        // Check if we've been silent long enough
        return (Date.now() - this.lastSoundTime) > this.silenceDuration;
    }

    getAverageVolume() {
        if (this.volumeHistory.length === 0) return 0;
        const sum = this.volumeHistory.reduce((acc, v) => acc + v.volume, 0);
        return sum / this.volumeHistory.length;
    }
}