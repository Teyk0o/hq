import { customAlphabet } from 'nanoid';

/** 12-char slug, URL-safe, no lookalike chars — used for tasks, comments, messages, etc. */
export const newId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);
