# _legacy — not built, not shipped

These files are the **server-coupled client** from before the static-PWA rebuild:
auth (JWT), the admin dashboard, contest pages, the SSE verdict stream, the REST
API client. Nothing here is imported by `main.jsx` / `App.jsx`, so Vite never
bundles it — the deployed app is `pages/{Catalog,Solve,Me}.jsx` only.

Kept (not deleted) because the contest path in `SEI_Architecture_v10.0.md` /
`codeforge-arena-v4.md` will reuse the server in `../../server`, and this UI is a
starting point for that admin/contest surface. If you resurrect it, expect the
API shape to have moved on.
