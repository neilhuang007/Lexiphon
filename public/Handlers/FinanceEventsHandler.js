class FinanceEventsHandler extends BaseHandler {
    constructor() {
        super({
            name: 'finance-events',
            displayName: 'Events',
            icon: '📅',
            description: 'Identifies historical events and their economic significance'
        });

        // Initialize state properly
        this._state.customData = {
            events: new Map(),
            lastProcessedChunk: null,
            summary: null
        };

        this.eventsPrompt = null;
        this.loadPrompts();
    }

    async loadPrompts() {
        try {
            const response = await fetch('./prompts/finance-events.json');
            this.eventsPrompt = await response.json();
            console.log('[FinanceEventsHandler] Prompts loaded successfully');
        } catch (error) {
            console.error('[FinanceEventsHandler] Failed to load prompts:', error);
        }
    }

    getState() {
        const state = super.getState();

        // Ensure events exists and is a Map
        if (!state.customData) {
            state.customData = {};
        }

        if (!state.customData.events) {
            state.customData.events = new Map();
        } else if (!(state.customData.events instanceof Map)) {
            // Handle different data types safely
            if (Array.isArray(state.customData.events)) {
                state.customData.events = new Map(state.customData.events);
            } else if (state.customData.events && typeof state.customData.events === 'object') {
                // Convert plain object to Map
                state.customData.events = new Map(Object.entries(state.customData.events));
            } else {
                // If it's something else, create empty Map
                state.customData.events = new Map();
            }
        }

        return state;
    }

    setState(updates) {
        console.log('[FinanceEventsHandler] setState called with updates');
        console.log('[FinanceEventsHandler] Updates events count:', updates.customData?.events?.size || 0);
        
        // Call parent setState directly - it now handles Maps correctly
        super.setState(updates);
        
        // Verify the state was set correctly
        const newState = this.getState();
        console.log('[FinanceEventsHandler] Post-setState events count:', newState.customData?.events?.size || 0);
    }

    getPanelLayout() {
        return {
            layout: 'stack',
            sections: [
                {
                    id: 'events',
                    component: (state) => {
                        console.log('[FinanceEventsHandler] Component render called');
                        return this._renderEvents(state);
                    },
                    shouldUpdate: () => true
                }
            ]
        };
    }

    getPanelEventHandlers() {
        return {
            '.event-card': {
                click: (e) => {
                    const eventId = e.currentTarget.dataset.eventId;
                    console.log('[FinanceEventsHandler] Event card clicked:', eventId);
                    this._highlightEventInTranscript(eventId);
                }
            }
        };
    }

    async processChunk(text, context) {
        if (!text.trim() || !this.eventsPrompt) {
            console.log('[FinanceEventsHandler] Skipping chunk - empty text or no prompts');
            return;
        }

        try {
            console.log(`[FinanceEventsHandler] Processing chunk ${context.chunkId}: "${text.slice(0, 50)}..."`);
            const events = await this._extractEvents(text, context.chunkId);
            console.log('[FinanceEventsHandler] Extracted events:', events);

            const state = this.getState();

            // Ensure events map exists
            if (!state.customData.events || !(state.customData.events instanceof Map)) {
                console.warn('[FinanceEventsHandler] Events map was not properly initialized, creating new Map');
                state.customData.events = new Map();
            }

            const currentEvents = state.customData.events;
            console.log(`[FinanceEventsHandler] Current events count: ${currentEvents.size}`);

            // Process events if they exist
            if (events && Array.isArray(events)) {
                events.forEach(event => {
                    const key = event.event.toLowerCase().replace(/\s+/g, '-');
                    if (!currentEvents.has(key)) {
                        event.searchTerms = this._generateEventSearchTerms(event.event);
                        currentEvents.set(key, { ...event, chunkId: context.chunkId });
                        console.log(`[FinanceEventsHandler] Added new event: ${event.event}`);
                    }
                });
            }

            // Update state with new events
            const newState = {
                customData: {
                    ...state.customData,
                    events: currentEvents,
                    lastProcessedChunk: context.chunkId
                }
            };
            
            console.log(`[FinanceEventsHandler] Before setState - events count: ${currentEvents.size}`);
            this.setState(newState);
            
            // Verify state after update
            const updatedState = this.getState();
            console.log(`[FinanceEventsHandler] After setState - events count: ${updatedState.customData.events?.size || 0}`);
            
            // Force UI update
            if (this._mounted) {
                console.log('[FinanceEventsHandler] Forcing UI update');
                this.onUpdate(updatedState);
            }
        } catch (error) {
            console.error('[FinanceEventsHandler] Error in processChunk:', error);
        }

        // Update transcript highlights
        this._updateTranscriptHighlights();
    }

    async processComplete(fullTranscript) {
        console.log('[FinanceEventsHandler] Processing complete');
        const state = this.getState();
        const eventCount = state.customData.events?.size || 0;

        this.setState({
            customData: {
                ...state.customData,
                summary: {
                    totalEvents: eventCount,
                    processedAt: new Date().toISOString()
                }
            }
        });

        console.log(`[FinanceEventsHandler] Final event count: ${eventCount}`);
    }

    async _extractEvents(text, chunkId) {
        console.log(`[FinanceEventsHandler] Extracting events from chunk ${chunkId}`);

        if (!this.eventsPrompt) {
            console.error('[FinanceEventsHandler] No prompts loaded');
            return [];
        }

        const messages = this._buildMessages(this.eventsPrompt, text);

        try {
            const response = await this._callAIAgent(messages);
            const json = this._parseJsonResponse(response);
            console.log('[FinanceEventsHandler] AI Agent response:', json);
            return json.events || [];
        } catch (error) {
            console.error('[FinanceEventsHandler] Event extraction error:', error);
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
                content: promptData.taskDescription + `\n\nExtract events from: "${promptData.examples[0].input}"`
            },
            {
                role: "assistant",
                content: JSON.stringify(promptData.examples[0].output)
            }
        ];

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

        messages.push({
            role: "user",
            content: `Extract events from: "${text}"`
        });

        return messages;
    }

    async _callAIAgent(messages) {
        console.log('[FinanceEventsHandler] Calling AI Agent');
        
        // Get current AI agent setting for finance category
        const selectedAgent = window.SettingsHandler ? 
            window.SettingsHandler.getAgentForCategory('finance') : 
            'deepseek';
        
        console.log('[FinanceEventsHandler] Using AI agent:', selectedAgent);
        
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
                console.error('[FinanceEventsHandler] DeepSeek API error:', errorText);
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
            console.error('[FinanceEventsHandler] JSON parse error:', parseError);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw parseError;
        }
    }

    _generateEventSearchTerms(eventName) {
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

        // Add partial matches
        const words = eventName.split(/\s+/);
        words.forEach(word => {
            if (word.length > 3 && !['the', 'and', 'for', 'with'].includes(word.toLowerCase())) {
                terms.push(word);
            }
        });

        // Remove duplicates and filter out very long terms
        const uniqueTerms = [...new Set(terms)].filter(term => term.length < 100);
        console.log(`[FinanceEventsHandler] Generated search terms for "${eventName}":`, uniqueTerms);
        return uniqueTerms;
    }

    _renderEvents(state) {
        console.log('[FinanceEventsHandler] _renderEvents called with state:', state);
        
        // Get events from state, ensuring it's a Map
        let events = state?.customData?.events;
        if (!events || !(events instanceof Map)) {
            console.warn('[FinanceEventsHandler] Events is not a Map, getting fresh state');
            const freshState = this.getState();
            events = freshState.customData.events || new Map();
        }
        
        console.log(`[FinanceEventsHandler] Rendering ${events.size} events`);
        
        // Debug: Log the actual events data
        if (events.size > 0) {
            console.log('[FinanceEventsHandler] Events data:', Array.from(events.entries()));
        }

        if (events.size === 0) {
            return '<div class="no-terms">Historical events will appear here as they are detected</div>';
        }

        const eventsList = Array.from(events.values()).reverse();
        console.log('[FinanceEventsHandler] Events list to render:', eventsList);

        const html = `
            <div class="terms-list">
                ${eventsList.map(event => {
                    console.log('[FinanceEventsHandler] Rendering event:', event);
                    return `
                    <div class="event-card" data-event-id="${event.event.toLowerCase().replace(/\s+/g, '-')}">
                        <h3>${this._escapeHtml(event.event)}</h3>
                        <div class="event-quote">"${this._escapeHtml(event.quote)}"</div>
                        <div class="event-description">${this._escapeHtml(event.description)}</div>
                    </div>
                `}).join('')}
            </div>
        `;
        
        console.log('[FinanceEventsHandler] Generated HTML length:', html.length);
        return html;
    }

    _highlightEventInTranscript(eventId) {
        console.log('[FinanceEventsHandler] Highlighting event in transcript:', eventId);

        // Find all occurrences in transcript
        const elements = document.querySelectorAll(`.highlighted-event[data-event="${eventId}"]`);
        console.log(`[FinanceEventsHandler] Found ${elements.length} occurrences of event`);

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
        console.log('[FinanceEventsHandler] Requesting transcript highlight update');
        const currentState = this.getState();
        console.log('[FinanceEventsHandler] Current events for highlighting:', currentState.customData.events?.size || 0);
        
        // Delay to ensure state is fully updated and propagated
        setTimeout(() => {
            if (window.updateTranscriptionDisplay) {
                console.log('[FinanceEventsHandler] Calling updateTranscriptionDisplay');
                window.updateTranscriptionDisplay();
            }
        }, 100);
    }


    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use
window.FinanceEventsHandler = FinanceEventsHandler;