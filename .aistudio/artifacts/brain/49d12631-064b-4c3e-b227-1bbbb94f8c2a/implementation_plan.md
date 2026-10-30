# Disguised API Key Share Links

Let Vellum owners share a clean, disguised web link (`?share=vlm_...`) that lets anyone chat, switch across the full model list, and build custom roles using the owner's API connection — without the recipient ever seeing, receiving, or extracting the actual API key.

## User Review & Critical Decisions

> [!IMPORTANT]
> Your raw API key stays strictly on the server whenever a shared link is created or used. Guests opening your link only receive a disguised link code (`vlm_...`), so your key never appears in the link URL, browser storage, or network inspector.

- **Confirmed Choice — Link Controls & Limits**: Owners can set an **expiration time**, a **message limit**, and **one-tap instant revoke** on every disguised link.
- **Confirmed Choice — Guest Controls**: Anyone opening a shared link gets access to the **full synced model list** and **custom roles** (creating and switching roles freely), while the raw API key and Base API setup stay completely hidden.
- **Confirmed Choice — Link Management**: Owners get a **saved link list** showing live message usage counts (`used / limit`), expiration status, one-tap copy, and instant revoke.
- **Recommended Default — Link Storage & Owner Control**: Shared link records and live message counters are stored on the server (persisted on disk across restarts), paired with a private owner management token saved in your browser so only the browser that created a link can view its stats or revoke it.

---

## 1. Overview & Core Concept

- **What It Does**: Turns any saved API connection in Vellum into one or more shareable guest links with built-in time and message caps. When a friend, teammate, or client opens the link on mobile or desktop, Vellum opens straight into a ready-to-use workspace powered by your connection while keeping your key completely invisible.
- **Target Audience**: API key owners who want to let teammates, clients, or testers use Vellum without handing over raw credentials or risking runaway usage.
- **Key Value**: Full workspace access for guests (live streaming, thought process display, background chat runs, interactive preview drawer, full model picker, and custom roles) with total key privacy and instant cutoff control for the owner.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Creating a Disguised Link (Owner Flow)**:
   - Open the API & Models sheet and tap the new **Shared Links** tab (or tap the quick **Share** action on any saved key row).
   - Pick which saved key to disguise, add an optional friendly label (for example, `"Design Review"` or `"Client Demo"`), choose an **Expiration** preset (`1h`, `24h`, `7d`, `30d`, or `No limit`), and set a **Message Limit** (`10`, `25`, `50`, `100`, `500`, or `Unlimited`, plus custom number input).
   - Tap **Create Disguised Link**. The link is generated immediately and ready to copy in one tap (`https://<your-app>/?share=vlm_...`).

2. **Managing & Revoking Links (Owner Flow)**:
   - Below the generator, the **Saved Shared Links** list displays every disguised link you created.
   - Each row shows the link label, masked link ID, current state (`Active`, `Revoked`, `Expired`, or `Limit reached`), live message count (`12 / 50 messages`), and remaining time (`22h left`) separated cleanly with `·` dividers.
   - Tapping **Copy** copies the full share URL; tapping **Revoke** immediately blocks any further model syncs or chat requests on that link; tapping **Remove** deletes the entry from your list.

3. **Opening a Disguised Link (Guest Flow)**:
   - Opening `?share=vlm_...` bypasses the API key setup screen, verifies the disguised pass with the server, cleans the URL bar if needed, and loads the full synced model list right away.
   - Guests can chat, stream responses in the background, open HTML/SVG previews, switch across all available models, test models, and create or edit their own custom roles stored locally on their device.
   - All raw API key inputs and saved key lists are hidden. Instead, opening the connection sheet displays a clean **Shared Access Pass** view showing remaining messages, time left, and a **Use My Own API Key** button if the guest ever wants to switch to their own credentials.
   - If a link is revoked, expired, or out of messages, Vellum displays a clear, plain-language notice explaining why the pass ended, alongside a button to connect a personal key.

### Visual Identity & Theme

- **Aesthetic Direction**: Minimalist editorial workspace matching Vellum's mobile-first design — crisp hairline dividers (`1px`), generous whitespace, bold iPhone-grade font weights (`600`–`700`), and zero clutter.
- **Color Palette & Mood**: Uses Vellum's dual-theme tokens (`--background` `#fafaf9` light / `#080503` dark, `--foreground`, `--muted-foreground`, `--border`, and `--destructive` reserved strictly for revoked/expired notices and destructive actions).
- **Typography & Hierarchy**:
  - Expressive headings in `Instrument Serif` (`font-display`) with `text-wrap: balance`.
  - Thick, crisp UI controls and labels in `Instrument Sans` (`font-semibold` / `font-bold`).
  - Usage counters, disguised IDs, and countdowns in `JetBrains Mono` with `tabular-nums` so numbers align cleanly without layout shift.
- **Component Styling & Mobile Ergonomics**:
  - Bottom-sheet presentation on mobile (`375px`–`430px`) with grab handle, expanding cleanly to centered modal panels on desktop (`1440px`).
  - Every button, preset selector, copy trigger, and revoke control maintains at least a `44px` touch target (`min-h-[44px]`) and single-line `whitespace-nowrap` labels.
  - Zero static metadata pills or decorative pulsing dots — link status, message usage, and expiry render as clean inline typography separated by `·`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Held Key Vault Instead of URL-Encoded Keys**
  - *Chosen Approach*: Store the real API key, Base API URL, and optional session header exclusively on the server behind a random disguised ID (`vlm_...`). All guest model syncs, model tests, and background chat streams send only `x-vellum-share-id` to Vellum's backend, which attaches the real key server-side before talking to the upstream gateway.
  - *Why*: Putting an obscured or Base64-encoded key inside a URL or browser storage would allow anyone opening browser developer tools to read the raw key and bypass message limits or revocations. Keeping the key strictly on the server guarantees the guest never touches the key and makes instant revoke and message caps enforceable.
  - *Alternatives Considered*: Client-side scrambled links were rejected because the browser would have to unscramble the key to call the API, exposing it in network headers.

- **Decision 2: Owner Management Token Stored Locally Per Creator**
  - *Chosen Approach*: Generate a random creator token in the owner's browser (`localStorage`) and hash-match it on the server when listing or revoking shared links.
  - *Why*: Gives instant, zero-friction link management and revocation right inside your existing workspace without forcing you or your guests to create usernames and passwords.

- **Decision 3: Strict Server-Only Routing in Guest Mode**
  - *Chosen Approach*: When operating via a shared link, Vellum routes all model lists, model tests, and chat runs through the backend proxy and never falls back to direct browser-to-gateway calls.
  - *Why*: Direct browser-to-gateway calls would require sending the raw API key to the guest's browser, breaking the core rule that guests can never possess the key.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Request Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        OWNER BROWSER (Creator Mode)                        │
│  ┌──────────────────────┐   POST /api/shares   ┌────────────────────────┐  │
│  │Saved API Connection  │ ───────────────────► │  Shared Links Manager  │  │
│  │(Key + Base API URL)  │   + Creator Token    │  • Copy ?share=vlm_... │  │
│  └──────────────────────┘                      │  • Live Used / Limit   │  │
│                                                │  • One-Tap Revoke      │  │
│                                                └───────────┬────────────┘  │
└────────────────────────────────────────────────────────────┼───────────────┘
                                                             │
                                                             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     VELLUM BACKEND SHARE VAULT & PROXY                     │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Disk-Backed Share Store (Disguised ID -> Hidden Key, Expiry, Quota)  │  │
│  │  • Validates active state, expiration timestamp, & remaining quota   │  │
│  │  • Atomically increments usedMessages on each guest chat request     │  │
│  │  • Injects real Authorization header strictly inside server memory   │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┴─────────────────────────────┐
        ▼                                                           ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────┐
│     GUEST BROWSER (?share=vlm_...)    │   │   UPSTREAM MODEL GATEWAY       │
│  • Sends ONLY x-vellum-share-id       │   │   (OpenAI / AgentRouter API)   │
│  • Full Model Picker & Custom Roles   │   │   • Receives real key from     │
│  • Background Runs & Live Canvas      │   │     Vellum server only         │
│  • Raw API Key 100% Absent in Client  │   └────────────────────────────────┘
└───────────────────────────────────────┘
```

### Data Model & State

- **Server Share Record**:
  - `shareId`: Random opaque identifier (`vlm_<random>`) used in `?share=vlm_...`.
  - `ownerTokenHash`: One-way hash of the creator's browser management token so only the creator can inspect or revoke the link.
  - `label`: Friendly name chosen by the owner (for example, `"Team Link"`).
  - `baseUrl`, `apiKey`, `wafCookie`, `customModels`: Stored solely on the server and stripped from every API response.
  - `status`: `'active'` or `'revoked'`.
  - `createdAt`, `expiresAt` (`number | null`), `maxMessages` (`number | null`), `usedMessages` (`number`), and `lastUsedAt` (`number | null`).
- **Public Share Summary (Returned to Owner & Guest — Zero Secrets)**:
  - Contains only `shareId`, `label`, `status` (computed with expiry/quota checks), `createdAt`, `expiresAt`, `maxMessages`, `usedMessages`, `customModels`, and masked host label (such as `co.agentrouter.org`) — never `apiKey` or `wafCookie`.
- **Client State**:
  - **Owner State**: Persists `ownerToken` in `localStorage` and syncs the owner's created links via `GET /api/shares` whenever the Shared Links tab opens or updates.
  - **Guest State**: Detects `?share=vlm_...` on page load, stores the active `shareId` in guest session state, loads public share status (`GET /api/shares/:shareId`), syncs the full model list through `/api/models` + `/api/models/catalog` using `x-vellum-share-id`, and keeps custom roles and chat history locally on the guest's device.

### Interactive Component & State Mapping

- **Shared Links Tab (Inside Connection & Models Sheet)**:
  - *Link Builder Form*: Key selector dropdown (when multiple keys exist), label input, single-row expiration selector buttons, message limit selector buttons with custom numeric input, and submit handler (`POST /api/shares`) with loading spinner and instant copy feedback.
  - *Saved Links List*: Displays populated rows with live refresh (`GET /api/shares`), empty state prompt when no links exist yet, **Copy Link** handler with `"Copied"` confirmation, **Revoke / Restore** toggle handler (`PATCH /api/shares/:shareId`), and **Delete** handler (`DELETE /api/shares/:shareId`).
- **Quick Share Triggers**:
  - Adds a **Share** button on saved key rows so owners can jump straight into creating a disguised link for that key.
- **Guest Pass Banner & Sheet View**:
  - Compact top indicator and dedicated **Shared Access Pass** panel showing remaining messages (`tabular-nums`), expiration countdown, manual **Refresh Pass** check, and **Use My Own Key** exit handler that clears the guest pass and returns to standard personal-key mode.
- **Server Enforcement Across All Proxy Routes**:
  - Updates model sync, catalog fallback, model latency test, streaming chat, and detached background chat runs to accept `x-vellum-share-id`, enforce expiry/revocation on all endpoints, and enforce + increment `usedMessages` on chat generation endpoints while updating the guest's remaining count in real time.
