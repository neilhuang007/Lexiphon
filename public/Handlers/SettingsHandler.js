class SettingsHandler extends BaseHandler {
    constructor(config) {
        super({
            name: config.name || 'settings',
            displayName: 'Settings',
            icon: '⚙️',
            description: 'AI agent selection for transcription correction'
        });

        this.category = config.category || 'general';
        
        // Initialize with default
        this._state.customData = {
            aiAgent: 'deepseek'
        };

        // Load saved setting
        this._loadSettings();
    }

    _loadSettings() {
        const key = `ai-agent-${this.category}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            this._state.customData.aiAgent = saved;
        }
    }

    _saveSettings(agent) {
        const key = `ai-agent-${this.category}`;
        localStorage.setItem(key, agent);
    }

    getPanelLayout() {
        return {
            layout: 'stack',
            sections: [
                {
                    id: 'settings',
                    component: (state) => this._renderSettings(state),
                    shouldUpdate: () => true
                }
            ]
        };
    }

    getPanelEventHandlers() {
        return {
            '.ai-agent-select': {
                change: (e) => {
                    const newAgent = e.target.value;
                    this._state.customData.aiAgent = newAgent;
                    this._saveSettings(newAgent);
                    console.log(`AI agent for ${this.category} changed to: ${newAgent}`);
                }
            }
        };
    }

    _renderSettings(state) {
        const currentAgent = state.customData.aiAgent || 'deepseek';
        
        return `
            <div class="settings-panel">
                <h3>AI Agent</h3>
                <p>Choose AI agent for transcription correction:</p>
                
                <select class="ai-agent-select">
                    <option value="deepseek" ${currentAgent === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                    <option value="gemini" ${currentAgent === 'gemini' ? 'selected' : ''}>Gemini</option>
                </select>
            </div>
        `;
    }

    // Static method to get AI agent setting for a category
    static getAgentForCategory(category) {
        const key = `ai-agent-${category}`;
        return localStorage.getItem(key) || 'deepseek';
    }

    // Required methods (not used for settings)
    async processChunk(text, context) { return; }
    async processComplete(fullTranscript) { return; }
}

// Export for use
window.SettingsHandler = SettingsHandler;