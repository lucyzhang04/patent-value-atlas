# Patent Value Atlas

An interactive site built on the KPSS patent dataset (Kogan, Papanikolaou, Seru & Stoffman), covering
patents granted to U.S. public firms from 1926 to 2025. It shows:

- the most-cited and most valuable patents, all-time or within a decade
- every patent's market value restated in 2025 dollars
- the technology mix of patents over time, by count and by value
- filing-to-grant time by field and by narrow CPC subclass
- the mix and concentration of the firms doing the patenting

Live at https://patent-value-atlas.vercel.app/ 

## Run locally

```bash
pip install -r requirements.txt
python scripts/build_data.py
python -m http.server -d public 8000
```
