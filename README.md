# Patent Value Atlas

An interactive site built on the KPSS patent dataset (Kogan, Papanikolaou, Seru & Stoffman), covering
patents granted to U.S. public firms from 1926 to 2025. It shows:

- the most-cited and most valuable patents, all-time or within a decade
- every patent's market value restated in 2025 dollars
- the technology mix of patents over time, by count and by value
- filing-to-grant time by field and by narrow CPC subclass
- the mix and concentration of the firms doing the patenting

## How it works

The site doesn't read any local data. `scripts/build_data.py` downloads `KPSS_2025.zip` and
`Match_patent_cpc_2025.zip` from the authors' repository,
[KPSS2017/Technological-Innovation-Resource-Allocation-and-Growth-Extended-Data](https://github.com/KPSS2017/Technological-Innovation-Resource-Allocation-and-Growth-Extended-Data),
at its latest commit and aggregates 3.8M patents with DuckDB into small JSON files under `public/data/`.
The page in `public/` loads those files.

Hosting is on Vercel (`vercel.json`). Vercel runs the build on every push to `main`.
`.github/workflows/refresh.yml` also calls a Vercel deploy hook every Monday, so new upstream releases get picked up.
The page footer shows which upstream commit it was built from.

### Vercel setup (one time)

1. On vercel.com, choose Add New → Project and import `patent-value-atlas`. The settings come from `vercel.json`.
2. In Project → Settings → Git → Deploy Hooks, create a hook for branch `main` and copy its URL.
3. In the GitHub repo, go to Settings → Secrets and variables → Actions and add a secret named `VERCEL_DEPLOY_HOOK` with that URL.

## Run locally

```bash
pip install -r requirements.txt
python scripts/build_data.py
python -m http.server -d public 8000
```
