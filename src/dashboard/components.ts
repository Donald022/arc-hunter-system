/**
 * ARC Hunter Dashboard UI Components
 * Reusable HTML component builders
 */

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export interface BadgeProps {
  type: "success" | "warning" | "error" | "neutral";
  label: string;
  dot?: boolean;
}

export function badge({ type, label, dot = false }: BadgeProps): string {
  return `<span class="badge badge-${type}">
    ${dot ? `<span class="badge-dot"></span>` : ""}
    ${esc(label)}
  </span>`;
}

export interface StatCardProps {
  label: string;
  value: string | number;
  meta?: string;
}

export function statCard({ label, value, meta }: StatCardProps): string {
  return `<div class="stat-card">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(String(value))}</div>
    ${meta ? `<div class="stat-meta">${esc(meta)}</div>` : ""}
  </div>`;
}

export interface ProgressBarProps {
  current: number;
  max: number;
  label?: string;
  showNumbers?: boolean;
}

export function progressBar({ current, max, label, showNumbers = true }: ProgressBarProps): string {
  const percentage = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return `<div class="progress-bar">
    <div class="progress-fill" style="width: ${percentage.toFixed(1)}%"></div>
  </div>
  ${
    showNumbers
      ? `<div class="progress-label">
    <span>${label ?? ""}</span>
    <span>${current} / ${max}</span>
  </div>`
      : ""
  }`;
}

export interface HunterIconProps {
  hunter: string;
}

export function hunterIcon({ hunter }: HunterIconProps): string {
  const icons: Record<string, string> = {
    "carbon-capture": "🌱",
    "data-center-land": "📍",
    "renewable-finance": "⚡",
    "grid-modernization": "⚙️",
    "cooling-tech": "❄️",
  };
  const icon = icons[hunter] ?? "🎯";
  return `<div class="hunter-icon">${icon}</div>`;
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
}

export function emptyState({ icon = "📭", title, description }: EmptyStateProps): string {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${esc(title)}</div>
    ${description ? `<div class="empty-state-description">${esc(description)}</div>` : ""}
  </div>`;
}

export interface AlertProps {
  type: "warning" | "info";
  message: string;
}

export function alert({ type, message }: AlertProps): string {
  return `<div class="alert alert-${type}">${message}</div>`;
}

export { esc };
