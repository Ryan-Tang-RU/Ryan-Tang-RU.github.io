# ruixiangtang.net

Static personal site for Ruixiang (Ryan) Tang, migrated off Google Sites. Plain HTML and CSS, no
framework, no build step on the server. GitHub Pages serves the committed `.html` files as they are.

## Layout

```
_data/*.yml        all content lives here (bio, news, publications, group, teaching, courses, awards, blog, misc)
build.py           renders the .yml files into the .html pages
assets/css/        one stylesheet
assets/img/        logo, favicon, portrait, trip photos
index.html ...     generated pages, committed to the repo
teaching/<slug>/   course and reading-group pages, at their original Google Sites URLs
home/ publications/ ...  redirect stubs so old Google Sites URLs keep working
CNAME              custom domain
```

## Editing

Add a paper, a student, or a news item by editing the matching file in `_data/`, then:

```bash
pip install pyyaml        # once
python build.py
git add -A && git commit -m "add EMNLP paper" && git push
```

The site is live about a minute later. If you would rather not run the script, editing an `.html`
file directly works too, but the next `build.py` run overwrites it, so put lasting changes in `_data/`.

Adding a publication looks like this:

```yaml
- title: "Title of the paper"
  url: https://arxiv.org/abs/2601.00000     # optional
  authors: First Author, Second Author, Ruixiang Tang
  venue: Conference on Language Modeling, COLM 2027
  note: Oral                                 # optional badge
```

Your name is bolded automatically wherever it appears in `authors`.

## Images to add

Google Sites stores images on `lh3.googleusercontent.com` behind signed URLs, so they cannot be
copied over programmatically. Download them from the Google Sites editor and drop them in
`assets/img/` under these names:

| File | Where it appears |
|---|---|
| `profile.jpg` | portrait in the left rail. Delete the file and the rail simply omits it |
| `mexico-1.jpg` … `mexico-3.jpg` | Misc, Mexico |
| `nc-1.jpg` … `nc-3.jpg` | Misc, North Carolina |
| `colorado-1.jpg` … `colorado-3.jpg` | Misc, Colorado |
| `utah-1.jpg` … `utah-3.jpg` | Misc, Utah |

`build.py` only renders a gallery for photos that actually exist, so missing files leave no broken
images. Resize anything wider than about 1600px before committing.

The TRAIL logo files (`trail-mark.svg`, `trail-logo.svg`, `favicon.svg`) are already in place.

## Deploying into Ryan-Tang-RU.github.io

The target repo already has three files: `index.html` (the blog index), `emdash.html`, and
`probe.html`. Copy everything from this bundle into the repo root. Exactly one file collides.

**`index.html` collides.** The new homepage takes that name, and `blog.html` replaces the old blog
index, so the old `index.html` is no longer needed. Delete it rather than keeping it around:

```bash
git rm index.html                 # the old blog index
# copy this bundle's files in, then
git add -A && git commit -m "migrate site from Google Sites" && git push
```

`emdash.html` and `probe.html` stay exactly where they are. `_data/blog.yml` now links to them with
relative paths, so the Blog page points at the real files in the same repo.

**One thing to check by hand.** The two post pages may link back to the old blog index. Open each
one and make any "back" link point at `blog.html`:

```bash
grep -n 'href="index.html"' emdash.html probe.html
```

If that returns hits, change them to `blog.html`.

**Pages settings.** Settings → Pages → Source: "Deploy from a branch", branch `main`, folder
`/ (root)`. Keep `.nojekyll` in the repo so Pages serves the files directly instead of running
Jekyll over them.

**A note on look.** The two blog posts use their own warm palette with a dark mode. The site pages
use the navy TRAIL palette. They will read as two different designs sitting next to each other.
That is a defensible choice, since long-form posts often get their own treatment, but if you want
one identity across everything, the posts are the pieces to restyle, not the site.

## Pointing ruixiangtang.net at GitHub Pages

The domain is registered somewhere already (Google Domains, Squarespace, Namecheap, whoever bills
you). Change the DNS records there, not in Google Sites.

1. In the repo, Settings → Pages → Custom domain, enter `www.ruixiangtang.net`. This creates or
   updates the `CNAME` file, which is already in this bundle.
2. At your DNS provider, set:

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `www` | `ryan-tang-ru.github.io` |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |

   The four A records let the bare `ruixiangtang.net` redirect to the `www` host. If your provider
   supports ALIAS or ANAME on the apex, that works too.
3. Remove the custom domain from Google Sites first, or the old CNAME record keeps pointing at
   Google and the two fight each other.
4. Back in Settings → Pages, wait for the certificate to be issued, then tick **Enforce HTTPS**.

DNS changes take anywhere from a few minutes to a few hours. Until then `https://ryan-tang-ru.github.io`
serves the site, so you can check everything before touching DNS.

One consequence worth knowing: once the custom domain is attached to this repo, the old
`ryan-tang-ru.github.io/emdash.html` links redirect to `www.ruixiangtang.net/emdash.html`. Anything
already linking to the posts keeps working.

## Old links

Google Sites used extensionless paths such as `/publications` and `/teaching/fall-2025-massive-data-mining`.
`build.py` writes a small redirect page at each of those paths, so bookmarks, citations, and search
results land on the right page instead of a 404. Add more in the `OLD_PATHS` dictionary in
`build.py` if you find any that are missing.

The four `/teaching/...` paths are not redirects: they are the real course pages, built from
`_data/courses.yml` at exactly the URLs the old site used. Each entry carries the page heading, the
logistics box, the prose sections, and the week-by-week schedule table. Edit that file to update a
syllabus; add an entry (plus a `page:` key in `_data/teaching.yml`) to add a course.

## Local preview

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from the file system works too, though the redirect stubs behave
slightly differently there.

## What did not come across automatically

- Photos, as described above.
- The "Page updated" timestamps and the Google Sites search box. Neither has an equivalent here.
- Your CV currently links to Google Drive. Consider committing the PDF to `assets/files/cv.pdf` and
  pointing `_data/site.yml` at it, so the CV survives independently of Drive sharing settings.
