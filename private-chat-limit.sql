-- QuietChat migration: private one-to-one chats can never exceed two members.
-- Run this once in Supabase SQL Editor after deploying the matching app update.

create or replace function public.create_chat_invite_for(target_chat uuid)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare raw_code text; chat_name text; member_total integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select name into chat_name from public.chats where id=target_chat for update;
  if not found then raise exception 'Chat not found'; end if;
  if not public.is_chat_member(target_chat,auth.uid()) then raise exception 'You are not a member of this chat'; end if;
  if chat_name is null then
    select count(*) into member_total from public.chat_members where chat_id=target_chat;
    if member_total >= 2 then raise exception 'Private chats are one-on-one. This chat already has two people.'; end if;
  end if;
  raw_code := upper(encode(gen_random_bytes(5),'hex'));
  insert into public.chat_invites(code_hash,chat_id,created_by) values(encode(digest(raw_code,'sha256'),'hex'),target_chat,auth.uid());
  return raw_code;
end; $$;
revoke all on function public.create_chat_invite_for(uuid) from public,anon;
grant execute on function public.create_chat_invite_for(uuid) to authenticated;

create or replace function public.join_chat_with_invite(invite_code text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare inv public.chat_invites%rowtype; normalized text; chat_name text; member_total integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  normalized := upper(regexp_replace(coalesce(invite_code,''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(normalized) <> 10 then raise exception 'Invalid invite'; end if;
  select * into inv from public.chat_invites
    where code_hash=encode(digest(normalized,'sha256'),'hex') for update;
  if not found or inv.used_at is not null or inv.expires_at < now() or inv.created_by=auth.uid()
    then raise exception 'Invalid or expired invite'; end if;
  -- Lock the chat row so two different outstanding codes cannot add a third member concurrently.
  select name into chat_name from public.chats where id=inv.chat_id for update;
  if not found then raise exception 'This chat no longer exists'; end if;
  if exists(select 1 from public.chat_members where chat_id=inv.chat_id and user_id=auth.uid())
    then raise exception 'Already joined'; end if;
  if chat_name is null then
    select count(*) into member_total from public.chat_members where chat_id=inv.chat_id;
    if member_total >= 2 then raise exception 'This private chat already has two people. Ask them for a different invite.'; end if;
  end if;
  insert into public.chat_members(chat_id,user_id) values(inv.chat_id,auth.uid());
  update public.chat_invites set used_at=now(),used_by=auth.uid() where id=inv.id;
  return inv.chat_id;
end; $$;
revoke all on function public.join_chat_with_invite(text) from public,anon;
grant execute on function public.join_chat_with_invite(text) to authenticated;
