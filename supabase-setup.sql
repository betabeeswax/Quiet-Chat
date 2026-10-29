-- QuietChat database setup. Run the entire file in Supabase Dashboard > SQL Editor.
-- First enable Anonymous Sign-Ins: Authentication > Sign In / Providers > Anonymous.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 24),
  created_at timestamptz not null default now()
);
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id,user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create table if not exists public.chat_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  chat_id uuid not null references public.chats(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

create index if not exists chat_members_user_idx on public.chat_members(user_id);
create index if not exists messages_chat_created_idx on public.messages(chat_id,created_at);
create index if not exists chat_invites_chat_idx on public.chat_invites(chat_id);

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.chat_invites enable row level security;

-- SECURITY DEFINER helper avoids recursive RLS checks when policies inspect membership.
create or replace function public.is_chat_member(target_chat uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.chat_members m where m.chat_id=target_chat and m.user_id=target_user);
$$;
revoke all on function public.is_chat_member(uuid,uuid) from public;
grant execute on function public.is_chat_member(uuid,uuid) to authenticated;

drop policy if exists "profiles readable by people in shared chats" on public.profiles;
create policy "profiles readable by people in shared chats" on public.profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.chat_members mine
  where mine.user_id=auth.uid() and public.is_chat_member(mine.chat_id, profiles.id)
));
drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile" on public.profiles for insert to authenticated with check (id=auth.uid());
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists "members can read their chats" on public.chats;
create policy "members can read their chats" on public.chats for select to authenticated
using (public.is_chat_member(chats.id, auth.uid()));

drop policy if exists "members can see membership in their chats" on public.chat_members;
create policy "members can see membership in their chats" on public.chat_members for select to authenticated
using (public.is_chat_member(chat_members.chat_id, auth.uid()));
-- Membership creation is only via the locked SECURITY DEFINER RPC functions below.

drop policy if exists "members can read chat messages" on public.messages;
create policy "members can read chat messages" on public.messages for select to authenticated
using (public.is_chat_member(messages.chat_id, auth.uid()));
drop policy if exists "members can send as themselves" on public.messages;
create policy "members can send as themselves" on public.messages for insert to authenticated
with check (sender_id=auth.uid() and char_length(body) between 1 and 4000 and public.is_chat_member(messages.chat_id, auth.uid()));
drop policy if exists "creator can read own invite metadata" on public.chat_invites;
create policy "creator can read own invite metadata" on public.chat_invites for select to authenticated
using (created_by=auth.uid());

-- Creates a new chat and one-time invite; only the code hash is stored.
create or replace function public.create_chat_invite()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare new_chat uuid; raw_code text; normalized text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  raw_code := upper(encode(gen_random_bytes(5),'hex'));
  normalized := raw_code;
  insert into public.chats default values returning id into new_chat;
  insert into public.chat_members(chat_id,user_id) values(new_chat,auth.uid());
  insert into public.chat_invites(code_hash,chat_id,created_by)
    values(encode(digest(normalized,'sha256'),'hex'),new_chat,auth.uid());
  return normalized;
end;
$$;

-- A code is single-use, expires after 24 hours, and cannot be used by its creator.
create or replace function public.join_chat_with_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare inv public.chat_invites%rowtype; normalized text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  normalized := upper(regexp_replace(coalesce(invite_code,''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(normalized) <> 10 then raise exception 'Invalid invite'; end if;
  select * into inv from public.chat_invites
    where code_hash=encode(digest(normalized,'sha256'),'hex')
    for update;
  if not found or inv.used_at is not null or inv.expires_at < now() or inv.created_by=auth.uid()
    then raise exception 'Invalid or expired invite'; end if;
  if exists(select 1 from public.chat_members where chat_id=inv.chat_id and user_id=auth.uid())
    then raise exception 'Already joined'; end if;
  insert into public.chat_members(chat_id,user_id) values(inv.chat_id,auth.uid());
  update public.chat_invites set used_at=now(),used_by=auth.uid() where id=inv.id;
  return inv.chat_id;
end;
$$;

revoke all on function public.create_chat_invite() from public;
revoke all on function public.join_chat_with_invite(text) from public;
grant execute on function public.create_chat_invite() to authenticated;
grant execute on function public.join_chat_with_invite(text) to authenticated;

grant usage on schema public to authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select on public.chats to authenticated;
grant select on public.chat_members to authenticated;
grant select,insert on public.messages to authenticated;
grant select on public.chat_invites to authenticated;

-- Enable Realtime for messages. Safe to run if already enabled.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then raise notice 'Publication supabase_realtime was not found; enable Realtime for messages in the dashboard.';
end $$;

-- Group chats and photo/video messages (added in the latest QuietChat update).
-- Safe to run on an existing installation.
alter table public.chats add column if not exists name text;
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages drop constraint if exists messages_attachment_type_check;
alter table public.messages add constraint messages_attachment_type_check check (attachment_type in ('image','video','audio') or attachment_type is null);

-- Let Supabase understand messages -> profiles(username) joins used by the UI.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='messages_sender_id_profiles_fkey' and conrelid='public.messages'::regclass) then
    alter table public.messages add constraint messages_sender_id_profiles_fkey foreign key (sender_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- Let Supabase understand chat_members -> profiles(username) joins used by the UI.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='chat_members_user_id_profiles_fkey' and conrelid='public.chat_members'::regclass) then
    alter table public.chat_members add constraint chat_members_user_id_profiles_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create or replace function public.create_group_chat(group_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_chat uuid; cleaned_name text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  cleaned_name := left(trim(regexp_replace(coalesce(group_name,''), '\s+', ' ', 'g')), 60);
  if char_length(cleaned_name) < 2 then raise exception 'Group name must be at least 2 characters'; end if;
  insert into public.chats(name) values(cleaned_name) returning id into new_chat;
  insert into public.chat_members(chat_id,user_id) values(new_chat,auth.uid());
  return new_chat;
end; $$;

create or replace function public.create_chat_invite_for(target_chat uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare raw_code text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_chat_member(target_chat, auth.uid()) then raise exception 'You are not a member of this chat'; end if;
  raw_code := upper(encode(gen_random_bytes(5),'hex'));
  insert into public.chat_invites(code_hash,chat_id,created_by) values(encode(digest(raw_code,'sha256'),'hex'),target_chat,auth.uid());
  return raw_code;
end; $$;
revoke all on function public.create_group_chat(text) from public;
revoke all on function public.create_chat_invite_for(uuid) from public;
grant execute on function public.create_group_chat(text) to authenticated;
grant execute on function public.create_chat_invite_for(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-media','chat-media',false,52428800,null)
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=null;

drop policy if exists "Chat members can upload media" on storage.objects;
create policy "Chat members can upload media" on storage.objects for insert to authenticated with check (bucket_id='chat-media' and public.is_chat_member(((storage.foldername(name))[1])::uuid,auth.uid()));
drop policy if exists "Chat members can read media" on storage.objects;
create policy "Chat members can read media" on storage.objects for select to authenticated using (bucket_id='chat-media' and public.is_chat_member(((storage.foldername(name))[1])::uuid,auth.uid()));
drop policy if exists "Chat members can delete own media" on storage.objects;
create policy "Chat members can delete own media" on storage.objects for delete to authenticated using (bucket_id='chat-media' and owner_id=auth.uid()::text and public.is_chat_member(((storage.foldername(name))[1])::uuid,auth.uid()));

NOTIFY pgrst, 'reload schema';


-- QuietChat profile pictures, bios, arbitrary files, games and yearly retention.
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists avatar_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages drop constraint if exists messages_attachment_type_check;
alter table public.messages add constraint messages_attachment_type_check
  check (attachment_type in ('image','video','audio','file') or attachment_type is null);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-pics','profile-pics',false,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];
drop policy if exists "Users upload own profile pictures" on storage.objects;
create policy "Users upload own profile pictures" on storage.objects for insert to authenticated
with check (bucket_id='profile-pics' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users update own profile pictures" on storage.objects;
create policy "Users update own profile pictures" on storage.objects for update to authenticated
using (bucket_id='profile-pics' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='profile-pics' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Shared chat members can read profile pictures" on storage.objects;
create policy "Shared chat members can read profile pictures" on storage.objects for select to authenticated
using (bucket_id='profile-pics' and ((storage.foldername(name))[1]=auth.uid()::text or exists (
  select 1 from public.chat_members mine join public.chat_members theirs on theirs.chat_id=mine.chat_id
  where mine.user_id=auth.uid() and theirs.user_id::text=(storage.foldername(name))[1]
)));
drop policy if exists "Users delete own profile pictures" on storage.objects;
create policy "Users delete own profile pictures" on storage.objects for delete to authenticated
using (bucket_id='profile-pics' and (storage.foldername(name))[1]=auth.uid()::text);

create table if not exists public.chat_games (
  id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.chats(id) on delete cascade,
  game_type text not null default 'rps' check (game_type in ('rps')),
  state jsonb not null default '{"round":1,"moves":{},"scores":{},"last":null}'::jsonb,
  updated_at timestamptz not null default now(), unique(chat_id,game_type)
);
alter table public.chat_games enable row level security;
drop policy if exists "Chat members can read game state" on public.chat_games;
create policy "Chat members can read game state" on public.chat_games for select to authenticated using (public.is_chat_member(chat_id,auth.uid()));
drop policy if exists "Chat members can create game state" on public.chat_games;
create policy "Chat members can create game state" on public.chat_games for insert to authenticated with check (public.is_chat_member(chat_id,auth.uid()));
drop policy if exists "Chat members can update game state" on public.chat_games;
create policy "Chat members can update game state" on public.chat_games for update to authenticated using (public.is_chat_member(chat_id,auth.uid())) with check (public.is_chat_member(chat_id,auth.uid()));
grant select on public.chat_games to authenticated;
do $$ begin alter publication supabase_realtime add table public.chat_games; exception when duplicate_object then null; when undefined_object then raise notice 'Enable Realtime for chat_games in the dashboard.'; end $$;

create or replace function public.play_rps(target_chat uuid, chosen_move text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare game public.chat_games%rowtype; moves jsonb; scores jsonb; member_count int; ids text[]; p1 text; p2 text; m1 text; m2 text; result text; last_round jsonb;
begin
 if auth.uid() is null or not public.is_chat_member(target_chat,auth.uid()) then raise exception 'You are not a member of this chat'; end if;
 if chosen_move not in ('rock','paper','scissors') then raise exception 'Invalid move'; end if;
 insert into public.chat_games(chat_id,game_type,state) values(target_chat,'rps','{"round":1,"moves":{},"scores":{},"last":null}'::jsonb) on conflict(chat_id,game_type) do nothing;
 select * into game from public.chat_games where chat_id=target_chat and game_type='rps' for update;
 moves := coalesce(game.state->'moves','{}'::jsonb) || jsonb_build_object(auth.uid()::text,chosen_move); scores := coalesce(game.state->'scores','{}'::jsonb);
 select count(*) into member_count from public.chat_members where chat_id=target_chat; last_round := null;
 if member_count >= 2 and (select count(*) from jsonb_object_keys(moves)) >= 2 then
   select array_agg(key order by key) into ids from jsonb_object_keys(moves) as t(key); p1:=ids[1]; p2:=ids[2]; m1:=moves->>p1; m2:=moves->>p2;
   if m1=m2 then result:='tie'; elsif (m1='rock' and m2='scissors') or (m1='paper' and m2='rock') or (m1='scissors' and m2='paper') then result:=p1; else result:=p2; end if;
   if result<>'tie' then scores:=jsonb_set(scores,array[result],to_jsonb(coalesce((scores->>result)::int,0)+1),true); end if;
   last_round:=jsonb_build_object('p1',p1,'m1',m1,'p2',p2,'m2',m2,'winner',result,'at',now()); moves:='{}'::jsonb;
 end if;
 update public.chat_games set state=jsonb_build_object('round',coalesce((game.state->>'round')::int,1)+case when last_round is not null then 1 else 0 end,'moves',moves,'scores',scores,'last',coalesce(last_round,game.state->'last')),updated_at=now() where id=game.id;
 return (select state from public.chat_games where id=game.id);
end; $$;
revoke all on function public.play_rps(uuid,text) from public,anon;
grant execute on function public.play_rps(uuid,text) to authenticated;

create or replace function public.quietchat_annual_cleanup()
returns void language plpgsql security definer set search_path=public as $$
begin
 delete from public.messages where created_at < now() - interval '1 year';
 delete from public.chats where created_at < now() - interval '1 year';
 delete from public.chat_invites where expires_at < now() or used_at is not null;
end; $$;
revoke all on function public.quietchat_annual_cleanup() from public,anon,authenticated;
do $$ begin
 execute 'create extension if not exists pg_cron with schema pg_catalog';
 if not exists(select 1 from cron.job where jobname='quietchat-annual-cleanup') then perform cron.schedule('quietchat-annual-cleanup','0 3 1 1 *','select public.quietchat_annual_cleanup()'); end if;
exception when others then raise notice 'Schedule public.quietchat_annual_cleanup() for 03:00 on January 1 in Supabase Cron if pg_cron is unavailable.';
end $$;

notify pgrst, 'reload schema';


-- Username + password accounts do not require a real email. The Edge Function
-- creates a confirmed Supabase Auth user with an internal .invalid address.
-- This private registry prevents duplicate usernames for username-login accounts.
create table if not exists public.username_accounts (
  username_key text primary key check (username_key ~ '^[a-z0-9_-]{2,24}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.username_accounts enable row level security;
revoke all on public.username_accounts from public, anon, authenticated;

-- Public group discovery and joining; all existing chats remain private by default.
alter table public.chats add column if not exists is_public boolean not null default false;
alter table public.chats add column if not exists description text not null default '';
create index if not exists chats_public_created_idx on public.chats(is_public,created_at desc) where is_public=true;
create or replace function public.create_group_chat(group_name text, is_public boolean default false, group_description text default '') returns uuid language plpgsql security definer set search_path=public as $$ declare new_chat uuid; cleaned_name text; cleaned_description text; begin if auth.uid() is null then raise exception 'Sign in required'; end if; cleaned_name:=left(trim(regexp_replace(coalesce(group_name,''), '\\s+', ' ', 'g')),60); cleaned_description:=left(trim(coalesce(group_description,'')),240); if char_length(cleaned_name)<2 then raise exception 'Group name must have at least 2 characters'; end if; insert into public.chats(name,is_public,description) values(cleaned_name,is_public,cleaned_description) returning id into new_chat; insert into public.chat_members(chat_id,user_id) values(new_chat,auth.uid()); return new_chat; end; $$;
revoke all on function public.create_group_chat(text) from public; revoke all on function public.create_group_chat(text,boolean,text) from public; grant execute on function public.create_group_chat(text,boolean,text) to authenticated;
create or replace function public.discover_public_groups() returns table(id uuid,name text,description text,created_at timestamptz,member_count bigint,is_member boolean) language sql stable security definer set search_path=public as $$ select c.id,c.name,coalesce(c.description,''),c.created_at,(select count(*) from public.chat_members m where m.chat_id=c.id),public.is_chat_member(c.id,auth.uid()) from public.chats c where c.is_public=true and c.name is not null order by c.created_at desc limit 200; $$;
revoke all on function public.discover_public_groups() from public; grant execute on function public.discover_public_groups() to authenticated;
create or replace function public.join_public_group(target_chat uuid) returns uuid language plpgsql security definer set search_path=public as $$ begin if auth.uid() is null then raise exception 'Sign in required'; end if; if not exists(select 1 from public.chats c where c.id=target_chat and c.is_public=true and c.name is not null) then raise exception 'This group is not public or no longer exists'; end if; insert into public.chat_members(chat_id,user_id) values(target_chat,auth.uid()) on conflict do nothing; return target_chat; end; $$;
revoke all on function public.join_public_group(uuid) from public; grant execute on function public.join_public_group(uuid) to authenticated;


-- Community settings and creator-only management.
-- Remove the old one-argument overload so PostgREST cannot choose the wrong RPC.
drop function if exists public.create_group_chat(text);
alter table public.chats add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.chats add column if not exists allow_gifs boolean not null default true;
alter table public.chats add column if not exists remove_inactive boolean not null default true;

create or replace function public.create_group_chat(group_name text, is_public boolean default false, group_description text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare new_chat uuid; cleaned_name text; cleaned_description text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 cleaned_name:=left(trim(regexp_replace(coalesce(group_name,''), '\s+', ' ', 'g')),60);
 cleaned_description:=left(trim(coalesce(group_description,'')),240);
 if char_length(cleaned_name)<2 then raise exception 'Group name must have at least 2 characters'; end if;
 insert into public.chats(name,is_public,description,created_by,allow_gifs,remove_inactive)
 values(cleaned_name,is_public,cleaned_description,auth.uid(),true,true) returning id into new_chat;
 insert into public.chat_members(chat_id,user_id) values(new_chat,auth.uid());
 return new_chat;
end; $$;
revoke all on function public.create_group_chat(text,boolean,text) from public;
grant execute on function public.create_group_chat(text,boolean,text) to authenticated;

create or replace function public.update_group_settings(
  target_chat uuid, make_public boolean, p_allow_gifs boolean, p_remove_inactive boolean,
  p_name text default null, p_logo_path text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(
    select 1 from public.chats
    where id=target_chat and name is not null
      and (created_by=auth.uid() or auth.uid() in (
        '6690d263-46ff-4cb3-a257-c4235fcb9ae1'::uuid,
        '33101fc2-e3f1-4b32-adb6-85c17a099aac'::uuid
      ))
  ) then raise exception 'Only the community owner or a QuietChat admin can change settings'; end if;
  update public.chats set
    is_public=make_public, allow_gifs=p_allow_gifs, remove_inactive=p_remove_inactive,
    name=coalesce(nullif(trim(p_name),''),name),
    logo_path=coalesce(p_logo_path,logo_path)
  where id=target_chat;
end; $$;
revoke all on function public.update_group_settings(uuid,boolean,boolean,boolean,text,text) from public;
grant execute on function public.update_group_settings(uuid,boolean,boolean,boolean,text,text) to authenticated;

create or replace function public.delete_group_chat(target_chat uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(
    select 1 from public.chats
    where id=target_chat and name is not null
      and (created_by=auth.uid() or auth.uid() in (
        '6690d263-46ff-4cb3-a257-c4235fcb9ae1'::uuid,
        '33101fc2-e3f1-4b32-adb6-85c17a099aac'::uuid
      ))
  ) then raise exception 'Only the community creator or a QuietChat admin can delete this group'; end if;
  delete from public.chats where id=target_chat;
end; $$;
revoke all on function public.delete_group_chat(uuid) from public;
grant execute on function public.delete_group_chat(uuid) to authenticated;


-- QuietChat: allow a signed-in member to leave/remove a chat from their own list.
create or replace function public.quietchat_remove_chat(target_chat uuid)
returns void language plpgsql security definer set search_path=public as $$
declare remaining_members int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.chat_members where chat_id=target_chat and user_id=auth.uid()) then
    raise exception 'You are not a member of this chat';
  end if;
  delete from public.chat_members where chat_id=target_chat and user_id=auth.uid();
  select count(*) into remaining_members from public.chat_members where chat_id=target_chat;
  if remaining_members=0 then delete from public.chats where id=target_chat; end if;
end; $$;
revoke all on function public.quietchat_remove_chat(uuid) from public, anon;
grant execute on function public.quietchat_remove_chat(uuid) to authenticated;

-- Enforce a 5 MB maximum for chat uploads at the Supabase Storage level too.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-media','chat-media',false,5242880,null)
on conflict (id) do update set file_size_limit=5242880;

-- Expired/used invite records are cleaned daily (codes already expire after 24 hours).
create or replace function public.quietchat_daily_invite_cleanup()
returns void language sql security definer set search_path=public as $$
  delete from public.chat_invites where expires_at <= now() or used_at is not null;
$$;
revoke all on function public.quietchat_daily_invite_cleanup() from public, anon, authenticated;
do $$ begin
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  if not exists(select 1 from cron.job where jobname='quietchat-daily-invite-cleanup') then
    perform cron.schedule('quietchat-daily-invite-cleanup','17 3 * * *','select public.quietchat_daily_invite_cleanup()');
  end if;
exception when others then
  raise notice 'pg_cron is unavailable. Schedule public.quietchat_daily_invite_cleanup() daily in Supabase Cron.';
end $$;

notify pgrst, 'reload schema';


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
