# Prakton Sikkharthi Forum Site

Dynamic website for Prakton Sikkharthi Forum, Shantirhat Islamia Secondary School.

## Run

```bash
npm start
```

Open `http://localhost:3000` for the website and `http://localhost:3000/admin` for the admin panel.

The app uses SQLite at `data/site.db`. On first run it creates the database and seeds it from `data/site.json`.

Default admin credentials:



Set `ADMIN_USER`, `ADMIN_PASSWORD`, or `PORT` in the environment to change those values.

## Image uploads

Local development uploads are written to `public/assets` when no external storage bucket is configured. Those files are normal working-tree files: GitHub will only receive them if you commit and push them.

On Render, do not rely on files written into the app folder at runtime. Render rebuilds the app from GitHub and its default filesystem is temporary, so uploaded files can disappear after a deploy or restart. Use Supabase Storage or GitHub uploads for persistent uploaded images.

### Option 1: Supabase Storage

```bash
SUPABASE_URL=your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=your server-only service role key
SUPABASE_STORAGE_BUCKET=site-assets
REQUIRE_PERSISTENT_UPLOADS=true
```

Create a public Supabase Storage bucket named `site-assets` (or use your own bucket name and set `SUPABASE_STORAGE_BUCKET` to match). Uploaded image fields will then save the public Supabase Storage URL in the database, so the image works locally, on Render, and after redeploys.

Use the Supabase **service role** key only on the server, for example in Render environment variables or local `.env`. Do not put it in frontend JavaScript, GitHub, or any `NEXT_PUBLIC_*` variable. The anon/publishable key follows Storage row-level security policies and will usually fail with `new row violates row-level security policy` during server uploads.

### Option 2: GitHub uploads

Use this when you do not want a Supabase bucket. The server commits uploaded images into a GitHub repo folder and stores the raw GitHub image URL in the database. When GitHub upload variables are configured, GitHub uploads are used before Supabase Storage.

```bash
GITHUB_UPLOAD_TOKEN=github fine-grained token with Contents read/write
GITHUB_UPLOAD_REPO=imkhaled404/SISHSALUMNI
GITHUB_UPLOAD_BRANCH=master
GITHUB_UPLOAD_DIR=public/assets/uploads
REQUIRE_PERSISTENT_UPLOADS=true
```

For this project, these are the production values to set in Render:

```bash
GITHUB_UPLOAD_REPO=imkhaled404/SISHSALUMNI
GITHUB_UPLOAD_BRANCH=master
GITHUB_UPLOAD_DIR=public/assets/uploads
REQUIRE_PERSISTENT_UPLOADS=true
```

Add `GITHUB_UPLOAD_TOKEN` separately as a secret value. Do not commit it.

For public website images, the upload repo or returned URL must be publicly readable. If you use a CDN or another public base URL for that folder, set:

```bash
GITHUB_UPLOAD_PUBLIC_BASE_URL=https://your-public-base.example/assets/uploads
```

Optional local mirror:

```bash
MIRROR_UPLOADS_TO_LOCAL=true
```

Use this only if you also want a local copy written to `public/assets` while uploading to Supabase or GitHub.
