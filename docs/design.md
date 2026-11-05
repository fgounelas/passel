# Passel UI design guide

Use this guide when adding or changing UI. Match the surrounding interface and
reuse its components and CSS before introducing another control style. Update
this document when an intentional design decision changes these conventions.

## Settings

- Setup checks installed Claude Code, Codex and Antigravity CLI (`agy`) versions
  and offers explicit Install/Update actions. Use the official native installers
  (and `agy update` for Antigravity updates), serialize installers and show errors
  inline. Keep account sign-in in a new Terminal session. Only fixed CLI IDs and
  actions are accepted; never accept a URL or shell command from the browser.
- Setup checks the fixed Danus/Pharos directories and offers explicit installation
  buttons that clone their current default branches. Preserve existing files and
  repositories; no arbitrary repository URL, directory or bootstrap command is
  accepted from the browser.
- Terminal → Startup path is a server preference, defaulting to `~/work`. Apply
  text edits on Enter/blur, report directory errors inline, and persist it on the
  selected server. The bridge supplies this directory when creating sessions;
  never type `cd` into an existing terminal. Existing sessions and explicitly
  configured preset directories retain their working directories.
- Terminal → Scrolling speed adjusts touch, wheel and trackpad input (50–300%,
  default 100%). Keep scrolling momentum bounded and cancel it on new input,
  hidden pages and renderer disposal; do not buffer terminal history in the browser.

- Display → Default view selects Conversation, Terminal, or Remember last
  used (default). Persist it per browser with display preferences; apply the opening choice
  on load without switching the current view when the preference changes.

- Boolean preferences use **Off / On segmented buttons**, in that order. Do not
  use checkboxes for settings such as remembering reading position or folders.
- Reuse `BooleanSettingControl` in `web/src/BackendSettingsDialog.tsx` for new
  boolean preferences. It uses the existing `.segmented-control` styling,
  `role="group"`, an accessible group name, and `aria-pressed` on both buttons.
  `data-on` supplies the matching visual state. Buttons must have `type="button"`.
- Keep the visible setting label on the left and its control on the right using
  `.settings-row`. Give the control or group the same accessible name as the label.
- Reuse existing segmented choices for short enumerations and `.settings-select`
  for dropdown choices. Reuse the existing number/slider controls for quantities;
  keep units and reset behaviour consistent.
- Align controls across all settings areas: short menus, numeric fields, colour
  fields and Off/On groups share a 128px width and 34px height. Reserve separate
  columns for units and reset buttons so they never shift input alignment. Longer
  enumerations and action buttons can use the full 194px control column. Stack
  sliders above their numeric field. On mobile, place controls below their labels,
  retain the same field sizes, and prevent horizontal overflow.
- Connection enable switches in the Connections list are an existing exception:
  they belong to selectable connection rows and use switch semantics. Do not copy
  that row-specific pattern into general preferences.
- Apply preferences immediately and preserve them through the appropriate browser
  preference store. Avoid adding a Save button to an otherwise immediate panel.
- Put document behaviour in Documents, panel layout in Display, and terminal
  transport/batching in the collapsed Advanced section of Terminal.
- Use plain labels such as “Connections” and “This server”. Explain unfamiliar
  behaviour near its control; do not rely solely on technical jargon or tooltips.

## Appearance

- Label the reading and terminal appearance sections “Conversation Mode” and
  “Terminal Mode” so they clearly refer to the two pane views.

- Keep visual preferences in Settings → Appearance: ten colour presets (Dark,
  Light, Gruvbox Dark/Light, Tokyo Night, Nord, Dracula, Solarized Dark/Light and
  pink unicorn-themed TIG), followed by a live preview and customisation rows.
  Preserve the existing Dark palette and sizes as defaults. Follow system uses
  Dark/Light; choosing a preset disables it without erasing reading preferences.
- Define palettes centrally in `web/src/appearanceThemes.ts`. Map them onto the
  existing CSS roles, including text, subdued text, surfaces, borders and status
  colours. Light themes need readable dark text throughout settings, Files,
  conversations and documents. Use the same palette for terminal default/ANSI
  colours; preserve the KaTeX font system and application RGB colours outside the
  preset palette. Ghostty 0.4 exposes resolved RGB cells without their original
  colour type, so explicit RGB equal to a preset colour also follows that colour.
- Conversation and terminal font family/size are independent. Use bundled Geist
  and device-installed fonts with suitable fallbacks; keep terminal choices
  monospace. Font controls belong in Appearance, scrolling/input behaviour in
  Terminal, and panel layout in Display. Preserve the existing terminal-size key.
- Opacity changes backgrounds only, never text, controls or a whole canvas layer.
  Conversation opacity applies to user-message boxes and the reply field. Terminal
  opacity blends its background with the underlying reading surface, retaining
  opaque glyphs and application-specified cell backgrounds. Keep the activity
  panel distinct from user messages. Show the result in the live preview.
- Reading width, line spacing and compact message spacing apply to conversation
  text; use a maximum width that still shrinks on mobile. Preserve math overflow
  padding and bounded history. Accent override affects interface accents; provide
  a separate reset to the preset colour.
- Changes apply immediately, with per-control resets and Reset appearance. Save
  preferences per browser/device and synchronise same-origin browser tabs. If
  storage is unavailable, keep changes for the current tab. These settings must
  not restart an agent or reconnect/remount a live terminal: recolour its existing
  renderer, including already-resolved viewport/history cells. Keep the native VT,
  pending escape sequences and scroll position; only a font metrics change should
  request a pane resize. Do not retain an additional transcript or history copy
  to implement theme changes.
- Manual reduced motion supplements the device preference. Disable decorative
  animation/transitions without hiding working indicators. Reuse Off/On segmented
  controls, labelled native selects/sliders and existing focus/reset behaviour.

## Layout and file interaction

- Passel's deployment launcher choices are Shell, Codex, Claude and Gemini.
  Use the bridge's server-owned launcher preset configuration to filter built-ins;
  Gemini is a custom preset running Antigravity CLI as exactly `agy`, with the `agy` agent hint.
  Keep it listed even before installation; do not install or launch it implicitly.
  The checked-in configuration is `examples/launcher-presets.json`.

- Save launch names on both the Herdr tab and its initial pane. Renaming the only
  pane in a tab also renames the Herdr tab so CLI and web names agree. In split
  tabs, retain independent pane names. Pane labels displayed in place of numbered
  legacy tabs are a presentation fallback, not a separate Passel naming store.

- Show the sidebar server selector only when multiple servers are available.

- Preserve the compact Files toolbar: `~/work`, filename search, then actions;
  reload and Collapse All are at the right. Do not add a redundant Files heading.
- Files uses an expandable tree. Left-click opens a file in the right viewer;
  right-click offers Copy full path for every file and folder; files also
  offer Download. Keep keyboard access to the same actions. Copy the instance's
  real absolute host path, preserving spaces and characters, not a URL or container
  mount path. Use server-provided root metadata rather than guessing the username.
  Report clipboard failures without claiming success; keep directory actions read-only.
- Filename search spans all permitted files, including unopened folders.
- The viewer header contains filename, Download, refresh and close. Avoid a
  redundant “Document viewer” heading; retain accessible panel names.
- Keep sidebar and document viewer independently collapsible and easy to reopen.
  Preserve useful selection state when hiding a panel.
- Text document readers are keyboard-focusable regions. Cmd/Ctrl+A and native
  context-menu Select All select only the document body while interacting there,
  excluding file listings, conversation text and viewer controls. Keep native
  partial selection/copy, links and read-only content; do not use contenteditable.
  Release selection ownership on interaction/focus elsewhere and remove document
  listeners when the reader closes. Input fields retain normal Select All.
- PDF expansion fills the browser window. Do not invoke browser fullscreen.
- PDF zoom uses circled plus/minus icons, without a percentage label. Keep zoom
  and search in the same toolbar row.
- Scrolling regions need discoverable scrollbars. Check narrow layouts, long
  filenames, keyboard focus and overflow when changing toolbar or panel sizing.

- On mobile (820px and below), the usage badge shows only the lowest remaining
  percentage among the provider's primary allowances. Tap for provider, windows,
  resets and freshness details. Keep the full accessible label; mark stale values
  with an asterisk. Desktop retains its descriptive labels.
- Usage details include provider-reported credit balances and banked-reset counts,
  with local expiry dates when available. Unknown differs from zero; list/count
  truncation must remain visible. A reset needs an explicit account-labelled
  confirmation, server revalidation and one persisted idempotency key per attempt.
  Never redeem automatically, infer restored quota or restart a worker. Refresh
  actual provider limits afterward. For providers without supported wallet/reset
  APIs, offer their official Usage page instead of inventing balances or resets.
  Keep same-attempt retry inside the reset confirmation; omit a separate previous-
  attempt action from the usage popover.
- Usage popovers dismiss on outside pointer/focus and Escape. Inside controls stay
  usable; a separate reset confirmation keeps its own focus/cancel behaviour.
  Escape returns focus to the badge when focus was inside the popover.
- On mobile, usage details are a compact viewport-centred floating sheet, rendered
  at the document body to escape pane clipping/transform ancestors. Limit width
  and height to the visual viewport, including keyboard/zoom changes, and scroll
  its contents. Portal reset confirmation too; inside interaction stays distinct
  from outside dismissal and global terminal/navigation shortcuts.

## Visual language and accessibility

- Use the existing theme variables in `web/src/styles.css` (for example `--text`,
  `--subtext0`, `--line`, `--crust`, and `--r-sm`). Reuse spacing, typography and
  component classes rather than adding one-off colors, borders or button shapes.
- Prefer existing Lucide icons and established icons for the same action.
  Icon-only buttons need an accessible action label and a descriptive tooltip.
- Use native buttons, inputs and selects. Keep visible keyboard focus, accurate
  pressed/expanded/disabled states, and existing modal focus/Escape behaviour.
- Action menus stay within the viewport and scroll vertically when long. Keep
  rows from shrinking; wrap long paths. Position using unscaled dimensions and
  retain the focused item when the window resizes. Arrow keys and Home/End must
  reach every item without scrolling the page underneath.
- Do not create nonfunctional button-shaped status labels. Actions should look
  actionable; status text should look like information.
- Keep rendered math, readable scrollbars and PDF memory safeguards as standard
  behaviour rather than optional settings.

## Review before delivery

Compare a new control with an existing control of the same kind. Check its label,
state, keyboard behaviour, persistence and appearance in the surrounding layout.
Run lint/build and relevant behaviour tests. When browser testing is available,
check desktop and narrow layouts visually; distinguish automated checks from
actual visual verification when reporting results.

## Files uploads and refresh

- The upload action uses the Lucide upward-arrow icon beside Refresh and Collapse
  All. Its tooltip and the drop hint identify `~/work/uploads` and 100 MB.
- Drops onto Files always use that inbox, regardless of the selected tree folder.
  Report saved/renamed paths, provide Copy uploaded path, and allow cancellation.
- Accept PDF, TeX, Markdown, TXT, DjVu, BibTeX, Lean, CSV/JSON, PNG/JPEG,
  Python/Sage, Jupyter notebooks and LaTeX style/class files through both upload
  selection and drag/drop. Keep the hint compact using file categories rather
  than listing every extension. Text formats must be UTF-8 without NUL bytes; uploaded Markdown
  uses the same safe renderer and Source option as project Markdown.
- Refresh listings in place; never remount the tree on a polling tick or steal
  focus. Poll only while Files is visible, and preserve open document contents.
- Text, code, data and notebook uploads display literal source; do not execute
  code or notebook output. Images and DjVu get a download-only explanation and
  do not fetch/decode in the viewer. Keep Markdown on its safe renderer.

- Only upload-file menus offer Delete, styled as destructive and using the shared
  confirmation dialog. Project-file menus remain download-only.

## Conversation view

- Start in Conversation mode. Use one small icon button in the pane toolbar to
  switch between Conversation and Terminal. Hide the Split right / Split down
  toolbar buttons while retaining split functionality and existing panes. Use the existing icon-btn sizing, a clear tooltip
  and accessible action label; do not add a wide segmented control.
- Preserve full assistant commentary and final messages, including operational
  updates, proof caveats and pauses. Exclude tool calls/results structurally; do
  not classify mathematical prose as interesting or uninteresting.
  Claude records explicitly marked `thinkingDisplay: updates` contain visible
  progress messages and belong in the conversation, history and search. Continue
  excluding internal reasoning and unmarked thinking blocks.
- Conversation mode unmounts the terminal view. It must not secretly attach or
  resize the terminal. Provide a reply composer; retain Terminal for interactive
  prompts. Enter inserts a new line, Ctrl/Command+Enter or Send submits.
- A proven new Codex client can receive its first message before a saved
  conversation exists. Show the connected/first-message state and enable the
  composer; never inject a dummy prompt or select another thread to create history.
- Optimistic replies show input submission separately from agent acknowledgement.
  After 30 seconds without a matching saved user record, explain that the copy is
  unconfirmed and may still be queued. Show its status and hint without Copy to
  reply or Dismiss copy buttons. Preserve the draft and never retry input
  automatically or label an unrecorded message as accepted by the agent.
  Claude may save multiline user input in a complete `pasted_content` envelope.
  Match its exact body against the submitted text and render the body as normal
  user text. Require matching envelope IDs; never use substring/fuzzy matching,
  an assistant reply or a previously known record as delivery confirmation.
  Read current question/approval state independently of terminal scroll position;
  ordinary replies must not act as answers to a modal prompt.
- Follow new messages only while the reader is at the bottom. Provide Bottom and bounded earlier-message expansion without moving the reading position.

- Conversation search is a small magnifying-glass icon that expands a search
  box on demand. Autofocus the field; Escape or toggling the icon closes search.
  Search is over saved user/assistant messages, not terminal tool activity.

- Use one Load earlier messages control for both cached expansion and saved history;
  do not expose that storage distinction as separate user actions.
- Prepend older conversation messages in place and preserve the reading position;
  scrolling near the top loads the next batch. Only Beginning explicitly jumps.

- Conversation search belongs at the right of the main pane toolbar. Avoid a
  redundant always-visible status/Open Terminal row. Top floats at the
  top right and matches Bottom. Retain error states in the content.
- Keep a bounded reading window (80 messages/200,000 source characters), reloading
  evicted history in either scroll direction rather than accumulating the session.

- Hide Top when the reading window includes the beginning. Use scrolling
  and floating jump controls instead of an additional inline paging button row.
- Highlight literal search matches in rendered message text; preserve KaTeX markup
  and cap generated highlight elements for very common queries.
- Place a circled-X clear button inside the right edge of the conversation search
  input, before the Search submit button. Clear the query/results and retain input
  focus; do not close the field. The toolbar magnifier toggles search open/closed.
  Hide Top while search is open so it cannot cover controls.

## Fact Markdown documents

- Recognize fact records by their facts-directory path and fact_id frontmatter.
  Keep metadata in a collapsed Fact details disclosure rather than rendering YAML
  as Markdown headings. Leave other Markdown documents on their normal renderer.
- Use15px reading text, restrained section headings and generous paragraph spacing.
  Preserve source line breaks, including standalone equations. In fact records,
  stars/underscores remain literal rather than Markdown emphasis; explicitly
  delimited LaTeX still renders normally. Do not infer or rewrite mathematics.
- Source must return the exact original text, including frontmatter.
- Treat configured Pharos workspaces like Danus project trees, exposing research
  reports, facts, checkpoints, materials, expert guidance and the root ROUTES.md
  summary through the same file viewer/search. Keep workflow and account folders
  hidden; do not mount an entire workflow checkout to provide project outputs.
- TeX documents show the complete literal source, including the preamble. Do not
  offer an equation-only preview or strip document text. Keep View matching PDF
  when a sibling PDF with the same basename exists.

## Passel branding

- Use the approved three-boar herd in brown#332522; master in assets/branding.
  The header uses the herd icon and live lowercase passel text. Keep a light
  backing behind the brown mark so it stays legible in the dark theme.
- Browser title and installed app name are Passel. Existing Herdr backend/API
  names and stored preference keys remain compatibility identifiers.

- Conversation file references open the right-hand viewer using existing Files
  access checks. Recognize explicit Markdown links and plain workspace/project
  paths; preserve code blocks and math. Resolve relative runtime paths only on
  click, and offer workspace choices for ambiguous matches.

- Local conversation links offer Open in viewer, Reveal in Files and Copy link through the
  shared context menu, including Shift+F10 keyboard access. Reveal expands and
  focuses the file in the sidebar while retaining the current document preview.
  Copy link resolves ambiguous workspace references before copying the absolute
  file URL on this instance; it contains no gateway key and retains normal access
  checks. Copying does not open the viewer or fetch document contents.

- Horizontally scrollable display math needs vertical padding inside its overflow
  box to protect superscripts and tall glyphs; outside margins alone do not prevent
  clipping. Preserve the surrounding paragraph spacing.

- On mobile, the pane title and action buttons form a horizontally scrollable
  strip with nonshrinking controls. Back and quota stay outside that strip; quota
  popovers must not be clipped by its overflow container.

- Live conversation activity occupies one fixed-height box directly below the live messages,
  inside the same reading column and matching its width. Show only the latest bounded command/output as plain
  text, replacing previous activity without resizing the slot. Hide when idle,
  completed, disconnected or browsing history/search; do not accumulate tool logs.

- Activity uses a gently pulsing “Working…” label inside its box, with no waiting
  placeholder or bouncing dots. Respect reduced-motion by keeping the label static.

- Activity panels share the conversation background, with a muted thin border and
  small blue left accent. Keep command text subdued; filled user-message backgrounds
  remain visually distinct.

- Pinned questions and responses use the small three-dot message-actions button.
  That menu also offers Copy to clipboard for the message's Markdown/LaTeX text,
  excluding role/time/actions and Claude paste-envelope markup. Copy only on an
  explicit click, report success or clipboard failure, and leave pins/drafts alone.
  Leave message text long-press and right-click behaviour to the browser for
  selection and copying; do not open the pin menu or move focus from message text.
  File links keep their own file-action menus. The toolbar bookmark opens a list on the right.
  Pins belong to the conversation and server, surviving pane moves and browser
  changes. Persist on the instance owner’s server; never use browser storage as
  the source of truth. Limit storage to 1,000 pins / 10,000,000 source characters
  and browser pages to 100 pins / 500,000 characters. Render previews in the list.
  Clicking a pin jumps to its original message in the conversation, loading that
  history window if necessary; never expand a duplicate message in the pin list.
- Message shortcuts append editable text to the composer. Never send automatically
  or overwrite an existing draft. Keep them available from a compact dropdown.
- The toolbar Files action uses a folder icon and reveals/expands the current
  project in the existing tree. Prefer an exact project working directory; otherwise
  match conversation project paths against allowed folders in the pane's runtime.
  Offer a project chooser when no unique match exists; do not guess another project.
- Remember the chosen folder in this browser, scoped by server, stable terminal
  identity and working directory. Validate it against the allowed directory
  listing each time; an explicit project working directory takes precedence.
  Right-click, long-press or Shift+F10 on the folder button reopens all choices.
  Open a sole validated project directly without a conversation request. When
  conversation-based matching fails, offer the validated folder choices rather
  than blocking Files; preserve cancellation on pane/server changes.
  Keep at most 100 saved choices and retain an in-memory fallback if storage is
  unavailable. Cancel pending lookups when switching panes or servers.

- Files rows and filename search show compact last-modified timestamps in the
  browser's locale/time zone. Hover exposes the full timestamp. Folder times
  describe directory-entry changes, not recursive descendant edits. Omit times
  for virtual navigation folders rather than displaying an epoch date. Reuse
  existing listing metadata and polling; do not add per-row requests or timers.
- Show ordinary directories below ~/work in their original hierarchy, with all
  regular filenames. Keep dot-files/directories, symlinks and special files hidden.
  Top-level names containing danus, pharos or rethlas retain filtered project views.
  Ordinary folders open directly from their pane's working directory and can be
  remembered like workflow project choices. Render known text/code as source,
  Markdown/PDF normally, and unknown binary formats as download-only. Reading
  these folders must never enable deletion outside the uploads inbox.

- Header layout control has three compact diagram buttons: Files + session,
  Files + document, and all three. Use accessible labels and pressed state.
  Files + document hides the center session and fills the remainder with the
  document; keep the sidebar control available. Changing layout never stops
  Codex/workers. Show an empty document prompt when no file has been selected.

- Spaces and tabs support direct drag-and-drop. Neither has a visible grip: drag
  the row, or hold then move on touch screens. Preserve ordinary scrolling and
  context-menu long presses; expose an arrow-key reorder button on keyboard focus.
  Show an insertion line; do not change selection on
  drag. Space worktree families move together. Orders are saved through Herdr,
  scoped to one server/workspace; no browser-only ordering overrides.
- Top tabs and Sessions sidebar use the same saved tab order. Their default sorting
  is Manual (agents first): all agent sessions share one reorder group regardless
  of working/idle/blocked status, followed by plain shells. Status changes must
  not undo manual moves. Explicit Status or Last status change sorting still takes
  precedence when selected.
  Numeric tab IDs are stable identifiers, not ordering indices. Existing Space
  reorder menu stays available.

## Archived tabs

- Archive lives in tab/pane context menus. Archive only hides the whole tab from
  both current tab lists and preserves server order. Sessions has prominent
  Current/Archived collection buttons with counts. Archived lists span spaces on
  the selected server and use plain-text names with explicit View and Restore buttons.
- Show the same attention-count badge beside archived session names as on spaces,
  counting done/blocked panes. Keep the badge visible when long names truncate;
  do not treat this status count as unread messages or clear it on viewing a tab.
- Offer “Quit session and archive” only for single-pane sessions whose agent has
  a validated graceful quit/resume adapter (currently Codex and Claude). Explain that it
  exits the foreground TUI, not background workers or the shared daemon. Do not
  call this Pause or imply token use has stopped. Restore never automatically resumes.
- A stopped session offers a separate Resume session action; retain its account/profile
  and directory. Store archive/launch metadata privately on the server, not in localStorage.
- Hide panel-layout presets at the compact layout breakpoint (820px). Keep normal
  mobile Files, Conversation and viewer navigation available.

## Sessions and waiting questions

- Main navigation is Sessions, Files, Notes. Sessions combines the former Agents
  and Tabs lists, with All sessions, Working and Needs attention filters. Show a
  short status beside session details; preserve spaces, pins and saved ordering.
  Use the workspace list to select a space; omit the separate Space/All switch
  and host selector/grouping from Sessions. Ignore old grouping preferences there;
  spaces already organise the list. Put the All sessions / Working / Needs attention
  filter in the three-dot menu below Sort, rather than a dedicated sidebar row.
  Filters apply to Current; Archived always lists all archived sessions.
  The main row label matches the top tab bar; the subtitle is the agent type
  (Codex, Claude, Terminal, etc.). Put status immediately beside the name, with
  secondary details below. Keep session rows compact with 6px vertical
  padding on desktop and 9px on touch, retaining at least 44px touch targets.
- Waiting Codex questions appear in a persistent, bounded preview above the
  Conversation composer. Open choices sends Alt+Up; arrows, Select and Back act
  only on an open question. Never auto-select, retry a submission, or replay keys.
  Revalidate the foreground process and displayed prompt before selection.
- Claude command approvals use the same persistent panel, with the command
  context and numbered option buttons. Clicking an option stages navigation,
  checks that the same command/process is still pending and that option is selected,
  then confirms once. Keep arrows/Select/Back; omit Codex-only Alt navigation.
  Do not auto-answer, retry approval submissions or hide the conversation above.
  Fresh Claude sessions are connected before their first transcript; quota shows
  “Awaiting response” until the provider supplies limits, never an estimated percent.

- Terminal redraws carry the exact server grid and full-snapshot marker alongside
  their bytes, including through gzip and batching. Fit the current grid into the
  viewer and retain its preferred font/size for resize requests. Do not resize the
  local VT ahead of the server's redraw. Full snapshots cancel unfinished controls
  and reset the view in place, preserving keyboard/selection bindings; incremental
  frames preserve parser state. Herdr retains the actual history/scroll position.
  Bound browser grids to 500 columns × 200 rows and decoded batches to 256 records.
- The mobile terminal key strip has separate Ctrl, Alt and Shift buttons. These
  are one-shot modifiers with visible pressed states; they can be combined before
  tapping an arrow or another key, and clear after sending that key. Opening the
  special-key panel does not consume them. Do not add fixed Alt+arrow shortcuts.

- Waiting question controls distinguish a collapsed queue, an open choice list,
  and an open free-text answer field. Hide irrelevant navigation controls; show
  an explicitly submitted answer field for text questions. Never auto-answer.

- Forward primary clicks and stationary taps only when the attached application
  requests mouse capture. Map the displayed canvas to the server's cell grid;
  send one press/release pair for taps, suppress duplicate compatibility clicks,
  and leave swipes with scrolling. Shift-click retains local text selection.
  Keep application mouse state separate from snapshot VT resets and clear it
  on disconnect. Do not add an application-specific overlay for native buttons.

- A Claude conversation handed into a continuation remains the same logical
  conversation. Preserve original message positions and pins, omit copied history,
  and append only explicitly linked, independently validated main-session output.
  Keep history/search bounded; never select a worker transcript by recency or title.

- Conversation navigation uses compact up/down arrow icons with accessible
  Go to top/bottom labels and tooltips. Previous prompt sits left of the up arrow
  and jumps to one earlier canonical user message per click,
  skipping assistant/tool activity. It starts from the current reading position,
  follows saved history beyond the browser window using bounded user-prompt scans,
  progressing across assistant-only gaps without overlapping message pages,
  and resets its cursor after manual scrolling or jumping to the bottom. Hide the
  top controls while search is open. No Next prompt control. Hide Previous prompt
  at the beginning of history or the first prompt; restore it when scrolling away.
  Disable it during loading; cancel scans on other navigation/session changes
  or unmount. Preserve the 80-message/200k-character reading bounds.
  Programmatic jump/layout scroll events must retain that prompt cursor and must
  not trigger automatic history paging; only scrolling away resets it.
