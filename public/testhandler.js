// Test Handler Implementation
class TestHandler extends BaseHandler {
    constructor() {
        super({
            name: 'test',
            displayName: 'Test Handler',
            icon: '🧪',
            description: 'A test handler to demonstrate the framework'
        });
    }

    getPanelLayout() {
        return {
            layout: 'tabs',
            defaultActiveSection: 'overview',
            sections: [
                {
                    id: 'overview',
                    title: 'Overview',
                    icon: '📊',
                    component: (state) => this._renderOverview(state)
                },
                {
                    id: 'details',
                    title: 'Details',
                    icon: '📋',
                    component: (state) => this._renderDetails(state)
                },
                {
                    id: 'settings',
                    title: 'Settings',
                    icon: '⚙️',
                    component: (state) => this._renderSettings(state)
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
            '.test-button': {
                click: (e) => {
                    alert('Test button clicked!');
                }
            }
        };
    }

    async processChunk(text, context) {
        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, 100));

        const wordCount = text.split(/\s+/).length;

        this.setState({
            customData: {
                ...this.getState().customData,
                totalWords: (this.getState().customData.totalWords || 0) + wordCount,
                chunks: [...(this.getState().customData.chunks || []), {
                    text: text.substring(0, 50) + '...',
                    words: wordCount,
                    timestamp: new Date().toLocaleTimeString()
                }]
            }
        });

        return { processed: true };
    }

    async processComplete(fullTranscript) {
        console.log('Processing complete transcript');
        return { complete: true };
    }

    _renderOverview(state) {
        const totalWords = state.customData.totalWords || 0;
        const chunkCount = state.customData.chunks?.length || 0;

        return `
            <div class="test-overview">
                ${SharedComponents.InfoCard({
            label: 'Total Words',
            value: totalWords,
            icon: '📝'
        })}
                ${SharedComponents.InfoCard({
            label: 'Chunks Processed',
            value: chunkCount,
            icon: '📦'
        })}
                <button class="test-button primary-btn">Test Action</button>
            </div>
        `;
    }

    _renderDetails(state) {
        const chunks = state.customData.chunks || [];

        return SharedComponents.ScrollableList({
            items: chunks,
            className: 'chunk-list',
            emptyMessage: 'No chunks processed yet',
            renderItem: (chunk) => `
                <div class="chunk-item">
                    <div class="chunk-text">${chunk.text}</div>
                    <div class="chunk-meta">
                        <span>${chunk.words} words</span>
                        <span>${chunk.timestamp}</span>
                    </div>
                </div>
            `
        });
    }

    _renderSettings(state) {
        return `
            <div class="test-settings">
                <h4>Handler Settings</h4>
                ${SharedComponents.Toggle({
            id: 'test-toggle',
            label: 'Enable feature',
            checked: state.uiState.userPreferences.featureEnabled || false,
            onChange: (checked) => {
                this.setState({
                    uiState: {
                        ...this.getState().uiState,
                        userPreferences: {
                            ...this.getState().uiState.userPreferences,
                            featureEnabled: checked
                        }
                    }
                });
            }
        })}
            </div>
        `;
    }
}