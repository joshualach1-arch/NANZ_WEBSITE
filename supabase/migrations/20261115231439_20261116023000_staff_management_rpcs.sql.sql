/*
# Staff management RPCs (server-side permission enforcement)

The site has no member login. Management actions (rivals, goals, missions,
hall of fame, alert thresholds, manual awards) must still be enforced
server-side. A private staff table holds a randomly generated management
key that the anon/authenticated roles CANNOT read. SECURITY DEFINER
functions compare the presented key against the stored key before acting.

## 1. New Tables
- `nanz_staff_config`: id (true), staff_key (text, random hex). REVOKE ALL from anon/authenticated.

## 2. New Functions (SECURITY DEFINER, EXECUTE to anon+authenticated, passkey-checked)
- `staff_manage_rival(p_passkey, p_action, p_clan_name, p_display_name, p_description, p_tracking)` — add/update/toggle/delete tracked rivals. Validates clan exists in latest verified battle rankings (real clans only).
- `staff_manage_goal(p_passkey, p_action, p_goal_id, p_title, p_description, p_category, p_target_points, p_target_rank, p_deadline, p_owner_label, p_reward)` — create/edit/pause/resume/complete/archive goals + audit history rows.
- `staff_manage_mission(p_passkey, p_action, p_mission_id, p_title, p_description, p_requirement_type, p_requirement_value, p_start_date, p_end_date, p_reward, p_user_id)` — create missions, assign members, complete manually.
- `staff_manage_hof(p_passkey, p_action, p_user_id, p_username, p_title, p_detail, p_entry_type)` — add/remove special recognition (and legend) entries.
- `staff_manage_alert_config(p_passkey, p_threshold_points, p_surge_percent, p_milestones)` — update alert thresholds.
- `staff_manual_award(p_passkey, p_award_slug, p_roblox_user_id, p_notes)` — management-awarded recognition (marks notes as management-awarded).
- `staff_verify(p_passkey)` — returns boolean, used by the admin panel to check a key.

## 3. Security
- `nanz_staff_config`: RLS on, no grants to anon/authenticated (service_role only).
- Functions: SECURITY DEFINER, search_path pinned. Passkey mismatch raises.
*/

CREATE TABLE IF NOT EXISTS public.nanz_staff_config (
  id boolean PRIMARY KEY DEFAULT true,
  staff_key text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.nanz_staff_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.nanz_staff_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nanz_staff_config FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_verify(p_passkey text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_key text;
BEGIN
  SELECT staff_key INTO v_key FROM nanz_staff_config WHERE id = true;
  RETURN v_key IS NOT NULL AND p_passkey = v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_assert(p_passkey text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_key text;
BEGIN
  SELECT staff_key INTO v_key FROM nanz_staff_config WHERE id = true;
  IF v_key IS NULL OR p_passkey IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'staff_key_invalid';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_manage_rival(
  p_passkey text, p_action text, p_clan_name text,
  p_display_name text DEFAULT NULL, p_description text DEFAULT NULL, p_tracking boolean DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_existing uuid;
BEGIN
  PERFORM staff_assert(p_passkey);

  IF p_action = 'add' THEN
    IF p_clan_name IS NULL OR length(trim(p_clan_name)) = 0 THEN
      RAISE EXCEPTION 'clan_name_required';
    END IF;
    -- Only allow clans verified in the latest battle scan (no invented rivals)
    IF NOT EXISTS (SELECT 1 FROM nanz_battle_rankings WHERE clan_name = trim(p_clan_name) AND status = 'verified') THEN
      RAISE EXCEPTION 'clan_not_verified';
    END IF;
    INSERT INTO nanz_rival_clans (clan_name, display_name, description, is_tracking, threat_level)
    VALUES (trim(p_clan_name), p_display_name, p_description, true, 'medium')
    ON CONFLICT (clan_name) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, is_tracking = true, updated_at = now();
    RETURN 'added';
  END IF;

  SELECT id INTO v_existing FROM nanz_rival_clans WHERE clan_name = trim(p_clan_name);
  IF v_existing IS NULL THEN RAISE EXCEPTION 'rival_not_found'; END IF;

  IF p_action = 'update' THEN
    UPDATE nanz_rival_clans SET display_name = p_display_name, description = p_description, updated_at = now() WHERE id = v_existing;
    RETURN 'updated';
  ELSIF p_action = 'toggle' THEN
    UPDATE nanz_rival_clans SET is_tracking = COALESCE(p_tracking, NOT is_tracking), updated_at = now() WHERE id = v_existing;
    RETURN 'toggled';
  ELSIF p_action = 'delete' THEN
    DELETE FROM nanz_rival_clans WHERE id = v_existing;
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_manage_goal(
  p_passkey text, p_action text, p_goal_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL, p_description text DEFAULT NULL, p_category text DEFAULT 'contribution',
  p_target_points bigint DEFAULT NULL, p_target_rank integer DEFAULT NULL,
  p_deadline timestamptz DEFAULT NULL, p_owner_label text DEFAULT NULL, p_reward text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new_id uuid;
BEGIN
  PERFORM staff_assert(p_passkey);

  IF p_action = 'create' THEN
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title_required'; END IF;
    IF p_target_points IS NULL AND p_target_rank IS NULL THEN RAISE EXCEPTION 'target_required'; END IF;
    IF p_category NOT IN ('contribution','rank','daily_activity','weekly') THEN RAISE EXCEPTION 'bad_category'; END IF;
    INSERT INTO nanz_clan_goals (title, description, goal_category, target_points, target_rank, deadline, owner_label, reward_description, start_date, status)
    VALUES (trim(p_title), p_description, p_category, p_target_points, p_target_rank, p_deadline, p_owner_label, p_reward, now(), 'active')
    RETURNING id INTO v_new_id;
    INSERT INTO nanz_clan_goal_history (goal_id, action, detail, actor_label) VALUES (v_new_id, 'created', 'Goal created by management', 'Management');
    RETURN 'created';
  END IF;

  IF p_goal_id IS NULL THEN RAISE EXCEPTION 'goal_id_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM nanz_clan_goals WHERE id = p_goal_id) THEN RAISE EXCEPTION 'goal_not_found'; END IF;

  IF p_action = 'edit' THEN
    UPDATE nanz_clan_goals SET
      title = COALESCE(p_title, title),
      description = COALESCE(p_description, description),
      target_points = COALESCE(p_target_points, target_points),
      target_rank = COALESCE(p_target_rank, target_rank),
      deadline = COALESCE(p_deadline, deadline),
      owner_label = COALESCE(p_owner_label, owner_label),
      reward_description = COALESCE(p_reward, reward_description),
      updated_at = now()
    WHERE id = p_goal_id;
    INSERT INTO nanz_clan_goal_history (goal_id, action, detail, actor_label) VALUES (p_goal_id, 'edited', 'Goal updated by management', 'Management');
    RETURN 'updated';
  ELSIF p_action = 'pause' THEN
    UPDATE nanz_clan_goals SET status = 'paused', updated_at = now() WHERE id = p_goal_id;
    INSERT INTO nanz_clan_goal_history (goal_id, action, detail, actor_label) VALUES (p_goal_id, 'paused', 'Goal paused', 'Management');
    RETURN 'paused';
  ELSIF p_action = 'resume' THEN
    UPDATE nanz_clan_goals SET status = 'active', updated_at = now() WHERE id = p_goal_id;
    INSERT INTO nanz_clan_goal_history (goal_id, action, detail, actor_label) VALUES (p_goal_id, 'resumed', 'Goal resumed', 'Management');
    RETURN 'resumed';
  ELSIF p_action = 'complete' THEN
    UPDATE nanz_clan_goals SET status = 'completed', updated_at = now() WHERE id = p_goal_id;
    INSERT INTO nanz_clan_goal_history (goal_id, action, detail, actor_label) VALUES (p_goal_id, 'completed', 'Goal marked completed', 'Management');
    RETURN 'completed';
  ELSIF p_action = 'archive' THEN
    UPDATE nanz_clan_goals SET status = 'archived', updated_at = now() WHERE id = p_goal_id;
    INSERT INTO nanz_clan_goal_history (goal_id, action, detail, actor_label) VALUES (p_goal_id, 'archived', 'Goal archived', 'Management');
    RETURN 'archived';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_manage_mission(
  p_passkey text, p_action text, p_mission_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL, p_description text DEFAULT NULL,
  p_requirement_type text DEFAULT 'manual', p_requirement_value bigint DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL,
  p_reward text DEFAULT NULL, p_user_id bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new_id uuid;
BEGIN
  PERFORM staff_assert(p_passkey);

  IF p_action = 'create' THEN
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title_required'; END IF;
    IF p_requirement_type NOT IN ('daily_points','streak','total_points','rank_improvement','manual') THEN RAISE EXCEPTION 'bad_requirement_type'; END IF;
    INSERT INTO nanz_missions (title, description, requirement_type, requirement_value, start_date, end_date, reward_text, status, created_by_label)
    VALUES (trim(p_title), p_description, p_requirement_type, p_requirement_value, COALESCE(p_start_date, now()), p_end_date, p_reward, 'active', 'Management')
    RETURNING id INTO v_new_id;
    RETURN 'created';
  END IF;

  IF p_mission_id IS NULL THEN RAISE EXCEPTION 'mission_id_required'; END IF;

  IF p_action = 'assign' THEN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_required'; END IF;
    INSERT INTO nanz_member_missions (mission_id, roblox_user_id, username)
    VALUES (p_mission_id, p_user_id, (SELECT username FROM nanz_battle_member_rankings WHERE user_id = p_user_id ORDER BY captured_at DESC LIMIT 1))
    ON CONFLICT (mission_id, roblox_user_id) DO NOTHING;
    RETURN 'assigned';
  ELSIF p_action = 'complete' THEN
    UPDATE nanz_missions SET status = 'completed', updated_at = now() WHERE id = p_mission_id;
    RETURN 'completed';
  ELSIF p_action = 'pause' THEN
    UPDATE nanz_missions SET status = 'paused', updated_at = now() WHERE id = p_mission_id;
    RETURN 'paused';
  ELSIF p_action = 'resume' THEN
    UPDATE nanz_missions SET status = 'active', updated_at = now() WHERE id = p_mission_id;
    RETURN 'resumed';
  ELSIF p_action = 'archive' THEN
    UPDATE nanz_missions SET status = 'archived', updated_at = now() WHERE id = p_mission_id;
    RETURN 'archived';
  ELSIF p_action = 'complete_manual' THEN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_required'; END IF;
    UPDATE nanz_member_missions SET progress = GREATEST(progress, COALESCE(p_requirement_value, 1)), completed_at = COALESCE(completed_at, now())
    WHERE mission_id = p_mission_id AND roblox_user_id = p_user_id;
    RETURN 'member_completed';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_manage_hof(
  p_passkey text, p_action text, p_user_id bigint DEFAULT NULL,
  p_username text DEFAULT NULL, p_title text DEFAULT NULL, p_detail text DEFAULT NULL,
  p_entry_type text DEFAULT 'special_recognition'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM staff_assert(p_passkey);
  IF p_action = 'add' THEN
    IF p_entry_type NOT IN ('special_recognition','all_time_legend','battle_legend','top_contributor','most_consistent') THEN RAISE EXCEPTION 'bad_entry_type'; END IF;
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title_required'; END IF;
    INSERT INTO nanz_hall_of_fame (entry_type, roblox_user_id, username, title, detail, coverage_label)
    VALUES (p_entry_type, p_user_id, p_username, trim(p_title), p_detail, 'Manual honorary recognition by management');
    RETURN 'added';
  ELSIF p_action = 'remove' THEN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_required'; END IF;
    DELETE FROM nanz_hall_of_fame WHERE roblox_user_id = p_user_id AND entry_type = p_entry_type AND coverage_label = 'Manual honorary recognition by management';
    RETURN 'removed';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_manage_alert_config(
  p_passkey text, p_threshold_points bigint DEFAULT NULL, p_surge_percent integer DEFAULT NULL, p_milestones integer[] DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM staff_assert(p_passkey);
  UPDATE nanz_rival_alert_config SET
    threshold_points = COALESCE(p_threshold_points, threshold_points),
    surge_percent = COALESCE(p_surge_percent, surge_percent),
    rank_milestones = COALESCE(p_milestones, rank_milestones),
    updated_at = now()
  WHERE id = true;
  RETURN 'updated';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_manual_award(
  p_passkey text, p_award_slug text, p_roblox_user_id bigint, p_notes text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_award_id uuid; v_member_id uuid;
BEGIN
  PERFORM staff_assert(p_passkey);
  SELECT id INTO v_award_id FROM nanz_award_definitions WHERE slug = p_award_slug AND is_active = true;
  IF v_award_id IS NULL THEN RAISE EXCEPTION 'award_not_found'; END IF;
  SELECT id INTO v_member_id FROM nanz_members WHERE roblox_user_id = p_roblox_user_id;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'member_not_found'; END IF;
  INSERT INTO nanz_award_winners (award_id, member_id, period_label, notes)
  VALUES (v_award_id, v_member_id, 'management', COALESCE(p_notes, 'Management-awarded recognition'));
  RETURN 'awarded';
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_verify(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_manage_rival(text, text, text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_manage_goal(text, text, uuid, text, text, text, bigint, integer, timestamptz, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_manage_mission(text, text, uuid, text, text, text, bigint, timestamptz, timestamptz, text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_manage_hof(text, text, bigint, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_manage_alert_config(text, bigint, integer, integer[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_manual_award(text, text, bigint, text) TO anon, authenticated;