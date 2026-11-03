"""Aggregate the KPSS (Kogan, Papanikolaou, Seru & Stoffman) patent data into
small JSON files for the static site in public/.

Usage:
    python scripts/build_data.py

Downloads KPSS_2025.zip and Match_patent_cpc_2025.zip from the authors' GitHub
repository (UPSTREAM) at its latest commit, so the site always reflects the
published data. Runs in GitHub Actions; see .github/workflows/deploy.yml.

Inflation: KPSS xi_real is xi_nominal deflated to 1982 dollars with the annual
CPI (xi_nominal / xi_real is constant within each issue year, = 1.0 in 1982).
We restate every value in 2025 dollars: value_2025 = xi_real * CPI_2025/CPI_1982,
where that ratio is read from the data itself (the 2025 nominal/real ratio).
"""

import json
from datetime import datetime, timezone
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import duckdb

UPSTREAM = "KPSS2017/Technological-Innovation-Resource-Allocation-and-Growth-Extended-Data"
FILES = ("KPSS_2025", "Match_patent_cpc_2025")
OUT = Path(__file__).resolve().parent.parent / "public" / "data"

CATEGORIES = [
    "Computing & Software",
    "Communications",
    "Semiconductors & Electrical",
    "Instruments & Optics",
    "Drugs, Medical & Biotech",
    "Chemicals & Materials",
    "Mechanical, Transport & Construction",
    "Consumer & Other",
]

# Order matters: first match wins.
CATEGORY_SQL = """
CASE
  WHEN sc IS NULL THEN 'Unclassified'
  WHEN (cl IN ('G06','G16') AND sc <> 'G16H') OR sc = 'G10L' THEN 'Computing & Software'
  WHEN cl = 'H04' THEN 'Communications'
  WHEN cl IN ('H01','H02','H03','H05','H10','G11') THEN 'Semiconductors & Electrical'
  WHEN cl IN ('A61','C12') OR sc IN ('C07K','G16H') THEN 'Drugs, Medical & Biotech'
  WHEN left(sc,1) = 'C' OR cl IN ('B01','B05','B29','B32') OR sc = 'A01N' THEN 'Chemicals & Materials'
  WHEN left(sc,1) = 'G' THEN 'Instruments & Optics'
  WHEN left(sc,1) IN ('B','E','F') THEN 'Mechanical, Transport & Construction'
  WHEN left(sc,1) IN ('A','D','H') THEN 'Consumer & Other'
  ELSE 'Unclassified'
END
"""

# Narrow CPC subclasses for like-for-like pendency comparisons.
SUBCLASSES = {
    "G06F": "Digital data processing (computers)",
    "G06Q": "Business-method data processing",
    "G06N": "AI / computing models",
    "G06T": "Image processing",
    "H04L": "Digital data transmission / networking",
    "H04N": "Television & imaging transmission",
    "H04W": "Wireless networks",
    "H01L": "Semiconductor devices",
    "H01M": "Batteries & fuel cells",
    "G11B": "Disk / tape storage",
    "G02B": "Optical elements",
    "G01N": "Materials analysis",
    "G03G": "Photocopying (electrography)",
    "A61K": "Drug preparations",
    "A61B": "Diagnosis & surgery",
    "A61F": "Prostheses & implants",
    "C12N": "Genetic engineering",
    "C07D": "Heterocyclic compounds",
    "C08L": "Polymer compositions",
    "B65D": "Containers & packaging",
    "F16H": "Gearing",
    "F16K": "Valves",
    "F02M": "Engine fuel supply",
    "B60R": "Vehicle fittings",
    "E21B": "Earth drilling (oil & gas wells)",
    "B41J": "Printers & typewriters",
    "A47C": "Chairs, sofas & beds",
    "A47J": "Kitchen equipment",
    "A63B": "Sports apparatus",
}


def upstream_commit() -> dict:
    req = urllib.request.Request(f"https://api.github.com/repos/{UPSTREAM}/commits?per_page=1",
                                 headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as r:
        c = json.load(r)[0]
    return dict(sha=c["sha"], date=c["commit"]["committer"]["date"])


def fetch(sha: str, work: Path) -> dict:
    paths = {}
    for name in FILES:
        url = f"https://raw.githubusercontent.com/{UPSTREAM}/{sha}/{name}.zip"
        zpath = work / f"{name}.zip"
        print("downloading", url)
        urllib.request.urlretrieve(url, zpath)
        with zipfile.ZipFile(zpath) as z:
            member = next(m for m in z.namelist() if m.lower().endswith(".csv") and "__MACOSX" not in m)
            z.extract(member, work)
        paths[name] = (work / member).as_posix()
        zpath.unlink()
    return paths


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    commit = upstream_commit()
    with tempfile.TemporaryDirectory() as tmp:
        paths = fetch(commit["sha"], Path(tmp))
        build(paths["KPSS_2025"], paths["Match_patent_cpc_2025"], commit)


def build(kpss: str, cpc: str, commit: dict) -> None:
    con = duckdb.connect()

    factor = con.sql(
        f"SELECT median(xi_nominal / xi_real) FROM '{kpss}' "
        "WHERE issue_date // 10000 = 2025 AND xi_real > 0"
    ).fetchone()[0]

    con.sql(f"""
    CREATE TABLE p AS
    WITH c AS (
      SELECT patent_num,
             trim(list_filter(string_split(cpc, ';'), x -> NOT starts_with(trim(x), 'Y'))[1]) AS code
      FROM '{cpc}'
    ), c2 AS (
      SELECT patent_num, code, left(code, 4) AS sc, left(code, 3) AS cl FROM c
    )
    SELECT k.patent_num,
           k.permno,
           strptime(k.issue_date::VARCHAR, '%Y%m%d')::DATE AS issue_date,
           try_strptime(k.filing_date::VARCHAR, '%Y%m%d')::DATE AS filing_date,
           k.xi_nominal,
           k.xi_real * {factor} AS v2025,
           k.cites,
           c2.code, c2.sc,
           {CATEGORY_SQL} AS cat
    FROM '{kpss}' k LEFT JOIN c2 USING (patent_num)
    """)
    con.sql("""
    ALTER TABLE p ADD COLUMN year INTEGER;
    UPDATE p SET year = year(issue_date);
    ALTER TABLE p ADD COLUMN pend DOUBLE;
    UPDATE p SET pend = date_diff('day', filing_date, issue_date) / 365.25
      WHERE filing_date IS NOT NULL AND filing_date <= issue_date;
    """)

    def rows(q):
        r = con.sql(q)
        cols = r.columns
        return [dict(zip(cols, t)) for t in r.fetchall()]

    def rnd(x, n=3):
        return None if x is None else round(float(x), n)

    # ---- summary
    s = con.sql("""SELECT count(*), sum(v2025), median(v2025), count(DISTINCT permno),
                          min(year), max(year), count(*) FILTER (WHERE cat='Unclassified')
                   FROM p""").fetchone()
    summary = dict(n=s[0], total_v2025=rnd(s[1], 0), median_v2025=rnd(s[2], 4),
                   firms=s[3], first_year=s[4], last_year=s[5], unclassified=s[6],
                   cpi_factor_1982_to_2025=rnd(factor, 6),
                   source=dict(repo=UPSTREAM, **commit),
                   built_at=datetime.now(timezone.utc).isoformat())

    # ---- yearly by category
    yearly = rows("""
      SELECT year, cat, count(*) n, sum(v2025) v, median(v2025) med, avg(cites) cites
      FROM p GROUP BY 1, 2 ORDER BY 1, 2""")
    for r in yearly:
        r["v"] = rnd(r["v"], 1); r["med"] = rnd(r["med"], 4); r["cites"] = rnd(r["cites"], 2)

    totals = rows("""
      SELECT year, count(*) n, sum(v2025) v, median(v2025) med, avg(v2025) mean,
             sum(xi_nominal) v_nom, median(xi_nominal) med_nom, avg(xi_nominal) mean_nom,
             count(DISTINCT permno) firms
      FROM p GROUP BY 1 ORDER BY 1""")
    for r in totals:
        for k in ("v", "v_nom"):
            r[k] = rnd(r[k], 1)
        for k in ("med", "mean", "med_nom", "mean_nom"):
            r[k] = rnd(r[k], 4)

    # ---- pendency (filing -> grant), by grant year
    pend_all = rows("""
      SELECT year, median(pend) med, quantile_cont(pend, 0.25) p25,
             quantile_cont(pend, 0.75) p75, count(*) n
      FROM p WHERE pend IS NOT NULL GROUP BY 1 ORDER BY 1""")
    pend_cat = rows("""
      SELECT year, cat, median(pend) med, quantile_cont(pend, 0.25) p25,
             quantile_cont(pend, 0.75) p75, count(*) n
      FROM p WHERE pend IS NOT NULL AND cat <> 'Unclassified'
      GROUP BY 1, 2 HAVING count(*) >= 30 ORDER BY 1, 2""")
    sc_list = ",".join(f"'{k}'" for k in SUBCLASSES)
    pend_sc = rows(f"""
      SELECT year, sc, median(pend) med, quantile_cont(pend, 0.25) p25,
             quantile_cont(pend, 0.75) p75, count(*) n
      FROM p WHERE pend IS NOT NULL AND sc IN ({sc_list})
      GROUP BY 1, 2 HAVING count(*) >= 20 ORDER BY 1, 2""")
    for lst in (pend_all, pend_cat, pend_sc):
        for r in lst:
            for k in ("med", "p25", "p75"):
                r[k] = rnd(r[k], 3)

    # ---- top patents
    top_cols = """patent_num, year, strftime(filing_date, '%Y-%m-%d') filed,
                  strftime(issue_date, '%Y-%m-%d') issued, permno, cites,
                  xi_nominal, v2025, code, cat"""
    top_cites = rows(f"SELECT {top_cols} FROM p ORDER BY cites DESC, v2025 DESC LIMIT 250")
    top_value = rows(f"SELECT {top_cols} FROM p ORDER BY v2025 DESC LIMIT 250")
    # Older patents have had decades longer to accumulate citations, so also rank within decade.
    dec_cols = top_cols + ", (year // 10) * 10 AS decade"
    top_cites_dec = rows(f"""SELECT * EXCLUDE (rk) FROM (
        SELECT {dec_cols}, row_number() OVER (PARTITION BY year // 10 ORDER BY cites DESC, v2025 DESC) rk
        FROM p) WHERE rk <= 50 ORDER BY decade, cites DESC""")
    top_value_dec = rows(f"""SELECT * EXCLUDE (rk) FROM (
        SELECT {dec_cols}, row_number() OVER (PARTITION BY year // 10 ORDER BY v2025 DESC) rk
        FROM p) WHERE rk <= 50 ORDER BY decade, v2025 DESC""")
    for lst in (top_cites, top_value, top_cites_dec, top_value_dec):
        for r in lst:
            r["xi_nominal"] = rnd(r["xi_nominal"], 3); r["v2025"] = rnd(r["v2025"], 3)

    # ---- firms: each firm-decade gets the category where most of its patents fall
    con.sql("""
    CREATE TABLE fd AS
    WITH x AS (
      SELECT permno, (year // 10) * 10 AS decade, cat, count(*) n, sum(v2025) v
      FROM p WHERE cat <> 'Unclassified' GROUP BY 1, 2, 3
    )
    SELECT permno, decade, arg_max(cat, n) AS cat, sum(n) n, sum(v) v,
           max(n) / sum(n) AS focus
    FROM x GROUP BY 1, 2
    """)
    firm_mix = rows("""
      SELECT decade, cat, count(*) firms, sum(n) patents
      FROM fd GROUP BY 1, 2 ORDER BY 1, 2""")
    top_firms = rows("""
      SELECT decade, permno, cat, n, v, focus FROM (
        SELECT *, row_number() OVER (PARTITION BY decade ORDER BY n DESC) rk FROM fd
      ) WHERE rk <= 10 ORDER BY decade, rk""")
    for r in top_firms:
        r["v"] = rnd(r["v"], 1); r["focus"] = rnd(r["focus"], 3)

    conc = rows("""
      WITH f AS (SELECT year, permno, count(*) n FROM p GROUP BY 1, 2),
      r AS (SELECT *, row_number() OVER (PARTITION BY year ORDER BY n DESC) rk,
                   n / sum(n) OVER (PARTITION BY year) sh FROM f)
      SELECT year, sum(sh) FILTER (WHERE rk <= 10) top10, sum(sh * sh) hhi
      FROM r GROUP BY 1 ORDER BY 1""")
    for r in conc:
        r["top10"] = rnd(r["top10"], 4); r["hhi"] = rnd(r["hhi"], 5)

    out = dict(
        summary=summary, categories=CATEGORIES, subclasses=SUBCLASSES,
        yearly=yearly, totals=totals,
        pend_all=pend_all, pend_cat=pend_cat, pend_sc=pend_sc,
        firm_mix=firm_mix, top_firms=top_firms, concentration=conc,
    )
    (OUT / "aggregates.json").write_text(json.dumps(out, separators=(",", ":"), default=str))
    (OUT / "top_patents.json").write_text(
        json.dumps(dict(by_cites=top_cites, by_value=top_value,
                        by_cites_decade=top_cites_dec, by_value_decade=top_value_dec), separators=(",", ":"), default=str))
    print("factor", factor, "summary", summary)


if __name__ == "__main__":
    main()
