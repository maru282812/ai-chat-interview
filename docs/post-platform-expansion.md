# Post-Centric Product Expansion

## Role

This document is the first implementation-ready design artifact for expanding the existing LINE AI interview system into a unified product that covers:

1. research capture (`survey` / `interview`)
2. emotional data capture (`rant` / `diary` / `free_comment`)
3. enterprise output generation (analysis and export)

The design keeps the current `answers` and `sessions` model working, then layers a post-centric data asset model on top.

## 1. Post Foundation DB Design

### Core Tables

#### `user_posts`

Single storage layer for all user-authored input.

- `survey`: normal structured survey answer
- `interview`: interview-style answer
- `rant`: free complaint / honest voice
- `diary`: daily feeling log
- `free_comment`: mandatory last open comment for every research project

Recommended fields:

- `id`
- `user_id`
- `respondent_id`
- `type`
- `project_id`
- `session_id`
- `answer_id`
- `source_channel` (`line` / `liff` / `admin` / `system`)
- `menu_action_key`
- `title`
- `content`
- `metadata`
- `posted_on`
- `created_at`
- `updated_at`

Design intent:

- keep one canonical table for all raw qualitative input
- preserve linkage back to existing research objects
- support LINE-native and LIFF-originated posts without schema split

#### `post_analysis`

One analysis record per post.

Recommended fields:

- `id`
- `post_id`
- `analysis_version`
- `summary`
- `tags`
- `sentiment`
- `sentiment_score`
- `keywords`
- `mentioned_brands`
- `pii_flags`
- `actionability`
- `personality_signals`
- `behavior_signals`
- `raw_json`
- `analyzed_at`
- `created_at`
- `updated_at`

Design intent:

- store normalized AI outputs separately from raw input
- allow re-analysis by version without mutating original posts
- expose high-value filters to admin and export layers

#### `user_personality_profiles`

Latest personality / behavior diagnosis per user.

Recommended fields:

- `id`
- `user_id`
- `respondent_id`
- `latest_post_id`
- `summary`
- `traits`
- `segments`
- `confidence`
- `evidence_post_ids`
- `raw_json`
- `created_at`
- `updated_at`

Design intent:

- keep personality inference out of `respondents`
- make personality reusable for enterprise segmentation
- keep evidence traceable to source posts

### Config Tables

#### `line_menu_actions`

DB-driven rich menu action registry.

Recommended fields:

- `id`
- `menu_key`
- `label`
- `action_type`
- `action_payload`
- `liff_path`
- `icon_key`
- `sort_order`
- `is_active`
- `audience_rule`
- `created_at`
- `updated_at`

Action types for initial rollout:

- `start_project_list`
- `resume_project`
- `open_post_mode`
- `open_liff`
- `show_mypage`
- `show_personality`

#### `liff_entrypoints`

LIFF page registry to avoid hardcoding URLs in service logic.

Recommended fields:

- `id`
- `entry_key`
- `title`
- `path`
- `entry_type`
- `settings_json`
- `is_active`
- `created_at`
- `updated_at`

### Derived View

#### `project_high_value_posts`

View that exposes only `free_comment`, `rant`, and `diary` with analysis columns joined in.

Use cases:

- admin filtering
- CSV export
- high-insight comment extraction

## 2. Integration Policy With Existing Answers

### Keep Existing Runtime Stable

Current orchestration remains the source of truth for question flow:

- `projects`
- `questions`
- `respondents`
- `sessions`
- `answers`

### Dual Write Policy

When the user answers a survey or interview question:

1. write `answers`
2. write `user_posts`
3. store `answer_id` on `user_posts`
4. copy mode-derived type:
   - project `survey` -> post `survey`
   - project `interview` or `survey_with_interview_probe` -> post `interview`

This keeps current behavior intact while building the unified post asset.

### Free Comment Injection

Every project must end with a mandatory `free_comment` capture step.

Recommended implementation:

- inject a virtual terminal step from orchestration code, not by forcing every admin user to create the same final question manually
- save the response in both:
  - `answers`
  - `user_posts` with `type = free_comment`

Metadata to attach:

- `question_code = "__free_comment__"`
- `answer_role`
- `question_role = "free_comment"`
- `quality_score` when available

### Historical Migration Policy

Do not block the new feature set on full backfill.

Phase order:

1. new inputs use dual write immediately
2. optional batch backfill copies historical `answers` into `user_posts`
3. enterprise exports read both old and new data until backfill is complete

## 3. Rich Menu Flow Design

### Initial Menu

- `調査に参加`
- `本音・悩み`
- `今日の気持ち`
- `マイページ`
- `性格診断`

### Routing Policy

`menuActionService` should no longer map only fixed text commands. It should resolve actions from `line_menu_actions`.

Recommended behavior:

- `調査に参加` -> list actionable projects, or resume active session
- `本音・悩み` -> open LIFF long-form composer, fallback to LINE text mode if LIFF unavailable
- `今日の気持ち` -> open diary LIFF calendar/composer
- `マイページ` -> keep current rank/points card, later extend with post history
- `性格診断` -> run latest diagnosis snapshot, then show summary and LIFF detail link

### Fallback Policy

Text commands remain valid for operational safety:

- `案件一覧`
- `再開`
- `ポイント確認`
- `ランク確認`

## 4. LIFF Introduction Scope

### Must Use LIFF

- rant long-form input
- diary calendar UI
- diary history browsing
- personality detail page

### Can Stay On LINE

- survey/interview short answers
- project start/resume
- simple free comment
- summary replies and diagnosis teaser

### Recommended LIFF Pages

- `/liff/rant`
- `/liff/diary`
- `/liff/diary/calendar`
- `/liff/mypage`
- `/liff/personality`

### Design Rule

LIFF is a UX enhancer, not a required dependency for core response capture.

If LIFF fails, the user must still be able to submit content in LINE.

## 5. Prompt Catalog And Responsibilities

Introduce `promptBuilder` as the central prompt registry. Split prompts by responsibility rather than by route or service.

### 1. Question Rendering

Purpose:

- render the same question differently by mode
- hide `Q1`, `問1`, and other index labels from user-facing text

Rules:

- `survey`: short and direct
- `interview`: conversational and natural

### 2. Probe Generation

Purpose:

- generate follow-up only when the answer is weak
- target `where`, `why`, `in what situation`

Rules:

- improve answer first
- evaluate after the improved answer is collected
- return one follow-up at a time

### 3. Answer Quality Evaluation

Purpose:

- assign `S / A / B / C / D`
- decide whether probe is required

Evaluation axes:

- specificity
- intent fit
- information density
- sincerity
- business usability

### 4. Free Comment Analysis

Purpose:

- analyze final free comment from projects

Output:

- summary
- tags
- keywords
- sentiment
- actionability
- pii flags

### 5. Post Analysis (`rant` / `diary`)

Purpose:

- analyze emotional logs outside research sessions

Output:

- summary
- emotion
- triggers
- mentioned brands
- behavior signals
- actionability
- risk flags

### 6. Personality Diagnosis

Purpose:

- infer stable traits from accumulated posts
- produce user-facing and enterprise-facing outputs separately

Output:

- short trait summary
- evidence-backed traits
- confidence
- segment labels
- recommended activation hints for enterprise use

## 6. Enterprise Output Data Design

### Core Respondent Profile

Each enterprise record should be buildable without a new UI layer.

Recommended response shape:

- `respondent`
- `project_participation`
- `answers`
- `answer_analysis`
- `post_summary`
- `high_value_posts`
- `personality_profile`
- `behavior_tendencies`
- `interview_history`
- `sentiment_rollup`

### High-Value Inputs

Treat these as a separate analytical axis:

- `free_comment`
- `rant`
- `diary`

They should be exportable both:

- mixed into respondent profile
- as their own filtered feed

### API Surface

Recommended initial endpoints:

- `GET /admin/projects/:projectId/output/respondents`
- `GET /admin/projects/:projectId/output/posts`
- `GET /admin/projects/:projectId/output/high-value-posts`
- `GET /admin/respondents/:respondentId/profile`

### CSV Export Shapes

#### Respondent profile CSV

Columns:

- respondent identifiers
- project identifiers
- structured answers
- answer summaries
- post counts by type
- latest sentiment
- personality segment
- latest rant summary
- latest diary summary

#### Post feed CSV

Columns:

- post id
- user id
- type
- project id
- session id
- content
- summary
- tags
- sentiment
- keywords
- actionability
- created at

#### High-value post CSV

Same as post feed, filtered to:

- `free_comment`
- `rant`
- `diary`

## 7. Existing Code Impact Map

### High Impact Files

#### `src/services/conversationOrchestratorService.ts`

Changes needed:

- dual write from `answers` to `user_posts`
- free comment terminal step
- branch into rant/diary capture mode
- invoke post analysis and personality refresh asynchronously

#### `src/services/menuActionService.ts`

Changes needed:

- replace fixed command map with DB-configured menu actions
- add `open_post_mode`, `open_liff`, `show_personality`

#### `src/services/analysisService.ts`

Changes needed:

- split session analysis and post analysis responsibilities
- add `analyzePost`
- add `extractHighInsightPosts`

#### `src/services/csvService.ts`

Changes needed:

- add respondent profile export
- add post feed export
- add high-value post export

#### `src/services/adminService.ts`

Changes needed:

- add post list query
- add filters by tags / keywords / sentiment / actionability
- add respondent unified profile query

### New Services

#### `src/services/postService.ts`

Responsibility:

- create and list posts
- dual write helper from answers
- rant/diary/free-comment capture

#### `src/services/personalityService.ts`

Responsibility:

- aggregate post evidence
- generate and cache user personality profile

#### `src/services/promptBuilder.ts`

Responsibility:

- central prompt catalog
- prompt versioning
- mode-aware prompt composition

### New Repositories

- `src/repositories/postRepository.ts`
- `src/repositories/postAnalysisRepository.ts`
- `src/repositories/personalityProfileRepository.ts`
- `src/repositories/menuActionRepository.ts`
- `src/repositories/liffEntrypointRepository.ts`

### Admin UI Impact

Add pages or sections for:

- free comment list
- post list
- tag search
- keyword search
- sentiment filter
- high-actionability extraction

### Prompt Layer Impact

Current prompt modules should be split into:

- research runtime prompts
- post analysis prompts
- personality prompts
- enterprise synthesis prompts

## Recommended Build Order

1. migration + repositories
2. `postService` dual write
3. mandatory `free_comment`
4. rant and diary capture
5. post analysis
6. personality diagnosis
7. admin filters and CSV
