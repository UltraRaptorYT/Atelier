# Workspace migration — 2026-09-13

The active checkout is now `C:/Users/sohho/Documents/GitHub/Atelier`.

Merged the previous task's implementation updates using the new repository's initial commit as the common ancestor. Preserved the new checkout's click-to-walk navigation, corrected first-person eye height, active Markdown prompt library, Draftroom references and Git history. Reconciled these with GPT-6 Astra/GPT-LIVE-1 integration, caption handling, authenticated project state, material editing, shared furniture geometry and versioned Blender assets.

The complete annotated template is [../.env.example](../.env.example). Its setup script now uses that filename; the intentionally removed `.env.local.example` was not restored. Preserved the destination `.env.local`; copied the missing Worker secret file privately, including the existing local encryption key. Restored the one saved local project into the previously empty destination database. No credentials were printed or committed, and no cloud resources were created.

Pre-merge versions of changed files and the previously empty local database are backed up in the git-ignored `.atelier/migration-backup-2026-09-13` directory. The previous source folder remains intact. New-only prompt, navigation and evidence files were retained.

Validation in the new checkout: frontend/Worker TypeScript checks passed; 35 tests passed across the suite and the focused backend rerun after reconciling an error-message assertion; the Next.js production build passed. Generation/render gates remain false. These local checks do not establish live OpenAI/E2B access or rendering performance.

The previous task's dev services were stopped. The existing new-folder frontend runs on port 3001 and the new-folder local Worker on port 8787. Port 3000 belongs to a different process and was left alone.

The saved Atelier project entry in Codex still referenced the old folder when inspected. Add/open this new folder as a Codex project for future tasks. The current task uses the new path explicitly for commands and file edits; no manual file copying is required.
