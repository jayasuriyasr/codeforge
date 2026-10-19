# CodeForge web app

The live site: **[codeforge-arena.vercel.app](https://codeforge-arena.vercel.app)**.
See the [main README](../README.md) for the project overview.

```bash
npm run dev            # dev server on http://localhost:5173
npm run build          # production build to dist/
npm test               # unit tests (checker + judge)
npm run gen:problems   # regenerate the built-in problem JSON (content/problems)
```

Problems, accounts and submissions live in Supabase — see `supabase/schema.sql`
and `npm run db:setup` at the repo root.

- [DEPLOY.md](DEPLOY.md): hosting on Vercel / Cloudflare Pages / Netlify
- [STATUS.md](STATUS.md): language support and known limitations
- [VERIFY.md](VERIFY.md): manual browser checks per language
