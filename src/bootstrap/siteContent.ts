import prisma from "../config/prisma";

const TERMS_SLUG = "terms-of-service";

export const ensureDefaultSiteContent = async (): Promise<void> => {
  const existing = await prisma.sitePageContent.findUnique({
    where: { slug: TERMS_SLUG },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  await prisma.sitePageContent.create({
    data: {
      slug: TERMS_SLUG,
      pageTitle: "Terms of Service",
      lastUpdatedLabel: "August 7, 2025",
      introText:
        "By using our website (rkstore.com), you agree to the following terms:",
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
          description:
            "These Terms are governed by the applicable laws of Pakistan.",
        },
      ],
      isPublished: true,
    },
  });
};
