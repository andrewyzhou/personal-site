import { NextResponse } from "next/server";
import {
  GitHubConflictError,
  GitHubExistsError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnavailableError,
} from "./github-content";

// uniform cms api envelope: { data } on success, { error: { code, message } }
// on failure. every route catches through mapError so nothing throws unhandled.

export type ErrorCode =
  | "unauthorized"
  | "validation"
  | "not_found"
  | "conflict"
  | "exists"
  | "rate_limited"
  | "github_unavailable"
  | "lookup_failed"
  | "internal";

export function ok(data: unknown, status = 200, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ data, ...(extra ?? {}) }, { status });
}

export function fail(code: ErrorCode, message: string, status: number, details?: unknown): NextResponse {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });
}

export function mapError(error: unknown): NextResponse {
  if (error instanceof GitHubConflictError) return fail("conflict", "this file changed on github since you opened it", 409);
  if (error instanceof GitHubExistsError) return fail("exists", "an entry with this path already exists (or your copy is stale)", 409);
  if (error instanceof GitHubNotFoundError) return fail("not_found", "not found", 404);
  if (error instanceof GitHubRateLimitError) return fail("rate_limited", "github is rate limiting — wait a minute and retry", 429);
  if (error instanceof GitHubUnavailableError) return fail("github_unavailable", "github unreachable — your draft is saved on this device", 502);
  return fail("internal", "something went wrong", 500);
}
