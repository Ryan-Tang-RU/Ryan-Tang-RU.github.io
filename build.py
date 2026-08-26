#!/usr/bin/env python3
"""Build the static site from the YAML files in _data/.

Usage:  python build.py
Then open index.html in a browser, or run:  python -m http.server
Commit the generated .html files; GitHub Pages serves them as-is, no build step needed.
"""

import html
import os
import pathlib
import yaml

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "_data"


def load(name):
    with open(DATA / f"{name}.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


site = load("site")
news = load("news")
pubs = load("publications")
group = load("group")
teaching = load("teaching")
awards = load("awards")
blog = load("blog")
misc = load("misc")

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&'
    'family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap" rel="stylesheet">'
)


def rail(active):
    links = "".join(
        f'<a href="{l["url"]}">{l["label"]}</a>' for l in site["links"]
    )
    nav = "".join(
        '<li><a href="{href}"{cur}>{label}</a></li>'.format(
            href=n["href"],
            label=n["label"],
            cur=' aria-current="page"' if n["href"] == active else "",
        )
        for n in site["nav"]
    )
    portrait = ""
    if os.path.exists(ROOT / site["photo"]):
        portrait = (
            f'<img class="rail__portrait" src="{site["photo"]}" '
            f'alt="Portrait of {site["name"]}" width="400" height="500">'
        )
    return f"""<aside class="rail">
  <a class="rail__mark" href="index.html" aria-label="Home">
    <img src="assets/img/trail-mark.svg" alt="TRAIL Lab shield" width="120" height="150">
  </a>
  <p class="rail__name">{site['name']}</p>
  <p class="rail__zh">唐瑞祥</p>
  {portrait}
  <p class="rail__meta">
    <strong>{site['role']}</strong><br>
    {site['department']}<br>
    {site['institution']}<br>
    {site['address']}<br>
    <a href="mailto:{site['email']}">{site['email']}</a>
  </p>
  <div class="rail__links">{links}</div>
  <nav class="site" aria-label="Sections"><ul>{nav}</ul></nav>
</aside>"""


def page(filename, title, body, description=""):
    desc = description or f"{site['name']}, {site['role']}, {site['institution']}."
    canon = "" if filename == "index.html" else filename
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{html.escape(desc, quote=True)}">
<meta property="og:title" content="{html.escape(title, quote=True)}">
<meta property="og:description" content="{html.escape(desc, quote=True)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://{site['domain']}/{canon}">
<link rel="canonical" href="https://{site['domain']}/{canon}">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
{FONTS}
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
{rail(filename)}
<main id="main">
{body}
</main>
</div>
<footer class="page">
  {site['name']} · {site['lab']} · {site['institution']}
</footer>
</body>
</html>
"""
    (ROOT / filename).write_text(doc, encoding="utf-8")
    print("wrote", filename)


def bold_me(authors):
    """Render the site owner's name in bold inside an author string."""
    out = html.escape(authors)
    for form in (site["name"], site["name"] + "*"):
        out = out.replace(form, f'<span class="me">{form}</span>')
    return out


# ---------------------------------------------------------------- home

def build_home():
    bio = "".join(f"<p>{p.strip()}</p>" for p in site["bio"])
    areas = "".join(
        f'<div class="area"><h3>{a["title"]}</h3><p>{a["body"]}</p></div>'
        for a in site["research"]
    )

    def item(n):
        tag = f'<span class="tag">{n["tag"]}</span>' if n.get("tag") else ""
        return f'<li><span class="when">{n["date"]}</span> {tag}{n["text"].strip()}</li>'

    head, rest = news[:8], news[8:]
    news_html = f'<ul class="trail">{"".join(item(n) for n in head)}</ul>'
    if rest:
        news_html += (
            f'<div id="news-rest"><ul class="trail">{"".join(item(n) for n in rest)}</ul></div>'
            f'<p class="more"><button class="toggle" id="news-toggle" aria-expanded="false" '
            f'aria-controls="news-rest">Show all {len(news)} updates</button></p>'
        )

    services = ""
    for heading, entries in site["services"].items():
        rows = "".join(f"<li>{e}</li>" for e in entries)
        services += f'<h3>{heading}</h3><ul class="people">{rows}</ul>'

    press = "".join(
        f'<li><a href="{p["url"]}">{p["title"]}</a><span class="src">{p["source"]}</span></li>'
        for p in site["press"]
    )

    script = """
<script>
(function () {
  var btn = document.getElementById('news-toggle');
  var box = document.getElementById('news-rest');
  if (!btn || !box) return;
  btn.addEventListener('click', function () {
    var open = box.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Show fewer updates' : 'Show all NEWSCOUNT updates';
  });
})();
</script>""".replace("NEWSCOUNT", str(len(news)))

    body = f"""<p class="eyebrow">{site['lab']}</p>
<h1>Infusing trust throughout the AI lifecycle</h1>
<div class="lede">{bio}</div>

<h2>Research</h2>
<div class="areas">{areas}</div>

<h2>News</h2>
{news_html}

<h2>Service</h2>
{services}

<h2>In the press</h2>
<ul class="press">{press}</ul>
{script}"""
    page("index.html", f"{site['name']}", body)


# ---------------------------------------------------------------- publications

def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")


def build_publications():
    jump = "".join(
        f'<a href="#{slug(sec["section"])}">{sec["section"]}</a>' for sec in pubs
    )
    blocks = ""
    for sec in pubs:
        rows = ""
        for p in sec["items"]:
            title = html.escape(p["title"])
            title = f'<a href="{p["url"]}">{title}</a>' if p.get("url") else title
            note = f'<span class="note">{p["note"]}</span>' if p.get("note") else ""
            rows += (
                '<li class="pub">'
                f'<span class="pub__title">{title}</span>'
                f'<span class="pub__authors">{bold_me(p["authors"])}</span><br>'
                f'<span class="pub__venue">{html.escape(p["venue"])}{note}</span>'
                "</li>"
            )
        blocks += (
            f'<h2 id="{slug(sec["section"])}">{sec["section"]}</h2>'
            f'<ul class="pubs">{rows}</ul>'
        )

    scholar = next(l["url"] for l in site["links"] if l["label"] == "Google Scholar")
    total = sum(len(s["items"]) for s in pubs)
    body = f"""<h1>Publications</h1>
<p>A full list is also on <a href="{scholar}">Google Scholar</a>. An asterisk marks equal contribution.</p>
<div class="jump">{jump}</div>
{blocks}"""
    page("publications.html", f"Publications · {site['name']}", body,
         f"{total} publications by {site['name']} on trustworthy AI, interpretability, "
         "agent safety, and AI for biomedicine.")


# ---------------------------------------------------------------- group

def build_group():
    blocks = ""
    for sec in group["sections"]:
        rows = ""
        for m in sec["items"]:
            who = (
                f'<a href="{m["url"]}">{m["name"]}</a>' if m.get("url") else m["name"]
            )
            what = f'<span class="what">{m["detail"]}</span>' if m.get("detail") else ""
            rows += f'<li><span class="who">{who}</span>{what}</li>'
        blocks += f'<h2>{sec["section"]}</h2><ul class="people">{rows}</ul>'

    joining = group.get("joining", "").strip()
    body = f"""<h1>Group</h1>
<p>The Trustworthy and Reliable AI Lab works on interpretability, agent safety, perception
reliability, and AI for biomedicine.</p>
{blocks}
{f'<div class="callout"><p>{joining}</p></div>' if joining else ''}"""
    page("group.html", f"Group · {site['name']}", body)


# ---------------------------------------------------------------- teaching

def build_teaching():
    rows = ""
    for c in teaching["courses"]:
        name = (
            f'<a href="{c["url"]}">{c["title"]}</a>' if c.get("url") else c["title"]
        )
        rows += (
            f'<li><span class="k">{c["term"]}</span>'
            f'<span>{name}<span class="code">{c["code"]}</span></span></li>'
        )
    rg = teaching["reading_group"]
    rg_title = f'<a href="{rg["url"]}">{rg["title"]}</a>' if rg.get("url") else rg["title"]
    body = f"""<h1>Teaching</h1>
<h2>Courses</h2>
<ul class="stack">{rows}</ul>
<h2>Reading group</h2>
<p><strong>{rg_title}</strong></p>
<p>{rg['body'].strip()}</p>"""
    page("teaching.html", f"Teaching · {site['name']}", body)


# ---------------------------------------------------------------- awards

def build_awards():
    rows = "".join(
        f'<li><span class="k">{a["year"]}</span><span>{a["text"]}</span></li>'
        for a in awards
    )
    body = f'<h1>Awards</h1>\n<ul class="stack">{rows}</ul>'
    page("awards.html", f"Awards · {site['name']}", body)


# ---------------------------------------------------------------- blog

def build_blog():
    rows = ""
    for p in blog:
        tags = "".join(f"<span>{t}</span>" for t in p.get("tags", []))
        rows += f"""<li class="post">
  <h3><a href="{p['url']}">{html.escape(p['title'])}</a></h3>
  <p class="post__meta"><span>{p['date']}</span>{tags}</p>
  <p>{p['summary'].strip()}</p>
  <p class="go"><a href="{p['url']}">Read the post</a></p>
</li>"""
    body = f"""<h1>Blog</h1>
<p>Notes on things we ran into while doing the work: mechanisms we did not expect, evaluations that
looked better than they were, and results that needed a second look.</p>
<ul class="posts">{rows}</ul>"""
    page("blog.html", f"Blog · {site['name']}", body)


# ---------------------------------------------------------------- misc

def build_misc():
    about = "".join(f"<p>{p.strip()}</p>" for p in misc["about"])
    trips = ""
    for t in misc["trips"]:
        shots = [p for p in t.get("photos", []) if os.path.exists(ROOT / "assets/img" / p)]
        gallery = ""
        if shots:
            imgs = "".join(
                f'<img src="assets/img/{p}" alt="{t["place"]}, {t["year"]}" loading="lazy">'
                for p in shots
            )
            gallery = f'<div class="gallery">{imgs}</div>'
        trips += f'<h3>{t["place"]}, {t["year"]}</h3><p>{t["body"].strip()}</p>{gallery}'
    body = f"""<h1>Misc</h1>
{about}
<h2>National parks and trips</h2>
{trips}"""
    page("misc.html", f"Misc · {site['name']}", body)


# ---------------------------------------------------------------- old URL redirects

# Google Sites served pages without an .html suffix (/publications, /group ...).
# These stubs keep every inbound link, bookmark, and search result working.
OLD_PATHS = {
    "home": "index.html",
    "publications": "publications.html",
    "blog": "blog.html",
    "group": "group.html",
    "teaching": "teaching.html",
    "awards": "awards.html",
    "misc": "misc.html",
    "teaching/fall-2024-trustworthy-ai": "teaching.html",
    "teaching/spring-2025-introduction-to-data-science": "teaching.html",
    "teaching/trustworthy-ai-reading-group": "teaching.html",
    "teaching/fall-2025-massive-data-mining": "teaching.html",
}


def build_redirects():
    for old, new in OLD_PATHS.items():
        depth = old.count("/") + 1
        target = "../" * depth + new
        d = ROOT / old
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(
            "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<link rel=\"canonical\" href=\"https://{site['domain']}/{new}\">"
            f"<meta http-equiv=\"refresh\" content=\"0; url={target}\">"
            "<title>Redirecting</title></head>"
            f"<body><p>This page has moved. <a href=\"{target}\">Continue</a>.</p></body></html>\n",
            encoding="utf-8",
        )
    print("wrote", len(OLD_PATHS), "redirect stubs")


def build_sitemap():
    urls = ["" if n["href"] == "index.html" else n["href"] for n in site["nav"]]
    # standalone post pages are real content, not generated by this script
    urls += [b["url"] for b in blog if not b["url"].startswith("http")]
    body = "".join(
        f"<url><loc>https://{site['domain']}/{u}</loc></url>" for u in urls
    )
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{body}</urlset>\n",
        encoding="utf-8",
    )
    (ROOT / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nSitemap: https://{site['domain']}/sitemap.xml\n",
        encoding="utf-8",
    )
    print("wrote sitemap.xml, robots.txt")


if __name__ == "__main__":
    build_home()
    build_publications()
    build_group()
    build_teaching()
    build_awards()
    build_blog()
    build_misc()
    build_redirects()
    build_sitemap()
    print("done")
