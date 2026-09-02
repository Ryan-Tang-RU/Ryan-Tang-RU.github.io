#!/usr/bin/env python3
"""Build the static site from the YAML files in _data/.

Usage:  python build.py
Then open index.html in a browser, or run:  python -m http.server
Commit the generated .html files; GitHub Pages serves them as-is, no build step needed.

Page structure, headings and wording follow the Google Sites site this one was
migrated from. Strings in _data/ may contain inline <b>, <i> and <a>; they are
written into the page as-is, so keep them valid HTML.
"""

import hashlib
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


def asset_version(path):
    """Short content hash, appended to the stylesheet URL.

    The .html files and the stylesheet are separate requests with separate
    cache lifetimes, so a browser can hold a stale stylesheet against freshly
    deployed markup and lay the page out with rules that no longer exist.
    Changing the URL whenever the bytes change makes that impossible.
    """
    try:
        return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:8]
    except OSError:
        return ""


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


CSS_VERSION = ""  # set in __main__, once the stylesheet is final


# ---------------------------------------------------------------- analytics

STANDALONE = ["emdash.html", "probe.html", "ninetynine.html"]
MARK_OPEN, MARK_CLOSE = "<!-- analytics -->", "<!-- /analytics -->"


def analytics_tag():
    """The visitor counter, configured by the `analytics` block in site.yml.

    Nothing is written until both provider and id are filled in, so by default
    the pages carry no third-party script at all. The providers below are
    cookieless and store no personal data, which is why the site needs no
    consent banner; adding one that sets cookies would change that.
    """
    cfg = site.get("analytics") or {}
    provider = (cfg.get("provider") or "").strip().lower()
    ident = str(cfg.get("id") or "").strip()
    if not provider or not ident:
        return ""
    if provider == "goatcounter":
        endpoint = ident if ident.startswith("http") else f"https://{ident}.goatcounter.com/count"
        # Loaded behind a guard rather than as a plain <script src>, so that our
        # own visits can be left out of the numbers: open any page once with
        # #gc-off on the end of the URL and this browser stops being counted,
        # on every page and every later visit. #gc-on puts it back. The flag
        # lives in localStorage, so it is per browser and survives a restart
        # but not a clear-site-data.
        return (
            "<script>"
            "(function(){var k='gcskip';"
            "function set(){var h=location.hash;try{"
            "if(h==='#gc-off'){localStorage.setItem(k,'1');"
            "alert('Visits from this browser are no longer counted.');return 1;}"
            "if(h==='#gc-on'){localStorage.removeItem(k);"
            "alert('Visits from this browser are counted again.');}"
            "}catch(e){}return 0;}"
            "addEventListener('hashchange',set);"
            "if(set())return;"
            "try{if(localStorage.getItem(k))return;}catch(e){}"
            "var s=document.createElement('script');s.async=true;"
            "s.src='//gc.zgo.at/count.js';"
            f"s.setAttribute('data-goatcounter','{endpoint}');"
            "document.head.appendChild(s);})();"
            "</script>"
        )
    if provider == "cloudflare":
        return ('<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
                f'data-cf-beacon=\'{{"token": "{ident}"}}\'></script>')
    if provider == "plausible":
        return (f'<script defer data-domain="{ident}" '
                f'src="https://plausible.io/js/script.js"></script>')
    raise SystemExit(f"site.yml: unknown analytics provider {provider!r}")


def build_standalone_analytics():
    """The three long-form posts are written by hand rather than generated.

    Keep their snippet in step with site.yml by rewriting a marked block, so
    there is still only one place to change the counter.
    """
    block = f"{MARK_OPEN}{analytics_tag()}{MARK_CLOSE}"
    for name in STANDALONE:
        f = ROOT / name
        if not f.exists():
            continue
        doc = f.read_text(encoding="utf-8")
        if MARK_OPEN in doc:
            a, b = doc.index(MARK_OPEN), doc.index(MARK_CLOSE) + len(MARK_CLOSE)
            new = doc[:a] + block + doc[b:]
        else:
            new = doc.replace("</body>", f"{block}\n</body>", 1)
        if new != doc:
            f.write_text(new, encoding="utf-8")
            print("updated", name)


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
<link rel="stylesheet" href="{rel('assets/css/style.css', base)}?v={CSS_VERSION}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{masthead(filename, base)}
{banner}
<main id="main" class="band">
{body}
</main>
{analytics_tag()}</body>
</html>
"""
    out = ROOT / filename
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    print("wrote", filename)


# ---------------------------------------------------------------- home

def build_home():
    def ident_img(key, cls, alt, shown=266):
        """The width/height attributes describe the size the image is *shown* at.

        The files are larger so they stay sharp on a dense display, but writing
        the intrinsic width here would make the image 800px wide any time the
        stylesheet does not apply, which collapses the text column beside it.
        """
        path = site.get(key)
        if not path or not os.path.exists(ROOT / path):
            return ""
        iw, ih = image_size(ROOT / path)
        h = round(shown * ih / iw) if iw else shown
        return (f'<img class="{cls}" src="{path}" alt="{alt}" '
                f'width="{shown}" height="{h}">')

    # the original set the portrait and the lab logo side by side, right of the text
    portrait = ident_img("photo", "ident__portrait", f'Portrait of {site["name_full"]}')
    lab_logo = ident_img("logo", "ident__logo", f'{site["banner"]} logo')
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
        tag = (f'<span class="tag tag--{n["tag"]}">[{n["tag"]}]</span>'
               if n.get("tag") else "")
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
  {lab_logo}
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


ME = "<b>Ruixiang Tang</b>"


def mark_corresponding(authors, explicit=None):
    """Flag the papers Ruixiang is corresponding author on.

    The convention on this site is that he is corresponding author when he is
    last author. An entry can set `corresponding: true/false` in the YAML when
    that does not hold, which is the only thing to change if a paper is an
    exception.
    """
    last = authors.rstrip().rstrip(".").rstrip().endswith(ME)
    flag = last if explicit is None else explicit
    if not flag or ME not in authors:
        return authors
    i = authors.rfind(ME)
    return (authors[:i] + ME
            + '<sup class="corr" title="corresponding author">&dagger;</sup>'
            + authors[i + len(ME):])


def build_publications():
    scholar = next(l["url"] for l in site["links"] if l["label"] == "Google Scholar")
    blocks = ""
    for sec in pubs:
        name = sec["section"]
        if name in ("Preprint", "Workshop Papers"):
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
                f'<span class="a">{mark_corresponding(p["authors"], p.get("corresponding"))}</span>'
                f'<span class="v">{p["venue"]}</span></li>'
            )
        blocks += f'<ul class="pubs">{rows}</ul>'

    total = sum(len(s["items"]) for s in pubs)
    body = f"""<h1 class="h-page">Conference/Journal Papers
  <a class="scholar" href="{scholar}">[google scholar]</a></h1>
<p class="pub-note">(* indicates equal contribution; &dagger; indicates corresponding author)</p>
{blocks}"""
    page("publications.html", f"Publications · {site['name']}", body,
         f"{total} publications by {site['name_full']} on trustworthy AI, interpretability, "
         "agent safety, and AI for biomedicine.")


# ---------------------------------------------------------------- group

def group_photo():
    """The lab photo at the top of the Group page.

    Skipped entirely until the file is actually in the repo, so the page never
    shows a broken image.
    """
    path = site.get("group_photo")
    if not path or not os.path.exists(ROOT / path):
        return ""
    w, h = image_size(ROOT / path, (1440, 1080))
    cap = site.get("group_photo_caption") or ""
    cap = f"<figcaption>{cap}</figcaption>" if cap else ""
    return (f'<figure class="groupshot">'
            f'<img src="{path}" alt="{site["banner"]} members at a group dinner" '
            f'width="{w}" height="{h}">{cap}</figure>')


def build_group():
    blocks = ""
    for sec in group:
        rows = "".join(f"<li>{m}</li>" for m in sec["items"])
        blocks += f'<h2 class="h-page">{sec["section"]}</h2><ul class="people">{rows}</ul>'
    page("group.html", f"Group · {site['name']}", blocks + group_photo())


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
    CSS_VERSION = asset_version("assets/css/style.css")
    build_home()
    build_publications()
    build_group()
    build_teaching()
    build_courses()
    build_awards()
    build_blog()
    build_misc()
    build_redirects()
    build_standalone_analytics()
    build_sitemap()
    print("done")
