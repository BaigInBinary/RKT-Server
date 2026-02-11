import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/userService';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body;
    const existingUser = await userService.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const user = await userService.createUser({ email, password, name });
    res.status(201).json({ id: user.id, email: user.email, name: user.name });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const user = await userService.findUserByEmail(email);
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    res.status(200).json({ id: user.id, email: user.email, name: user.name });
  } catch (error) {
    next(error);
  }
};
