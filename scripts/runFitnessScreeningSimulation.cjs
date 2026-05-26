require("dotenv").config({ quiet: true });

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const projectId = "00000000-0000-4000-8000-0000000000f1";

const scenarios = [
  {
    assignmentId: "00000000-0000-4000-8000-00000000fa01",
    label: "pass_28_tokyo",
    answers: {
      Q1: "never_joined",
      Q2: "東京都",
      Q3: "20s",
      Q4: "健康診断で運動不足を指摘され、仕事帰りに短時間でも体力づくりを始めたいと思ったためです。",
      Q5: ["price", "time", "beginner"],
      Q6: ["orientation", "trainer_plan", "crowd_app"],
    },
  },
  {
    assignmentId: "00000000-0000-4000-8000-00000000fa02",
    label: "pass_69_saitama",
    answers: {
      Q1: "trial_only",
      Q2: "埼玉県",
      Q3: "60s",
      Q4: "加齢で足腰の衰えを感じており、医師から軽い筋力トレーニングを勧められたら検討します。",
      Q5: ["beginner", "effect", "crowd"],
      Q6: ["orientation", "trainer_plan", "trial_plan"],
    },
  },
  {
    assignmentId: "00000000-0000-4000-8000-00000000fa03",
    label: "fail_age_19_tokyo",
    answers: {
      Q1: "never_joined",
      Q2: "東京都",
      Q3: "under_20",
    },
  },
  {
    assignmentId: "00000000-0000-4000-8000-00000000fa04",
    label: "fail_region_osaka",
    answers: {
      Q1: "never_joined",
      Q2: "other",
      Q3: "30s",
    },
  },
  {
    assignmentId: "00000000-0000-4000-8000-00000000fa05",
    label: "fail_history_35_chiba",
    answers: {
      Q1: "joined_before",
      Q2: "千葉県",
      Q3: "30s",
    },
  },
];

function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}

function calculateAge(birthDate) {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function evaluateOperator(rawValue, operator, conditionValue) {
  if (operator === "equals") return normalize(rawValue) === normalize(conditionValue);
  if (operator === "not_equals") return normalize(rawValue) !== normalize(conditionValue);
  if (operator === "in") {
    const list = Array.isArray(conditionValue) ? conditionValue : [conditionValue];
    return list.map(normalize).includes(normalize(rawValue));
  }
  if (operator === "not_in") {
    const list = Array.isArray(conditionValue) ? conditionValue : [conditionValue];
    return !list.map(normalize).includes(normalize(rawValue));
  }

  const numericValue = Number(rawValue);
  if (operator === "gte") return Number.isFinite(numericValue) && numericValue >= Number(conditionValue);
  if (operator === "lte") return Number.isFinite(numericValue) && numericValue <= Number(conditionValue);
  if (operator === "between") {
    const range = Array.isArray(conditionValue) ? conditionValue : [];
    return (
      Number.isFinite(numericValue) &&
      numericValue >= Number(range[0]) &&
      numericValue <= Number(range[1])
    );
  }
  return false;
}

async function requireNoError(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function main() {
  const questions = await requireNoError(
    await supabase.from("questions").select("*").eq("project_id", projectId).order("sort_order")
  );
  const conditions = await requireNoError(
    await supabase.from("screening_conditions").select("*").eq("project_id", projectId).order("priority")
  );

  const questionByCode = Object.fromEntries(questions.map((question) => [question.question_code, question]));
  const screeningQuestions = questions.filter(
    (question) => question.is_screening_question || question.question_role === "screening"
  );

  const results = [];

  for (const scenario of scenarios) {
    const assignment = await requireNoError(
      await supabase.from("project_assignments").select("*").eq("id", scenario.assignmentId).single()
    );
    const profile = await requireNoError(
      await supabase.from("user_profiles").select("*").eq("line_user_id", assignment.user_id).maybeSingle()
    );

    const startedAt = new Date().toISOString();
    await requireNoError(
      await supabase
        .from("project_assignments")
        .update({ status: "started", started_at: startedAt })
        .eq("id", assignment.id)
    );

    const session = await requireNoError(
      await supabase
        .from("sessions")
        .insert({
          respondent_id: assignment.respondent_id,
          project_id: assignment.project_id,
          current_question_id: questionByCode.Q1.id,
          current_phase: "question",
          status: "active",
          state_json: {
            simulation: "fitness_screening_2026-05-26",
            mypage_confirmed_at: startedAt,
          },
        })
        .select("*")
        .single()
    );

    for (const [code, answerValue] of Object.entries(scenario.answers)) {
      const question = questionByCode[code];
      const answerText = Array.isArray(answerValue) ? answerValue.join(",") : String(answerValue);
      const freeText =
        question.question_type === "free_text_short" || question.question_type === "free_text_long"
          ? answerText
          : null;

      await requireNoError(
        await supabase.from("answers").insert({
          session_id: session.id,
          question_id: question.id,
          answer_text: answerText,
          free_text_answer: freeText,
          answer_role: "primary",
          normalized_answer: { value: answerValue, simulation: true },
        })
      );

      await requireNoError(
        await supabase
          .from("sessions")
          .update({ current_question_id: question.id, last_activity_at: new Date().toISOString() })
          .eq("id", session.id)
      );
    }

    const failedConditions = [];

    for (const condition of conditions) {
      let actualValue = null;
      if (condition.condition_type === "profile") {
        actualValue =
          condition.target_key === "age"
            ? calculateAge(profile?.birth_date)
            : profile?.[condition.target_key];
      } else {
        actualValue = scenario.answers[condition.target_key];
      }

      const pass = Array.isArray(actualValue)
        ? condition.operator === "not_in"
          ? actualValue.every((value) => evaluateOperator(value, condition.operator, condition.value_json))
          : actualValue.some((value) => evaluateOperator(value, condition.operator, condition.value_json))
        : evaluateOperator(actualValue, condition.operator, condition.value_json);

      if (!pass) {
        failedConditions.push(
          `${condition.condition_type}:${condition.target_key} ${condition.operator} ${JSON.stringify(
            condition.value_json
          )} (actual=${JSON.stringify(actualValue)})`
        );
      }
    }

    for (const question of screeningQuestions) {
      const options = question.question_config?.options ?? [];
      const passValues = new Set(
        options.filter((option) => option.isScreeningPass).map((option) => String(option.value))
      );
      if (passValues.size === 0) continue;

      const rawAnswer = scenario.answers[question.question_code];
      const pass = Array.isArray(rawAnswer)
        ? rawAnswer.some((value) => passValues.has(String(value)))
        : passValues.has(String(rawAnswer));

      if (!pass) {
        failedConditions.push(
          `question:${question.question_code} (actual=${JSON.stringify(rawAnswer)}, pass_values=${JSON.stringify(
            [...passValues]
          )})`
        );
      }
    }

    const judgement = failedConditions.length === 0 ? "pass" : "fail";
    const judgedAt = new Date().toISOString();
    const screeningResult = judgement === "pass" ? "passed" : "failed";

    await requireNoError(
      await supabase
        .from("sessions")
        .update({
          state_json: {
            ...(session.state_json ?? {}),
            screening_result: judgement,
            screening_failed_conditions: failedConditions,
            screening_judged_at: judgedAt,
          },
          status: judgement === "pass" ? "completed" : "active",
          current_phase: judgement === "pass" ? "completed" : "question",
          completed_at: judgement === "pass" ? judgedAt : null,
        })
        .eq("id", session.id)
    );

    // project_assignments にも判定結果を保存する（liffController.judgeScreening の動作に対応）
    const assignmentUpdate = {
      screening_result: screeningResult,
      screening_result_at: judgedAt,
      ...(judgement === "pass" ? { status: "completed", completed_at: judgedAt } : {}),
    };
    await requireNoError(
      await supabase
        .from("project_assignments")
        .update(assignmentUpdate)
        .eq("id", assignment.id)
    );

    // 最終状態を取得して検証
    const finalAssignment = await requireNoError(
      await supabase
        .from("project_assignments")
        .select("status, screening_result, screening_result_at")
        .eq("id", assignment.id)
        .single()
    );

    results.push({
      label: scenario.label,
      assignment_id: assignment.id,
      line_user_id: assignment.user_id,
      session_id: session.id,
      profile: {
        birth_date: profile?.birth_date,
        age: profile?.birth_date ? calculateAge(profile.birth_date) : null,
        prefecture: profile?.prefecture,
      },
      answers: scenario.answers,
      judgement,
      failed_conditions: failedConditions,
      main_answered: judgement === "pass",
      assignment_screening_result: finalAssignment?.screening_result ?? null,
      assignment_status: finalAssignment?.status ?? null,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
