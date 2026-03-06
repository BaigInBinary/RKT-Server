import prisma from "../config/prisma";
import { Prisma, SitePageContent } from "@prisma/client";

export interface ContentSectionInput {
  heading: string;
  description: string;
}

export interface UpsertSitePageContentInput {
  pageTitle: string;
  lastUpdatedLabel?: string | null;
  introText?: string | null;
  sections: ContentSectionInput[];
  isPublished?: boolean;
}

const normalizeSections = (sections: ContentSectionInput[]) => {
  return sections
    .map((section) => ({
      heading: String(section.heading ?? "").trim(),
      description: String(section.description ?? "").trim(),
    }))
    .filter((section) => section.heading && section.description);
};

export const getSitePageContentBySlug = async (
  slug: string,
): Promise<SitePageContent | null> => {
  return prisma.sitePageContent.findUnique({ where: { slug } });
};

export const getAllSitePageContent = async (): Promise<SitePageContent[]> => {
  return prisma.sitePageContent.findMany({
    orderBy: { updatedAt: "desc" },
  });
};

export const upsertSitePageContent = async (
  slug: string,
  payload: UpsertSitePageContentInput,
): Promise<SitePageContent> => {
  const pageTitle = String(payload.pageTitle ?? "").trim();
  if (!pageTitle) {
    throw new Error("pageTitle is required");
  }

  const sections = normalizeSections(payload.sections || []);
  if (sections.length === 0) {
    throw new Error("At least one content section is required");
  }

  const data: Prisma.SitePageContentUncheckedCreateInput = {
    slug,
    pageTitle,
    lastUpdatedLabel: payload.lastUpdatedLabel?.trim() || null,
    introText: payload.introText?.trim() || null,
    sections,
    isPublished: payload.isPublished ?? true,
  };

  return prisma.sitePageContent.upsert({
    where: { slug },
    update: {
      pageTitle: data.pageTitle,
      lastUpdatedLabel: data.lastUpdatedLabel,
      introText: data.introText,
      sections: data.sections,
      isPublished: data.isPublished,
    },
    create: data,
  });
};
