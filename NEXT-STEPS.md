# 🏮 Lantern — Next steps

Arbejdsdokument til de kommende opgaver. Åbn på Windows efter `git pull`.
Afkryds (`[x]`) efterhånden. Rytme: **byg → test → commit + push** pr. opgave.

> **Status lige nu:** 9 funktionelle områder live (Chat · Agent · Research ·
> Compare · Documents · Notes · Tasks · Memory · Settings). 37/37 backend-tests
> grønne, web build ren, desktop-pakning (Tauri + Python-sidecar) bevist.
> Alt på `origin/main`.

---

## ⚙️ Først på Windows (engangs-setup)
- [ ] **Flyt repoet væk fra iCloud-`~/Desktop`** (det evicterede mappen og brød alt på Mac'en). Fx `move %USERPROFILE%\Desktop\minai\lantern %USERPROFILE%\dev\lantern`.
- [ ] `git pull` — hent alt arbejde.
- [ ] Frontend deps: `cd apps/web && npm install`
- [ ] Backend venv: `cd apps/api && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt`
- [ ] Lav `.env`: `copy .env.example .env` → tilføj din provider-nøgle (Groq virker)
- [ ] Kør: API `cd apps/api && .venv\Scripts\uvicorn main:app --port 8000` + web `cd apps/web && npm run dev`
- [ ] Verificér: `cd apps/api && .venv\Scripts\pytest` (37 grønne)

---

## 1. Polér det eksisterende (ingen credentials)
- [ ] **Markdown-rendering** i chat + research-rapporter (kodeblokke, lister, overskrifter)
- [ ] **Stop-knap** i chat (afbryd en streaming-besked)
- [ ] **RAG-til/fra-toggle** i chat-headeren (så man kan slå kontekst fra pr. samtale)
- [ ] **Embeddings-provider-helper** i Settings (vælg/test en `/embeddings`-capable provider til RAG)
- [ ] Fjern **Turbopack lockfile-advarsel** (sæt `turbopack.root` i `next.config.ts`, eller fjern den løse `~/package-lock.json`)
- [ ] Små UX-ting: tom-tilstande, fejl-toasts, tastatur-genveje

## 2. Desktop-polish + Windows `.exe`
- [ ] **Byg Windows-`.exe` lokalt** (på Windows-maskinen):
  - [ ] `cd apps\api` → `.venv\Scripts\pip install pyinstaller` → `.venv\Scripts\pyinstaller lantern-api.spec`
  - [ ] Kopiér `dist\lantern-api.exe` → `apps\desktop\src-tauri\binaries\lantern-api-x86_64-pc-windows-msvc.exe`
  - [ ] `cd apps\web` → `set NEXT_PUBLIC_LANTERN_API_URL=http://127.0.0.1:8000 && npm run build`
  - [ ] `cd apps\desktop && npm install && npm run build` → `.exe` + `.msi` i `src-tauri\target\release\bundle\`
  - [ ] Krav: Rust (MSVC) + Visual Studio C++ Build Tools + WebView2
- [ ] **Validér build-CI'en** (`.github/workflows/desktop-build.yml`) ved at pushe et tag: `git tag v0.1.0 && git push --tags` → bygger mac/win/linux + draft-release
- [ ] **Hurtigere sidecar-start** (skift PyInstaller `--onefile` → `--onedir`; nu ~15-18s cold start)
- [ ] **Splash/"starter…"-skærm** mens sidecar booter
- [ ] **Code signing / notarization** (kræver certifikat — se nedenfor)

## 3. Flere AI-funktioner (kan bygges uden credentials)
- [ ] **Web search i Research** — kræver en search-API-nøgle (Brave/Tavily/Serp). Sæt en `web_search`-tool ind i agenten + research-pipelinen.
- [ ] **Chat-historik-søgning** (søg på tværs af sessioner)
- [ ] **Eksport** (gem chat/research-rapport som .md/.pdf)
- [ ] **Prompt-bibliotek / gemte prompts**

---

## 🔒 Parkeret — kræver DIG (credentials / certifikater / tungt)
- [ ] **Email (IMAP/SMTP + AI-triage)** — dine kontooplysninger. Bygges når du giver dem.
- [ ] **Calendar (CalDAV)** — dine kontooplysninger.
- [ ] **Cookbook (hardware-aware model serving)** — tungt; design-beslutninger.
- [ ] **Image editor** — tungt.
- [ ] **Code signing:** Windows Authenticode-cert + macOS Developer ID — så installerne ikke advarer brugeren.

---

## 📌 Noter
- **Provider:** Chat/Agent/Compare/Research virker live mod din Groq-nøgle. RAG-*indexering* kræver en provider med `/embeddings` (Groq har det ikke nødvendigvis — overvej Gemini free eller lokal Ollama-embeddings).
- **Sikker git-rutine (2 maskiner):** altid `git pull` før arbejde, aldrig force-push.
- **Verifikation pr. opgave:** `pytest` (backend) + `npm run build` (frontend) skal være grønne før commit.
- Fuld oversigt over nattens arbejde: se `MORNING-REPORT.md`. Desktop-arkitektur: `apps/desktop/README.md`.
