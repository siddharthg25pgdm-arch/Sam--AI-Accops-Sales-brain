// STUB from Stream B so the branch builds before Stream F/G merge. Fail safe (never admits the model).
// The owning stream's file replaces this one: take theirs on merge, or drop this commit when rebasing.
import type { Admit } from "./contracts";
export const admit: Admit = async () => null;
