-- UNIQUE ELITE CLUB DATABASE SETUP
-- Review before running this in your existing project.
-- This script creates tables and policies; it does not delete existing tables.

create extension if not exists pgcrypto;

do $$ begin
  create type public.club_member_status as enum ('pending', 'approved', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.club_member_role as enum ('member', 'treasurer', 'admin');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  membership_number text unique,
  status public.club_member_status not null default 'pending',
  role public.club_member_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.club_membership_number_seq start 1001;

create or replace function public.assign_membership_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and new.membership_number is null then
    new.membership_number := 'UEC-' || nextval('public.club_membership_number_seq')::text;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_assign_membership_number on public.profiles;
create trigger profiles_assign_membership_number
before insert or update of status on public.profiles
for each row execute function public.assign_membership_number();

create or replace function public.handle_new_club_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone, status, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    'pending',
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_club on auth.users;
create trigger on_auth_user_created_club
after insert on auth.users
for each row execute function public.handle_new_club_user();

create or replace function public.current_club_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role::text from public.profiles p
  where p.id = (select auth.uid()) and p.status = 'approved'
  limit 1;
$$;

create or replace function public.current_club_status()
returns text language sql stable security definer set search_path = '' as $$
  select p.status::text from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_approved_club_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved'
  );
$$;

create or replace function public.is_club_officer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
      and p.role in ('admin', 'treasurer')
  );
$$;

create or replace function public.is_club_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
      and p.role = 'admin'
  );
$$;

create table if not exists public.weekly_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  week_start date not null,
  amount_due numeric(12,2) not null default 0 check (amount_due >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  note text not null default '',
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, week_start)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  meeting_date date not null,
  status text not null check (status in ('Present','Absent','Excused')),
  penalty_amount numeric(12,2) not null default 0 check (penalty_amount >= 0),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(member_id, meeting_date)
);

create table if not exists public.financial_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  record_date date not null,
  record_type text not null check (record_type in ('Regular savings','Optional investment')),
  amount numeric(12,2) not null check (amount >= 0),
  note text not null default '',
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  is_published boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists weekly_payments_week_start_idx on public.weekly_payments(week_start desc);
create index if not exists attendance_meeting_date_idx on public.attendance_records(meeting_date desc);
create index if not exists financial_records_date_idx on public.financial_records(record_date desc);
create index if not exists announcements_published_idx on public.announcements(is_published, created_at desc);

alter table public.profiles enable row level security;
alter table public.weekly_payments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.financial_records enable row level security;
alter table public.announcements enable row level security;

-- Profiles: a member may read their own profile. Approved members can read approved member names
-- for shared club records. Members cannot self-approve or self-assign a role.
drop policy if exists "profiles read own or approved directory" on public.profiles;
create policy "profiles read own or approved directory" on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (public.is_approved_club_member() and status = 'approved')
  or public.is_club_admin()
);

drop policy if exists "officers update profiles" on public.profiles;
create policy "officers update profiles" on public.profiles
for update to authenticated
using (public.is_club_admin())
with check (public.is_club_admin());

-- Weekly payment list: approved members can read all weekly records; officers can write.
drop policy if exists "approved members read weekly payments" on public.weekly_payments;
create policy "approved members read weekly payments" on public.weekly_payments
for select to authenticated using (public.is_approved_club_member());

drop policy if exists "officers insert weekly payments" on public.weekly_payments;
create policy "officers insert weekly payments" on public.weekly_payments
for insert to authenticated with check (public.is_club_officer());

drop policy if exists "officers update weekly payments" on public.weekly_payments;
create policy "officers update weekly payments" on public.weekly_payments
for update to authenticated using (public.is_club_officer()) with check (public.is_club_officer());

drop policy if exists "officers delete weekly payments" on public.weekly_payments;
create policy "officers delete weekly payments" on public.weekly_payments
for delete to authenticated using (public.is_club_officer());

-- Attendance: approved members can see club attendance; only officers can manage it.
drop policy if exists "approved members read attendance" on public.attendance_records;
create policy "approved members read attendance" on public.attendance_records
for select to authenticated using (public.is_approved_club_member());
drop policy if exists "officers manage attendance" on public.attendance_records;
create policy "officers manage attendance" on public.attendance_records
for all to authenticated using (public.is_club_officer()) with check (public.is_club_officer());

-- Savings/investment entries: approved members can read the club ledger as selected by club policy.
-- If these amounts should be private per member, change this policy before launch.
drop policy if exists "approved members read financial records" on public.financial_records;
create policy "approved members read financial records" on public.financial_records
for select to authenticated using (public.is_approved_club_member());
drop policy if exists "officers manage financial records" on public.financial_records;
create policy "officers manage financial records" on public.financial_records
for all to authenticated using (public.is_club_officer()) with check (public.is_club_officer());

-- Published announcements are public. Only officers may insert/update/delete.
drop policy if exists "anyone reads published announcements" on public.announcements;
create policy "anyone reads published announcements" on public.announcements
for select to anon, authenticated using (is_published = true and (auth.uid() is null or public.is_approved_club_member()));
drop policy if exists "officers insert announcements" on public.announcements;
create policy "officers insert announcements" on public.announcements
for insert to authenticated with check (public.is_club_officer());
drop policy if exists "officers update announcements" on public.announcements;
create policy "officers update announcements" on public.announcements
for update to authenticated using (public.is_club_officer()) with check (public.is_club_officer());
drop policy if exists "officers delete announcements" on public.announcements;
create policy "officers delete announcements" on public.announcements
for delete to authenticated using (public.is_club_officer());

-- Approval RPC: only an approved admin may approve a pending account.
create or replace function public.approve_club_member(target_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_club_admin() then
    raise exception 'Only an approved club administrator can approve members';
  end if;
  update public.profiles set status = 'approved'
  where id = target_user_id and status = 'pending';
  if not found then
    raise exception 'Pending member not found';
  end if;
end;
$$;
revoke all on function public.approve_club_member(uuid) from public;
grant execute on function public.approve_club_member(uuid) to authenticated;

-- Storage: announcements use a PUBLIC bucket in this starter. Do NOT upload private payment receipts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-photos', 'club-photos', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "officers upload club photos" on storage.objects;
create policy "officers upload club photos" on storage.objects
for insert to authenticated with check (bucket_id = 'club-photos' and public.is_club_officer());
drop policy if exists "officers update club photos" on storage.objects;
create policy "officers update club photos" on storage.objects
for update to authenticated using (bucket_id = 'club-photos' and public.is_club_officer())
with check (bucket_id = 'club-photos' and public.is_club_officer());
drop policy if exists "officers delete club photos" on storage.objects;
create policy "officers delete club photos" on storage.objects
for delete to authenticated using (bucket_id = 'club-photos' and public.is_club_officer());
drop policy if exists "public read club photos" on storage.objects;
create policy "public read club photos" on storage.objects
for select to anon, authenticated using (bucket_id = 'club-photos');

-- ONE-TIME ADMIN BOOTSTRAP — RUN ONLY AFTER YOU REGISTER AND CONFIRM THE ADMIN EMAIL.
-- Replace the email below with the exact email address of your intended admin account.
-- Run this manually in SQL Editor while signed into the correct Supabase project.
-- update public.profiles p
-- set role = 'admin', status = 'approved'
-- from auth.users u
-- where p.id = u.id and lower(u.email) = lower('REPLACE-WITH-ADMIN-EMAIL');

-- OPTIONAL: assign a treasurer only after confirming that account's email:
-- update public.profiles p
-- set role = 'treasurer', status = 'approved'
-- from auth.users u
-- where p.id = u.id and lower(u.email) = lower('REPLACE-WITH-TREASURER-EMAIL');
