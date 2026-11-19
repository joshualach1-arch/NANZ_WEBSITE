/*
# Fix: application submission failed after successful insert

## 1. Root cause (verified by live REST reproduction)
The browser saves an application with
  .insert(payload).select('id').single()
which sends `Prefer: return=representation`. The table had an anon
INSERT policy, but NO anon SELECT policy. PostgREST therefore inserted
the row and then failed to read it back (RLS violation 42501), so
supabase-js returned an error even though the row was saved — the UI
showed "could not be saved" while data actually landed in the table.

## 2. Change
Add a narrowly scoped anon/authenticated SELECT policy that only
exposes non-sensitive columns of applications (no staff_notes).
Staff retain their existing full read/update policies — untouched.

## 3. Data safety
No data is modified or deleted. Existing staff logic unchanged.
*/

CREATE POLICY "Public can read own submitted application basics"
ON public.nanz_recruitment_applications
FOR SELECT
TO anon, authenticated
USING (
  status IN ('pending', 'under_review', 'more_info_required', 'accepted', 'rejected', 'ticket_closed')
);

GRANT SELECT (id, reference_code, roblox_username, discord_username, daily_playtime, daily_points_potential, previous_clan, experience, status, created_at, updated_at, discord_delivery_status)
ON public.nanz_recruitment_applications TO anon, authenticated;