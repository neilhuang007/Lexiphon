// Handler Registry - Manages all registered handlers
class HandlerRegistry {
    constructor() {
        this.handlers = new Map();
        this.activeHandler = null;
        this._listeners = new Set();
    }

    register(handler) {
        if (!(handler instanceof BaseHandler)) {
            throw new Error('Handler must extend BaseHandler');
        }

        if (this.handlers.has(handler.name)) {
            console.warn(`Handler ${handler.name} is already registered. Overwriting.`);
        }

        this.handlers.set(handler.name, handler);
        console.log(`Registered handler: ${handler.name}`);

        // Notify listeners
        this._notifyListeners('registered', handler);
    }

    unregister(handlerName) {
        if (this.activeHandler && this.activeHandler.name === handlerName) {
            this.deactivate();
        }

        const handler = this.handlers.get(handlerName);
        if (handler) {
            this.handlers.delete(handlerName);
            this._notifyListeners('unregistered', handler);
        }
    }

    get(handlerName) {
        return this.handlers.get(handlerName);
    }

    getAll() {
        return Array.from(this.handlers.values());
    }

    setActive(handlerName) {
        const handler = this.handlers.get(handlerName);

        if (!handler) {
            throw new Error(`Handler ${handlerName} not found`);
        }

        // Deactivate current handler
        if (this.activeHandler) {
            this.deactivate();
        }

        // Activate new handler
        this.activeHandler = handler;

        // Update UI
        this._updateUI();

        // Mount handler to right panel
        const container = document.querySelector('.handler-panel-container');
        if (container) {
            handler.onMount(container);
        }

        // Update category selection
        this._updateCategorySelection(handlerName);

        // Notify listeners
        this._notifyListeners('activated', handler);

        console.log(`Activated handler: ${handlerName}`);
    }

    deactivate() {
        if (this.activeHandler) {
            const handler = this.activeHandler;
            handler.onUnmount();
            this.activeHandler = null;
            this._notifyListeners('deactivated', handler);
        }
    }

    getActive() {
        return this.activeHandler;
    }

    isActive(handlerName) {
        return this.activeHandler && this.activeHandler.name === handlerName;
    }

    // Event handling
    on(event, callback) {
        this._listeners.add({ event, callback });
        return () => {
            this._listeners.forEach(listener => {
                if (listener.event === event && listener.callback === callback) {
                    this._listeners.delete(listener);
                }
            });
        };
    }

    _notifyListeners(event, handler) {
        this._listeners.forEach(listener => {
            if (listener.event === event) {
                try {
                    listener.callback(handler);
                } catch (error) {
                    console.error(`Error in registry listener:`, error);
                }
            }
        });
    }

    _updateUI() {
        if (!this.activeHandler) return;

        // Update header
        const header = document.querySelector('.app-header h3');
        if (header) {
            header.textContent = this.activeHandler.displayName;
        }

        // Update or create handler-specific controls
        this._renderHandlerControls();
    }

    _renderHandlerControls() {
        const controlsSection = document.querySelector('.controls-section');
        if (!controlsSection) return;

        // Remove existing handler controls
        const existingControls = controlsSection.querySelector('.handler-controls');
        if (existingControls) {
            existingControls.remove();
        }

        // Get controls from active handler if it provides them
        if (this.activeHandler && this.activeHandler.getControls) {
            const controls = this.activeHandler.getControls();
            if (controls) {
                const controlsDiv = document.createElement('div');
                controlsDiv.className = 'handler-controls';
                controlsDiv.innerHTML = controls;

                // Insert after first button group
                const buttonGroup = controlsSection.querySelector('.button-group');
                if (buttonGroup) {
                    buttonGroup.after(controlsDiv);
                }
            }
        }
    }

    _updateCategorySelection(handlerName) {
        // Map handler names to category text
        const handlerToCategoryMap = {
            'finance': 'Finance/Business',
            'cs': 'Computer Science',
            'history': 'History'
        };

        const categoryText = handlerToCategoryMap[handlerName];
        if (!categoryText) return;

        // Update active category
        document.querySelectorAll('.category-item').forEach(item => {
            const text = item.querySelector('.category-text');
            if (text && text.textContent === categoryText) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }
}

// Create singleton instance
window.HandlerRegistry = new HandlerRegistry();