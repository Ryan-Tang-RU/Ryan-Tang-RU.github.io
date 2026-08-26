#!/usr/bin/env python3
"""Build the static site from the YAML files in _data/.

Usage:  python build.py
Then open index.html in a browser, or run:  python -m http.server
Commit the generated .html files; GitHub Pages serves them as-is, no build step needed.

Page structure, headings and wording follow the Google Sites site this one was
migrated from. Strings in _data/ may contain inline <b>, <i> and <a>; they are
written into the page as-is, so keep them valid HTML.
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
courses = load("courses")
awards = load("awards")
blog = load("blog")
misc = load("misc")

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700'
    '&display=swap" rel="stylesheet">'
)


def image_size(path, default=(400, 500)):
    """Read width and height out of a JPEG or PNG header, so <img> can carry them."""
    try:
        with open(path, "rb") as f:
            head = f.read(2)
            if head == b"\xff\xd8":                       # JPEG
                f.seek(2)
                while True:
                    b = f.read(1)
                    while b and b != b"\xff":
                        b = f.read(1)
                    marker = f.read(1)
                    while marker == b"\xff":
                        marker = f.read(1)
                    if not marker:
                        return default
                    if marker[0] in range(0xC0, 0xCF) and marker[0] not in (0xC4, 0xC8, 0xCC):
                        f.read(3)
                        h = int.from_bytes(f.read(2), "big")
                        w = int.from_bytes(f.read(2), "big")
                        return w, h
                    seg = int.from_bytes(f.read(2), "big")
                    f.seek(seg - 2, 1)
            f.seek(0)
            if f.read(8) == b"\x89PNG\r\n\x1a\n":          # PNG
                f.seek(16)
                return int.from_bytes(f.read(4), "big"), int.from_bytes(f.read(4), "big")
    except OSError:
        pass
    return default


def rel(url, base):
    """Prefix a site-relative URL so it resolves from a page in a subdirectory."""
    if not base or url.startswith(("http://", "https://", "mailto:", "#", "/")):
        return url
    return base + url


# Circular social buttons, in the style the Google Sites original used. The
# originals were hosted images; these are inline so the page needs no CDN.
ICONS = {
    "LinkedIn": '<path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.5c0-1.31-.03-3-1.83-3-1.83 0-2.11 1.43-2.11 2.9V21H9z"/>',
    "Google Scholar": '<path d="M12 3 1 9l11 6 9-4.91V17h2V9zM5 13.18v4L12 21l7-3.82v-4L12 17z"/>',
    "CV": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 2 4.5 4.5H14zM8 13h8v1.6H8zm0 3.2h8v1.6H8zM8 9.8h4v1.6H8z"/>',
    "GitHub": '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 12 2z"/>',
}


def social_icon(label):
    path = ICONS.get(label)
    if not path:
        return label
    return (f'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" '
            f'focusable="false" fill="currentColor">{path}</svg>')


# ---------------------------------------------------------------- chrome

def masthead(active, base=""):
    nav = "".join(
        '<li><a href="{href}"{cur}>{label}</a></li>'.format(
            href=rel(n["href"], base),
            label=n["label"],
            cur=' aria-current="page"' if n["href"] == active else "",
        )
        for n in site["nav"]
    )
    return f"""<header class="masthead">
  <div class="masthead__in">
    <a class="brand" href="{rel('index.html', base)}">
      <img src="{rel('assets/img/trail-mark.svg', base)}" alt="" width="32" height="40">
      {site['name']}
    </a>
    <nav class="site" aria-label="Sections"><ul>{nav}</ul></nav>
  </div>
</header>"""


def site_footer(base=""):
    links = " · ".join(
        f'<a href="{rel(l["url"], base)}">{l["label"]}</a>' for l in site["links"]
    )
    return f"""<footer class="page">
  <div class="band">
    <p>{site['name_full']} · {site['department']}, {site['institution']}
       · <a href="mailto:{site['email']}">{site['email']}</a></p>
    <p>{links}</p>
  </div>
</footer>"""


def page(filename, title, body, description="", base="", banner=""):
    desc = description or f"{site['name_full']}, {site['department']}, {site['institution']}."
    canon = "" if filename == "index.html" else filename
    if canon.endswith("/index.html"):
        canon = canon[: -len("index.html")]
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
<link rel="icon" href="{rel('assets/img/favicon.svg', base)}" type="image/svg+xml">
{FONTS}
<link rel="stylesheet" href="{rel('assets/css/style.css', base)}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{masthead(filename, base)}
{banner}
<main id="main" class="band">
{body}
</main>
{site_footer(base)}
</body>
</html>
"""
    out = ROOT / filename
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    print("wrote", filename)


# ---------------------------------------------------------------- home

def build_home():
    portrait = ""
    if os.path.exists(ROOT / site["photo"]):
        w, h = image_size(ROOT / site["photo"])
        portrait = (
            f'<img class="ident__portrait" src="{site["photo"]}" '
            f'alt="Portrait of {site["name_full"]}" width="{w}" height="{h}">'
        )
    ident_lines = "".join(f"<p>{p}</p>" for p in site["identity"])
    social = "".join(
        f'<li><a href="{l["url"]}" title="{l["label"]}" aria-label="{l["label"]}">'
        f'{social_icon(l["label"])}</a></li>'
        for l in site["links"]
    )
    bio = "".join(f"<p>{p}</p>" for p in site["bio"])
    areas = "".join(
        f'<div><h3>{a["title"]}</h3><p>{a["body"]}</p></div>' for a in site["research"]
    )

    items = ""
    for n in news:
        tag = f'<span class="tag">[{n["tag"]}]</span>' if n.get("tag") else ""
        when = f'<span class="when">{n["date"]}:</span> ' if n.get("date") else ""
        items += f"<li>{tag}{when}{n['text']}</li>"

    press = ""
    for item in site["press"]:
        img = item.get("image")
        shot = ""
        if img and os.path.exists(ROOT / "assets/img" / img):
            w, h = image_size(ROOT / "assets/img" / img, (320, 200))
            shot = (f'<img src="assets/img/{img}" alt="" width="{w}" height="{h}" loading="lazy">')
        label = item.get("caption") or ("" if shot else item["title"])
        press += f'<li><a href="{item["url"]}">{shot}{label}</a></li>'

    svc = ""
    for g in site["services"]:
        if g.get("label"):
            svc += f'<p class="svc-label">{g["label"]}</p>'
        svc += '<ul class="gs">' + "".join(f"<li>{i}</li>" for i in g["items"]) + "</ul>"

    body = f"""<div class="ident">
  <div class="ident__body">
    <h1 class="h-item">{site['name_full']}</h1>
    {ident_lines}
    <ul class="social">{social}</ul>
  </div>
  {portrait}
</div>
<hr class="rule">

<h2 class="h-sec">About Our Lab</h2>
{bio}

<h2 class="h-sec">Research Overview</h2>
<div class="areas"><div class="areas__in">{areas}</div></div>

<h2 class="h-sec">News</h2>
<div class="newsband">
  <ul class="news">{items}</ul>
  <ul class="press">{press}</ul>
</div>

<h2 class="h-page">Services</h2>
{svc}"""

    shot = site.get("banner_image")
    style = ""
    if shot and os.path.exists(ROOT / shot):
        style = f' style="background-image:url({shot})"'
    banner = f'<div class="banner"{style}><h1>{site["banner"]}</h1></div>'
    page("index.html", f"{site['name']}", body,
         f"{site['name_full']}, Department of Computer Science, Rutgers-New Brunswick. "
         "Trustworthy and Reliable AI Lab (TRAIL).", banner=banner)


# ---------------------------------------------------------------- publications

def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")


def build_publications():
    scholar = next(l["url"] for l in site["links"] if l["label"] == "Google Scholar")
    blocks = ""
    for sec in pubs:
        name = sec["section"]
        if name == "Preprint":
            blocks += f'<h2 class="h-group" id="{slug(name)}">{name}</h2>'
        else:
            if sec is pubs[1]:
                blocks += '<h2 class="h-group" id="publications">Publications</h2>'
            blocks += f'<h3 class="h-year" id="{slug(name)}">{name}</h3>'
        rows = ""
        for p in sec["items"]:
            t = html.escape(p["title"])
            t = f'<a href="{p["url"]}">{t}</a>' if p.get("url") else t
            rows += (
                f'<li><span class="t">{t}</span>'
                f'<span class="a">{p["authors"]}</span>'
                f'<span class="v">{p["venue"]}</span></li>'
            )
        blocks += f'<ul class="pubs">{rows}</ul>'

    total = sum(len(s["items"]) for s in pubs)
    body = f"""<h1 class="h-page">Conference/Journal Papers
  <a class="scholar" href="{scholar}">[google scholar]</a></h1>
<p class="pub-note">(* indicates equal contributions)</p>
{blocks}"""
    page("publications.html", f"Publications · {site['name']}", body,
         f"{total} publications by {site['name_full']} on trustworthy AI, interpretability, "
         "agent safety, and AI for biomedicine.")


# ---------------------------------------------------------------- group

def build_group():
    blocks = ""
    for sec in group:
        rows = "".join(f"<li>{m}</li>" for m in sec["items"])
        blocks += f'<h2 class="h-page">{sec["section"]}</h2><ul class="people">{rows}</ul>'
    page("group.html", f"Group · {site['name']}", blocks)


# ---------------------------------------------------------------- teaching

def course_href(slug_):
    return f"teaching/{slug_}/"


def build_teaching():
    rows = ""
    for c in teaching["courses"]:
        name = (
            f'<a href="{course_href(c["page"])}">{c["title"]}</a>'
            if c.get("page") else c["title"]
        )
        rows += f'<li>{c["term"]}, {c["code"]} {name}</li>'
    rg = teaching["reading_group"]
    rg_link = (
        f'<a href="{course_href(rg["page"])}">{rg["title"]}</a>'
        if rg.get("page") else rg["title"]
    )
    body = f"""<h2 class="h-sec">{teaching['heading']}</h2>
<ul class="courses">{rows}</ul>
<h2 class="h-sec">{rg['heading']}</h2>
<p>{rg_link}</p>"""
    page("teaching.html", f"Teaching · {site['name']}", body)


def build_courses():
    """One page per course and for the reading group, at the original public URL."""
    for c in courses:
        base = "../../"
        parts = []
        if c.get("facts"):
            parts.append('<ul class="facts">' + "".join(f"<li>{f}</li>" for f in c["facts"]) + "</ul>")
        for sec in c.get("sections", []):
            paras = "".join(f"<p>{p}</p>" for p in sec["paras"])
            head = "" if sec["heading"] == "About" else f'<h2 class="h-sec">{sec["heading"]}</h2>'
            parts.append(head + paras)
        sched = c.get("schedule")
        if sched:
            head = "".join(f"<th>{col}</th>" for col in sched["columns"])
            rows = ""
            for row in sched["rows"]:
                cells = "".join(
                    "<td>" + "".join(f"<p>{p}</p>" for p in cell) + "</td>" for cell in row
                )
                cells += "<td></td>" * max(0, len(sched["columns"]) - len(row))
                rows += f"<tr>{cells}</tr>"
            parts.append(
                f'<h2 class="h-sec">{sched["heading"]}</h2>'
                '<div class="tablewrap"><table class="sched">'
                f"<thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>"
            )
        body = (
            f'<p class="crumb"><a href="{base}teaching.html">Teaching</a></p>'
            f'<h1 class="h-item">{c["heading"]}</h1>' + "".join(parts)
        )
        page(
            f"teaching/{c['slug']}/index.html",
            f"{c['title']} · {site['name']}",
            body,
            f"{c['title']} at Rutgers, taught by {site['name_full']}."
            if c.get("term") else f"{c['title']}, organized at Rutgers.",
            base=base,
        )


# ---------------------------------------------------------------- awards

def build_awards():
    rows = "".join(f"<li>{a}</li>" for a in awards)
    page("awards.html", f"Awards · {site['name']}",
         f'<h1 class="h-page">Awards</h1><ul class="gs">{rows}</ul>')


# ---------------------------------------------------------------- blog

def build_blog():
    rows = ""
    for p in blog:
        tags = "".join(f"<span>{t}</span>" for t in p.get("tags", []))
        rows += f"""<li>
  <h2 class="h-item"><a href="{p['url']}">{p['title']}</a></h2>
  <p class="post__date">{p['date']}</p>
  <p class="post__tags">{tags}</p>
  <p>{p['summary']}</p>
  <p class="go"><a href="{p['url']}">[Read the blog &rarr;]</a></p>
</li>"""
    page("blog.html", f"Blog · {site['name']}", f'<ul class="posts">{rows}</ul>')


# ---------------------------------------------------------------- misc

def build_misc():
    about = "".join(f"<li>{p}</li>" for p in misc["about"])
    trips = ""
    for t in misc["trips"]:
        shots = [p for p in t.get("photos", []) if os.path.exists(ROOT / "assets/img" / p)]
        gallery = ""
        if shots:
            imgs = "".join(
                f'<img src="assets/img/{p}" alt="{t["place"]}" loading="lazy">' for p in shots
            )
            gallery = f'<div class="gallery">{imgs}</div>'
        trips += f'<div class="trip"><p><b>{t["place"]}:</b> {t["body"]}</p>{gallery}</div>'
    body = f"""<h1 class="h-item">{misc['heading']}</h1>
<ul class="gs">{about}</ul>
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
}


def build_redirects():
    for old, new in OLD_PATHS.items():
        target = "../" * (old.count("/") + 1) + new
        d = ROOT / old
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(
            '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
            f'<link rel="canonical" href="https://{site["domain"]}/{new}">'
            f'<meta http-equiv="refresh" content="0; url={target}">'
            "<title>Redirecting</title></head>"
            f'<body><p>This page has moved. <a href="{target}">Continue</a>.</p></body></html>\n',
            encoding="utf-8",
        )
    print("wrote", len(OLD_PATHS), "redirect stubs")


def build_sitemap():
    urls = ["" if n["href"] == "index.html" else n["href"] for n in site["nav"]]
    # standalone post pages are real content, not generated by this script
    urls += [b["url"] for b in blog if not b["url"].startswith("http")]
    urls += [f"teaching/{c['slug']}/" for c in courses]
    body = "".join(f"<url><loc>https://{site['domain']}/{u}</loc></url>" for u in urls)
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
    build_courses()
    build_awards()
    build_blog()
    build_misc()
    build_redirects()
    build_sitemap()
    print("done")
