import { createHash, timingSafeEqual } from 'node:crypto';
const expected = Buffer.from("01f2926dda360908d1e526b61185f5cef28efbca151b0e3773f43940032d5b5c",'hex');
export function verifyPassword(input: unknown): boolean {
  if(typeof input!=='string'||!/^[A-Za-z]{4}$/.test(input))return false;
  return timingSafeEqual(createHash('sha256').update(input.toUpperCase()).digest(),expected);
}
