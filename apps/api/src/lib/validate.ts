import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse input with a Zod schema, turning failures into a 400 with a readable message. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path.join('.') || 'input';
    throw badRequest(`${path}: ${issue?.message ?? 'invalid'}`, 'validation_error');
  }
  return r.data;
}

export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });
export const text = (min: number, max: number) => z.string().trim().min(min).max(max);
