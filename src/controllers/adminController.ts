import type { Request, Response } from "express";
import { HttpError } from "../lib/http";
import { csvService } from "../services/csvService";
import { adminService } from "../services/adminService";
import { pointService } from "../services/pointService";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { rankRepository } from "../repositories/rankRepository";

function routeParam(req: Request, key: string): string {
  const value = req.params[key];
  if (!value) {
    throw new HttpError(400, `Missing route param: ${key}`);
  }
  return Array.isArray(value) ? String(value[0] ?? "") : value;
}

function bodyString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return "";
}

function parseJsonField<T>(value: string | undefined, fieldName: string, fallback: T): T {
  if (!value || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new HttpError(400, `${fieldName} はJSON形式で入力してください`);
  }
}

function numberField(value: unknown, defaultValue = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

export const adminController = {
  async dashboard(_req: Request, res: Response): Promise<void> {
    const stats = await adminService.dashboard();
    res.render("admin/dashboard", { title: "Dashboard", stats });
  },

  async projects(_req: Request, res: Response): Promise<void> {
    const projects = await adminService.listProjects();
    res.render("admin/projects/index", { title: "Projects", projects });
  },

  async newProject(_req: Request, res: Response): Promise<void> {
    res.render("admin/projects/form", {
      title: "New Project",
      project: null,
      action: "/admin/projects"
    });
  },

  async createProject(req: Request, res: Response): Promise<void> {
    await projectRepository.create({
      name: String(req.body.name ?? ""),
      client_name: String(req.body.client_name ?? "") || null,
      objective: String(req.body.objective ?? "") || null,
      status: String(req.body.status ?? "draft") as "draft" | "active" | "paused" | "archived",
      reward_points: numberField(req.body.reward_points)
    });
    res.redirect("/admin/projects");
  },

  async editProject(req: Request, res: Response): Promise<void> {
    const project = await projectRepository.getById(routeParam(req, "projectId"));
    res.render("admin/projects/form", {
      title: "Edit Project",
      project,
      action: `/admin/projects/${project.id}`
    });
  },

  async updateProject(req: Request, res: Response): Promise<void> {
    await projectRepository.update(routeParam(req, "projectId"), {
      name: bodyString(req.body.name),
      client_name: bodyString(req.body.client_name) || null,
      objective: bodyString(req.body.objective) || null,
      status: bodyString(req.body.status || "draft") as "draft" | "active" | "paused" | "archived",
      reward_points: numberField(req.body.reward_points)
    });
    res.redirect("/admin/projects");
  },

  async questions(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const project = await projectRepository.getById(projectId);
    const questions = await adminService.listQuestions(projectId);
    res.render("admin/questions/index", { title: "Questions", project, questions });
  },

  async newQuestion(req: Request, res: Response): Promise<void> {
    const project = await projectRepository.getById(routeParam(req, "projectId"));
    res.render("admin/questions/form", {
      title: "New Question",
      project,
      question: null,
      action: `/admin/projects/${project.id}/questions`
    });
  },

  async createQuestion(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    await questionRepository.create({
      project_id: projectId,
      question_code: bodyString(req.body.question_code),
      question_text: bodyString(req.body.question_text),
      question_type: bodyString(req.body.question_type || "text") as
        | "text"
        | "single_select"
        | "multi_select"
        | "yes_no"
        | "scale",
      is_required: req.body.is_required === "on",
      sort_order: numberField(req.body.sort_order),
      branch_rule: parseJsonField(bodyString(req.body.branch_rule), "branch_rule", null),
      question_config: parseJsonField(bodyString(req.body.question_config), "question_config", null),
      ai_probe_enabled: req.body.ai_probe_enabled === "on"
    });
    res.redirect(`/admin/projects/${projectId}/questions`);
  },

  async editQuestion(req: Request, res: Response): Promise<void> {
    const question = await questionRepository.getById(routeParam(req, "questionId"));
    const project = await projectRepository.getById(question.project_id);
    res.render("admin/questions/form", {
      title: "Edit Question",
      project,
      question,
      action: `/admin/questions/${question.id}`
    });
  },

  async updateQuestion(req: Request, res: Response): Promise<void> {
    const questionId = routeParam(req, "questionId");
    const existing = await questionRepository.getById(questionId);
    await questionRepository.update(questionId, {
      question_code: bodyString(req.body.question_code),
      question_text: bodyString(req.body.question_text),
      question_type: bodyString(req.body.question_type || "text") as
        | "text"
        | "single_select"
        | "multi_select"
        | "yes_no"
        | "scale",
      is_required: req.body.is_required === "on",
      sort_order: numberField(req.body.sort_order),
      branch_rule: parseJsonField(bodyString(req.body.branch_rule), "branch_rule", null),
      question_config: parseJsonField(bodyString(req.body.question_config), "question_config", null),
      ai_probe_enabled: req.body.ai_probe_enabled === "on"
    });
    res.redirect(`/admin/projects/${existing.project_id}/questions`);
  },

  async respondents(_req: Request, res: Response): Promise<void> {
    const respondents = await adminService.listRespondents();
    res.render("admin/respondents/index", { title: "Respondents", respondents });
  },

  async respondentDetail(req: Request, res: Response): Promise<void> {
    const detail = await adminService.respondentDetail(routeParam(req, "respondentId"));
    res.render("admin/respondents/show", { title: "Respondent Detail", ...detail });
  },

  async points(_req: Request, res: Response): Promise<void> {
    const [respondents, ranks] = await Promise.all([
      adminService.listRespondents(),
      adminService.listRanks()
    ]);
    res.render("admin/points/index", { title: "Points", respondents, ranks });
  },

  async adjustPoints(req: Request, res: Response): Promise<void> {
    const respondentId = routeParam(req, "respondentId");
    await pointService.manualAdjust({
      respondentId,
      points: numberField(req.body.points),
      reason: bodyString(req.body.reason || "Manual adjustment")
    });
    res.redirect(`/admin/respondents/${respondentId}`);
  },

  async ranks(_req: Request, res: Response): Promise<void> {
    const ranks = await adminService.listRanks();
    res.render("admin/ranks/index", { title: "Ranks", ranks });
  },

  async updateRank(req: Request, res: Response): Promise<void> {
    await rankRepository.updateThreshold(routeParam(req, "rankId"), {
      min_points: numberField(req.body.min_points),
      badge_label: bodyString(req.body.badge_label) || null
    });
    res.redirect("/admin/ranks");
  },

  async exportAnswers(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.answersCsv());
  },

  async exportMessages(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.messagesCsv());
  },

  async exportAnalysis(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.analysisCsv());
  },

  async exportPoints(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.pointsCsv());
  },

  async exportRanks(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.ranksCsv());
  }
};
