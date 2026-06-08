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

On Render, do not rely on files written into the app folder at runtime. Render rebuilds the app from GitHub and its default filesystem is temporary, so uploaded files can disappear after a deploy or restart. This project uses GitHub uploads for persistent uploaded images.

The server commits uploaded images into a GitHub repo folder and stores the raw GitHub image URL in the database. Supabase Storage is not required.

```bash
UPLOAD_STORAGE_PROVIDER=github
GITHUB_UPLOAD_TOKEN=github fine-grained token with Contents read/write
GITHUB_UPLOAD_REPO=imkhaled404/SISHSALUMNI
GITHUB_UPLOAD_BRANCH=master
GITHUB_UPLOAD_DIR=public/assets/uploads
REQUIRE_PERSISTENT_UPLOADS=true
```

For this project, these are the production values to set in Render:

```bash
UPLOAD_STORAGE_PROVIDER=github
GITHUB_UPLOAD_REPO=imkhaled404/SISHSALUMNI
GITHUB_UPLOAD_BRANCH=master
GITHUB_UPLOAD_DIR=public/assets/uploads
REQUIRE_PERSISTENT_UPLOADS=true
```

Add `GITHUB_UPLOAD_TOKEN` separately as a secret value. Do not commit it.

If `GITHUB_UPLOAD_REPO` is missing locally, the server tries to read `owner/repo` from `git remote origin`. Render production should still set `GITHUB_UPLOAD_REPO` explicitly.

Admin asset uploads accept common image formats: `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`, `avif`, `bmp`, `ico`, `tif`, `tiff`, `heic`, and `heif`.

For public website images, the upload repo or returned URL must be publicly readable. If you use a CDN or another public base URL for that folder, set:

```bash
GITHUB_UPLOAD_PUBLIC_BASE_URL=https://your-public-base.example/assets/uploads
```

Optional local mirror:

```bash
MIRROR_UPLOADS_TO_LOCAL=true
```

Use this only if you also want a local copy written to `public/assets` while uploading to GitHub.
