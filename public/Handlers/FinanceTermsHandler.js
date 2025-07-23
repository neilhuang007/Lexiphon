class FinanceTermsHandler extends BaseHandler {
    constructor() {
        super({
            name: 'finance-terms',
            displayName: 'Terms',
            icon: '📊',
            description: 'Identifies and explains financial terminology'
        });

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

    setState(updates) {
        console.log('[FinanceTermsHandler] setState called with:', updates);
        if (updates.customData && updates.customData.terms && !(updates.customData.terms instanceof Map)) {
            updates.customData.terms = new Map(updates.customData.terms);
        }
        super.setState(updates);
    }

    getState() {
        const state = super.getState();
        if (state.customData && state.customData.terms && !(state.customData.terms instanceof Map)) {
            state.customData.terms = new Map(state.customData.terms);
        }
        return state;
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

            // Normalize terms map
            let currentTermsRaw = state.customData.terms;
            let currentTerms;

            if (currentTermsRaw instanceof Map) {
                currentTerms = currentTermsRaw;
            } else if (Array.isArray(currentTermsRaw)) {
                currentTerms = new Map(currentTermsRaw);
            } else if (currentTermsRaw && typeof currentTermsRaw === 'object') {
                currentTerms = new Map(Object.entries(currentTermsRaw));
            } else {
                currentTerms = new Map();
            }

            console.log(`[FinanceTermsHandler] Current terms count: ${currentTerms.size}`);

            terms.forEach(term => {
                const key = term.term.toLowerCase();
                if (!currentTerms.has(key)) {
                    currentTerms.set(key, { ...term, chunkId: context.chunkId });
                    console.log(`[FinanceTermsHandler] Added new term: ${term.term}`);
                }
            });

            this.setState({
                customData: {
                    ...state.customData,
                    terms: currentTerms,
                    lastProcessedChunk: context.chunkId
                }
            });

            console.log(`[FinanceTermsHandler] Updated terms count: ${currentTerms.size}`);
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
        const messages = this._buildMessages(this.termsPrompt, text);

        try {
            const response = await this._callDeepSeek(messages);
            const json = this._parseJsonResponse(response);
            console.log('[FinanceTermsHandler] DeepSeek response:', json);
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

    async _callDeepSeek(messages) {
        console.log('[FinanceTermsHandler] Calling DeepSeek API');
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
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
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
                        <h3>${term.term}</h3>
                        <div class="term-definition">${term.definition}</div>
                        <div class="term-context">${term.historicalContext}</div>
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
        // Trigger main app to update highlights
        if (window.updateTranscriptionDisplay) {
            window.updateTranscriptionDisplay();
        }
    }
}