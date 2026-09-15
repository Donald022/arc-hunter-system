export const METRICS = {
  sources_fetched: 0,
  candidates_found: 0,
  hard_gate_pass: 0,
  manual_review_count: 0,
  qualified_count: 0,
  verified_emails: 0,
  draft_rejects: 0,
  approvals: 0,
  sent: 0,
  uncertain_sends: 0,
  replies: 0,
  opt_outs: 0,
  api_errors: 0,
  ai_requests: 0,
  ai_input_tokens: 0,
  ai_output_tokens: 0,
  ai_estimated_usd: 0,
  enrichment_credits: 0,
} as const satisfies Record<string, number>;

export type MetricName = keyof typeof METRICS;

const counts: Record<MetricName, number> = { ...METRICS };

export function inc(name: MetricName, by = 1): void {
  counts[name] += by;
}

export function setMetric(name: MetricName, value: number): void {
  counts[name] = value;
}

export function snapshotMetrics(): Record<MetricName, number> {
  return { ...counts };
}

export function resetMetrics(): void {
  for (const k of Object.keys(counts) as MetricName[]) counts[k] = 0;
}
