-- QuietChat: remove chats with no messages after 3 days.
-- Run once in Supabase SQL Editor; safe to run more than once.
create or replace function public.quietchat_remove_empty_chats_after_3_days()
returns void language plpgsql security definer set search_path=public as $$
begin
  delete from public.chat_members m using public.chats c
  where m.chat_id=c.id and c.created_at <= now()-interval '3 days'
    and not exists(select 1 from public.messages msg where msg.chat_id=c.id);
  delete from public.chats c
  where c.created_at <= now()-interval '3 days'
    and not exists(select 1 from public.messages msg where msg.chat_id=c.id);
end; $$;
revoke all on function public.quietchat_remove_empty_chats_after_3_days() from public,anon,authenticated;
do $$ begin
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  if not exists(select 1 from cron.job where jobname='quietchat-empty-chat-3-day-cleanup') then
    perform cron.schedule('quietchat-empty-chat-3-day-cleanup','25 3 * * *','select public.quietchat_remove_empty_chats_after_3_days()');
  end if;
exception when others then
  raise notice 'pg_cron unavailable; schedule public.quietchat_remove_empty_chats_after_3_days() daily in Supabase Cron.';
end $$;
