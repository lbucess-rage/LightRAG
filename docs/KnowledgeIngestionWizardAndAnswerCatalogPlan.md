# Knowledge Ingestion Wizard And Answer Catalog Plan

## Backlog Memo

- Replace the current narrow Upload action with a unified data-source wizard after the current Docling processing work is finished.
- The wizard should keep existing ingestion APIs and flows, but present them through one guided entry point:
  - file upload
  - direct text
  - quick image
  - URL single/batch
  - board/API ingest
  - server input directory scan
- Recommended wizard steps:
  1. select source
  2. choose processing mode
  3. validate/preview
  4. execute
  5. review result
- Progress display should be task-id based across all ingestion modes.

### Implementation Status - 2026-05-17

- First data-source wizard iteration implemented in `lightrag_webui/src/components/documents/DataSourceWizardDialog.tsx`.
- `DocumentManager` now shows one primary `데이터 추가` entry point instead of separate Upload / URL / Multimodal / Quick Input buttons.
- The wizard directly supports:
  - normal file upload
  - multimodal file processing with Docling/PyMuPDF options
  - direct text ingestion
  - quick image ingestion
  - single/batch URL ingestion
  - server input directory scan
- Board/API ingestion is exposed through the wizard and currently delegates to the existing board mapping dialog. A later refinement can inline the board API connection, mapping, and execution steps into the same wizard panel.
- Build verification: `bun run build` succeeded.

## Fixed Answer / Intent-Based Retrieval Concept

Goal: keep the current LightRAG ingestion and RAG answer generation paths, while adding an answer-first path for cases where a curated fixed answer should be found quickly and accurately without relying on free-form LLM generation.

### Core Idea

- Maintain a curated answer catalog per workspace.
- Each answer has approved body text, optional approved summary, source, version, validity dates, status, and matching metadata.
- A fixed answer can be registered as a stable answer ID. Search/intent data is indexed separately and points back to that answer ID. At runtime, an optional LLM selector may be asked to choose one answer ID from a validated candidate list, while the final response is always loaded from the approved answer catalog.
- Reuse the existing KG/vector infrastructure where possible by indexing answer-guidance data as short virtual documents linked to the canonical answer ID. The answer body itself remains governed in the catalog table.
- Runtime query flow:
  1. normalize the user query
  2. retrieve candidate answer IDs using deterministic, vector, and optional KG matching
  3. score and rank candidates
  4. return the fixed answer immediately if the top score and margin are high enough
  5. call an LLM ID selector only for ambiguous cases
  6. show alternatives or fall back to RAG if confidence is low
  7. log query, candidates, selected answer, and feedback for analytics

### LLM Role

LLM is not mandatory for runtime answer lookup. It can be used as an optional assistant for:

- generating suggested keywords and canonical questions
- summarizing source answers into approved summaries
- detecting duplicate or overlapping answers
- classifying ambiguous user intent
- reranking candidate answers
- finding coverage gaps from no-match queries

Runtime modes should be configurable:

- deterministic-only: lowest risk, highest auditability, fastest
- hybrid fast path: deterministic/vector/KG score accepts high-confidence matches without LLM
- LLM-assisted ID selection: better recall for ambiguous queries, some cost/latency/risk
- LLM-generated summary: highest flexibility, requires stronger governance and should be optional

### Expanded Source And Structured Data Design

FAQ-style KMS should not be limited to manually typed Q/A rows. It should accept heterogeneous sources and decide whether each source becomes a curated answer, answer-guidance data, structured facts, or normal KMS context.

Supported source categories:

- manual text: simple plain-text answer or guidance input.
- rich HTML editor: store approved HTML, sanitized HTML, extracted markdown/plain text, and embedded media references separately.
- markdown: preserve source markdown while extracting heading structure, links, tables, and code blocks.
- single DB table: profile columns, detect key fields, infer candidate answer title/body/status/validity fields, and optionally materialize rows as answer candidates.
- multi-table DB source: import table metadata, primary/foreign keys, join paths, and sample rows; map table groups to answer objects, categories, products, policies, or structured facts.
- NoSQL source: sample documents, infer shape variants, flatten selected paths, and map nested arrays/objects into answer metadata or fact tables.
- link and web source: ingest pages, detect FAQ/list/detail patterns, extract canonical links, and keep crawl snapshots.
- file and multimodal source: keep existing document/chunk/KG pipeline for PDFs, Office files, images, and tables.

Each ingestion source should produce one or more output planes:

1. source snapshot: immutable copy or reference of what was ingested, with version, hash, connector metadata, and refresh time.
2. answer catalog: approved or draft answer rows that can be shown to users.
3. answer guidance index: keywords, example questions, synonyms, intent phrases, and embeddings pointing to answer IDs.
4. structured dataset: profiled and normalized tables suitable for deterministic lookup or generated SQL.
5. KG/vector context: existing LightRAG chunks, entities, relationships, and embeddings.
6. lineage: links from answer/version/fact/table rows back to source snapshots and extraction tasks.

Structured data path:

- Run profiling before ingestion: row count, null rate, cardinality, value samples, data type inference, date/range detection, duplicate keys, language detection.
- Infer table semantics: candidate primary keys, title/body columns, category fields, validity dates, version fields, status fields, foreign keys, and lookup columns.
- Let users confirm mappings before materialization. For multi-table sources, show join graph and sample joined rows.
- Materialize curated structures into read-optimized tables or views, rather than querying arbitrary raw source tables at runtime.
- Keep source snapshots and derived structured tables versioned so answer validity and rollback remain auditable.

Dynamic SQL policy:

- Dynamic SQL is useful, but should be treated as a controlled structured lookup layer, not an unrestricted text-to-SQL feature.
- Generate SQL only against registered semantic views or materialized tables with explicit allowed columns, joins, filters, row limits, and read-only permissions.
- Validate generated SQL with a parser/AST allowlist before execution. Block writes, DDL, cross-workspace access, unbounded scans, and non-approved functions.
- Prefer deterministic query templates for common lookups. Use LLM-generated SQL only for ambiguous ad hoc questions, and log query, generated SQL, result count, latency, and selected answer/fact.
- If the result is used in a final answer, display structured values with source/version/validity rather than letting the LLM paraphrase silently.

Recommended internal model:

- source_connectors: connector type, auth reference, refresh policy, owner, workspace, enabled flag.
- source_snapshots: connector_id, source_uri/table/query, hash, schema hash, captured_at, task_id, status.
- source_datasets: logical dataset name, source type, materialization mode, semantic description.
- source_fields: dataset_id, source field/path, inferred type, semantic role, nullable/cardinality/profile stats.
- source_relations: dataset/table relationships, join keys, confidence, user confirmation flag.
- answer_source_links: answer_id/version -> source snapshot/dataset/row/chunk.
- structured_lookup_logs: query, selected dataset/view, SQL/template, result count, user/session, latency.

UI implications:

- The data-add wizard should evolve from "select source -> execute" to "connect/sample -> profile -> map -> preview derived answers/facts -> execute -> review".
- FAQ workspaces need source-specific mapping screens:
  - text/HTML/markdown: answer body, summary, guidance terms, validity.
  - DB table: title/body/status/version/date fields, one-row-one-answer or table-as-facts mode.
  - multi-table DB: join graph, entity roles, answer row assembly, fact lookup views.
  - NoSQL: selected paths, flattening rules, array handling, document identity.
  - web/link: list/detail extraction, canonical URL, freshness policy.
- Answer Library should show not only answer rows, but also source lineage, extraction version, structured fields, and whether the answer is manually approved or source-derived draft.

Design conclusion:

- FAQ KMS should be modeled as an answer catalog plus a source/materialization layer.
- KMS graph/vector reuse remains valuable for intent matching and related-answer discovery.
- Structured sources need deterministic profiling, mapping, and versioned materialization before they are exposed to runtime lookup.
- LLM should assist with mapping suggestions, keyword generation, schema/field labeling, and ambiguous intent selection, but deterministic structured lookup should be the fast and auditable default where possible.

### Detailed Implementation Design

The FAQ/answer-catalog capability should be implemented as an additive workspace mode. Existing KMS behavior, APIs, tabs, graph/vector ingestion, schema tools, prompt tools, and search tools must keep working unchanged for normal KMS workspaces.

Workspace mode:

- Store mode in existing workspace metadata:
  - `metadata.workspace_mode = "kms" | "answer_catalog" | "hybrid"`
  - default missing value to `"kms"` for backward compatibility.
- Keep the existing workspace table/API contract. The current workspace create/update API already supports `metadata`, so the first step does not require a breaking DB migration.
- Add workspace-level answer catalog settings:
  - `metadata.answer_catalog.default_lookup_mode = "deterministic" | "hybrid_fast" | "llm_selector"`
  - `metadata.answer_catalog.show_kms_tools = true | false`
  - `metadata.answer_catalog.structured_lookup_enabled = true | false`
  - `metadata.answer_catalog.default_display_policy = "summary" | "full" | "both"`

UI by workspace type:

- KMS workspace:
  - Preserve current top-level tabs: Documents, Chunks, Knowledge Graph, Entity-Relation Explorer, Schema, Search, API, Prompts, Workspaces.
  - The new data-add wizard remains the main Documents entry point.
  - No answer-catalog screens are shown by default.
- Answer Catalog workspace:
  - Primary tabs should become answer-oriented:
    - Answers: curated answer library, status, version, validity, approval state.
    - Sources: source connectors, uploads, DB/NoSQL/web imports, profiling tasks, source snapshots.
    - Matching: keywords, canonical questions, negative keywords, KG/vector guidance, LLM suggestions.
    - Structured Data: profiled datasets, semantic views, materialized lookup tables, SQL/template tests.
    - Test Console: user query -> candidate answers -> selected answer -> evidence/score.
    - Analytics: views, top queries, no-match queries, ambiguous matches, feedback.
    - API, Workspaces.
  - Existing KMS tools should still be available from an "Advanced KMS Tools" section or a mode toggle, not removed.
- Hybrid workspace:
  - Show both answer and KMS surfaces, but keep navigation grouped:
    - Knowledge Sources: Documents, Chunks, Sources.
    - Graph Tools: Knowledge Graph, Entity-Relation Explorer, Schema.
    - Answer Tools: Answers, Matching, Structured Data, Test Console, Analytics.
    - Operations: API, Prompts, Workspaces.
  - Search UI should expose answer policy: `fixed answer first`, `RAG only`, `fixed answer only`, `hybrid with fallback`.

Frontend implementation:

1. Add a workspace mode helper:
   - `getWorkspaceMode(workspace?: WorkspaceInfo): "kms" | "answer_catalog" | "hybrid"`
   - default to `"kms"` when metadata is missing.
2. Extend workspace creation/edit dialog:
   - add a segmented control or radio cards for `KMS`, `FAQ/Fixed Answer`, `Hybrid`.
   - save the selected value in `metadata.workspace_mode`.
   - preserve existing metadata keys when editing.
3. Make top navigation mode-aware:
   - keep tab components mounted only when available for that mode.
   - if the persisted current tab is hidden after workspace switch, redirect to the mode's default tab.
4. Add new frontend feature shells:
   - `AnswerLibrary`
   - `AnswerSources`
   - `AnswerMatching`
   - `StructuredDataManager`
   - `AnswerTestConsole`
   - `AnswerAnalytics`
5. Keep current KMS components untouched:
   - `DocumentManager`
   - `ChunkManagement`
   - `GraphViewer`
   - `EntityManagement`
   - `SchemaManager`
   - `RetrievalTesting`
   - `PromptSettings`

Backend/API implementation:

- Keep all current endpoints unchanged.
- Add answer-specific routers:
  - `POST /api/answers`
  - `GET /api/answers`
  - `GET /api/answers/{answer_id}`
  - `PATCH /api/answers/{answer_id}`
  - `POST /api/answers/{answer_id}/publish`
  - `POST /api/answers/{answer_id}/archive`
  - `GET /api/answers/{answer_id}/revisions`
  - `POST /api/answers/{answer_id}/guidance`
  - `POST /api/answers/resolve`
  - `POST /api/answers/suggest`
  - `GET /api/answers/stats`
- Add source/materialization routers:
  - `POST /api/answer-sources/connectors`
  - `GET /api/answer-sources/connectors`
  - `POST /api/answer-sources/{connector_id}/sample`
  - `POST /api/answer-sources/{connector_id}/profile`
  - `POST /api/answer-sources/{connector_id}/mapping/preview`
  - `POST /api/answer-sources/{connector_id}/materialize`
  - `GET /api/answer-sources/snapshots`
  - `GET /api/structured-datasets`
  - `GET /api/structured-datasets/{dataset_id}`
  - `POST /api/structured-datasets/{dataset_id}/query/preview`
  - `POST /api/structured-datasets/{dataset_id}/query/execute`
- All new APIs must require workspace context and should reject unsupported operations when workspace mode is incompatible, except `hybrid`.

Suggested tables:

- `lightrag_answer_items`
  - `answer_id`, `workspace`, `title`, `body`, `approved_summary`, `content_format`, `display_policy`, `status`, `version`, `valid_from`, `valid_until`, `priority`, `tags`, `metadata`, timestamps.
- `lightrag_answer_revisions`
  - immutable body/summary/guidance snapshots per answer version.
- `lightrag_answer_guidance`
  - `answer_id`, `guidance_type`, `text`, `weight`, `embedding_ref`, `source_ref`, `created_by`.
- `lightrag_answer_events`
  - query/view/resolve/feedback events, selected answer, candidate IDs, score, latency, channel.
- `lightrag_source_connectors`
  - source type, workspace, config metadata, auth reference, refresh schedule, enabled flag.
- `lightrag_source_snapshots`
  - connector, source URI/table/query, schema hash, content hash, captured time, task ID, status.
- `lightrag_source_datasets`
  - logical dataset, source type, materialization mode, semantic description, status.
- `lightrag_source_fields`
  - field/path, inferred type, semantic role, profile stats, user-confirmed mapping.
- `lightrag_source_relations`
  - source/dataset relationships, join keys, cardinality, confidence.
- `lightrag_answer_source_links`
  - answer/version/guidance/fact rows linked back to source snapshots, rows, chunks, or documents.
- `lightrag_structured_lookup_logs`
  - query, selected dataset/view/template, SQL, result count, latency, selected answer/fact, user/session.

Ingestion/materialization flows:

- Manual text / HTML / Markdown:
  1. capture source body and format.
  2. extract plain text and markdown.
  3. create draft answer row.
  4. generate or manually enter guidance terms/questions.
  5. optionally index guidance as a short virtual document linked to `answer_id`.
  6. publish after review.
- Single DB table:
  1. connect using a read-only connector.
  2. sample rows and profile fields.
  3. suggest mapping: title/body/category/status/version/validity/key fields.
  4. user chooses `one row = one answer`, `table = structured facts`, or both.
  5. materialize approved view/table inside LightRAG storage.
  6. create answer drafts or structured lookup dataset.
- Multi-table DB:
  1. introspect tables, keys, row counts, sample rows.
  2. build join graph and suggest candidate semantic views.
  3. user confirms join path and row assembly.
  4. materialize semantic view.
  5. create answer drafts and/or structured lookup dataset.
- NoSQL:
  1. sample documents and infer shape variants.
  2. let user select identity path, title/body paths, validity/version paths, and arrays to flatten.
  3. materialize normalized dataset.
  4. create answer drafts or facts.
- URL/web/link:
  1. crawl/validate and snapshot content.
  2. detect page type: FAQ, list/detail, article, product/policy table.
  3. create answer candidates or normal KMS documents.
  4. preserve canonical URL, captured time, hash, and refresh policy.
- Existing files/multimodal:
  1. keep current KMS ingestion path.
  2. optionally add "extract answer candidates" as a post-processing step for answer-catalog/hybrid workspaces.

Runtime answer resolution:

1. normalize the query.
2. run deterministic filters first:
   - active status
   - validity period
   - workspace
   - channel/audience if configured.
3. retrieve candidates from:
   - exact keyword/index match
   - vector guidance
   - KG answer entities
   - structured lookup templates/views.
4. if top score and margin meet policy, return the approved answer without LLM.
5. if ambiguous, optionally call LLM selector with candidate IDs only.
6. validate selected ID against the candidate whitelist and answer status.
7. return approved summary/full body, source/version/validity, confidence, alternatives, and trace ID.
8. log event for analytics.

Structured lookup runtime:

- Prefer registered query templates for frequent structured questions.
- Allow generated SQL only against registered semantic views/materialized tables.
- Enforce:
  - read-only SQL
  - AST allowlist
  - allowed schemas/tables/columns
  - mandatory workspace filter
  - row limit
  - timeout
  - no DDL/DML/functions outside allowlist.
- The final response should expose source/version/validity and raw structured values; LLM paraphrasing must be optional.

Implementation phases:

- Phase A: Workspace mode and UI routing
  - save mode in workspace metadata.
  - make header navigation mode-aware.
  - add empty answer-catalog screens behind mode-specific tabs.
  - no existing KMS behavior changes.
- Phase B: Answer catalog core
  - answer CRUD, revision, publish/archive, guidance CRUD.
  - answer library UI.
  - basic deterministic/vector resolve API.
- Phase C: Source layer v1
  - manual text, HTML/markdown, URL, existing document extraction to answer drafts.
  - source snapshots and lineage.
- Phase D: Structured source layer
  - DB single-table connector, profiling, mapping preview, materialization.
  - Structured Data UI.
  - safe template SQL preview/execute.
- Phase E: Advanced connectors
  - multi-table DB join graph.
  - NoSQL path mapping.
  - refresh scheduling and version comparison.
- Phase F: Hybrid resolution and analytics
  - fixed-answer first/RAG fallback modes.
  - LLM ID selector for ambiguous cases.
  - analytics, feedback loop, no-match review.

Backward compatibility rules:

- Existing workspaces with no mode behave as `kms`.
- Existing tabs and APIs remain available.
- Existing document ingestion remains unchanged.
- Answer catalog ingestion must not pollute normal KMS query results unless workspace mode is `hybrid` and the user enables fixed-answer lookup.
- All answer/structured features must be workspace-scoped from the first migration.

### Phase A/B Implementation Status - 2026-05-17

- Phase A workspace mode foundation implemented:
  - workspace type is saved in `metadata.workspace_mode`.
  - workspace create/edit UI exposes `KMS`, `FAQ / Fixed Answer`, and `Hybrid` choices.
  - header navigation is mode-aware.
  - existing KMS workspaces default to `kms` and keep the existing tab layout.
  - answer-catalog workspaces show answer-oriented tabs first.
- Phase B answer catalog core implemented:
  - backend router: `lightrag/api/routers/answer_routes.py`.
  - API prefix: `/api/answers`.
  - lazy-created tables:
    - `LIGHTRAG_ANSWER_ITEMS`
    - `LIGHTRAG_ANSWER_REVISIONS`
    - `LIGHTRAG_ANSWER_GUIDANCE`
    - `LIGHTRAG_ANSWER_EVENTS`
  - implemented API:
    - list/create/get/update answers
    - publish/archive answers
    - list revisions
    - list/add/delete guidance
    - deterministic answer resolve
    - fixed-answer search response
    - view and feedback event logging
    - summary stats
  - frontend screens:
    - `AnswerLibrary`
    - `AnswerTestConsole`
    - placeholder shells for Sources, Matching, Structured Data, Analytics.
- Verification:
  - Python compile passed for the new answer router.
  - WebUI `bun run build` succeeded.
  - Server restarted and `/api/answers` returned 200.
  - Created/published a fixed-answer test item and resolved it by query through `/api/answers/resolve`.

### KG Reuse And ID Selector Approach

Registration flow:

1. Create an answer row with answer_id such as `ANS-<uuid>`.
2. Compose short answer-guidance data from keywords, canonical questions, synonyms, domain terms, and optional LLM suggestions.
3. Index the guidance data as a virtual document through the existing LightRAG ingestion pipeline.
4. Ensure the answer ID is present as a canonical answer entity, either through schema/seed entity support or a post-ingestion verification/repair step.
5. Store the approved answer body, summary, display policy, version, and validity window only in the catalog table.

Resolve flow:

1. Retrieve top-K answer ID candidates from vector/full-text/KG signals.
2. If top score and score margin are above threshold, return the catalog answer without LLM.
3. If candidates are ambiguous, call an LLM selector with only the candidate IDs and short evidence.
4. Validate that the returned ID is in the candidate whitelist and points to a published, valid catalog row.
5. Return approved summary/full body according to display policy.

Speed policy:

- Use no-LLM fast path by default.
- Use LLM only when the top candidate is below threshold or top candidates are close.
- Cache normalized query -> selected answer ID decisions with catalog version in the cache key.
- Keep guidance documents short to control vector/KG size and context size.
- Optionally precompute popular query mappings from analytics.

Risks and mitigations:

- Graph pollution: prefer a separate answer workspace/index, or add query-time filtering for `CanonicalAnswer` entities in normal RAG.
- ID hallucination: enforce candidate whitelist validation.
- LLM nondeterminism: use temperature 0, JSON schema, cache, and audit logs.
- Seed entity extraction failure: verify answer entity creation after ingestion and repair if missing.
- Version drift: update catalog row for body-only edits; re-index guidance only when matching data changes.
- Expired answers: keep graph data but filter responses by catalog status and validity.

### Workspace Mode Proposal

When creating a workspace, allow selecting its operating mode:

- `kms`: normal LightRAG/KMS workspace for open-ended document knowledge and RAG answers.
- `answer_catalog`: fixed-answer/FAQ workspace for approved answer lookup.
- `hybrid`: uses normal KMS retrieval and answer-catalog lookup together.

Recommended initial implementation:

- Store the mode in workspace metadata, e.g. `metadata.workspace_mode`.
- Keep the existing workspace APIs compatible by defaulting missing mode to `kms`.
- For `answer_catalog` workspaces, show Answer Library / Matching Setup / Test Console / Analytics as primary UI.
- For `kms` workspaces, keep existing Documents / Chunks / Graph / Search flows as primary UI.
- For `hybrid` workspaces, expose both, but make the search UI choose between `fixed answer first`, `RAG only`, and `fixed answer only`.

Schema policy:

- Existing workspace schema should remain reusable.
- `answer_catalog` mode should extend, not replace, the selected KMS schema with a minimal fixed-answer schema:
  - entity type: `CanonicalAnswer`
  - optional entity types: `AnswerIntent`, `AnswerKeyword`, `AnswerCategory`, `AnswerVersion`, `AnswerSource`
  - relation types: `answers_intent`, `has_keyword`, `belongs_to_category`, `supersedes`, `derived_from`, `valid_for`
- The answer ID (`ANS-...`) should be a seed/canonical entity so answer-guidance data reliably links to the catalog row.
- If the workspace is hybrid, normal RAG queries should be able to exclude `CanonicalAnswer` entities unless fixed-answer lookup is explicitly enabled.

Open design choice:

- Use a separate answer workspace/index for cleaner isolation, or keep answer guidance in the same workspace for richer KG linkage. Default recommendation: start with separate `answer_catalog` mode and add hybrid linking later.

### Suggested Data Model

- answer_items
  - id, workspace, title, body, approved_summary, source_type, source_uri, status
  - version, valid_from, valid_to, priority, tags, owner, approval metadata
- answer_intents
  - answer_id, intent_name, canonical_questions, keywords, negative_keywords
  - match_policy, threshold, embedding reference
- answer_revisions
  - immutable answer revision history
- answer_usage_logs
  - query, matched_answer_id, candidate_ids, score, channel, user/session, action
- answer_feedback
  - helpful, not helpful, selected alternative, correction note

### UI Areas

- Answer Library: manage answers, versions, validity, approval, source links.
- Matching Setup: keywords, example questions, negative keywords, LLM suggestions.
- Test Console: run sample queries and inspect candidate scores.
- Lookup Screen: simple user-facing search that shows fixed answers, validity, version, source, and confidence.
- Analytics: views, top queries, top keywords, no-match queries, ambiguous matches, stale answers.

### API Surface

- POST /api/answers/search
- GET /api/answers/{answer_id}
- POST /api/answers/{answer_id}/feedback
- GET /api/answers/stats
- Admin CRUD:
  - POST /api/answers
  - PATCH /api/answers/{answer_id}
  - POST /api/answers/{answer_id}/publish
  - GET /api/answers/{answer_id}/revisions
  - POST /api/answers/suggest

### 2026-05-17 Phase A/B Direct Test

Test workspace:

- ID: `faq_phase_ab_test_20260517`
- Name: `FAQ 지식화 테스트 20260517`
- Metadata: `workspace_mode=answer_catalog`

Improvements applied during testing:

- Answer Catalog APIs now reject normal KMS workspaces with HTTP 409 unless `metadata.workspace_mode` is `answer_catalog` or `hybrid`.
- Answer revision snapshots now normalize JSON fields so `tags` is returned as an array and `metadata` is returned as an object, including legacy snapshot reads.
- Answer JSON write helpers now avoid double-encoding existing JSON strings for `tags` and `metadata`.

Verified flows:

- Created the test workspace through `POST /workspaces`.
- Confirmed normal KMS workspace `feature-local` returns 409 for `GET /api/answers`.
- Created answer `ANS-FAQ-PHASEAB-001`.
- Published, archived, and re-published the answer.
- Updated summary, tags, and metadata; version advanced to 5.
- Added and deleted one temporary guidance row.
- Resolved `FAQ 워크스페이스란 무엇인가요` to `ANS-FAQ-PHASEAB-001`.
- Confirmed archived answers are excluded from normal resolve.
- Confirmed answer stats show one published answer and resolve events.
- Confirmed WebUI production build succeeds.

Remaining implementation notes:

- Current `resolve` is deterministic keyword/token scoring. The planned vector/KG candidate retrieval and optional LLM ID selector still need to be added.
- The library search endpoint searches answer title/body/summary; guidance text search should be added if operators expect guidance-driven filtering in the library screen.
- `bun test` currently reports no test files. Add focused tests for answer API client helpers and workspace-mode routing when the UI settles.

### Phase 1 Stabilization Status - 2026-05-18

- Tightened workspace-mode readiness in the WebUI so answer-catalog components are not rendered before the current workspace mode is known.
- Kept KMS workspaces on KMS tabs only, and answer-catalog workspaces on answer-oriented tabs only.
- Added localized user-facing handling for answer-catalog APIs accidentally called from unsupported workspace modes.
- Tuned the Matching screen visual treatment from strong multi-color panels to a quieter neutral layout.
- Verified `bun run build` succeeds.
- Browser smoke test:
  - FAQ workspace shows answer tabs and Matching screen correctly.
  - KMS workspace switch shows KMS tabs and document content.
  - No `/api/answers` 409 conflict appeared during the KMS smoke path; only expected answer stats calls for answer workspaces returned 200.

### Phase 1 Data Lifecycle And External API Status - 2026-05-18

- Workspace lifecycle now includes answer-catalog tables:
  - `copy-data` and `move-data` copy answer items, revisions, guidance, and events when document data is included.
  - workspace data deletion also cleans answer items, revisions, guidance, and events.
- External lookup APIs added:
  - `POST /api/answers/search`: returns the selected approved answer body/summary plus candidates, confidence, source metadata, and trace ID.
  - `POST /api/answers/source-draft`: creates an answer draft and guidance rows from source-wizard output in one API call.
  - `POST /api/answers/{answer_id}/view`: records a view event for analytics.
  - `POST /api/answers/{answer_id}/feedback`: records helpfulness/correction feedback for analytics.
  - `GET /api/answers/stats/summary`: now includes resolve/search/view/feedback event counts.
- API client helpers were added in `lightrag_webui/src/api/lightrag.ts`.
- The FAQ `Sources` screen now uses `source-draft` instead of separate answer/guidance calls, so UI and external integrations share the same materialization contract.
- Verification:
  - Python compile passed for `workspace_routes.py`, `postgres_impl.py`, and `answer_routes.py`.
  - `git diff --check` passed.
  - WebUI `bun run build` succeeded.
  - Server restarted on port `9422`, health check returned healthy.
  - `faq_phase_ab_test_20260517` resolved `FAQ 워크스페이스는 어떻게 답변을 찾나요?` through `/api/answers/search` to `ANS-FAQ-PHASEAB-001`.
  - View and feedback event writes succeeded, and summary stats reported `searches=1`, `views=1`, `feedback=1` for the test workspace.
  - Created a temporary FAQ workspace, copied answer catalog data into it through `copy-data`, confirmed 5 answer rows were visible, then deleted the temporary workspace with `delete_data=true`.
  - Created another temporary FAQ workspace, used `/api/answers/source-draft` to create one structured-source draft plus two guidance rows, searched it with `include_drafts=true`, and deleted the temporary workspace.

### Phase C Source Lineage Status - 2026-05-18

- Added source snapshot and lineage persistence for FAQ/answer-catalog workspaces:
  - `LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS`
  - `LIGHTRAG_ANSWER_SOURCE_LINKS`
- `POST /api/answers/source-draft` now records:
  - immutable source snapshot metadata
  - raw source content hash and preview
  - source profile such as structured columns and row count
  - answer-to-source lineage link for the created answer version
  - `source_snapshot_id` and `source_content_hash` in answer metadata
- Added API endpoints:
  - `GET /api/answers/sources/snapshots`
  - `GET /api/answers/{answer_id}/sources`
- Workspace data lifecycle now includes source snapshots and source links:
  - `copy-data` copies answer source snapshots and links with remapped IDs.
  - workspace deletion cleans source links and snapshots.
- Frontend updates:
  - `Sources` tab shows a source snapshot history panel with source type, preview, linked answer count, structured kind, timestamp, and content hash.
  - Answer detail dialog now has a `Sources` section showing linked snapshots, source URI, profile columns, preview, answer version, and hash.
  - Korean and English i18n keys were added for the new UI copy.
- Verification:
  - Python compile passed for `answer_routes.py`, `workspace_routes.py`, and `postgres_impl.py`.
  - WebUI `bun run build` succeeded.
  - Server restarted on port `9422`, health check returned healthy.
  - Created temporary workspace `faq_phase_c_smoke_20260518`.
  - Created `ANS-PHASE-C-SMOKE-01` through `/api/answers/source-draft`; response included snapshot and source link.
  - Verified `/api/answers/sources/snapshots`, `/api/answers/{answer_id}/sources`, and `/api/answers/search`.
  - Browser verified the `Sources` snapshot history and answer-detail `Sources` section.
  - Copied the temporary workspace data into `faq_phase_c_copy_20260518` and confirmed snapshots/links were copied with remapped IDs.
  - Deleted both temporary workspaces with `delete_data=true`.

### Phase D Structured Source Profiling Status - 2026-05-18

- Added structured source profiling APIs for FAQ/answer-catalog workspaces:
  - `POST /api/answers/structured/profile`
  - `POST /api/answers/structured/materialize`
- Supported source payloads in this phase:
  - CSV / TSV / delimited table text
  - JSON object or array of objects
- The profile response now includes:
  - detected kind, row count, columns, sample rows
  - field-level inferred type, null rate, distinct count, sample values
  - semantic role suggestions such as question, answer, category, status, valid_from, valid_until
  - warnings for truncated or ignored rows
- Materialization now creates:
  - a draft answer dataset with the raw structured content
  - source snapshot and source link records
  - structured profile metadata with mapping and guidance columns
  - guidance rows generated from mapped question/category/title/answer fields
- Frontend updates:
  - `Structured Data` tab has a structured source profiling panel.
  - Operators can paste CSV/JSON, inspect profile fields, review role mapping, choose guidance columns, and create a dataset draft.
  - The existing safe query preview/execute panel can immediately query the created dataset.
  - Korean and English i18n strings were added for the new flow.
- Verification:
  - Python compile passed for `answer_routes.py`.
  - WebUI `bun run build` succeeded.
  - Server restarted on port `9422`, health check returned healthy.
  - Created temporary workspace `faq_phase_d_smoke_20260518`.
  - Verified CSV profile, JSON profile, CSV materialization, structured dataset listing, safe SQL preview, safe query execution, and guidance-driven `/api/answers/search`.
  - Browser verified the `Structured Data` tab profiling UI, role mapping preview, dataset draft creation, and selected dataset state.
  - Deleted the temporary workspace with `delete_data=true` and confirmed the WebUI falls back to `Base`.

### Phase D+ Row Materialization And Lookup Logs Status - 2026-05-18

- Extended structured materialization with two explicit modes:
  - `table_as_dataset`: keeps the Phase D behavior and creates one queryable structured dataset answer.
  - `row_per_answer`: creates one draft answer per source row using mapped question/answer/category fields.
- Added structured lookup audit storage and API:
  - `LIGHTRAG_STRUCTURED_LOOKUP_LOGS`
  - `GET /api/answers/structured/query/logs`
- `POST /api/answers/structured/query` now records preview and execute lookups with dataset ID, pseudo SQL, filters, result count, latency, and source metadata.
- The `Structured Data` tab now shows:
  - materialization mode selection
  - row-per-answer guidance text
  - recent lookup logs for the selected dataset
- Validation and fixes:
  - Found a server error while logging structured lookups because `db.execute()` was called with positional list data. Fixed lookup-log writes and related rollback cleanup paths to use the repository's dictionary parameter convention.
  - Row-per-answer drafts now expose the source row as a single-row structured profile but are excluded from the structured dataset list so answer drafts and queryable datasets do not mix in the UI.
- Preserved test workspace for inspection:
  - workspace ID: `faq_phase_e_test_20260518`
  - workspace name: `FAQ Phase E 테스트 20260518`
  - created row-per-answer drafts:
    - `ANS-f58a1c6e4434` for `환불은 어떻게 하나요?`
    - `ANS-1a7d6b725168` for `비밀번호를 잊어버렸어요`
  - created table dataset:
    - `ANS-82bffb13fd95` for `Phase E 구조화 조회 로그 CSV`
- Verification:
  - Python compile passed for `answer_routes.py`.
  - `ruff check lightrag/api/routers/answer_routes.py` passed.
  - Server restarted on port `9422`, health check returned healthy.
  - Verified `row_per_answer` materialization created two draft answers and `/api/answers/search` matched the refund question to `ANS-f58a1c6e4434`.
  - Verified `table_as_dataset` materialization created `ANS-82bffb13fd95`.
  - Verified structured query preview and execute for `category = Billing`, returning one matching row.
  - Verified lookup logs show both preview and execute rows with pseudo SQL and latency.
  - Browser verified the preserved FAQ workspace, answer-oriented navigation, `Structured Data` tab, mode selector, selected dataset, and recent lookup logs. Browser console error list was empty.
