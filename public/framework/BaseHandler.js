// Base Handler Abstract Class
class BaseHandler {
    constructor(config) {
        if (new.target === BaseHandler) {
            throw new Error('BaseHandler is an abstract class and cannot be instantiated directly');
        }

        // Required config validation
        const required = ['name', 'displayName', 'icon'];
        required.forEach(field => {
            if (!config[field]) {
                throw new Error(`Handler config missing required field: ${field}`);
            }
        });

        // Initialize handler properties
        this.name = config.name;
        this.displayName = config.displayName;
        this.icon = config.icon;
        this.description = config.description || '';

        // State management
        this._state = {
            processedChunks: new Map(),
            pendingOperations: [],
            customData: {},
            uiState: {
                activeSection: null,
                expandedItems: [],
                scrollPositions: new Map(),
                userPreferences: {}
            }
        };

        // Event listeners
        this._stateListeners = new Set();
        this._eventListeners = new Map();

        // UI container reference
        this._container = null;
        this._mounted = false;
    }

    // Abstract methods that must be implemented by subclasses
    getPanelLayout() {
        throw new Error('getPanelLayout() must be implemented by subclass');
    }

    async processChunk(text, context) {
        throw new Error('processChunk() must be implemented by subclass');
    }

    async processComplete(fullTranscript) {
        throw new Error('processComplete() must be implemented by subclass');
    }

    // State management
    getState() {
        // Deep clone handler state, preserving Map instances
        const { processedChunks, pendingOperations, customData, uiState } = this._state;
        // Clone core state
        const stateClone = {
            processedChunks: new Map(processedChunks),
            pendingOperations: Array.isArray(pendingOperations) ? [...pendingOperations] : [],
            customData: {},
            uiState: {
                activeSection: uiState.activeSection,
                expandedItems: Array.isArray(uiState.expandedItems) ? [...uiState.expandedItems] : [],
                scrollPositions: uiState.scrollPositions instanceof Map ? new Map(uiState.scrollPositions) : new Map(),
                userPreferences: uiState.userPreferences && typeof uiState.userPreferences === 'object' ? { ...uiState.userPreferences } : {}
            }
        };
        // Clone customData entries
        Object.entries(customData).forEach(([key, value]) => {
            if (value instanceof Map) {
                stateClone.customData[key] = new Map(value);
            } else {
                stateClone.customData[key] = value;
            }
        });
        return stateClone;
    }

    setState(updates) {
        const oldState = this.getState();

        // Deep merge updates
        this._state = this._deepMerge(this._state, updates);

        // Notify listeners
        this._notifyStateListeners(oldState, this._state);

        // Trigger UI update if mounted
        if (this._mounted) {
            this.onUpdate(this._state);
        }
    }

    subscribeToStateChanges(callback) {
        this._stateListeners.add(callback);
        return () => this._stateListeners.delete(callback);
    }

    // Event handling
    on(eventName, handler) {
        if (!this._eventListeners.has(eventName)) {
            this._eventListeners.set(eventName, new Set());
        }
        this._eventListeners.get(eventName).add(handler);

        return () => {
            const handlers = this._eventListeners.get(eventName);
            if (handlers) {
                handlers.delete(handler);
            }
        };
    }

    emit(eventName, data) {
        const handlers = this._eventListeners.get(eventName);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${eventName}:`, error);
                }
            });
        }
    }

    // Lifecycle methods
    onMount(container) {
        if (this._mounted) {
            console.warn(`Handler ${this.name} is already mounted`);
            return;
        }

        console.log(`[BaseHandler] Mounting ${this.name} to container:`, container.id || container.className);

        this._container = container;
        this._mounted = true;

        // Clear container
        container.innerHTML = '';

        // Apply handler styles
        this._applyStyles();

        // Render panel layout
        this._renderPanel();
        
        console.log(`[BaseHandler] ${this.name} rendered, container HTML length:`, container.innerHTML.length);

        // Restore saved state if available
        this._restoreState();

        // Emit mounted event
        this.emit('mounted', { container });
    }

    onUnmount() {
        if (!this._mounted) {
            return;
        }

        // Save current state
        this._saveState();

        // Clean up event listeners
        this._eventListeners.clear();

        // Clear container
        if (this._container) {
            this._container.innerHTML = '';
        }

        this._mounted = false;
        this._container = null;

        // Emit unmounted event
        this.emit('unmounted');
    }

    onUpdate(data) {
        if (!this._mounted) {
            return;
        }

        // Re-render specific sections based on what changed
        this._updatePanel(data);
    }

    // Panel management
    getPanelStyles() {
        // Can be overridden by subclasses
        return '';
    }

    getPanelEventHandlers() {
        // Can be overridden by subclasses
        return {};
    }

    // Protected methods
    _renderPanel() {
        const layout = this.getPanelLayout();
        const renderer = PanelRenderers[layout.layout] || PanelRenderers.stack;

        const panelHTML = renderer(layout, this);
        this._container.innerHTML = panelHTML;

        // Attach event handlers
        this._attachEventHandlers();
    }

    _updatePanel(data) {
        // Intelligent updates - only re-render what changed
        const layout = this.getPanelLayout();

        layout.sections.forEach(section => {
            const sectionEl = this._container.querySelector(`#section-${section.id}`);
            if (sectionEl) {
                // Always update if no shouldUpdate function is provided, or if it returns true
                const shouldUpdate = !section.shouldUpdate || section.shouldUpdate(data);
                if (shouldUpdate) {
                    const content = this._renderSectionContent(section);
                    const contentEl = sectionEl.querySelector('.section-content');
                    if (contentEl) {
                        contentEl.innerHTML = content;
                        // Re-attach event handlers after updating content
                        this._attachEventHandlers();
                    }
                }
            }
        });
    }

    _renderSectionContent(section) {
        if (typeof section.component === 'function') {
            return section.component(this.getState(), this);
        } else if (typeof section.component === 'string') {
            return section.component;
        }
        return '';
    }

    _attachEventHandlers() {
        const handlers = this.getPanelEventHandlers();

        Object.entries(handlers).forEach(([selector, events]) => {
            Object.entries(events).forEach(([eventType, handler]) => {
                const elements = this._container.querySelectorAll(selector);
                elements.forEach(el => {
                    el.addEventListener(eventType, (e) => handler.call(this, e));
                });
            });
        });
    }

    _applyStyles() {
        const styles = this.getPanelStyles();
        if (!styles) return;

        // Create or update style element
        let styleEl = document.getElementById(`handler-styles-${this.name}`);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = `handler-styles-${this.name}`;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = styles;
    }

    _saveState() {
        const key = `handler-state-${this.name}`;
        const stateToSave = {
            customData: this._serializeCustomData(this._state.customData),
            uiState: this._state.uiState
        };
        localStorage.setItem(key, JSON.stringify(stateToSave));
    }

    _restoreState() {
        const key = `handler-state-${this.name}`;
        const savedState = localStorage.getItem(key);

        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                if (parsed.customData) {
                    parsed.customData = this._deserializeCustomData(parsed.customData);
                }
                this.setState(parsed);
            } catch (error) {
                console.error('Failed to restore handler state:', error);
            }
        }
    }

    _serializeCustomData(customData) {
        const serialized = {};
        for (const [key, value] of Object.entries(customData)) {
            if (value instanceof Map) {
                serialized[key] = Array.from(value.entries());
            } else {
                serialized[key] = value;
            }
        }
        return serialized;
    }

    _deserializeCustomData(customData) {
        const deserialized = {};
        for (const [key, value] of Object.entries(customData)) {
            if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0]) && value[0].length === 2) {
                // This looks like a serialized Map
                deserialized[key] = new Map(value);
            } else {
                deserialized[key] = value;
            }
        }
        return deserialized;
    }

    _notifyStateListeners(oldState, newState) {
        this._stateListeners.forEach(listener => {
            try {
                listener(newState, oldState);
            } catch (error) {
                console.error('Error in state listener:', error);
            }
        });
    }

    _deepMerge(target, source) {
        const output = Object.assign({}, target);

        if (this._isObject(target) && this._isObject(source)) {
            Object.keys(source).forEach(key => {
                // Special handling for Map objects
                if (source[key] instanceof Map) {
                    output[key] = source[key]; // Don't deep merge Maps
                } else if (this._isObject(source[key])) {
                    if (!(key in target)) {
                        Object.assign(output, { [key]: source[key] });
                    } else {
                        output[key] = this._deepMerge(target[key], source[key]);
                    }
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }

        return output;
    }

    _isObject(item) {
        return item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Map) && !(item instanceof Set);
    }
}

// Panel Renderers for different layout types
const PanelRenderers = {
    tabs: (layout, handler) => {
        const activeSection = handler.getState().uiState.activeSection ||
            layout.defaultActiveSection ||
            (layout.sections[0] && layout.sections[0].id);

        return `
            <div class="handler-panel tabs-layout">
                <div class="tabs-header">
                    ${layout.sections.map(section => `
                        <button class="tab-btn ${section.id === activeSection ? 'active' : ''}" 
                                data-section="${section.id}">
                            ${section.icon ? `<span class="tab-icon">${section.icon}</span>` : ''}
                            ${section.title}
                        </button>
                    `).join('')}
                </div>
                <div class="tabs-content">
                    ${layout.sections.map(section => `
                        <div id="section-${section.id}" 
                             class="tab-panel ${section.id === activeSection ? 'active' : ''}">
                            <div class="section-content">
                                ${handler._renderSectionContent(section)}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    accordion: (layout, handler) => {
        const expandedItems = handler.getState().uiState.expandedItems || [];

        return `
            <div class="handler-panel accordion-layout">
                ${layout.sections.map(section => {
            const isExpanded = expandedItems.includes(section.id) ||
                (section.defaultExpanded && !expandedItems.length);
            return `
                        <div class="accordion-item ${isExpanded ? 'expanded' : ''}" 
                             id="section-${section.id}">
                            <div class="accordion-header" data-section="${section.id}">
                                ${section.icon ? `<span class="accordion-icon">${section.icon}</span>` : ''}
                                <span class="accordion-title">${section.title}</span>
                                <span class="accordion-toggle">
                                    <svg width="12" height="12" viewBox="0 0 12 12">
                                        <path d="M2 4L6 8L10 4" stroke="currentColor" 
                                              stroke-width="2" fill="none"/>
                                    </svg>
                                </span>
                            </div>
                            <div class="accordion-content">
                                <div class="section-content">
                                    ${handler._renderSectionContent(section)}
                                </div>
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    },

    stack: (layout, handler) => {
        return `
            <div class="handler-panel stack-layout">
                ${layout.sections.map(section => `
                    <div class="stack-section" id="section-${section.id}">
                        ${section.title ? `
                            <div class="section-header">
                                ${section.icon ? `<span class="section-icon">${section.icon}</span>` : ''}
                                <h3 class="section-title">${section.title}</h3>
                            </div>
                        ` : ''}
                        <div class="section-content">
                            ${handler._renderSectionContent(section)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    custom: (layout, handler) => {
        if (layout.customLayoutComponent) {
            return layout.customLayoutComponent(layout, handler);
        }
        return PanelRenderers.stack(layout, handler);
    }
};

// Export for use
window.BaseHandler = BaseHandler;