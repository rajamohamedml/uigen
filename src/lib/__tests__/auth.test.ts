// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

// Import after mocks are registered
const { createSession, getSession, deleteSession, verifySession } = await import(
  "@/lib/auth"
);

describe("createSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("sets an httpOnly cookie named auth-token", async () => {
    await createSession("user-1", "a@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name, , options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  test("cookie expires in ~7 days", async () => {
    const before = Date.now();
    await createSession("user-1", "a@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expiry: number = options.expires.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(expiry).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expiry).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });

  test("cookie value is a JWT string", async () => {
    await createSession("user-1", "a@example.com");

    const [, token] = mockCookieStore.set.mock.calls[0];
    // JWTs have three base64url segments separated by dots
    expect(token.split(".")).toHaveLength(3);
  });

  test("secure flag is false outside production", async () => {
    await createSession("user-1", "a@example.com");

    const [, , options] = mockCookieStore.set.mock.calls[0];
    expect(options.secure).toBe(false);
  });
});

describe("getSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    expect(await getSession()).toBeNull();
  });

  test("returns null for an invalid token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "not.a.jwt" });

    expect(await getSession()).toBeNull();
  });

  test("returns null for an empty cookie value", async () => {
    mockCookieStore.get.mockReturnValue({ value: "" });

    expect(await getSession()).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    await createSession("user-42", "valid@example.com");
    const [, token] = mockCookieStore.set.mock.calls[0];
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-42");
    expect(session?.email).toBe("valid@example.com");
  });

  test("returned session includes an expiresAt date", async () => {
    await createSession("user-42", "valid@example.com");
    const [, token] = mockCookieStore.set.mock.calls[0];
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session?.expiresAt).toBeDefined();
  });
});

describe("deleteSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("deletes the auth-token cookie", async () => {
    await deleteSession();

    expect(mockCookieStore.delete).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns null when the request has no cookie", async () => {
    const request = new NextRequest("http://localhost/");

    expect(await verifySession(request)).toBeNull();
  });

  test("returns null for an invalid token in the request", async () => {
    const request = new NextRequest("http://localhost/", {
      headers: { cookie: "auth-token=bad.token.value" },
    });

    expect(await verifySession(request)).toBeNull();
  });

  test("returns session payload for a valid token in the request", async () => {
    await createSession("user-99", "verify@example.com");
    const [, token] = mockCookieStore.set.mock.calls[0];

    const request = new NextRequest("http://localhost/", {
      headers: { cookie: `auth-token=${token}` },
    });

    const session = await verifySession(request);

    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-99");
    expect(session?.email).toBe("verify@example.com");
  });

  test("returns null when a different cookie is present", async () => {
    const request = new NextRequest("http://localhost/", {
      headers: { cookie: "other-cookie=somevalue" },
    });

    expect(await verifySession(request)).toBeNull();
  });
});
