# 🏮 Lantern — Next steps

Arbejdsdokument til de kommende opgaver. Åbn på Windows efter `git pull`.
Afkryds (`[x]`) efterhånden. Rytme: **byg → test → commit + push** pr. opgave.

> **Status (2026-06-06):** 9 funktionelle områder + command palette (⌘K),
> dark/light/system-tema og global søgning. **43/43 backend-tests** grønne, web
> build ren. **Windows-installer (.exe + .msi) bygget og starter.** Alt på
> `origin/main` (tag `v0.1.0`).

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
- [x] **Markdown-rendering** i chat + research-rapporter (+ syntax highlighting)
- [x] **Stop-knap** i chat (afbryd en streaming-besked)
- [x] **RAG-til/fra-toggle** i chat-headeren
- [x] **Embeddings-provider-helper** i Settings
- [x] **Dark / light / system-tema** (toggle i sidebar-footeren, no-flash)
- [x] **Drag-and-drop** filupload i Documents
- [x] **Global søgning** (⌘K — noter/opgaver/dokumenter/memory/chats)
- [x] **Command palette** (⌘K) + ⌘/Ctrl+1-9 genveje + copy-knapper + rename/delete chats + markdown-eksport
- [x] **Turbopack lockfile-advarsel** fjernet (`turbopack.root` pinnet)
- [x] **Globale fejl-toasts** (lib/toast + Toaster; API-fejl vises app-wide)
- [x] **Deep-link** fra søgeresultater (åbner den konkrete chat/dokument)

## 2. Desktop-polish + Windows `.exe`
- [x] **Windows-`.exe` + `.msi` bygget** på Windows — app starter + spawner sidecar (verificeret). Launch-crash (ugyldig `plugins.shell.scope`) rettet.
- [x] **Splash/"starter…"-skærm** mens sidecar booter
- [ ] **Byg Windows-`.exe` lokalt** (reproducer / fremtidige builds):
  - [ ] `cd apps\api` → `.venv\Scripts\pip install pyinstaller` → `.venv\Scripts\pyinstaller lantern-api.spec`
  - [ ] Kopiér `dist\lantern-api.exe` → `apps\desktop\src-tauri\binaries\lantern-api-x86_64-pc-windows-msvc.exe`
  - [ ] `cd apps\web` → `set NEXT_PUBLIC_LANTERN_API_URL=http://127.0.0.1:8000 && npm run build`
  - [ ] `cd apps\desktop && npm install && npm run build` → `.exe` + `.msi` i `src-tauri\target\release\bundle\`
  - [ ] Krav: Rust (MSVC) + Visual Studio C++ Build Tools + WebView2
- [ ] **Validér build-CI'en** (`.github/workflows/desktop-build.yml`) ved at pushe et tag: `git tag v0.1.0 && git push --tags` → bygger mac/win/linux + draft-release
- [ ] **Hurtigere sidecar-start** (skift PyInstaller `--onefile` → `--onedir`; nu ~15-18s cold start)
- [ ] **Code signing / notarization** (kræver certifikat — se nedenfor)

## 3. Flere AI-funktioner
- [x] **Web search** (Tavily) — agent-`web_search`-tool, env-styret (sæt `LANTERN_TAVILY_API_KEY`)
- [x] **Chat-historik-søgning** (del af global ⌘K-søgning)
- [x] **Eksport** chat/research som **.md og .pdf**
- [ ] **Prompt-bibliotek / gemte prompts**
- [ ] **Web search også i Research-pipelinen** (nu kun som agent-værktøj)

---

## 🔒 Parkeret — kræver DIG (credentials / certifikater / tungt)
- [x] **Email (IMAP, read-only + AI-triage)** — bygget env-styret; aktivér med `LANTERN_IMAP_*` i `.env`. (Send er bevidst *ikke* med.)
- [x] **Calendar (CalDAV, read-only)** — bygget env-styret; aktivér med `LANTERN_CALDAV_*` i `.env`.
- [ ] **Cookbook (hardware-aware model serving)** — tungt; design-beslutninger.
- [ ] **Image editor** — tungt.
- [ ] **Code signing:** Windows Authenticode-cert + macOS Developer ID — så installerne ikke advarer brugeren.

---

## 📌 Noter
- **Provider:** Chat/Agent/Compare/Research virker live mod din Groq-nøgle. RAG-*indexering* kræver en provider med `/embeddings` (Groq har det ikke nødvendigvis — overvej Gemini free eller lokal Ollama-embeddings).
- **Sikker git-rutine (2 maskiner):** altid `git pull` før arbejde, aldrig force-push.
- **Verifikation pr. opgave:** `pytest` (backend) + `npm run build` (frontend) skal være grønne før commit.
- Fuld oversigt over nattens arbejde: se `MORNING-REPORT.md`. Desktop-arkitektur: `apps/desktop/README.md`.
