// Handler Registry - Manages all registered handlers
class HandlerRegistry {
    constructor() {
        this.handlers = new Map();
        this.activeHandlers = new Set(); // Multiple active handlers per category
        this.activeCategory = null;
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
        if (this.activeHandlers.has(handlerName)) {
            this.deactivateHandler(handlerName);
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

    getHandlersByCategory(category) {
        return this.getAll().filter(handler => {
            const handlerCategory = handler.name.split('-')[0];
            return handlerCategory === category;
        });
    }

    setActiveCategory(category) {
        // Deactivate all current handlers
        this.deactivateAll();

        this.activeCategory = category;

        // Get all handlers for this category
        const categoryHandlers = this.getHandlersByCategory(category);

        if (categoryHandlers.length === 0) {
            this._renderEmptyPanel();
            return;
        }

        // Create tabs container
        this._createTabsContainer();

        // Activate all handlers for this category
        categoryHandlers.forEach((handler, index) => {
            this.activateHandler(handler.name, index === 0);
        });

        // Update category selection UI
        this._updateCategorySelection(category);
    }

    activateHandler(handlerName, makeActive = false) {
        const handler = this.handlers.get(handlerName);

        if (!handler) {
            throw new Error(`Handler ${handlerName} not found`);
        }

        this.activeHandlers.add(handler);

        // Create tab for this handler
        this._createHandlerTab(handler, makeActive);

        // Mount handler content
        const tabContent = document.getElementById(`tab-content-${handler.name}`);
        if (tabContent) {
            console.log(`[HandlerRegistry] Mounting ${handler.name} to tab content`);
            handler.onMount(tabContent);
        } else {
            console.error(`[HandlerRegistry] Tab content not found for ${handler.name}`);
        }

        // Notify listeners
        this._notifyListeners('activated', handler);

        console.log(`Activated handler: ${handlerName}`);
    }

    deactivateHandler(handlerName) {
        const handler = this.handlers.get(handlerName);
        if (handler && this.activeHandlers.has(handler)) {
            handler.onUnmount();
            this.activeHandlers.delete(handler);
            this._notifyListeners('deactivated', handler);
        }
    }

    deactivateAll() {
        this.activeHandlers.forEach(handler => {
            handler.onUnmount();
            this._notifyListeners('deactivated', handler);
        });
        this.activeHandlers.clear();
    }
    
    clearAll() {
        console.log('[HandlerRegistry] Clearing all handlers');
        
        // Deactivate all handlers first
        this.deactivateAll();
        
        // Clear all handlers from registry
        this.handlers.clear();
        
        // Clear the right panel
        this._renderEmptyPanel();
        
        console.log('[HandlerRegistry] All handlers cleared');
    }

    getActive() {
        // Return first active handler for compatibility
        return Array.from(this.activeHandlers)[0] || null;
    }

    getActiveHandlers() {
        return Array.from(this.activeHandlers);
    }

    isActive(handlerName) {
        const handler = this.handlers.get(handlerName);
        return handler && this.activeHandlers.has(handler);
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

    _createTabsContainer() {
        const rightPanel = document.querySelector('.terms-sidebar');
        if (!rightPanel) return;

        rightPanel.innerHTML = `
            <div class="multi-handler-tabs">
                <div class="tabs-header" id="handler-tabs-header"></div>
                <div class="tabs-content" id="handler-tabs-content"></div>
            </div>
        `;
    }

    _createHandlerTab(handler, makeActive) {
        const tabsHeader = document.getElementById('handler-tabs-header');
        const tabsContent = document.getElementById('handler-tabs-content');

        if (!tabsHeader || !tabsContent) return;

        // Create tab button - NO ICON
        const tabButton = document.createElement('button');
        tabButton.className = `tab-btn ${makeActive ? 'active' : ''}`;
        tabButton.setAttribute('data-handler', handler.name);
        tabButton.textContent = handler.displayName; // Simple text only

        tabButton.addEventListener('click', () => {
            this._switchTab(handler.name);
        });

        tabsHeader.appendChild(tabButton);

        // Create tab content
        const tabContent = document.createElement('div');
        tabContent.id = `tab-content-${handler.name}`;
        tabContent.className = `tab-panel ${makeActive ? 'active' : ''}`;
        tabContent.setAttribute('data-handler', handler.name);

        tabsContent.appendChild(tabContent);
    }

    _switchTab(handlerName) {
        // Update tab buttons
        document.querySelectorAll('#handler-tabs-header .tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-handler') === handlerName);
        });

        // Update tab content
        document.querySelectorAll('#handler-tabs-content .tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.getAttribute('data-handler') === handlerName);
        });
    }

    _renderEmptyPanel() {
        const rightPanel = document.querySelector('.terms-sidebar');
        if (rightPanel) {
            rightPanel.innerHTML = `
                <div class="panel-placeholder">
                    <p>No analysis available for this category</p>
                </div>
            `;
        }
    }

    _updateCategorySelection(category) {
        console.log(`[HandlerRegistry] Updating category selection to: ${category}`);
        
        // Map category to display text
        const categoryTextMap = {
            'finance': 'Finance/Business',
            'cs': 'Computer Science',
            'history': 'History'
        };

        const categoryText = categoryTextMap[category];
        if (!categoryText) {
            console.warn(`[HandlerRegistry] Unknown category: ${category}`);
            return;
        }

        // Update active category - remove active from all first
        const categoryItems = document.querySelectorAll('.category-item');
        console.log(`[HandlerRegistry] Found ${categoryItems.length} category items`);
        
        categoryItems.forEach(item => {
            const itemCategory = item.getAttribute('data-category');
            console.log(`[HandlerRegistry] Item category: ${itemCategory}, target: ${category}`);
            
            if (itemCategory === category) {
                item.classList.add('active');
                console.log(`[HandlerRegistry] Added active to ${itemCategory}`);
            } else {
                item.classList.remove('active');
                console.log(`[HandlerRegistry] Removed active from ${itemCategory}`);
            }
        });

        // Update header
        const header = document.querySelector('.app-header h3');
        if (header) {
            header.textContent = categoryText;
        }
    }
}

// Create singleton instance
window.HandlerRegistry = new HandlerRegistry();