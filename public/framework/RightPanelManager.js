// Right Panel Manager - Orchestrates the right panel UI
class RightPanelManager {
    constructor(registry) {
        this.registry = registry;
        this.container = null;
        this._initialized = false;
    }

    init() {
        if (this._initialized) return;

        // Create right panel structure if it doesn't exist
        this._ensureRightPanelStructure();

        // Listen to registry events
        this.registry.on('activated', (handler) => {
            this._onHandlerActivated(handler);
        });

        this.registry.on('deactivated', (handler) => {
            this._onHandlerDeactivated(handler);
        });

        this._initialized = true;
        console.log('RightPanelManager initialized');
    }

    _ensureRightPanelStructure() {
        let rightPanel = document.querySelector('.terms-sidebar');

        if (!rightPanel) {
            // Create if doesn't exist
            rightPanel = document.createElement('aside');
            rightPanel.className = 'terms-sidebar';

            const contentWrapper = document.querySelector('.content-wrapper');
            if (contentWrapper) {
                contentWrapper.appendChild(rightPanel);
            }
        }

        // Ensure handler panel container exists
        let panelContainer = rightPanel.querySelector('.handler-panel-container');
        if (!panelContainer) {
            rightPanel.innerHTML = `
                <div class="handler-panel-header">
                    <h3 class="panel-title">Content Analysis</h3>
                    <button class="panel-menu-btn" id="panelMenuBtn">
                        <svg width="16" height="16" viewBox="0 0 16 16">
                            <circle cx="8" cy="3" r="1.5" fill="currentColor"/>
                            <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
                            <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
                        </svg>
                    </button>
                </div>
                <div class="handler-panel-container">
                    <div class="panel-placeholder">
                        <p>Select a category to begin analysis</p>
                    </div>
                </div>
            `;

            panelContainer = rightPanel.querySelector('.handler-panel-container');
        }

        this.container = panelContainer;

        // Attach menu button handler
        this._attachMenuHandler();
    }

    _attachMenuHandler() {
        const menuBtn = document.getElementById('panelMenuBtn');
        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showPanelMenu(e.currentTarget);
            });
        }
    }

    _showPanelMenu(button) {
        // Remove existing menu
        const existingMenu = document.querySelector('.panel-menu-dropdown');
        if (existingMenu) {
            existingMenu.remove();
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'panel-menu-dropdown';
        menu.innerHTML = `
            <div class="menu-item" data-action="reset">Reset Panel</div>
            <div class="menu-item" data-action="export">Export Data</div>
            <div class="menu-divider"></div>
            <div class="menu-item" data-action="help">Help</div>
        `;

        // Position menu
        const rect = button.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;

        document.body.appendChild(menu);

        // Handle menu clicks
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.menu-item');
            if (item) {
                const action = item.dataset.action;
                this._handleMenuAction(action);
                menu.remove();
            }
        });

        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
    }

    _handleMenuAction(action) {
        const handler = this.registry.getActive();
        if (!handler) return;

        switch (action) {
            case 'reset':
                if (confirm('Reset all panel data?')) {
                    handler.setState({
                        customData: {},
                        uiState: {
                            activeSection: null,
                            expandedItems: [],
                            scrollPositions: new Map(),
                            userPreferences: {}
                        }
                    });
                }
                break;
            case 'export':
                this._exportHandlerData(handler);
                break;
            case 'help':
                this._showHelp(handler);
                break;
        }
    }

    _exportHandlerData(handler) {
        const data = {
            handler: handler.name,
            timestamp: new Date().toISOString(),
            state: handler.getState()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)],
            { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${handler.name}-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    _showHelp(handler) {
        alert(`${handler.displayName} Panel\n\n${handler.description || 'No description available.'}`);
    }

    _onHandlerActivated(handler) {
        // Update panel title
        const titleEl = document.querySelector('.handler-panel-header .panel-title');
        if (titleEl) {
            titleEl.textContent = handler.displayName;
        }

        // Handler will mount itself to the container
        console.log(`Right panel updated for handler: ${handler.name}`);
    }

    _onHandlerDeactivated(handler) {
        // Show placeholder
        if (this.container) {
            this.container.innerHTML = `
                <div class="panel-placeholder">
                    <p>Select a category to begin analysis</p>
                </div>
            `;
        }
    }

    // Public API
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `panel-notification ${type}`;
        notification.textContent = message;

        this.container.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    showLoading(show = true) {
        if (show) {
            this.container.classList.add('loading');
        } else {
            this.container.classList.remove('loading');
        }
    }
}

// Create singleton instance
window.RightPanelManager = new RightPanelManager(window.HandlerRegistry);