import type { DashboardSummary } from '../lib/requests';

// The dashboard is a list of widgets, each a small declarative spec over one
// DashboardSummary. A layout is just an ordered list of widget ids, so letting
// people customise their own dashboard later means storing that list per user
// and letting them pick from WIDGETS — nothing here needs to change shape.
//
// Colours are fixed per outcome (the same hexes frappe-ui's categorical ramp
// uses for green / blue / red) so "approved" is the same colour in every chart,
// whatever else is filtered or reordered.
export const OUTCOME = {
  approved: { label: 'Approved', color: '#289e60' },
  in_progress: { label: 'In progress', color: '#2283c3' },
  rejected: { label: 'Rejected', color: '#c54b58' },
} as const;

// Scope colours are deliberately NOT the outcome colours: violet / amber / grey
// never appear as an outcome, so one colour never means two things on a page.
export const SCOPE = {
  internal: { label: 'Internal', color: '#753cbb' },
  external: { label: 'External', color: '#c98c28' },
  unset: { label: 'Not set', color: '#9ca3af' },
} as const;
export const CLASS_LABEL = { tech: 'Tech', non_tech: 'Non-tech', unset: 'Not set' } as const;

export type Span = 1 | 2 | 3 | 4;

export type WidgetSpec =
  | { id: string; title: string; kind: 'number'; span: Span; value: (s: DashboardSummary) => number | null; delta?: (s: DashboardSummary) => number | null; suffix?: string; sparkline?: (s: DashboardSummary) => number[]; caption?: string }
  | { id: string; title: string; kind: 'donut'; span: Span; subtitle?: string; rows: (s: DashboardSummary) => { name: string; count: number; color?: string }[]; center: string }
  | { id: string; title: string; kind: 'bars'; span: Span; subtitle?: string; rows: (s: DashboardSummary) => { name: string; count: number }[]; empty: string }
  | { id: string; title: string; kind: 'trend'; span: Span; subtitle?: string }
  | { id: string; title: string; kind: 'events'; span: Span; subtitle?: string };

// Percent change vs the prior 30 days; null when there is no prior period to compare.
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export const WIDGETS: WidgetSpec[] = [
  { id: 'kpi-total', title: 'Total ODs', kind: 'number', span: 1,
    value: (s) => s.total, delta: (s) => pct(s.last_30, s.prev_30),
    sparkline: (s) => s.by_month.map((m) => m.approved + m.rejected + m.in_progress),
    caption: 'Filed in last 30 days vs the 30 before' },
  { id: 'kpi-approved', title: 'Approved', kind: 'number', span: 1, value: (s) => s.approved,
    suffix: '', caption: '' },
  { id: 'kpi-in-progress', title: 'In progress', kind: 'number', span: 1, value: (s) => s.in_progress },
  { id: 'kpi-decision-time', title: 'Avg. time to decision', kind: 'number', span: 1, value: (s) => s.avg_decision_hours, suffix: ' h' },

  { id: 'kpi-events-now', title: 'Events going on', kind: 'number', span: 1, value: (s) => s.events.ongoing },
  { id: 'kpi-events-next', title: 'Events coming up', kind: 'number', span: 1, value: (s) => s.events.upcoming },

  { id: 'outcomes', title: 'Outcomes', kind: 'donut', span: 1, center: 'requests',
    rows: (s) => [
      { name: OUTCOME.approved.label, count: s.approved, color: OUTCOME.approved.color },
      { name: OUTCOME.in_progress.label, count: s.in_progress, color: OUTCOME.in_progress.color },
      { name: OUTCOME.rejected.label, count: s.rejected, color: OUTCOME.rejected.color },
    ] },
  { id: 'trend', title: 'ODs filed per month', kind: 'trend', span: 3, subtitle: 'By outcome, last 12 months' },

  { id: 'scope', title: 'Internal vs external', kind: 'donut', span: 1, center: 'requests',
    rows: (s) => s.by_scope.map((r) => ({ name: SCOPE[r.scope].label, count: r.count, color: SCOPE[r.scope].color })) },
  { id: 'by-class', title: 'Internal: tech vs non-tech', kind: 'bars', span: 1, subtitle: 'Internal events only',
    rows: (s) => s.by_class.map((r) => ({ name: CLASS_LABEL[r.class], count: r.count })),
    empty: 'No internal events yet — set a category to Internal under Workflow.' },
  { id: 'events', title: 'Happening now and next', kind: 'events', span: 2, subtitle: 'Approved events by their dates' },
  { id: 'by-category', title: 'By category', kind: 'bars', span: 2, subtitle: 'Where requests are being filed',
    rows: (s) => s.by_category, empty: 'No requests yet.' },
  { id: 'by-department', title: 'By department', kind: 'bars', span: 2, subtitle: 'Programme the request belongs to',
    rows: (s) => s.by_org_unit, empty: 'No requests are tied to a department yet.' },
  { id: 'pipeline', title: 'Waiting at', kind: 'bars', span: 2, subtitle: 'Open requests, by the stage they are at',
    rows: (s) => s.pipeline.map((p) => ({ name: p.stage, count: p.count })), empty: 'Nothing is waiting — every request has been decided.' },
];

// What a person sees until they customise it. Deans and the captain share the
// same default; what differs is what the database lets each of them count.
export const DEFAULT_LAYOUT: string[] = [
  'kpi-total', 'kpi-approved', 'kpi-in-progress', 'kpi-decision-time',
  'kpi-events-now', 'kpi-events-next',
  'outcomes', 'trend',
  'scope', 'by-class', 'events',
  'by-category', 'by-department', 'pipeline',
];
