/**
 * Brief lifecycle — shared by the server (transition validation) and the UI
 * (action buttons, status pills, dashboard filters).
 *
 *   draft ──submit──▶ submitted ──start──▶ in_analysis ──complete──▶ completed
 *                 ╲                                              (form / PATCH)
 *      paused_24h ─resolve─▶ submitted
 *
 * `draft → submitted/paused_24h` happens through the form (POST/PATCH), not a
 * transition. Archiving is orthogonal (any brief can be archived/unarchived).
 */

export type BriefStatus = 'draft' | 'paused_24h' | 'submitted' | 'in_analysis' | 'completed';

export const STATUS_LABEL: Record<BriefStatus, string> = {
  draft: 'Draft',
  paused_24h: 'Paused 24h',
  submitted: 'Outstanding',
  in_analysis: 'In analysis',
  completed: 'Completed',
};

export type StatusAction = { to: BriefStatus; label: string };

/** Actions available from each status (drive the buttons on the detail page). */
export const NEXT_ACTIONS: Record<BriefStatus, StatusAction[]> = {
  draft: [],
  paused_24h: [{ to: 'submitted', label: 'Questionnaire on record — submit' }],
  submitted: [{ to: 'in_analysis', label: 'Start analysis' }],
  in_analysis: [{ to: 'completed', label: 'Mark analysis complete' }],
  completed: [],
};

/** Server-side guard: is moving from→to a permitted transition? */
export function canTransition(from: BriefStatus, to: BriefStatus): boolean {
  return (NEXT_ACTIONS[from] || []).some((a) => a.to === to);
}
