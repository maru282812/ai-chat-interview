import { Router } from "express";
import { asyncHandler } from "../lib/http";
import { webhookController } from "../controllers/webhookController";

export const webhookRoutes = Router();

webhookRoutes.post("/line", asyncHandler(webhookController.lineWebhook));
