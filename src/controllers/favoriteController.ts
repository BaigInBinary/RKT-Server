import { NextFunction, Request, Response } from "express";
import * as favoriteService from "../services/favoriteService";

export const getFavorites = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const favorites = await favoriteService.getFavoritesByUserId(req.authUser.sub);
    return res.status(200).json(favorites);
  } catch (error) {
    next(error);
  }
};

export const addFavorite = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const { itemId } = req.body as {
      itemId?: string;
    };

    if (!itemId) {
      return res.status(400).json({ message: "itemId is required" });
    }

    const favorite = await favoriteService.addFavorite(req.authUser.sub, {
      itemId,
    });

    return res.status(201).json(favorite);
  } catch (error) {
    next(error);
  }
};

export const removeFavorite = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const removed = await favoriteService.removeFavorite(
      req.authUser.sub,
      req.params.itemId as string,
    );

    if (!removed) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};
