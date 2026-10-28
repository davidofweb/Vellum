# Vellum — Gateway Catalog Sync for AgentRouter & GPT-6 Sol / Astra Support

When `GET /v1/models` on `agentrouter.org/v1` connects cleanly yet returns an empty list (`0 models`), Vellum will automatically query the gateway's secondary catalog routes (such as `/api/pricing`, `/api/models`, `/api/available_model`, and `/api/user/models`) to load Group 1 OpenAI models including `gpt-6-astra`, `gpt-6.1-sol`, and `gpt-5.4-sol`, with full support for live testing and real-time streaming.

## User Review & Critical Decisions

> [!IMPORTANT]
> Your Phase 1 answers pinpointed why `agentrouter.org/v1` returned `0 models` and which OpenAI models your key uses. Please review the confirmed plan below and click **Proceed** when ready.

- **Confirmed Decision 1 — Secondary Gateway Catalog Discovery**: When `/v1/models` returns `0 models`, Vellum will automatically fall back to querying the gateway's catalog routes (`/api/pricing`, `/api/models`, `/api/available_model`, and `/api/user/models`) on the same domain and extract both `model_name` entries and grouped channel arrays (such as Group `1`).
- **Confirmed Decision 2 — GPT-6 Astra & Sol Model Compatibility (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-5.4-sol`)**: Live model testing and real-time chat streaming will recognize the GPT-6 and Sol/Astra families, routing smoothly across OpenAI `/v1/responses` and `/v1/chat/completions` while omitting unsupported legacy parameters (`temperature` / `max_tokens`) that cause 400 errors.
- **Confirmed Decision 3 — Flexible Tokenized Model Search & Zero Inbuilt Models**: All models continue to come strictly from your live gateway catalog (never hardcoded fallback lists), and searching `"6.1 sol"`, `"gpt 6 astra"`, or `"5.4 sol"` in the model picker will match hyphenated IDs like `gpt-6.1-sol`, `gpt-6-astra`, and `gpt-5.4-sol`.

## 1. Overview & Core Concept

- **What It Does**: Connects to your manually saved Base API URL (`https://agentrouter.org/v1`) and personal API key, discovers your full gateway model catalog even when `/v1/models` returns an empty `data: []` array, lets you test latency on individual models (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-5.4-sol`), and streams responses in real time.
- **Target Audience / Persona**: Mobile and desktop builders connecting AgentRouter and OpenAI keys to run coding, reasoning, and writing tasks in a fast, clean workspace.
- **Key Value**: Eliminates the false `"0 models were returned"` dead-end on gateways where model catalogs live on `/api/pricing` or grouped channel maps instead of `/v1/models`.

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Automatic Multi-Route Catalog Sync**: After saving `https://agentrouter.org/v1` and your key (or tapping **Sync**), Vellum checks `/v1/models` first; if that route returns `0 models`, it immediately checks `/api/pricing`, `/api/models`, `/api/available_model`, and `/api/user/models` on the gateway origin before finishing.
  2. **Smart Model Search & Selection**: Opening **API & Models** displays all synced models from Group `1` and other active groups on your gateway. Typing space-separated terms like `6.1 sol`, `5.4 sol`, or `gpt 6 astra` matches `gpt-6.1-sol`, `gpt-5.4-sol`, and `gpt-6-astra` right away.
  3. **Live Model Testing & Real-Time Streaming**: Tapping **Test** next to `gpt-6.1-sol` or `gpt-6-astra` sends a lightweight live check across OpenAI Responses (`/v1/responses`) and Chat Completions (`/v1/chat/completions`), reporting exact millisecond response times. Sending a message streams reasoning thoughts and output smoothly.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Minimalist Optimus editorial layout preserved intact with zero extra clutter or unrequested features.
  - *Color Palette & Mood*: Warm stone daylight mode (`--background: #fafaf9`, `--foreground: #080503`) and deep espresso dark mode (`--background: #080503`, `--foreground: #fafaf9`) with instant Light/Dark switching and hairline borders.
  - *Typography & Hierarchy*: Crisp, thick iPhone-grade font weights (`font-medium` / `font-semibold`) for clear readability on small screens, paired with `tabular-nums` monospace metrics for model IDs and millisecond test timings.
  - *Component Styling & Layout*: Mobile-first layout (`375px–430px` up to `1440px` desktop), minimum `44x44px` touch hitboxes on all interactive buttons and rows, safe-area bottom spacing (`pb-safe`), and sticky top/bottom bars kept compact within the 15% mobile viewport cap.
- **Interactive Feedback & Motion**: Smooth 150–200ms opacity/transform transitions, clear inline spinner states during catalog sync and model pings, and plain-language status notices.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Cascading Catalog Lookup When `/v1/models` Is Empty**:
  - *Chosen Approach*: Treat an HTTP 200 response with `0 models` on `/v1/models` as an incomplete result rather than the final answer, automatically cascading through the gateway's origin catalog endpoints (`/api/pricing`, `/api/models`, `/api/available_model`, `/api/user/models`) via the backend proxy with CLI headers and firewall cookie handling.
  - *Why*: New API gateways like `agentrouter.org` frequently return `{"data": []}` on `/v1/models` while serving the full active catalog (including `model_name: "gpt-6.1-sol"`, `"gpt-6-astra"`, and `"gpt-5.4-sol"`) at `/api/pricing` or grouped channel maps at `/api/models`.
  - *Alternatives Considered*: Hardcoding static model lists was rejected because all models must come live from the user's connected gateway.
- **Decision 2 — Deep Schema Extraction (`model_name` & Grouped Channel Arrays)**:
  - *Chosen Approach*: Upgrade the catalog parser to extract `model_name` objects (standard in `/api/pricing`) and flatten group-to-array maps such as `{ "1": ["gpt-6-astra", "gpt-6.1-sol", "gpt-5.4-sol"] }` (standard in `/api/models`) instead of mistaking group keys like `"1"` for model IDs.
  - *Why*: Ensures every model published by the gateway catalog appears cleanly with its real model ID and provider label.
  - *Alternatives Considered*: Parsing only OpenAI's `{ data: [{ id }] }` format was rejected because secondary catalog routes use New API's native schema.
- **Decision 3 — GPT-6 Sol & Astra Protocol Routing (`/v1/responses` + `/v1/chat/completions`)**:
  - *Chosen Approach*: Include `gpt-6`, `sol`, `astra`, `luna`, and `terra` in the reasoning/agentic model detector so `/v1/responses` is tried first (with automatic fallback to `/v1/chat/completions`), and omit unsupported `temperature` / `max_tokens` fields.
  - *Why*: On AgentRouter, Sol and Astra models commonly use `wire_api = "responses"` and reject legacy chat completion sampling parameters.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        Vellum Mobile-First Workspace                      │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐  │
│  │  Onboarding & Header │  │   API & Models Sheet │  │  Streaming Chat │  │
│  │  • Base URL Presets  │  │  • Multi-Word Search │  │  • Reasoning UI │  │
│  │  • Light/Dark Toggle │  │  • Live Latency Test │  │  • Canvas Split │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬────────┘  │
└─────────────┼─────────────────────────┼───────────────────────┼───────────┘
              │                         │                       │
              ▼                         ▼                       ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    Client Gateway & Proxy Fallback Layer                  │
│  • If browser /v1/models returns 0 models or hits CORS/WAF -> call proxy  │
└───────────────────────────────────────┬───────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│               Express Gateway Proxy (CLI Headers + WAF Solver)            │
│                                                                           │
│  1. Model Sync Cascade (/api/models):                                     │
│     ├─► GET {base}/v1/models                                              │
│     │     └─► If 0 models returned, cascade to origin catalog routes:     │
│     ├─► GET {origin}/api/pricing         (parses data[].model_name)       │
│     ├─► GET {origin}/api/models          (flattens group "1": [...] map)  │
│     ├─► GET {origin}/api/available_model (parses keyed model dictionary)  │
│     └─► GET {origin}/api/user/models     (parses string array)            │
│                                                                           │
│  2. Live Test & Stream (/api/models/test & /api/agent/stream):            │
│     ├─► GPT-6 / Sol / Astra / Codex -> POST /v1/responses first           │
│     └─► Automatic fallback          -> POST /v1/chat/completions          │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `SavedUserKey`: Stores `id`, `label`, `baseUrl`, `apiKey`, and optional `wafCookie` in browser `localStorage`.
  - `ModelOption`: Normalized `{ id, label, ownedBy, contextWindow?, endpointHint? }` parsed from OpenAI `{ data: [{ id }] }`, New API pricing `{ data: [{ model_name, enable_groups, supported_endpoint_types }] }`, or grouped channel arrays `{ data: { "1": [...] } }`.
- **Interactive Component & State Mapping**:
  - **Catalog Sync Handler**: Calls client gateway sync; if direct browser fetch returns `0 models` (or fails CORS/firewall), invokes `/api/models` on the backend proxy, which cascades across `/v1/models` and origin catalog routes until non-empty models are found, then auto-selects the user's saved model or first synced model.
  - **Tokenized Model Search**: Splits user search queries on whitespace/punctuation so typing `"6.1 sol"` or `"gpt 6 astra"` filters `models` by matching every token against `id`, `label`, and `ownedBy`.
  - **Model Test & Chat Stream Handlers**: Route `gpt-6-astra`, `gpt-6.1-sol`, and `gpt-5.4-sol` with reasoning-clean request bodies across `/v1/responses` and `/v1/chat/completions`, updating latency state (`ms`) and streaming deltas in real time.
