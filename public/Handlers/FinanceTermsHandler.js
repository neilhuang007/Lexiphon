class FinanceTermsHandler extends BaseHandler {
    constructor() {
        super({
            name: 'finance-terms',
            displayName: 'Terms',
            icon: '📊',
            description: 'Identifies and explains financial terminology'
        });

        // Initialize state properly
        this._state.customData = {
            terms: new Map(),
            lastProcessedChunk: null,
            summary: null
        };

        this.termsPrompt = null;
        this.loadPrompts();
    }

    async loadPrompts() {
        try {
            const response = await fetch('./prompts/finance-terms.json');
            this.termsPrompt = await response.json();
            console.log('[FinanceTermsHandler] Prompts loaded successfully');
        } catch (error) {
            console.error('[FinanceTermsHandler] Failed to load prompts:', error);
        }
    }

    getState() {
        const state = super.getState();

        // Ensure terms exists and is a Map
        if (!state.customData) {
            state.customData = {};
        }

        if (!state.customData.terms) {
            state.customData.terms = new Map();
        } else if (!(state.customData.terms instanceof Map)) {
            // Handle different data types safely
            if (Array.isArray(state.customData.terms)) {
                state.customData.terms = new Map(state.customData.terms);
            } else if (state.customData.terms && typeof state.customData.terms === 'object') {
                // Convert plain object to Map
                state.customData.terms = new Map(Object.entries(state.customData.terms));
            } else {
                // If it's something else, create empty Map
                state.customData.terms = new Map();
            }
        }

        return state;
    }

    setState(updates) {
        console.log('[FinanceTermsHandler] setState called with:', updates);

        // Ensure proper initialization before calling parent setState
        if (!updates.customData) {
            updates.customData = {};
        }

        if (updates.customData.terms !== undefined && !(updates.customData.terms instanceof Map)) {
            if (Array.isArray(updates.customData.terms)) {
                updates.customData.terms = new Map(updates.customData.terms);
            } else if (updates.customData.terms && typeof updates.customData.terms === 'object') {
                updates.customData.terms = new Map(Object.entries(updates.customData.terms));
            } else {
                updates.customData.terms = new Map();
            }
        }

        super.setState(updates);
    }

    getPanelLayout() {
        return {
            layout: 'stack',
            sections: [
                {
                    id: 'terms',
                    component: (state) => this._renderTerms(state),
                    shouldUpdate: () => true
                }
            ]
        };
    }

    getPanelEventHandlers() {
        return {
            '.term-card': {
                click: (e) => {
                    const termId = e.currentTarget.dataset.termId;
                    console.log('[FinanceTermsHandler] Term card clicked:', termId);
                    this._highlightTermInTranscript(termId);
                }
            }
        };
    }

    async processChunk(text, context) {
        if (!text.trim() || !this.termsPrompt) {
            console.log('[FinanceTermsHandler] Skipping chunk - empty text or no prompts');
            return;
        }

        try {
            console.log(`[FinanceTermsHandler] Processing chunk ${context.chunkId}: "${text.slice(0, 50)}..."`);
            const terms = await this._extractTerms(text, context.chunkId);

            if (!terms || !Array.isArray(terms)) {
                console.error('[FinanceTermsHandler] Invalid terms response:', terms);
                return;
            }

            console.log('[FinanceTermsHandler] Extracted terms:', terms);

            const state = this.getState();

            // Ensure terms map exists
            if (!state.customData.terms || !(state.customData.terms instanceof Map)) {
                console.warn('[FinanceTermsHandler] Terms map was not properly initialized, creating new Map');
                state.customData.terms = new Map();
            }

            const currentTerms = state.customData.terms;
            console.log(`[FinanceTermsHandler] Current terms count: ${currentTerms.size}`);

            terms.forEach(term => {
                const key = term.term.toLowerCase();
                if (!currentTerms.has(key)) {
                    currentTerms.set(key, { ...term, chunkId: context.chunkId });
                    console.log(`[FinanceTermsHandler] Added new term: ${term.term}`);
                }
            });

            // Update state with new terms
            const newState = {
                customData: {
                    ...state.customData,
                    terms: currentTerms,
                    lastProcessedChunk: context.chunkId
                }
            };
            
            console.log(`[FinanceTermsHandler] Before setState - terms count: ${currentTerms.size}`);
            this.setState(newState);
            
            // Verify state after update
            const updatedState = this.getState();
            console.log(`[FinanceTermsHandler] After setState - terms count: ${updatedState.customData.terms?.size || 0}`);
            
            // Force UI update
            if (this._mounted) {
                console.log('[FinanceTermsHandler] Forcing UI update');
                this.onUpdate(updatedState);
            }
        } catch (error) {
            console.error('[FinanceTermsHandler] Error in processChunk:', error);
        }

        // Update transcript highlights
        this._updateTranscriptHighlights();
    }

    async processComplete(fullTranscript) {
        console.log('[FinanceTermsHandler] Processing complete');
        const state = this.getState();
        const termCount = state.customData.terms?.size || 0;

        this.setState({
            customData: {
                ...state.customData,
                summary: {
                    totalTerms: termCount,
                    processedAt: new Date().toISOString()
                }
            }
        });

        console.log(`[FinanceTermsHandler] Final term count: ${termCount}`);
    }

    async _extractTerms(text, chunkId) {
        console.log(`[FinanceTermsHandler] Extracting terms from chunk ${chunkId}`);

        if (!this.termsPrompt) {
            console.error('[FinanceTermsHandler] No prompts loaded');
            return [];
        }

        const messages = this._buildMessages(this.termsPrompt, text);

        try {
            const response = await this._callAIAgent(messages);
            const json = this._parseJsonResponse(response);
            console.log('[FinanceTermsHandler] AI Agent response:', json);
            return json.terms || [];
        } catch (error) {
            console.error('[FinanceTermsHandler] Term extraction error:', error);
            return [];
        }
    }

    _buildMessages(promptData, text) {
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

        messages.push({
            role: "user",
            content: `Extract terms from: "${text}"`
        });

        return messages;
    }

    async _callAIAgent(messages) {
        console.log('[FinanceTermsHandler] Calling AI Agent');
        
        // Get current AI agent setting for finance category
        const selectedAgent = window.SettingsHandler ? 
            window.SettingsHandler.getAgentForCategory('finance') : 
            'deepseek';
        
        console.log('[FinanceTermsHandler] Using AI agent:', selectedAgent);
        
        if (window.AIAgentManager) {
            return await window.AIAgentManager.callAgent(selectedAgent, {
                messages,
                useJsonOutput: true
            });
        } else {
            // Fallback to DeepSeek if AIAgentManager not available
            const response = await fetch('/api/deepseek', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages,
                    useJsonOutput: true
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[FinanceTermsHandler] DeepSeek API error:', errorText);
                throw new Error(`DeepSeek API error: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        }
    }

    _parseJsonResponse(response) {
        try {
            return JSON.parse(response);
        } catch (parseError) {
            console.error('[FinanceTermsHandler] JSON parse error:', parseError);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw parseError;
        }
    }

    _renderTerms(state) {
        const terms = state.customData.terms || new Map();
        console.log(`[FinanceTermsHandler] Rendering ${terms.size} terms`);

        if (terms.size === 0) {
            return '<div class="no-terms">Financial terms will appear here as they are detected</div>';
        }

        const termsList = Array.from(terms.values()).reverse();

        return `
            <div class="terms-list">
                ${termsList.map(term => `
                    <div class="term-card" data-term-id="${term.term.toLowerCase()}">
                        <h3>${this._escapeHtml(term.term)}</h3>
                        <div class="term-definition">${this._escapeHtml(term.definition)}</div>
                        <div class="term-context">${this._escapeHtml(term.historicalContext)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _highlightTermInTranscript(termId) {
        console.log('[FinanceTermsHandler] Highlighting term in transcript:', termId);

        // Find all occurrences in transcript
        const elements = document.querySelectorAll(`.highlighted-term[data-term="${termId}"]`);
        console.log(`[FinanceTermsHandler] Found ${elements.length} occurrences of term`);

        if (elements.length > 0) {
            // Scroll to last occurrence
            const lastElement = elements[elements.length - 1];
            lastElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Flash highlight
            lastElement.classList.add('highlight-focus');
            setTimeout(() => {
                lastElement.classList.remove('highlight-focus');
            }, 2000);
        }
    }

    _updateTranscriptHighlights() {
        console.log('[FinanceTermsHandler] Requesting transcript highlight update');
        // Small delay to ensure state is fully updated
        setTimeout(() => {
            if (window.updateTranscriptionDisplay) {
                window.updateTranscriptionDisplay();
            }
        }, 50);
    }


    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use
window.FinanceTermsHandler = FinanceTermsHandler;