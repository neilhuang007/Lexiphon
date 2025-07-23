class FinanceEventsHandler extends BaseHandler {
    constructor() {
        super({
            name: 'finance-events',
            displayName: 'Events',
            icon: '📅',
            description: 'Identifies historical events and their economic significance'
        });

        this.eventsPrompt = null;
        this.loadPrompts();
    }

    async loadPrompts() {
        try {
            const response = await fetch('./prompts/finance-events.json');
            this.eventsPrompt = await response.json();
        } catch (error) {
            console.error('Failed to load finance events prompt:', error);
        }
    }

    setState(updates) {
        if (updates.customData && updates.customData.events && !(updates.customData.events instanceof Map)) {
            updates.customData.events = new Map(updates.customData.events);
        }
        super.setState(updates);
    }

    getState() {
        const state = super.getState();
        if (state.customData && state.customData.events && !(state.customData.events instanceof Map)) {
            state.customData.events = new Map(state.customData.events);
        }
        return state;
    }

    getPanelLayout() {
        return {
            layout: 'stack',
            sections: [
                {
                    id: 'events',
                    component: (state) => this._renderEvents(state),
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
                    this._highlightEventInTranscript(eventId);
                }
            }
        };
    }

    async processChunk(text, context) {
        if (!text.trim() || !this.eventsPrompt) return;
        try {
            console.log(`[FinanceEventsHandler] processChunk start: chunkId=${context.chunkId}, text snippet="${text.slice(0,50)}"`);
            const events = await this._extractEvents(text, context.chunkId);
            console.log('[FinanceEventsHandler] extracted events:', events);

         const state = this.getState();
         // Normalize events map (restore Map if corrupted by serialization)
         let currentEventsRaw = state.customData.events;
         let currentEvents;
         if (currentEventsRaw instanceof Map) {
             currentEvents = currentEventsRaw;
         } else if (Array.isArray(currentEventsRaw)) {
             currentEvents = new Map(currentEventsRaw);
         } else if (currentEventsRaw && typeof currentEventsRaw === 'object') {
             currentEvents = new Map(Object.entries(currentEventsRaw));
         } else {
             currentEvents = new Map();
         }

        events && Array.isArray(events) ? events.forEach(event => {
             const key = event.event.toLowerCase().replace(/\s+/g, '-');
             if (!currentEvents.has(key)) {
                 event.searchTerms = this._generateEventSearchTerms(event.event);
                 if (event.quote && !event.searchTerms.includes(event.quote)) {
                     event.searchTerms.push(event.quote);
                 }
                 currentEvents.set(key, { ...event, chunkId: context.chunkId });
             }
         });

         this.setState({
             customData: {
                 ...state.customData,
                 events: currentEvents,
                 lastProcessedChunk: context.chunkId
             }
         });
            console.log(`[FinanceEventsHandler] currentEvents count after update: ${currentEvents.size}`);
        } catch (error) {
            console.error('[FinanceEventsHandler] Error in processChunk:', error);
        }

         // Update transcript highlights
         this._updateTranscriptHighlights();
    }

    async processComplete(fullTranscript) {
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

        return [...new Set(terms)];
    }

    _renderEvents(state) {
        const events = state.customData.events || new Map();

        if (events.size === 0) {
            return '<div class="no-terms">Historical events will appear here as they are detected</div>';
        }

        const eventsList = Array.from(events.values()).reverse();

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

    _highlightEventInTranscript(eventId) {
        // Find all occurrences in transcript
        const elements = document.querySelectorAll(`.highlighted-event[data-event="${eventId}"]`);
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
        // Trigger main app to update highlights
        if (window.updateTranscriptionDisplay) {
            window.updateTranscriptionDisplay();
        }
    }
}