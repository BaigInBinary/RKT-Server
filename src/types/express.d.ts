import type { AuthTokenPayload } from "../utils/security";

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthTokenPayload;
  }
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthTokenPayload;
    }
  }
}

export {};
