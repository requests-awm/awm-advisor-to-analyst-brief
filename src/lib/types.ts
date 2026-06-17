import type { Answers } from './briefSchema';
import type { BriefStatus } from './lifecycle';

export type { BriefStatus };

/** A brief record as returned by the API (mirrors adviser_to_analyst.briefs columns). */
export type Brief = {
  id: string;
  client_name: string;
  ceding_scheme: string | null;
  p_code: string | null;
  asana_task_id: string | null;
  transfer_type: 'pension' | 'isa' | 'gia' | null;
  transfer_value: number | null;
  client_age: number | null;
  client_dob: string | null;
  risk_profile: string | null;
  adviser_email: string | null;
  meeting_date: string | null;
  meeting_time: string | null;
  completed_by: string | null;
  risk_questionnaire_on_record: boolean;
  status: BriefStatus;
  pause_until: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  archived_at: string | null;
  answers: Answers;
  submitted_by_email: string | null;
  submitted_by_name: string | null;
  asana_comment_gid: string | null;
  asana_sync_error: string | null;
  ai_suggestions: string | null;
  ai_suggestions_at: string | null;
  rtq_signup_ref: string | null;
  rtq_state: string | null;
  rtq_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CurrentUser = {
  sub: string;
  email: string;
  name?: string;
  avatar_url?: string | null;
  admin?: boolean;
};

export type BriefEvent = {
  id: string;
  brief_id: string;
  action: string;
  actor_email: string | null;
  detail: string | null;
  created_at: string;
};
