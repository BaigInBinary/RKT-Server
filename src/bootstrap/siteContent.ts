import prisma from "../config/prisma";

const DEFAULT_SITE_PAGES: Array<{
  slug: string;
  pageTitle: string;
  lastUpdatedLabel: string;
  introText?: string;
  sections: Array<{ heading: string; description: string }>;
}> = [
  {
    slug: "terms-of-service",
    pageTitle: "Terms of Service",
    lastUpdatedLabel: "August 7, 2025",
    introText: "By using our website (rkstore.com), you agree to the following terms:",
    sections: [
      {
        heading: "1. Use of Website",
        description:
          "You agree not to use this site for any illegal or unauthorized purpose. You must not transmit any worms, viruses, or destructive code.",
      },
      {
        heading: "2. Products & Pricing",
        description:
          "All prices are listed in PKR. We reserve the right to modify prices or discontinue products without notice.",
      },
      {
        heading: "3. Account Responsibility",
        description:
          "If you create an account on rkstore.com, you are responsible for maintaining the security of your account and password.",
      },
      {
        heading: "4. Intellectual Property",
        description:
          "All content on this site, including text, graphics, logos, and images, is the property of RK Store and protected by copyright laws.",
      },
      {
        heading: "5. Limitation of Liability",
        description:
          "RK Store is not liable for any indirect, incidental, or consequential damages arising from the use of our website or products.",
      },
      {
        heading: "6. Governing Law",
        description: "These Terms are governed by the applicable laws of Pakistan.",
      },
    ],
  },
  {
    slug: "shipping-policy",
    pageTitle: "Shipping Policy",
    lastUpdatedLabel: "August 7, 2025",
    sections: [
      {
        heading: "Processing Times",
        description:
          "Orders are processed within 1-3 business days (excluding weekends and holidays). You will receive an email with tracking information once your order ships.",
      },
      {
        heading: "Domestic Shipping",
        description:
          "We offer standard shipping (3-7 business days). Shipping costs are calculated at checkout. Free shipping is available on orders over Rs.2,000.",
      },
      {
        heading: "International Shipping",
        description:
          "Yes, we ship internationally. Delivery times and shipping fees vary based on location. Customs and import duties are the responsibility of the customer.",
      },
      {
        heading: "Delays",
        description:
          "While we do our best to ensure timely delivery, delays can occur due to weather, holidays, or carrier issues. We are not responsible for delays caused by third-party shipping providers.",
      },
      {
        heading: "Lost or Damaged Packages",
        description:
          "If your package is lost or arrives damaged, contact us immediately at support@rkstore.com. We'll work to resolve the issue as quickly as possible.",
      },
    ],
  },
];

export const ensureDefaultSiteContent = async (): Promise<void> => {
  for (const page of DEFAULT_SITE_PAGES) {
    const existing = await prisma.sitePageContent.findUnique({
      where: { slug: page.slug },
      select: { id: true },
    });

    if (existing) {
      continue;
    }

    await prisma.sitePageContent.create({
      data: {
        slug: page.slug,
        pageTitle: page.pageTitle,
        lastUpdatedLabel: page.lastUpdatedLabel,
        introText: page.introText ?? null,
        sections: page.sections,
        isPublished: true,
      },
    });
  }
};
