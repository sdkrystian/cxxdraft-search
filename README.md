# cxxdraft-search

A static clone of [eel.is/c++draft](https://eel.is/c++draft/) with two extra search modes on top of the usual browse:

1. **Keyword** -- instant client-side full-text search via [Pagefind](https://pagefind.app)
2. **Semantic** -- LLM-powered retrieval via Bring-Your-Own-Key calls to [OpenRouter](https://openrouter.ai) (HyDE expansion + Pagefind candidates + LLM rerank)
3. **Ask** -- RAG-style question answering, same pipeline + a streamed answer with inline `[abbr#N]` citations that link back into the standard

The HTML pages themselves are produced by the upstream Haskell tool [`cxxdraft-htmlgen`](https://github.com/Eelis/cxxdraft-htmlgen) from the LaTeX sources at [`Eelis/draft`](https://github.com/Eelis/draft) (the `cxxdraft-htmlgen-fixes` branch recommended by the upstream README). No backend is hosted by this project: all LLM calls happen directly from the visitor's browser using their own OpenRouter key.

## Live site

When deployed via the included GitHub Actions workflow, the site lives at:

```
https://<owner>.github.io/cxxdraft-search/
```

## How the search modes work

- **Keyword**: Pagefind indexes the generated HTML at build time. Queries run entirely in-browser with no API call.
- **Semantic**: the LLM (via OpenRouter) writes a 1-2 sentence "hypothetical paragraph" in standardese (HyDE). That paragraph is fed into Pagefind to broaden recall, then the LLM reranks the top candidates against the original query.
- **Ask**: Same retrieval pipeline, then a larger model streams an answer that cites every claim with `[abbr#N]` tokens. The UI rewrites those tokens into anchor links pointing into the actual standard pages as they stream in.

The visitor's API key is kept in `localStorage` only and posted directly to `openrouter.ai` (with optional `HTTP-Referer` and `X-Title: cxxdraft-search` for OpenRouter's leaderboards). Get a key at <https://openrouter.ai/keys>.

Defaults are `openrouter/free` for both retrieval and answer models, which auto-routes to free models (DeepSeek R1, Llama, Qwen, ...) with no credit card required. Users can swap in any model from <https://openrouter.ai/models>, e.g. `anthropic/claude-sonnet-4-5`, `google/gemini-2.5-pro`, `openai/gpt-5.2`, or pin a specific free variant with `:free` (e.g. `deepseek/deepseek-r1:free`).

## Local build

You need Haskell `stack`, Node 20+, Graphviz, and (for `cxxdraft-htmlgen`) the `mathjax-node` and `split` npm packages.

```bash
git clone --recurse-submodules https://github.com/<owner>/cxxdraft-search
cd cxxdraft-search
make deps
make
make serve     # local static preview of dist/
```

The full pipeline:

| Step                  | What it does                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `make html`           | Runs `cxxdraft-htmlgen` against `vendor/draft` and copies the result into `dist/`         |
| `make assets`         | Copies `web/search.{css,js}` to `dist/`                                                   |
| `make inject`         | Walks every HTML page, injects the search trigger and Pagefind metadata                   |
| `make section-index`  | Emits `dist/search/sections.json` (abbr, breadcrumb, title) for client-side use           |
| `make pagefind`       | Builds the Pagefind FTS index into `dist/pagefind/`                                       |

The Haskell build is the long pole; first run is roughly an hour because MathJax rendering is single-threaded.

## Continuous deployment

`.github/workflows/build.yml` runs the same pipeline on Ubuntu 22.04, caches the stack build, and publishes `dist/` to GitHub Pages via `actions/deploy-pages`. A daily cron keeps the site in sync with the upstream LaTeX `cxxdraft-htmlgen-fixes` branch.

No API key secrets are required at build time -- Semantic and Ask search use the visitor's own OpenRouter key at runtime.

## Repository layout

```
.
├── Makefile
├── package.json
├── tools/
│   ├── extract.mjs           # cheerio helpers shared by the other scripts
│   ├── inject.mjs            # adds the search trigger and Pagefind tags to every page
│   └── section-index.mjs     # emits dist/search/sections.json
├── web/
│   ├── search.css
│   └── search.js             # Pagefind glue + OpenRouter provider + HyDE/rerank/Q&A flows
├── vendor/                   # git submodules
│   ├── cxxdraft-htmlgen/
│   └── draft/                # Eelis/draft on the cxxdraft-htmlgen-fixes branch
└── .github/workflows/build.yml
```

## License

The site content is the C++ working draft. The tooling in this repository is released under the same terms as upstream `cxxdraft-htmlgen` (public domain).
