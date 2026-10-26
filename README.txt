UNIQUE ELITE CLUB — SETUP NOTES
================================

IMPORTANT
- This folder is the website frontend. It is not secure or functional with real member data until the database SQL has been installed and access policies tested.
- Never put your Supabase service_role or secret key in config.js.
- Use only your Project URL and the publishable key (or legacy anon public key).
- The SQL setup is in supabase-setup.sql.
- Do not add actual payments or member information to HTML source code.

FILES
-----
index.html            Homepage, registration/login forms, member dashboard and officer forms
style.css             Responsive visual design
app.js                Frontend behavior and Supabase requests
config.js             Public Supabase URL and public browser key placeholders
supabase-setup.sql    Database tables, row-level security policies, photo bucket and approval function

SETUP OVERVIEW
--------------
1. In Supabase, open your existing project.
2. In Project Settings / API, copy the Project URL and publishable key (or anon public key).
3. Replace the two placeholders in config.js. Do NOT use a secret/service_role key.
4. Open SQL Editor in Supabase and run supabase-setup.sql. Read it first and ensure it is the intended existing project.
5. Register using the club admin email in the website. If email confirmation is enabled, confirm it first.
6. In Supabase SQL Editor, run the one-time admin bootstrap statement from the bottom of supabase-setup.sql after replacing the email with the exact account email. This is a privileged operation. Never make the user-supplied role editable from the public registration form.
7. Sign out and sign back in. Add a treasurer only by using a trusted SQL Editor session after confirming the person's account ID/email.
8. Test with a separate ordinary member account: ordinary members should read the approved weekly payment list but should not be able to insert/update/delete records.
9. Deploy the entire folder to Netlify using manual deploy / drag-and-drop of the extracted folder's contents, not the ZIP file if Netlify expects a folder.

FEATURES INCLUDED IN THIS STARTER
---------------------------------
- Responsive public homepage, club rules, contact details and announcements
- Email/password sign-up and sign-in via Supabase Auth
- Pending member approval state
- Member dashboard
- Weekly payments list shared with approved members
- Officer forms for weekly payment records, attendance, penalties, savings and optional investments
- Officer announcements with optional image uploads
- Separate savings and optional-investment record types

LIMITATIONS / NEXT IMPROVEMENTS
-------------------------------
- Membership number generation is handled by the database trigger in SQL.
- Photo URLs are public in this starter to allow public announcements to display. Do not upload private receipts or financial evidence to this bucket. Use a separate private bucket with signed URLs and tighter policies if private receipt uploads are later needed.
- Payment editing uses one record per member per week; changing a record is allowed to officers through database policy.
- The starter has not been independently security-audited. Test RLS with a normal member and an officer before using real financial records.
- Do not treat this site as a regulated investment or banking platform.
