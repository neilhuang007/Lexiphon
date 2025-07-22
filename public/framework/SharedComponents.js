// Shared Components Library
const SharedComponents = {
    // Card Components
    Card: ({ title, content, icon, className = '', onClick }) => {
        return `
            <div class="shared-card ${className}" ${onClick ? `onclick="${onClick}"` : ''}>
                ${icon ? `<div class="card-icon">${icon}</div>` : ''}
                ${title ? `<h4 class="card-title">${title}</h4>` : ''}
                <div class="card-content">${content}</div>
            </div>
        `;
    },

    InfoCard: ({ label, value, icon, trend }) => {
        return SharedComponents.Card({
            className: 'info-card',
            content: `
                <div class="info-label">${label}</div>
                <div class="info-value">${value}</div>
                ${trend ? `<div class="info-trend ${trend.direction}">${trend.text}</div>` : ''}
            `,
            icon
        });
    },

    // List Components
    ScrollableList: ({ items, renderItem, className = '', emptyMessage = 'No items' }) => {
        if (!items || items.length === 0) {
            return `<div class="empty-state">${emptyMessage}</div>`;
        }

        return `
            <div class="scrollable-list ${className}">
                ${items.map((item, index) =>
            `<div class="list-item" data-index="${index}">
                        ${renderItem(item, index)}
                    </div>`
        ).join('')}
            </div>
        `;
    },

    // Control Components
    SearchBar: ({ placeholder = 'Search...', onSearch, value = '' }) => {
        const id = `search-${Date.now()}`;

        // Store callback globally for event handling
        window[`__search_${id}`] = onSearch;

        return `
            <div class="search-bar">
                <input type="text" 
                       id="${id}"
                       placeholder="${placeholder}" 
                       value="${value}"
                       class="search-input"
                       oninput="window['__search_${id}'](this.value)">
                <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16">
                    <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" fill="none"/>
                    <path d="M11 11L14 14" stroke="currentColor"/>
                </svg>
            </div>
        `;
    },

    TabContainer: ({ tabs, activeTab, onTabChange }) => {
        const id = `tabs-${Date.now()}`;
        window[`__tabChange_${id}`] = onTabChange;

        return `
            <div class="shared-tabs">
                <div class="tabs-header">
                    ${tabs.map(tab => `
                        <button class="tab-btn ${tab.id === activeTab ? 'active' : ''}"
                                onclick="window['__tabChange_${id}']('${tab.id}')">
                            ${tab.icon ? `<span class="tab-icon">${tab.icon}</span>` : ''}
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>
                <div class="tabs-content">
                    ${tabs.map(tab => `
                        <div class="tab-pane ${tab.id === activeTab ? 'active' : ''}"
                             data-tab="${tab.id}">
                            ${tab.content || ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    // Visualization Components
    ProgressBar: ({ value, max = 100, label, color }) => {
        const percentage = (value / max) * 100;
        return `
            <div class="progress-bar">
                ${label ? `<div class="progress-label">${label}</div>` : ''}
                <div class="progress-track">
                    <div class="progress-fill" 
                         style="width: ${percentage}%; ${color ? `background: ${color};` : ''}">
                    </div>
                </div>
                <div class="progress-value">${value}/${max}</div>
            </div>
        `;
    },

    Timeline: ({ events, orientation = 'vertical' }) => {
        return `
            <div class="timeline ${orientation}">
                ${events.map((event, index) => `
                    <div class="timeline-item">
                        <div class="timeline-marker"></div>
                        <div class="timeline-content">
                            <div class="timeline-date">${event.date}</div>
                            <div class="timeline-title">${event.title}</div>
                            ${event.description ?
            `<div class="timeline-description">${event.description}</div>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    // Form Components
    Toggle: ({ id, label, checked = false, onChange }) => {
        window[`__toggle_${id}`] = onChange;

        return `
            <div class="toggle-wrapper">
                <input type="checkbox" 
                       id="${id}" 
                       class="toggle-input" 
                       ${checked ? 'checked' : ''}
                       onchange="window['__toggle_${id}'](this.checked)">
                <label for="${id}" class="toggle-label">
                    <span class="toggle-switch"></span>
                    ${label}
                </label>
            </div>
        `;
    },

    // Utility Components
    LoadingSpinner: ({ size = 'medium', text }) => {
        return `
            <div class="loading-spinner ${size}">
                <div class="spinner"></div>
                ${text ? `<div class="loading-text">${text}</div>` : ''}
            </div>
        `;
    },

    EmptyState: ({ icon, title, message, action }) => {
        return `
            <div class="empty-state-container">
                ${icon ? `<div class="empty-state-icon">${icon}</div>` : ''}
                <h3 class="empty-state-title">${title}</h3>
                <p class="empty-state-message">${message}</p>
                ${action ? `
                    <button class="empty-state-action" onclick="${action.onClick}">
                        ${action.label}
                    </button>
                ` : ''}
            </div>
        `;
    },

    // Complex Components
    DataTable: ({ columns, data, className = '' }) => {
        return `
            <div class="data-table-wrapper ${className}">
                <table class="data-table">
                    <thead>
                        <tr>
                            ${columns.map(col =>
            `<th class="${col.className || ''}">${col.label}</th>`
        ).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(row => `
                            <tr>
                                ${columns.map(col => {
            const value = col.accessor ?
                col.accessor(row) : row[col.key];
            return `<td class="${col.className || ''}">${value}</td>`;
        }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    // Helper functions
    createComponent: (html) => {
        const div = document.createElement('div');
        div.innerHTML = html.trim();
        return div.firstChild;
    },

    render: (component, container) => {
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        if (container) {
            container.innerHTML = component;
        }
    }
};

// Export for use
window.SharedComponents = SharedComponents;