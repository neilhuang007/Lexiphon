// AI Agent Manager
// Handles AI agent selection and API calls for handlers
class AIAgentManager {
    constructor() {
        this.agents = {
            deepseek: {
                name: 'DeepSeek',
                endpoint: '/api/deepseek',
                description: 'Fast and cost-effective AI agent'
            },
            gemini: {
                name: 'Gemini',
                endpoint: '/api/gemini', 
                description: 'Google\'s advanced AI with multimodal capabilities'
            }
        };
    }

    // Get available agents
    getAvailableAgents() {
        return this.agents;
    }

    // Call the selected AI agent
    async callAgent(agentType, options) {
        const agent = this.agents[agentType];
        if (!agent) {
            throw new Error(`Unknown AI agent: ${agentType}`);
        }

        const { prompt, systemPrompt, messages, useJsonOutput = false } = options;

        const body = {
            prompt,
            systemPrompt,
            messages,
            useJsonOutput
        };

        console.log(`[AIAgentManager] Calling ${agent.name} API`);
        
        const response = await fetch(agent.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AIAgentManager] ${agent.name} API error:`, errorText);
            throw new Error(`${agent.name} API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    // Get default agent settings for a handler
    getDefaultSettings(handlerName) {
        return {
            aiAgent: 'deepseek' // Default to DeepSeek for backward compatibility
        };
    }

    // Save settings for a handler
    saveSettings(handlerName, settings) {
        const key = `ai-settings-${handlerName}`;
        localStorage.setItem(key, JSON.stringify(settings));
    }

    // Load settings for a handler
    loadSettings(handlerName) {
        const key = `ai-settings-${handlerName}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (error) {
                console.error('Failed to parse AI settings:', error);
            }
        }
        return this.getDefaultSettings(handlerName);
    }

    // Render settings UI for a handler
    renderSettingsUI(handlerName, currentSettings, onSettingsChange) {
        const settings = currentSettings || this.loadSettings(handlerName);
        
        return `
            <div class="ai-settings">
                <div class="setting-group">
                    <label class="setting-label">AI Agent</label>
                    <select class="ai-agent-select" data-setting="aiAgent">
                        ${Object.entries(this.agents).map(([key, agent]) => `
                            <option value="${key}" ${settings.aiAgent === key ? 'selected' : ''}>
                                ${agent.name}
                            </option>
                        `).join('')}
                    </select>
                    <div class="setting-description">
                        ${this.agents[settings.aiAgent]?.description || ''}
                    </div>
                </div>
            </div>
        `;
    }

    // Get event handlers for settings UI
    getSettingsEventHandlers(handlerName, onSettingsChange) {
        return {
            '.ai-agent-select': {
                change: (e) => {
                    const newSettings = this.loadSettings(handlerName);
                    newSettings.aiAgent = e.target.value;
                    this.saveSettings(handlerName, newSettings);
                    
                    // Update description
                    const descEl = e.target.parentElement.querySelector('.setting-description');
                    if (descEl) {
                        descEl.textContent = this.agents[newSettings.aiAgent]?.description || '';
                    }
                    
                    if (onSettingsChange) {
                        onSettingsChange(newSettings);
                    }
                }
            }
        };
    }
}

// Export singleton instance
window.AIAgentManager = new AIAgentManager();