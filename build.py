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
courses = load("courses")

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&'
    'family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap" rel="stylesheet">'
)


def image_size(path, default=(400, 500)):
    """Intrinsic pixel size of a JPEG or PNG, read from its header.

    Used only for the portrait's width/height attributes, which reserve the right
    box while the image loads. Stdlib only, so build.py still needs just pyyaml.
    """
    try:
        with open(path, "rb") as f:
            head = f.read(24)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
            if head[:2] != b"\xff\xd8":
                return default
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
                # SOF0..SOF15, skipping the non-frame markers in that range
                if marker[0] in range(0xC0, 0xD0) and marker[0] not in (0xC4, 0xC8, 0xCC):
                    f.read(3)
                    h = int.from_bytes(f.read(2), "big")
                    w = int.from_bytes(f.read(2), "big")
                    return w, h
                size = int.from_bytes(f.read(2), "big")
                if size < 2:
                    return default
                f.seek(size - 2, 1)
    except (OSError, ValueError):
        return default


def rel(url, base):
    """Prefix a site-relative URL so it resolves from a page nested in a subdirectory."""
    if not base or url.startswith(("http://", "https://", "mailto:", "#", "/")):
        return url
    return base + url


def masthead(active, base=""):
    """Top bar: brand on the left, section nav on the right, on every page."""
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
    <a class="brand" href="{rel("index.html", base)}" aria-label="Home">
      <img src="{rel("assets/img/trail-mark.svg", base)}" alt="TRAIL Lab shield" width="120" height="150">
      <span class="brand__txt">
        <span class="brand__name">{site['name']}</span>
        <span class="brand__zh">唐瑞祥</span>
      </span>
    </a>
    <nav class="site" aria-label="Sections"><ul>{nav}</ul></nav>
  </div>
</header>"""


def identity():
    """Portrait and contact details. Only the home page carries this."""
    portrait = ""
    if os.path.exists(ROOT / site["photo"]):
        pw, ph = image_size(ROOT / site["photo"])
        portrait = (
            f'<img class="ident__portrait" src="{site["photo"]}" '
            f'alt="Portrait of {site["name"]}" width="{pw}" height="{ph}">'
        )
    links = "".join(f'<a href="{l["url"]}">{l["label"]}</a>' for l in site["links"])
    return f"""<div class="ident">
  {portrait}
  <div class="ident__body">
    <p class="ident__role"><strong>{site['role']}</strong><br>
      {site['department']}<br>
      {site['institution']}<br>
      {site['address']}<br>
      <a href="mailto:{site['email']}">{site['email']}</a></p>
    <div class="ident__links">{links}</div>
  </div>
</div>"""


def site_footer(base=""):
    """The contact block the left rail used to carry, on every page."""
    links = "".join(
        f'<a href="{rel(l["url"], base)}">{l["label"]}</a>' for l in site["links"]
    )
    return f"""<footer class="page">
  <div class="foot">
    <p class="foot__who"><strong>{site['name']}</strong><br>
      {site['role']}, {site['department']}<br>
      {site['institution']}<br>
      {site['address']}<br>
      <a href="mailto:{site['email']}">{site['email']}</a></p>
    <div class="foot__links">{links}</div>
  </div>
  <p class="foot__legal">{site['name']} · {site['lab']} · {site['institution']}</p>
</footer>"""


def page(filename, title, body, description="", base=""):
    desc = description or f"{site['name']}, {site['role']}, {site['institution']}."
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
<link rel="icon" href="{rel("assets/img/favicon.svg", base)}" type="image/svg+xml">
{FONTS}
<link rel="stylesheet" href="{rel("assets/css/style.css", base)}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{masthead(filename, base)}
<div class="wrap">
<main id="main">
{body}
</main>
</div>
{site_footer(base)}
</body>
</html>
"""
    out = ROOT / filename
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
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

    body = f"""{identity()}
<p class="eyebrow">{site['lab']}</p>
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
{blocks}
{f'<div class="callout"><p>{joining}</p></div>' if joining else ''}"""
    page("group.html", f"Group · {site['name']}", body)


# ---------------------------------------------------------------- teaching

def course_href(slug):
    return f"teaching/{slug}/"


def build_teaching():
    rows = ""
    for c in teaching["courses"]:
        name = (
            f'<a href="{course_href(c["page"])}">{c["title"]}</a>'
            if c.get("page") else c["title"]
        )
        rows += (
            f'<li><span class="k">{c["term"]}</span>'
            f'<span>{name}<span class="code">{c["code"]}</span></span></li>'
        )
    rg = teaching["reading_group"]
    rg_title = (
        f'<a href="{course_href(rg["page"])}">{rg["title"]}</a>'
        if rg.get("page") else rg["title"]
    )
    body = f"""<h1>Teaching</h1>
<h2>Courses</h2>
<ul class="stack">{rows}</ul>
<h2>Reading group</h2>
<p><strong>{rg_title}</strong></p>"""
    page("teaching.html", f"Teaching · {site['name']}", body)


# ---------------------------------------------------------------- course pages

def build_courses():
    """One page per course and for the reading group, at the original public URL."""
    for c in courses:
        base = "../../"
        parts = []
        if c.get("facts"):
            items = "".join(f"<li>{f}</li>" for f in c["facts"])
            parts.append(f'<ul class="facts">{items}</ul>')
        for sec in c.get("sections", []):
            paras = "".join(f"<p>{p}</p>" for p in sec["paras"])
            head = "" if sec["heading"] == "About" else f'<h2>{sec["heading"]}</h2>'
            parts.append(head + paras)
        sched = c.get("schedule")
        if sched:
            head = "".join(f"<th>{col}</th>" for col in sched["columns"])
            body_rows = ""
            for row in sched["rows"]:
                cells = ""
                for cell in row:
                    inner = "".join(f"<p>{p}</p>" for p in cell)
                    cells += f"<td>{inner}</td>"
                # short rows (a cancelled week) still need to span the table
                missing = len(sched["columns"]) - len(row)
                cells += "<td></td>" * max(0, missing)
                body_rows += f"<tr>{cells}</tr>"
            parts.append(
                f'<h2>{sched["heading"]}</h2>'
                '<div class="tablewrap"><table class="sched">'
                f"<thead><tr>{head}</tr></thead><tbody>{body_rows}</tbody></table></div>"
            )
        crumb = f'<p class="crumb"><a href="{base}teaching.html">Teaching</a></p>'
        body = crumb + f'<h1>{c["heading"]}</h1>' + "".join(parts)
        page(
            f"teaching/{c['slug']}/index.html",
            f"{c['title']} · {site['name']}",
            body,
            f"{c['title']} at Rutgers, taught by {site['name']}."
            if c.get("term") else f"{c['title']}, organized at Rutgers.",
            base=base,
        )


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
    urls += [f"teaching/{c['slug']}/" for c in courses]
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
    build_courses()
    build_awards()
    build_blog()
    build_misc()
    build_redirects()
    build_sitemap()
    print("done")
