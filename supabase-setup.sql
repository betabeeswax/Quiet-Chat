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
values('chat-media','chat-media',false,52428800,array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a','audio/aac'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a','audio/aac'];

drop policy if exists "Chat members can upload media" on storage.objects;
create policy "Chat members can upload media" on storage.objects for insert to authenticated with check (bucket_id='chat-media' and public.is_chat_member(((storage.foldername(name))[1])::uuid,auth.uid()));
drop policy if exists "Chat members can read media" on storage.objects;
create policy "Chat members can read media" on storage.objects for select to authenticated using (bucket_id='chat-media' and public.is_chat_member(((storage.foldername(name))[1])::uuid,auth.uid()));
drop policy if exists "Chat members can delete own media" on storage.objects;
create policy "Chat members can delete own media" on storage.objects for delete to authenticated using (bucket_id='chat-media' and owner_id=auth.uid()::text and public.is_chat_member(((storage.foldername(name))[1])::uuid,auth.uid()));

NOTIFY pgrst, 'reload schema';
