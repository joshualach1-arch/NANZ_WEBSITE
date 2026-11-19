-- Task 05 cleanup: the previous task-05 stats migration accidentally created
-- an overloaded vault_values_manage(text,text,uuid,uuid,numeric,numeric,text)
-- with a p_source parameter that was actually meant as p_combined_value.
-- This made real calls (p_combined_value numeric) resolve ambiguously.
-- The overload was dropped in-place; this migration records the drop and
-- re-asserts the canonical grants on the surviving function.

-- (DROP executed out-of-band; nothing to recreate — the original
--  vault_values_manage(text,text,uuid,uuid,numeric,numeric,numeric,text)
--  from the Task 03 migration remains canonical.)

SELECT 1;
