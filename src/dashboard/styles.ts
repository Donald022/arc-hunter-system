/**
 * ARC Hunter System Mission Control — Dark Theme Styles
 * A professional, restrained dark operations console aesthetic
 */

export const darkTheme = `
/* ===== CSS Variables ===== */
:root {
  /* Colors: Dark Operations Console */
  --bg-obsidian: #080A0D;
  --bg-elevated: #11151A;
  --border-subtle: #252B33;
  --text-primary: #F4F6F8;
  --text-secondary: #9099A5;
  --accent-gold: #C99A45;
  --success: #3D7B4F;
  --success-dim: #254432;
  --warning: #C99A45;
  --warning-dim: #3D3020;
  --error: #B33A3A;
  --error-dim: #3D2020;
  
  /* Typography */
  --font-base: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  
  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  
  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 10px 30px rgba(0,0,0,0.5);
}

/* ===== Reset & Base ===== */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-base);
  color: var(--text-primary);
  background: var(--bg-obsidian);
  line-height: 1.5;
  min-height: 100vh;
}

/* ===== Layout Grid ===== */
.dashboard-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

/* ===== Sidebar Navigation ===== */
.sidebar {
  background: var(--bg-elevated);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar-header {
  padding: var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.sidebar-wordmark {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-primary);
  margin-bottom: var(--space-xs);
}

.sidebar-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 400;
  letter-spacing: 0.3px;
}

.sidebar-nav {
  flex: 1;
  padding: var(--space-md) 0;
}

.nav-link {
  display: flex;
  align-items: center;
  padding: var(--space-sm) var(--space-lg);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s ease;
  border-left: 3px solid transparent;
}

.nav-link:hover {
  background: rgba(255,255,255,0.03);
  color: var(--text-primary);
}

.nav-link.active {
  background: rgba(201,154,69,0.08);
  color: var(--accent-gold);
  border-left-color: var(--accent-gold);
}

.sidebar-footer {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}

.sidebar-user {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
}

/* ===== Main Content ===== */
.main-content {
  display: flex;
  flex-direction: column;
}

.page-header {
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-lg) var(--space-xl);
  position: sticky;
  top: 0;
  z-index: 10;
}

.page-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.page-badges {
  display: flex;
  gap: var(--space-sm);
}

.page-description {
  font-size: 14px;
  color: var(--text-secondary);
}

.page-content {
  padding: var(--space-xl);
  flex: 1;
}

/* ===== Badge Components ===== */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
}

.badge-success {
  background: var(--success-dim);
  color: var(--success);
  border: 1px solid var(--success);
}

.badge-warning {
  background: var(--warning-dim);
  color: var(--warning);
  border: 1px solid var(--warning);
}

.badge-error {
  background: var(--error-dim);
  color: var(--error);
  border: 1px solid var(--error);
}

.badge-neutral {
  background: rgba(255,255,255,0.05);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 6px;
}

.badge-success .badge-dot { background: var(--success); }
.badge-warning .badge-dot { background: var(--warning); }
.badge-error .badge-dot { background: var(--error); }

/* ===== Card Components ===== */
.card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
  box-shadow: var(--shadow-sm);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ===== Stats Grid ===== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.stat-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: var(--space-md);
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--space-xs);
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: var(--space-xs);
}

/* ===== Progress Bar ===== */
.progress-bar {
  background: rgba(255,255,255,0.05);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
  margin: var(--space-sm) 0;
}

.progress-fill {
  background: linear-gradient(90deg, var(--accent-gold), #D4A855);
  height: 100%;
  transition: width 0.3s ease;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: var(--space-xs);
}

/* ===== Buttons ===== */
button, .button {
  font-family: var(--font-base);
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

button:hover:not(:disabled), .button:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.2);
}

button:active:not(:disabled) {
  transform: translateY(1px);
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button.primary {
  background: var(--accent-gold);
  color: var(--bg-obsidian);
  border-color: var(--accent-gold);
}

button.primary:hover:not(:disabled) {
  background: #D4A855;
  border-color: #D4A855;
}

button.danger {
  background: var(--error-dim);
  color: var(--error);
  border-color: var(--error);
}

button.danger:hover:not(:disabled) {
  background: var(--error);
  color: var(--text-primary);
}

button.small {
  padding: 4px 10px;
  font-size: 12px;
}

/* ===== Forms ===== */
form.inline {
  display: inline-block;
}

label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--space-xs);
}

input[type="text"],
input[type="email"],
input[type="number"],
input[type="url"],
textarea,
select {
  font-family: var(--font-base);
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-obsidian);
  color: var(--text-primary);
  width: 100%;
  transition: all 0.15s ease;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--accent-gold);
  box-shadow: 0 0 0 3px rgba(201,154,69,0.1);
}

select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239099A5' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 32px;
  cursor: pointer;
}

select:hover {
  border-color: var(--accent-gold);
}

select option {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

input::placeholder,
textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

input[type="checkbox"] {
  width: auto;
  margin-right: var(--space-xs);
}

textarea {
  resize: vertical;
  min-height: 80px;
}

.form-row {
  margin-bottom: var(--space-md);
}

.form-inline {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-end;
}

.form-inline label {
  flex: 1;
}

/* ===== Tables ===== */
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
}

thead {
  background: rgba(255,255,255,0.02);
}

th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border-subtle);
}

td {
  padding: 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

tr:hover {
  background: rgba(255,255,255,0.02);
}

tr:last-child td {
  border-bottom: none;
}

/* ===== Hunter Cards ===== */
.hunter-grid {
  display: grid;
  gap: var(--space-md);
}

.hunter-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: var(--space-md);
  display: flex;
  align-items: center;
  gap: var(--space-md);
  transition: all 0.15s ease;
}

.hunter-card:hover {
  border-color: rgba(255,255,255,0.2);
  box-shadow: var(--shadow-sm);
}

.hunter-icon {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: rgba(201,154,69,0.1);
  border: 1px solid rgba(201,154,69,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.hunter-info {
  flex: 1;
  min-width: 0;
}

.hunter-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.hunter-meta {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.hunter-actions {
  display: flex;
  gap: var(--space-sm);
  flex-shrink: 0;
}

/* ===== Campaign Cards ===== */
.campaign-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
}

.campaign-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
}

.campaign-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.campaign-form {
  display: grid;
  gap: var(--space-md);
}

.campaign-section {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: var(--space-md);
  align-items: start;
}

.campaign-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  padding-top: 10px;
}

/* ===== Filter Bar ===== */
.filter-bar {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.filter-bar input {
  flex: 1;
  min-width: 200px;
}

.filter-bar button {
  flex-shrink: 0;
}

/* ===== Empty State ===== */
.empty-state {
  text-align: center;
  padding: var(--space-xl) var(--space-lg);
  color: var(--text-secondary);
}

.empty-state-icon {
  font-size: 48px;
  opacity: 0.3;
  margin-bottom: var(--space-md);
}

.empty-state-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-xs);
}

.empty-state-description {
  font-size: 14px;
  color: var(--text-secondary);
}

/* ===== Alert Banner ===== */
.alert {
  padding: var(--space-md);
  border-radius: 6px;
  margin-bottom: var(--space-lg);
  border: 1px solid;
  font-size: 14px;
}

.alert-warning {
  background: var(--warning-dim);
  color: var(--warning);
  border-color: var(--warning);
}

.alert-info {
  background: rgba(255,255,255,0.05);
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

/* ===== Control Panel ===== */
.control-panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) 0;
}

.control-row:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
}

.control-info {
  flex: 1;
}

.control-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.control-description {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ===== Developer Details ===== */
.dev-details {
  margin-top: var(--space-xl);
}

.dev-details summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  padding: var(--space-sm);
  background: rgba(255,255,255,0.02);
  border-radius: 4px;
  user-select: none;
}

.dev-details summary:hover {
  background: rgba(255,255,255,0.04);
}

.dev-details pre {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--bg-obsidian);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: var(--space-md);
  overflow-x: auto;
  margin-top: var(--space-sm);
}

/* ===== Responsive ===== */
@media (max-width: 768px) {
  .dashboard-layout {
    grid-template-columns: 1fr;
  }
  
  .sidebar {
    position: fixed;
    top: 0;
    left: -240px;
    width: 240px;
    z-index: 100;
    transition: left 0.3s ease;
    height: 100vh;
  }
  
  .sidebar.mobile-open {
    left: 0;
  }
  
  .page-header {
    position: relative;
  }
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .hunter-card {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .hunter-actions {
    width: 100%;
  }
  
  .campaign-section {
    grid-template-columns: 1fr;
  }
  
  .filter-bar {
    flex-direction: column;
  }
  
  .filter-bar input {
    min-width: 100%;
  }
}

/* ===== Animations ===== */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.fade-in {
  animation: fadeIn 0.3s ease;
}

/* ===== Accessibility ===== */
*:focus-visible {
  outline: 2px solid var(--accent-gold);
  outline-offset: 2px;
}

button:focus-visible {
  outline-offset: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
`;
