class FinanceCombinedHandler extends BaseHandler {
    constructor() {
        super({
            name: 'finance-combined',
            displayName: 'Finance & Business',
            icon: '💰',
            description: 'Identifies financial terms and historical events in economics lectures'
        });

        this.termsPrompt = null;
        this.eventsPrompt = null;
        this.loadPrompts();
    }

    async loadPrompts() {
        try {
            const termsResponse = await fetch('./prompts/finance-terms.json');
            this.termsPrompt = await termsResponse.json();

            const eventsResponse = await fetch('./prompts/finance-events.json');
            this.eventsPrompt = await eventsResponse.json();
        } catch (error) {
            console.error('Failed to load finance prompts:', error);
        }
    }

    // Override setState to ensure Maps are properly handled
    setState(updates) {
        // Convert arrays back to Maps if needed
        if (updates.customData) {
            if (updates.customData.terms && !(updates.customData.terms instanceof Map)) {
                updates.customData.terms = new Map(updates.customData.terms);
            }
            if (updates.customData.events && !(updates.customData.events instanceof Map)) {
                updates.customData.events = new Map(updates.customData.events);
            }
        }
        super.setState(updates);
    }

    getState() {
        const state = super.getState();
        // Ensure Maps are always Maps when getting state
        if (state.customData) {
            if (state.customData.terms && !(state.customData.terms instanceof Map)) {
                state.customData.terms = new Map(state.customData.terms);
            }
            if (state.customData.events && !(state.customData.events instanceof Map)) {
                state.customData.events = new Map(state.customData.events);
            }
        }
        return state;
    }

    getPanelLayout() {
        return {
            layout: 'tabs',
            defaultActiveSection: 'terms',
            sections: [
                {
                    id: 'terms',
                    title: 'Terms',
                    component: (state) => this._renderTerms(state)
                },
                {
                    id: 'events',
                    title: 'Events',
                    component: (state) => this._renderEvents(state)
                }
            ]
        };
    }

    getPanelEventHandlers() {
        return {
            '.tab-btn': {
                click: (e) => {
                    const sectionId = e.target.dataset.section;
                    this.setState({
                        uiState: {
                            ...this.getState().uiState,
                            activeSection: sectionId
                        }
                    });
                }
            },
            '.term-card': {
                click: (e) => {
                    const termId = e.currentTarget.dataset.termId;
                    this._highlightTermInTranscript(termId);
                }
            },
            '.event-card': {
                click: (e) => {
                    const eventId = e.currentTarget.dataset.eventId;
                    this._highlightEventInTranscript(eventId);
                }
            }
        };
    }

    async processChunk(text, context) {
        if (!text.trim() || !this.termsPrompt || !this.eventsPrompt) return;

        // Process terms
        const terms = await this._extractTerms(text, context.chunkId);

        // Process events
        const events = await this._extractEvents(text, context.chunkId);

        // Update state
        const state = this.getState();
        const currentTerms = state.customData.terms || new Map();
        const currentEvents = state.customData.events || new Map();

        terms.forEach(term => {
            const key = term.term.toLowerCase();
            if (!currentTerms.has(key)) {
                currentTerms.set(key, { ...term, chunkId: context.chunkId });
            }
        });

        events.forEach(event => {
            const key = event.event.toLowerCase().replace(/\s+/g, '-');
            if (!currentEvents.has(key)) {
                currentEvents.set(key, { ...event, chunkId: context.chunkId });
            }
        });

        this.setState({
            customData: {
                ...state.customData,
                terms: currentTerms,
                events: currentEvents,
                lastProcessedChunk: context.chunkId
            }
        });

        // Trigger transcript update with highlights
        this._updateTranscriptHighlights();
    }

    async processComplete(fullTranscript) {
        // Generate summary statistics
        const state = this.getState();
        const termCount = state.customData.terms?.size || 0;
        const eventCount = state.customData.events?.size || 0;

        this.setState({
            customData: {
                ...state.customData,
                summary: {
                    totalTerms: termCount,
                    totalEvents: eventCount,
                    processedAt: new Date().toISOString()
                }
            }
        });
    }

    async _extractTerms(text, chunkId) {
        const messages = this._buildMessages(this.termsPrompt, text);

        try {
            const response = await this._callDeepSeek(messages);
            const json = this._parseJsonResponse(response);
            return json.terms || [];
        } catch (error) {
            console.error('Term extraction error:', error);
            return [];
        }
    }

    async _extractEvents(text, chunkId) {
        const messages = this._buildMessages(this.eventsPrompt, text);

        try {
            const response = await this._callDeepSeek(messages);
            const json = this._parseJsonResponse(response);
            return json.events || [];
        } catch (error) {
            console.error('Event extraction error:', error);
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
                content: promptData.taskDescription + `\n\nExtract from: "${promptData.examples[0].input}"`
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
                content: `Extract from: "${promptData.examples[i].input}"`
            });
            messages.push({
                role: "assistant",
                content: JSON.stringify(promptData.examples[i].output)
            });
        }

        // Add actual text
        messages.push({
            role: "user",
            content: `Extract from: "${text}"`
        });

        return messages;
    }

    async _callDeepSeek(messages) {
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
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw parseError;
        }
    }

    _renderTerms(state) {
        const terms = state.customData.terms || new Map();

        if (terms.size === 0) {
            return '<div class="no-terms">Financial terms will appear here as they are detected</div>';
        }

        const termsList = Array.from(terms.values());

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

    _renderEvents(state) {
        const events = state.customData.events || new Map();

        if (events.size === 0) {
            return '<div class="no-terms">Historical events will appear here as they are detected</div>';
        }

        const eventsList = Array.from(events.values());

        return `
            <div class="terms-list">
                ${eventsList.map(event => `
                    <div class="event-card" data-event-id="${event.event.toLowerCase().replace(/\s+/g, '-')}">
                        <h3>${event.event}</h3>
                        <div class="event-quote">"${event.quote}"</div>
                        <div class="event-description">${event.description}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _highlightTermInTranscript(termId) {
        this.emit('highlight-term', { termId });
    }

    _highlightEventInTranscript(eventId) {
        this.emit('highlight-event', { eventId });
    }

    _updateTranscriptHighlights() {
        this.emit('update-highlights', {
            terms: Array.from(this.getState().customData.terms || new Map()),
            events: Array.from(this.getState().customData.events || new Map())
        });
    }
}