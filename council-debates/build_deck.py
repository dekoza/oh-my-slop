#!/usr/bin/env python3
"""Build an HTML presentation deck from council debate JSON files."""

import json
import os
import html
import re

DEBATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(DEBATES_DIR, "council-deck.html")

def load_debates():
    debates = []
    for fname in sorted(os.listdir(DEBATES_DIR)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(DEBATES_DIR, fname)
        with open(path) as f:
            data = json.load(f)
        debates.append(data)
    return debates

def escape(text):
    return html.escape(text)

def paragraphs(text):
    """Convert markdown-style text with paragraphs into HTML."""
    text = escape(text)
    # Split on double newlines into paragraphs
    parts = re.split(r'\n\s*\n', text)
    result = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Handle bullet points
        if part.startswith('- ') or part.startswith('* '):
            items = part.split('\n')
            li = []
            for item in items:
                item = item.strip()
                if item.startswith('- ') or item.startswith('* '):
                    li.append(item[2:])
                elif item:
                    li.append(item)
            result.append('<ul>' + ''.join(f'<li>{i}</li>' for i in li) + '</ul>')
        else:
            # Replace single newlines with <br>
            part = part.replace('\n', '<br>\n')
            result.append(f'<p>{part}</p>')
    return '\n'.join(result)

def build_deck(debates):
    total = len(debates)

    # Build table of contents
    toc_items = []
    for i, d in enumerate(debates):
        name = d.get("skill_name", "unknown")
        first_step = d.get("chairman_verdict", {}).get("first_step", "")
        toc_items.append(f'''
        <a href="#slide-{i+1}" class="toc-item">
            <span class="toc-num">{i+1}</span>
            <span class="toc-name">{escape(name)}</span>
            <span class="toc-first">{escape(first_step[:80])}{"..." if len(first_step) > 80 else ""}</span>
        </a>''')

    # Build slides
    slides = []
    for i, d in enumerate(debates):
        name = d.get("skill_name", "unknown")
        path = d.get("skill_path", "")
        question = d.get("framed_question", "")

        # Advisors
        advisor_cards = []
        for adv in d.get("advisors", []):
            aname = adv.get("name", "")
            aresp = adv.get("response", "")
            advisor_cards.append(f'''
            <div class="advisor-card">
                <div class="advisor-header">
                    <span class="advisor-icon">{get_advisor_icon(aname)}</span>
                    <span class="advisor-name">{escape(aname)}</span>
                </div>
                <div class="advisor-body">{paragraphs(aresp)}</div>
            </div>''')

        # Peer reviews
        review_cards = []
        for j, rev in enumerate(d.get("peer_reviews", [])):
            rname = rev.get("reviewer", f"Reviewer {j+1}")
            strongest = rev.get("strongest", "")
            blind_spot = rev.get("biggest_blind_spot", "")
            missed = rev.get("what_all_missed", "")
            review_cards.append(f'''
            <div class="review-card">
                <div class="review-header">{escape(rname)}</div>
                <div class="review-section">
                    <span class="review-label strongest">Strongest</span>
                    <p>{paragraphs(strongest)}</p>
                </div>
                <div class="review-section">
                    <span class="review-label blind-spot">Biggest Blind Spot</span>
                    <p>{paragraphs(blind_spot)}</p>
                </div>
                <div class="review-section">
                    <span class="review-label missed">What All Missed</span>
                    <p>{paragraphs(missed)}</p>
                </div>
            </div>''')

        # Chairman verdict
        verdict = d.get("chairman_verdict", {})
        agrees = verdict.get("agrees", "")
        clashes = verdict.get("clashes", "")
        blind_spots = verdict.get("blind_spots", "")
        recommendation = verdict.get("recommendation", "")
        first_step = verdict.get("first_step", "")

        slides.append(f'''
        <section class="slide" id="slide-{i+1}">
            <div class="slide-header">
                <span class="slide-number">{i+1} / {total}</span>
                <h1 class="slide-title">{escape(name)}</h1>
                <p class="slide-path">{escape(path)}</p>
            </div>

            <div class="slide-section question-section">
                <h2>Framed Question</h2>
                <blockquote class="question">{escape(question)}</blockquote>
            </div>

            <div class="slide-section">
                <h2>5 Advisors</h2>
                <div class="advisors-grid">
                    {''.join(advisor_cards)}
                </div>
            </div>

            <div class="slide-section">
                <h2>5 Peer Reviews</h2>
                <div class="reviews-grid">
                    {''.join(review_cards)}
                </div>
            </div>

            <div class="slide-section verdict-section">
                <h2>Chairman's Verdict</h2>
                <div class="verdict-grid">
                    <div class="verdict-card agrees">
                        <h3>Where the Council Agrees</h3>
                        {paragraphs(agrees)}
                    </div>
                    <div class="verdict-card clashes">
                        <h3>Where the Council Clashes</h3>
                        {paragraphs(clashes)}
                    </div>
                    <div class="verdict-card blind-spots">
                        <h3>Blind Spots Caught</h3>
                        {paragraphs(blind_spots)}
                    </div>
                    <div class="verdict-card recommendation">
                        <h3>The Recommendation</h3>
                        {paragraphs(recommendation)}
                    </div>
                    <div class="verdict-card first-step">
                        <h3>First Step</h3>
                        {paragraphs(first_step)}
                    </div>
                </div>
            </div>

            <div class="slide-nav">
                <a href="#slide-{i}" class="nav-prev" {'style="visibility:hidden"' if i == 0 else ''}>&larr; Previous</a>
                <a href="#toc" class="nav-toc">Table of Contents</a>
                <a href="#slide-{i+2}" class="nav-next" {'style="visibility:hidden"' if i == total - 1 else ''}>Next &rarr;</a>
            </div>
        </section>''')

    # Full HTML
    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Oh-My-Slop Council Debates — {total} Skills</title>
<style>
:root {{
    --bg: #0f0f14;
    --surface: #1a1a24;
    --surface2: #222230;
    --border: #2a2a3a;
    --text: #e0e0e8;
    --text-dim: #8888a0;
    --accent: #7c6ff7;
    --accent2: #ff6b9d;
    --accent3: #4ecdc4;
    --warn: #ffb347;
    --danger: #ff6b6b;
    --success: #51cf66;
    --agree: #4ecdc4;
    --clash: #ff6b9d;
    --blind: #ffb347;
}}

* {{ margin: 0; padding: 0; box-sizing: border-box; }}

body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    overflow-x: hidden;
}}

/* Table of Contents */
#toc {{
    position: fixed;
    top: 0;
    left: 0;
    width: 320px;
    height: 100vh;
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    z-index: 100;
    padding: 20px 0;
}}

#toc h2 {{
    padding: 0 20px 16px;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
}}

.toc-item {{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 20px;
    text-decoration: none;
    color: var(--text);
    font-size: 13px;
    transition: background 0.15s;
}}

.toc-item:hover {{
    background: var(--surface2);
}}

.toc-num {{
    background: var(--accent);
    color: white;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
}}

.toc-name {{
    font-weight: 600;
    flex-shrink: 0;
    min-width: 90px;
}}

.toc-first {{
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}}

/* Main content */
main {{
    margin-left: 320px;
    min-height: 100vh;
}}

/* Slides */
.slide {{
    min-height: 100vh;
    padding: 60px 80px 40px;
    border-bottom: 1px solid var(--border);
    scroll-margin-top: 0;
}}

.slide-header {{
    margin-bottom: 40px;
    padding-bottom: 24px;
    border-bottom: 2px solid var(--accent);
}}

.slide-number {{
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--accent);
    font-weight: 700;
}}

.slide-title {{
    font-size: 42px;
    font-weight: 800;
    margin: 8px 0 4px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}}

.slide-path {{
    font-size: 12px;
    color: var(--text-dim);
    font-family: monospace;
}}

/* Sections */
.slide-section {{
    margin-bottom: 40px;
}}

.slide-section h2 {{
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-dim);
    margin-bottom: 20px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
}}

/* Question */
.question {{
    font-size: 18px;
    font-style: italic;
    color: var(--text);
    border-left: 4px solid var(--accent);
    padding: 16px 24px;
    background: var(--surface);
    border-radius: 0 8px 8px 0;
    line-height: 1.7;
}}

/* Advisors */
.advisors-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}}

.advisor-card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    transition: border-color 0.2s;
}}

.advisor-card:hover {{
    border-color: var(--accent);
}}

.advisor-header {{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    background: var(--surface2);
    border-bottom: 1px solid var(--border);
}}

.advisor-icon {{
    font-size: 22px;
}}

.advisor-name {{
    font-weight: 700;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}

.advisor-body {{
    padding: 16px 18px;
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--text);
}}

.advisor-body p {{
    margin-bottom: 10px;
}}

.advisor-body ul {{
    margin: 8px 0;
    padding-left: 20px;
}}

.advisor-body li {{
    margin-bottom: 4px;
}}

/* Reviews */
.reviews-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}}

.review-card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 18px;
    font-size: 13px;
    line-height: 1.65;
}}

.review-header {{
    font-weight: 700;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent3);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
}}

.review-section {{
    margin-bottom: 10px;
}}

.review-section:last-child {{
    margin-bottom: 0;
}}

.review-label {{
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 2px 8px;
    border-radius: 4px;
    margin-bottom: 6px;
}}

.review-label.strongest {{
    background: rgba(78, 205, 196, 0.15);
    color: var(--agree);
}}

.review-label.blind-spot {{
    background: rgba(255, 179, 71, 0.15);
    color: var(--blind);
}}

.review-label.missed {{
    background: rgba(255, 107, 157, 0.15);
    color: var(--clash);
}}

.review-section p {{
    color: var(--text);
}}

/* Verdict */
.verdict-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}}

.verdict-card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 22px;
    font-size: 13.5px;
    line-height: 1.7;
}}

.verdict-card h3 {{
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
}}

.verdict-card.agrees h3 {{ color: var(--agree); }}
.verdict-card.clashes h3 {{ color: var(--clash); }}
.verdict-card.blind-spots h3 {{ color: var(--blind); }}
.verdict-card.recommendation h3 {{ color: var(--accent); }}
.verdict-card.first-step h3 {{ color: var(--accent3); }}

.verdict-card.first-step {{
    grid-column: 1 / -1;
    background: linear-gradient(135deg, rgba(78, 205, 196, 0.08), rgba(124, 111, 247, 0.08));
    border-color: var(--accent3);
}}

.verdict-card p {{
    margin-bottom: 8px;
}}

/* Navigation */
.slide-nav {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
}}

.slide-nav a {{
    color: var(--accent);
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 6px;
    transition: background 0.15s;
}}

.slide-nav a:hover {{
    background: var(--surface2);
}}

/* Responsive */
@media (max-width: 1200px) {{
    .advisors-grid, .reviews-grid, .verdict-grid {{
        grid-template-columns: 1fr;
    }}
    .verdict-card.first-step {{
        grid-column: auto;
    }}
}}

@media (max-width: 900px) {{
    #toc {{
        width: 260px;
    }}
    main {{
        margin-left: 260px;
    }}
    .slide {{
        padding: 40px 30px 30px;
    }}
    .slide-title {{
        font-size: 28px;
    }}
}}

/* Scrollbar */
::-webkit-scrollbar {{
    width: 6px;
}}

::-webkit-scrollbar-track {{
    background: var(--bg);
}}

::-webkit-scrollbar-thumb {{
    background: var(--border);
    border-radius: 3px;
}}

::-webkit-scrollbar-thumb:hover {{
    background: var(--text-dim);
}}

/* Print */
@media print {{
    #toc {{ display: none; }}
    main {{ margin-left: 0; }}
    .slide {{ page-break-after: always; }}
    .slide-nav {{ display: none; }}
}}
</style>
</head>
<body>

<nav id="toc">
    <h2>Council Debates &mdash; {total} Skills</h2>
    {''.join(toc_items)}
</nav>

<main>
    {''.join(slides)}
</main>

</body>
</html>'''

    with open(OUTPUT_FILE, 'w') as f:
        f.write(html_content)

    print(f"Built {OUTPUT_FILE} with {total} debates")
    print(f"File size: {os.path.getsize(OUTPUT_FILE) / 1024:.0f} KB")

def get_advisor_icon(name):
    icons = {
        "The Contrarian": "🔴",
        "The First Principles Thinker": "🔵",
        "The Expansionist": "🟢",
        "The Outsider": "🟡",
        "The Executor": "🟠",
    }
    return icons.get(name, "⚪")

if __name__ == "__main__":
    debates = load_debates()
    build_deck(debates)
