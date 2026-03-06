import { NextFunction, Request, Response } from "express";
import * as siteContentService from "../services/siteContentService";

const getParam = (value: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const normalizeSections = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      return {
        heading: String(row.heading ?? ""),
        description: String(row.description ?? ""),
      };
    })
    .filter(
      (section): section is { heading: string; description: string } => !!section,
    );
};

export const getAllSitePages = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pages = await siteContentService.getAllSitePageContent();
    res.status(200).json(pages);
  } catch (error) {
    next(error);
  }
};

export const getSitePageBySlug = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const slug = getParam(req.params.slug);
    const page = await siteContentService.getSitePageContentBySlug(slug);
    if (!page || !page.isPublished) {
      return res.status(404).json({ message: "Page content not found" });
    }
    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
};

export const upsertSitePageBySlug = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const slug = getParam(req.params.slug);
    const body = req.body as Record<string, unknown>;
    const payload: siteContentService.UpsertSitePageContentInput = {
      pageTitle: String(body.pageTitle ?? ""),
      lastUpdatedLabel:
        body.lastUpdatedLabel !== undefined
          ? String(body.lastUpdatedLabel ?? "")
          : undefined,
      introText: body.introText !== undefined ? String(body.introText ?? "") : undefined,
      sections: normalizeSections(body.sections),
      isPublished:
        body.isPublished !== undefined ? Boolean(body.isPublished) : undefined,
    };

    const page = await siteContentService.upsertSitePageContent(slug, payload);
    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
};
