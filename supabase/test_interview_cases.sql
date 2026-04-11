-- Test interview conversation cases for project:
-- 00000000-0000-4000-8000-000000000002
--
-- Prerequisite:
--   Run supabase/test_interview_project.sql first.
--
-- What this file creates:
--   Case 01: completed interview with AI probe on Q2
--   Case 02: completed interview without AI probe
--   Case 03: in-progress interview waiting on Q3

do $$
begin
  if not exists (
    select 1
    from projects
    where id = '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Project 00000000-0000-4000-8000-000000000002 not found. Run supabase/test_interview_project.sql first.';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from questions
    where project_id = '00000000-0000-4000-8000-000000000002'
      and question_code in ('Q1', 'Q2', 'Q3', '__free_comment__')
    group by project_id
    having count(*) = 4
  ) then
    raise exception 'Interview questions for test project are missing. Run supabase/test_interview_project.sql first.';
  end if;
end $$;

-- Clean up previous run
delete from ai_analysis_results
where session_id in (
  '00000000-0000-4000-8000-000000003001',
  '00000000-0000-4000-8000-000000003002',
  '00000000-0000-4000-8000-000000003003'
);

delete from answer_extractions
where source_answer_id in (
  '00000000-0000-4000-8000-000000004001',
  '00000000-0000-4000-8000-000000004002',
  '00000000-0000-4000-8000-000000004004',
  '00000000-0000-4000-8000-000000004007',
  '00000000-0000-4000-8000-000000004008',
  '00000000-0000-4000-8000-000000004010',
  '00000000-0000-4000-8000-000000004012'
);

delete from point_transactions
where id in (
  '00000000-0000-4000-8000-000000007001',
  '00000000-0000-4000-8000-000000007002'
)
or respondent_id in (
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000001002',
  '00000000-0000-4000-8000-000000001003'
);

delete from messages
where session_id in (
  '00000000-0000-4000-8000-000000003001',
  '00000000-0000-4000-8000-000000003002',
  '00000000-0000-4000-8000-000000003003'
);

delete from answers
where session_id in (
  '00000000-0000-4000-8000-000000003001',
  '00000000-0000-4000-8000-000000003002',
  '00000000-0000-4000-8000-000000003003'
);

delete from project_assignments
where id in (
  '00000000-0000-4000-8000-000000002001',
  '00000000-0000-4000-8000-000000002002',
  '00000000-0000-4000-8000-000000002003'
);

delete from sessions
where id in (
  '00000000-0000-4000-8000-000000003001',
  '00000000-0000-4000-8000-000000003002',
  '00000000-0000-4000-8000-000000003003'
);

delete from respondents
where project_id = '00000000-0000-4000-8000-000000000002'
  and line_user_id in (
    'U_TEST_INTERVIEW_CASE_01',
    'U_TEST_INTERVIEW_CASE_02',
    'U_TEST_INTERVIEW_CASE_03'
  );

-- Respondents
insert into respondents (
  id,
  line_user_id,
  display_name,
  project_id,
  status,
  total_points,
  current_rank_id,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001001',
    'U_TEST_INTERVIEW_CASE_01',
    'Case 01 短答深掘り完了',
    '00000000-0000-4000-8000-000000000002',
    'active',
    10,
    null,
    '2026-04-01T10:00:00+09:00',
    '2026-04-01T10:08:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    'U_TEST_INTERVIEW_CASE_02',
    'Case 02 十分回答完了',
    '00000000-0000-4000-8000-000000000002',
    'active',
    20,
    null,
    '2026-04-02T20:00:00+09:00',
    '2026-04-02T20:07:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000001003',
    'U_TEST_INTERVIEW_CASE_03',
    'Case 03 途中再開用',
    '00000000-0000-4000-8000-000000000002',
    'active',
    0,
    null,
    '2026-04-06T08:00:00+09:00',
    '2026-04-06T08:05:00+09:00'
  );

-- Assignments
insert into project_assignments (
  id,
  user_id,
  project_id,
  respondent_id,
  assignment_type,
  status,
  assigned_at,
  deadline,
  sent_at,
  opened_at,
  started_at,
  completed_at,
  expired_at,
  reminder_sent_at,
  last_delivery_error,
  delivery_log,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000002001',
    'U_TEST_INTERVIEW_CASE_01',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000001001',
    'manual',
    'completed',
    '2026-04-01T09:55:00+09:00',
    null,
    '2026-04-01T09:55:10+09:00',
    '2026-04-01T10:00:00+09:00',
    '2026-04-01T10:00:20+09:00',
    '2026-04-01T10:08:00+09:00',
    null,
    null,
    null,
    '[
      {"at":"2026-04-01T09:55:10+09:00","result":"success","type":"invite_push","assignment_type":"manual"},
      {"at":"2026-04-01T10:00:00+09:00","result":"opened","type":"project_list"},
      {"at":"2026-04-01T10:08:00+09:00","result":"completed","type":"session_completed"}
    ]'::jsonb,
    '2026-04-01T09:55:00+09:00',
    '2026-04-01T10:08:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000002002',
    'U_TEST_INTERVIEW_CASE_02',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000001002',
    'manual',
    'completed',
    '2026-04-02T19:55:00+09:00',
    null,
    '2026-04-02T19:55:10+09:00',
    '2026-04-02T20:00:00+09:00',
    '2026-04-02T20:00:15+09:00',
    '2026-04-02T20:07:00+09:00',
    null,
    null,
    null,
    '[
      {"at":"2026-04-02T19:55:10+09:00","result":"success","type":"invite_push","assignment_type":"manual"},
      {"at":"2026-04-02T20:00:00+09:00","result":"opened","type":"project_list"},
      {"at":"2026-04-02T20:07:00+09:00","result":"completed","type":"session_completed"}
    ]'::jsonb,
    '2026-04-02T19:55:00+09:00',
    '2026-04-02T20:07:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000002003',
    'U_TEST_INTERVIEW_CASE_03',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000001003',
    'manual',
    'started',
    '2026-04-06T07:55:00+09:00',
    null,
    '2026-04-06T07:55:10+09:00',
    '2026-04-06T08:00:00+09:00',
    '2026-04-06T08:00:20+09:00',
    null,
    null,
    null,
    null,
    '[
      {"at":"2026-04-06T07:55:10+09:00","result":"success","type":"invite_push","assignment_type":"manual"},
      {"at":"2026-04-06T08:00:00+09:00","result":"opened","type":"project_list"},
      {"at":"2026-04-06T08:00:20+09:00","result":"started","type":"session_started"}
    ]'::jsonb,
    '2026-04-06T07:55:00+09:00',
    '2026-04-06T08:05:30+09:00'
  );

-- Sessions
insert into sessions (
  id,
  respondent_id,
  project_id,
  current_question_id,
  current_phase,
  status,
  summary,
  state_json,
  started_at,
  completed_at,
  last_activity_at
)
values
  (
    '00000000-0000-4000-8000-000000003001',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000002',
    null,
    'completed',
    'completed',
    '利用頻度は高い。出勤前の時短用途が主で、昼のレジ待ちに不満がある。',
    '{
      "phase":"completed",
      "currentQuestionIndex":3,
      "answersSinceSummary":0,
      "aiProbeCount":1,
      "aiProbeCountCurrentAnswer":0,
      "pendingQuestionId":null,
      "pendingProbeQuestion":null,
      "pendingProbeSourceQuestionId":null,
      "pendingProbeSourceAnswerId":null,
      "pendingProbeReason":null,
      "pendingProbeType":null,
      "pendingProbeMissingSlots":[],
      "pendingFreeComment":false,
      "freeCommentPromptShown":false,
      "freeCommentProbeAsked":false,
      "pendingFreeCommentPrompt":null,
      "pendingFreeCommentSourceAnswerId":null,
      "pendingFreeCommentSourceText":null,
      "pendingFreeCommentReason":null,
      "pendingFreeCommentProbeType":null,
      "pendingFreeCommentMissingSlots":[],
      "finalQuestionCompletedAt":null
    }'::jsonb,
    '2026-04-01T10:00:20+09:00',
    '2026-04-01T10:08:00+09:00',
    '2026-04-01T10:08:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000003002',
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000000002',
    null,
    'completed',
    'completed',
    '週2〜3回利用。通勤前と昼食調達が主で、品切れに改善要望がある。',
    '{
      "phase":"completed",
      "currentQuestionIndex":3,
      "answersSinceSummary":0,
      "aiProbeCount":0,
      "aiProbeCountCurrentAnswer":0,
      "pendingQuestionId":null,
      "pendingProbeQuestion":null,
      "pendingProbeSourceQuestionId":null,
      "pendingProbeSourceAnswerId":null,
      "pendingProbeReason":null,
      "pendingProbeType":null,
      "pendingProbeMissingSlots":[],
      "pendingFreeComment":false,
      "freeCommentPromptShown":false,
      "freeCommentProbeAsked":false,
      "pendingFreeCommentPrompt":null,
      "pendingFreeCommentSourceAnswerId":null,
      "pendingFreeCommentSourceText":null,
      "pendingFreeCommentReason":null,
      "pendingFreeCommentProbeType":null,
      "pendingFreeCommentMissingSlots":[],
      "finalQuestionCompletedAt":null
    }'::jsonb,
    '2026-04-02T20:00:15+09:00',
    '2026-04-02T20:07:00+09:00',
    '2026-04-02T20:07:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000003003',
    '00000000-0000-4000-8000-000000001003',
    '00000000-0000-4000-8000-000000000002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q3'),
    'question',
    'active',
    '朝の軽食購入が主用途。Q2 で一度深掘り済み。',
    '{
      "phase":"question",
      "currentQuestionIndex":2,
      "answersSinceSummary":3,
      "aiProbeCount":1,
      "aiProbeCountCurrentAnswer":0,
      "pendingQuestionId":null,
      "pendingProbeQuestion":null,
      "pendingProbeSourceQuestionId":null,
      "pendingProbeSourceAnswerId":null,
      "pendingProbeReason":null,
      "pendingProbeType":null,
      "pendingProbeMissingSlots":[],
      "pendingFreeComment":false,
      "freeCommentPromptShown":false,
      "freeCommentProbeAsked":false,
      "pendingFreeCommentPrompt":null,
      "pendingFreeCommentSourceAnswerId":null,
      "pendingFreeCommentSourceText":null,
      "pendingFreeCommentReason":null,
      "pendingFreeCommentProbeType":null,
      "pendingFreeCommentMissingSlots":[],
      "lastQuestionText":"コンビニに対して不満や改善してほしい点があれば教えてください。\n小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください",
      "lastQuestionEmbedding":[],
      "lastProbeType":null
    }'::jsonb,
    '2026-04-06T08:00:20+09:00',
    null,
    '2026-04-06T08:05:30+09:00'
  );

-- Messages
insert into messages (id, session_id, sender_type, message_text, raw_payload, created_at)
values
  -- Case 01
  ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-000000003001', 'system', 'session_started', null, '2026-04-01T10:00:20+09:00'),
  ('00000000-0000-4000-8000-000000005002', '00000000-0000-4000-8000-000000003001', 'assistant', '普段どれくらいの頻度でコンビニを利用しますか？
1. ほぼ毎日
2. 週に4〜6回
3. 週に2〜3回
4. 週に1回くらい
5. 月に数回以下
番号でも回答できます', null, '2026-04-01T10:00:21+09:00'),
  ('00000000-0000-4000-8000-000000005003', '00000000-0000-4000-8000-000000003001', 'user', '1', null, '2026-04-01T10:00:35+09:00'),
  ('00000000-0000-4000-8000-000000005004', '00000000-0000-4000-8000-000000003001', 'assistant', 'どのような場面でコンビニを利用することが多いですか？
利用するタイミングや、そのとき買うものがあれば一緒に教えてください', null, '2026-04-01T10:00:36+09:00'),
  ('00000000-0000-4000-8000-000000005005', '00000000-0000-4000-8000-000000003001', 'user', '朝に使います', null, '2026-04-01T10:00:50+09:00'),
  ('00000000-0000-4000-8000-000000005006', '00000000-0000-4000-8000-000000003001', 'assistant', 'その場面で使う理由や、実際にどんな買い方をするかまで具体的に教えてください', null, '2026-04-01T10:00:51+09:00'),
  ('00000000-0000-4000-8000-000000005007', '00000000-0000-4000-8000-000000003001', 'user', '出勤前に駅前でコーヒーとパンを買います。時間がないので早く買えて助かっています。', null, '2026-04-01T10:01:20+09:00'),
  ('00000000-0000-4000-8000-000000005008', '00000000-0000-4000-8000-000000003001', 'assistant', 'コンビニに対して不満や改善してほしい点があれば教えてください。
小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください', null, '2026-04-01T10:01:21+09:00'),
  ('00000000-0000-4000-8000-000000005009', '00000000-0000-4000-8000-000000003001', 'user', '昼休みはレジ待ちが長くて、急いでいる日にかなりストレスです。セルフレジがもっと増えると助かります。', null, '2026-04-01T10:01:55+09:00'),
  ('00000000-0000-4000-8000-000000005010', '00000000-0000-4000-8000-000000003001', 'assistant', '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。', null, '2026-04-01T10:01:56+09:00'),
  ('00000000-0000-4000-8000-000000005011', '00000000-0000-4000-8000-000000003001', 'user', 'ATMや宅配の受け取りでも使うので、そのあたりも便利です。', null, '2026-04-01T10:02:20+09:00'),
  ('00000000-0000-4000-8000-000000005012', '00000000-0000-4000-8000-000000003001', 'system', 'session_completed', null, '2026-04-01T10:08:00+09:00'),

  -- Case 02
  ('00000000-0000-4000-8000-000000005013', '00000000-0000-4000-8000-000000003002', 'system', 'session_started', null, '2026-04-02T20:00:15+09:00'),
  ('00000000-0000-4000-8000-000000005014', '00000000-0000-4000-8000-000000003002', 'assistant', '普段どれくらいの頻度でコンビニを利用しますか？
1. ほぼ毎日
2. 週に4〜6回
3. 週に2〜3回
4. 週に1回くらい
5. 月に数回以下
番号でも回答できます', null, '2026-04-02T20:00:16+09:00'),
  ('00000000-0000-4000-8000-000000005015', '00000000-0000-4000-8000-000000003002', 'user', '3', null, '2026-04-02T20:00:28+09:00'),
  ('00000000-0000-4000-8000-000000005016', '00000000-0000-4000-8000-000000003002', 'assistant', 'どのような場面でコンビニを利用することが多いですか？
利用するタイミングや、そのとき買うものがあれば一緒に教えてください', null, '2026-04-02T20:00:29+09:00'),
  ('00000000-0000-4000-8000-000000005017', '00000000-0000-4000-8000-000000003002', 'user', '平日の通勤前に飲み物を買うときと、昼休みに昼食を手早く済ませたいときによく使います。近くにあって短時間で必要なものをそろえられるので助かっています。', null, '2026-04-02T20:01:10+09:00'),
  ('00000000-0000-4000-8000-000000005018', '00000000-0000-4000-8000-000000003002', 'assistant', 'コンビニに対して不満や改善してほしい点があれば教えてください。
小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください', null, '2026-04-02T20:01:11+09:00'),
  ('00000000-0000-4000-8000-000000005019', '00000000-0000-4000-8000-000000003002', 'user', '昼の時間帯に人気の商品が売り切れていることがあり、食べたいものを買えないのが少し不満です。補充の頻度が上がるとうれしいです。', null, '2026-04-02T20:01:55+09:00'),
  ('00000000-0000-4000-8000-000000005020', '00000000-0000-4000-8000-000000003002', 'assistant', '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。', null, '2026-04-02T20:01:56+09:00'),
  ('00000000-0000-4000-8000-000000005021', '00000000-0000-4000-8000-000000003002', 'user', 'スイーツや新商品の入れ替えが早いのは楽しみです。', null, '2026-04-02T20:02:18+09:00'),
  ('00000000-0000-4000-8000-000000005022', '00000000-0000-4000-8000-000000003002', 'system', 'session_completed', null, '2026-04-02T20:07:00+09:00'),

  -- Case 03
  ('00000000-0000-4000-8000-000000005023', '00000000-0000-4000-8000-000000003003', 'system', 'session_started', null, '2026-04-06T08:00:20+09:00'),
  ('00000000-0000-4000-8000-000000005024', '00000000-0000-4000-8000-000000003003', 'assistant', '普段どれくらいの頻度でコンビニを利用しますか？
1. ほぼ毎日
2. 週に4〜6回
3. 週に2〜3回
4. 週に1回くらい
5. 月に数回以下
番号でも回答できます', null, '2026-04-06T08:00:21+09:00'),
  ('00000000-0000-4000-8000-000000005025', '00000000-0000-4000-8000-000000003003', 'user', '2', null, '2026-04-06T08:00:34+09:00'),
  ('00000000-0000-4000-8000-000000005026', '00000000-0000-4000-8000-000000003003', 'assistant', 'どのような場面でコンビニを利用することが多いですか？
利用するタイミングや、そのとき買うものがあれば一緒に教えてください', null, '2026-04-06T08:00:35+09:00'),
  ('00000000-0000-4000-8000-000000005027', '00000000-0000-4000-8000-000000003003', 'user', '朝です', null, '2026-04-06T08:00:48+09:00'),
  ('00000000-0000-4000-8000-000000005028', '00000000-0000-4000-8000-000000003003', 'assistant', 'その場面で使う理由や、実際にどんな買い方をするかまで具体的に教えてください', null, '2026-04-06T08:00:49+09:00'),
  ('00000000-0000-4000-8000-000000005029', '00000000-0000-4000-8000-000000003003', 'user', '出勤前におにぎりとお茶を買うことが多いです。時間がないので近くてすぐ買えるのが理由です。', null, '2026-04-06T08:01:18+09:00'),
  ('00000000-0000-4000-8000-000000005030', '00000000-0000-4000-8000-000000003003', 'assistant', 'コンビニに対して不満や改善してほしい点があれば教えてください。
小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください', null, '2026-04-06T08:01:19+09:00');

-- Answers
insert into answers (
  id,
  session_id,
  question_id,
  answer_text,
  answer_role,
  parent_answer_id,
  normalized_answer,
  created_at
)
values
  -- Case 01
  (
    '00000000-0000-4000-8000-000000004001',
    '00000000-0000-4000-8000-000000003001',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q1'),
    'ほぼ毎日',
    'primary',
    null,
    '{"value":"daily","label":"ほぼ毎日"}'::jsonb,
    '2026-04-01T10:00:35+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004002',
    '00000000-0000-4000-8000-000000003001',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    '朝に使います',
    'primary',
    null,
    '{
      "value":"朝に使います",
      "source":"primary",
      "structured_summary":"出勤前に駅前のコンビニでコーヒーとパンを買う。時間がないので利用している。",
      "extracted_slot_map":{
        "usage_scene":"出勤前",
        "usage_reason":"時間がないから",
        "usage_example":"駅前でコーヒーとパンを買う",
        "emotion":"早く買えて助かる"
      },
      "extracted_slots":[
        {"key":"usage_scene","value":"出勤前"},
        {"key":"usage_reason","value":"時間がないから"},
        {"key":"usage_example","value":"駅前でコーヒーとパンを買う"},
        {"key":"emotion","value":"早く買えて助かる"}
      ],
      "comparable_payload":{
        "usage_scene":"出勤前",
        "usage_reason":"時間がないから",
        "emotion":"助かる"
      },
      "completion":{
        "is_complete":true,
        "missing_slots":[],
        "reasons":[],
        "quality_score":88
      },
      "suggested_next_action":"ask_next"
    }'::jsonb,
    '2026-04-01T10:00:50+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004003',
    '00000000-0000-4000-8000-000000003001',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    '出勤前に駅前でコーヒーとパンを買います。時間がないので早く買えて助かっています。',
    'ai_probe',
    '00000000-0000-4000-8000-000000004002',
    '{
      "source":"ai_probe",
      "probe_type":"concretize",
      "structured_summary":"出勤前に駅前のコンビニでコーヒーとパンを買う。時間がないので利用している。"
    }'::jsonb,
    '2026-04-01T10:01:20+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004004',
    '00000000-0000-4000-8000-000000003001',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q3'),
    '昼休みはレジ待ちが長くて、急いでいる日にかなりストレスです。セルフレジがもっと増えると助かります。',
    'primary',
    null,
    '{
      "value":"昼休みはレジ待ちが長くて、急いでいる日にかなりストレスです。セルフレジがもっと増えると助かります。",
      "source":"primary",
      "structured_summary":"昼休みのレジ待ちが長く、急いでいるときに強いストレスを感じる。セルフレジ増設を希望。",
      "extracted_slot_map":{
        "pain_point":"レジ待ちが長い",
        "pain_scene":"昼休み",
        "improvement_request":"セルフレジを増やしてほしい",
        "emotion":"かなりストレス"
      },
      "extracted_slots":[
        {"key":"pain_point","value":"レジ待ちが長い"},
        {"key":"pain_scene","value":"昼休み"},
        {"key":"improvement_request","value":"セルフレジを増やしてほしい"},
        {"key":"emotion","value":"かなりストレス"}
      ],
      "comparable_payload":{
        "pain_point":"レジ待ちが長い",
        "pain_scene":"昼休み",
        "improvement_request":"セルフレジを増やしてほしい"
      },
      "completion":{
        "is_complete":true,
        "missing_slots":[],
        "reasons":[],
        "quality_score":92
      },
      "suggested_next_action":"finish"
    }'::jsonb,
    '2026-04-01T10:01:55+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004005',
    '00000000-0000-4000-8000-000000003001',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = '__free_comment__'),
    'ATMや宅配の受け取りでも使うので、そのあたりも便利です。',
    'primary',
    null,
    '{
      "value":"ATMや宅配の受け取りでも使うので、そのあたりも便利です。",
      "source":"free_comment",
      "structured_summary":"買い物以外にATMや宅配受け取り用途でも利便性を感じている。"
    }'::jsonb,
    '2026-04-01T10:02:20+09:00'
  ),

  -- Case 02
  (
    '00000000-0000-4000-8000-000000004006',
    '00000000-0000-4000-8000-000000003002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q1'),
    '週に2〜3回',
    'primary',
    null,
    '{"value":"2_3_per_week","label":"週に2〜3回"}'::jsonb,
    '2026-04-02T20:00:28+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004007',
    '00000000-0000-4000-8000-000000003002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    '平日の通勤前に飲み物を買うときと、昼休みに昼食を手早く済ませたいときによく使います。近くにあって短時間で必要なものをそろえられるので助かっています。',
    'primary',
    null,
    '{
      "value":"平日の通勤前に飲み物を買うときと、昼休みに昼食を手早く済ませたいときによく使います。近くにあって短時間で必要なものをそろえられるので助かっています。",
      "source":"primary",
      "structured_summary":"通勤前と昼休みに利用。近くて短時間で必要な物をそろえられる点に価値を感じている。",
      "extracted_slot_map":{
        "usage_scene":"通勤前、昼休み",
        "usage_reason":"近くて短時間で必要なものをそろえられるから",
        "usage_example":"飲み物、昼食",
        "emotion":"助かっている"
      },
      "extracted_slots":[
        {"key":"usage_scene","value":"通勤前、昼休み"},
        {"key":"usage_reason","value":"近くて短時間で必要なものをそろえられるから"},
        {"key":"usage_example","value":"飲み物、昼食"},
        {"key":"emotion","value":"助かっている"}
      ],
      "comparable_payload":{
        "usage_scene":"通勤前、昼休み",
        "usage_reason":"近くて短時間で必要なものをそろえられるから"
      },
      "completion":{
        "is_complete":true,
        "missing_slots":[],
        "reasons":[],
        "quality_score":94
      },
      "suggested_next_action":"ask_next"
    }'::jsonb,
    '2026-04-02T20:01:10+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004008',
    '00000000-0000-4000-8000-000000003002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q3'),
    '昼の時間帯に人気の商品が売り切れていることがあり、食べたいものを買えないのが少し不満です。補充の頻度が上がるとうれしいです。',
    'primary',
    null,
    '{
      "value":"昼の時間帯に人気の商品が売り切れていることがあり、食べたいものを買えないのが少し不満です。補充の頻度が上がるとうれしいです。",
      "source":"primary",
      "structured_summary":"昼の人気商品の品切れに不満。補充頻度向上を要望。",
      "extracted_slot_map":{
        "pain_point":"人気商品の品切れ",
        "pain_scene":"昼の時間帯",
        "improvement_request":"補充の頻度を上げてほしい",
        "emotion":"少し不満"
      },
      "extracted_slots":[
        {"key":"pain_point","value":"人気商品の品切れ"},
        {"key":"pain_scene","value":"昼の時間帯"},
        {"key":"improvement_request","value":"補充の頻度を上げてほしい"},
        {"key":"emotion","value":"少し不満"}
      ],
      "comparable_payload":{
        "pain_point":"人気商品の品切れ",
        "pain_scene":"昼の時間帯",
        "improvement_request":"補充の頻度を上げてほしい"
      },
      "completion":{
        "is_complete":true,
        "missing_slots":[],
        "reasons":[],
        "quality_score":90
      },
      "suggested_next_action":"finish"
    }'::jsonb,
    '2026-04-02T20:01:55+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004009',
    '00000000-0000-4000-8000-000000003002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = '__free_comment__'),
    'スイーツや新商品の入れ替えが早いのは楽しみです。',
    'primary',
    null,
    '{
      "value":"スイーツや新商品の入れ替えが早いのは楽しみです。",
      "source":"free_comment",
      "structured_summary":"不満だけでなく、新商品回転の速さを楽しんでいる。"
    }'::jsonb,
    '2026-04-02T20:02:18+09:00'
  ),

  -- Case 03
  (
    '00000000-0000-4000-8000-000000004010',
    '00000000-0000-4000-8000-000000003003',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q1'),
    '週に4〜6回',
    'primary',
    null,
    '{"value":"4_6_per_week","label":"週に4〜6回"}'::jsonb,
    '2026-04-06T08:00:34+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004011',
    '00000000-0000-4000-8000-000000003003',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    '朝です',
    'primary',
    null,
    '{
      "value":"朝です",
      "source":"primary",
      "structured_summary":"出勤前におにぎりとお茶を買う。時間がないためコンビニを使う。",
      "extracted_slot_map":{
        "usage_scene":"出勤前",
        "usage_reason":"時間がないから",
        "usage_example":"おにぎりとお茶を買う"
      },
      "extracted_slots":[
        {"key":"usage_scene","value":"出勤前"},
        {"key":"usage_reason","value":"時間がないから"},
        {"key":"usage_example","value":"おにぎりとお茶を買う"}
      ],
      "comparable_payload":{
        "usage_scene":"出勤前",
        "usage_reason":"時間がないから"
      },
      "completion":{
        "is_complete":true,
        "missing_slots":[],
        "reasons":[],
        "quality_score":81
      },
      "suggested_next_action":"ask_next"
    }'::jsonb,
    '2026-04-06T08:00:48+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000004012',
    '00000000-0000-4000-8000-000000003003',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    '出勤前におにぎりとお茶を買うことが多いです。時間がないので近くてすぐ買えるのが理由です。',
    'ai_probe',
    '00000000-0000-4000-8000-000000004011',
    '{
      "source":"ai_probe",
      "probe_type":"clarify",
      "structured_summary":"出勤前におにぎりとお茶を買う。時間がないため近くて早く買える点を評価している。"
    }'::jsonb,
    '2026-04-06T08:01:18+09:00'
  );

-- Answer extractions for primary text answers
insert into answer_extractions (
  id,
  source_answer_id,
  project_id,
  question_id,
  extraction_status,
  extraction_method,
  extracted_json,
  extracted_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000008001',
    '00000000-0000-4000-8000-000000004002',
    '00000000-0000-4000-8000-000000000002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    'completed',
    'rule_based',
    '{"usage_scene":"出勤前","usage_reason":"時間がないから","usage_example":"駅前でコーヒーとパンを買う","emotion":"早く買えて助かる"}'::jsonb,
    '2026-04-01T10:01:21+09:00',
    '2026-04-01T10:01:21+09:00',
    '2026-04-01T10:01:21+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000008002',
    '00000000-0000-4000-8000-000000004004',
    '00000000-0000-4000-8000-000000000002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q3'),
    'completed',
    'rule_based',
    '{"pain_point":"レジ待ちが長い","pain_scene":"昼休み","improvement_request":"セルフレジを増やしてほしい","emotion":"かなりストレス"}'::jsonb,
    '2026-04-01T10:01:56+09:00',
    '2026-04-01T10:01:56+09:00',
    '2026-04-01T10:01:56+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000008003',
    '00000000-0000-4000-8000-000000004007',
    '00000000-0000-4000-8000-000000000002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    'completed',
    'rule_based',
    '{"usage_scene":"通勤前、昼休み","usage_reason":"近くて短時間で必要なものをそろえられるから","usage_example":"飲み物、昼食","emotion":"助かっている"}'::jsonb,
    '2026-04-02T20:01:11+09:00',
    '2026-04-02T20:01:11+09:00',
    '2026-04-02T20:01:11+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000008004',
    '00000000-0000-4000-8000-000000004008',
    '00000000-0000-4000-8000-000000000002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q3'),
    'completed',
    'rule_based',
    '{"pain_point":"人気商品の品切れ","pain_scene":"昼の時間帯","improvement_request":"補充の頻度を上げてほしい","emotion":"少し不満"}'::jsonb,
    '2026-04-02T20:01:56+09:00',
    '2026-04-02T20:01:56+09:00',
    '2026-04-02T20:01:56+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000008005',
    '00000000-0000-4000-8000-000000004011',
    '00000000-0000-4000-8000-000000000002',
    (select id from questions where project_id = '00000000-0000-4000-8000-000000000002' and question_code = 'Q2'),
    'completed',
    'rule_based',
    '{"usage_scene":"出勤前","usage_reason":"時間がないから","usage_example":"おにぎりとお茶を買う"}'::jsonb,
    '2026-04-06T08:01:19+09:00',
    '2026-04-06T08:01:19+09:00',
    '2026-04-06T08:01:19+09:00'
  );

-- Session analyses for completed cases
insert into ai_analysis_results (
  id,
  session_id,
  summary,
  usage_scene,
  motive,
  pain_points,
  alternatives,
  insight_candidates,
  raw_json,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000006001',
    '00000000-0000-4000-8000-000000003001',
    '朝の時短ニーズで高頻度利用。昼のレジ待ちが大きな不満。',
    '出勤前に駅前でコーヒーとパンを買う',
    '時間がなく、近くで早く買えるため',
    '昼休みのレジ待ちが長い',
    '特になし',
    'セルフレジ増設は優先度の高い改善候補。',
    '{"case":"01","probe_used_on":"Q2"}'::jsonb,
    '2026-04-01T10:08:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000006002',
    '00000000-0000-4000-8000-000000003002',
    '通勤前と昼休みに中頻度利用。品切れ改善ニーズが明確。',
    '通勤前の飲み物購入、昼休みの昼食調達',
    '近くて短時間で必要なものをそろえられるため',
    '昼の人気商品が売り切れている',
    '別の店舗や別商品に切り替える可能性がある',
    '補充頻度の最適化が満足度改善に寄与する。',
    '{"case":"02","probe_used_on":null}'::jsonb,
    '2026-04-02T20:07:00+09:00'
  );

-- Point history for completed cases
insert into point_transactions (
  id,
  respondent_id,
  session_id,
  project_id,
  transaction_type,
  points,
  reason,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000007001',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000003001',
    '00000000-0000-4000-8000-000000000002',
    'award',
    10,
    'test interview completion case 01',
    '2026-04-01T10:08:00+09:00'
  ),
  (
    '00000000-0000-4000-8000-000000007002',
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000003002',
    '00000000-0000-4000-8000-000000000002',
    'award',
    10,
    'test interview completion case 02',
    '2026-04-02T20:07:00+09:00'
  );
