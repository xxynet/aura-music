import { expect, test } from "bun:test";
import {
  deleteRoom,
  fetchRoomSnapshot,
  permissionAllows,
  resolveRoomId,
  resolveRoomRole,
  ROOM_ID_RE,
  RoomMissingError,
} from "../services/roomSync";

test("ROOM_ID_RE accepts only 3-64 chars of letters, digits, - or _", () => {
  expect(ROOM_ID_RE.test("movie-night")).toBe(true);
  expect(ROOM_ID_RE.test("ab")).toBe(false);
  expect(ROOM_ID_RE.test("bad id!")).toBe(false);
  expect(ROOM_ID_RE.test(`${"a".repeat(65)}`)).toBe(false);
});

test("resolveRoomId uses the room query param", () => {
  const target = resolveRoomId("?room=my-room");
  expect(target.id).toBe("my-room");
});

test("resolveRoomId trims the room query param", () => {
  const target = resolveRoomId("?room=%20my-room%20");
  expect(target.id).toBe("my-room");
});

test("resolveRoomId returns no room without a param", () => {
  expect(resolveRoomId("")).toEqual({ id: null });
});

test("resolveRoomId ignores blank params", () => {
  expect(resolveRoomId("?room=")).toEqual({ id: null });
});

test("fetchRoomSnapshot reports missing rooms on 404", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("not found", { status: 404 })) as typeof fetch;
  try {
    await expect(fetchRoomSnapshot("nope")).rejects.toBeInstanceOf(
      RoomMissingError,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("deleteRoom surfaces the http status on failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("forbidden", { status: 403 })) as typeof fetch;
  try {
    let err: (Error & { status?: number }) | null = null;
    try {
      await deleteRoom("some-room");
    } catch (e) {
      err = e as Error & { status?: number };
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.status).toBe(403);
  } finally {
    globalThis.fetch = original;
  }
});

test("resolveRoomRole separates host, logged-in users and guests", () => {
  expect(resolveRoomRole(7, 7)).toBe("creator");
  expect(resolveRoomRole(7, 9)).toBe("member");
  expect(resolveRoomRole(7, null)).toBe("guest");
  expect(resolveRoomRole(null, 9)).toBe("member");
  expect(resolveRoomRole(null, null)).toBe("guest");
});

test("permissionAllows defaults to open rooms without stored permissions", () => {
  expect(permissionAllows(undefined, "guest", "control")).toBe(true);
  expect(permissionAllows(undefined, "member", "edit")).toBe(true);
  expect(permissionAllows(null, "guest", "edit")).toBe(true);
});

test("permissionAllows follows the flags for guest and member roles", () => {
  const perms = {
    guest: { control: false, edit: true },
    member: { control: true, edit: false },
  };
  expect(permissionAllows(perms, "guest", "control")).toBe(false);
  expect(permissionAllows(perms, "guest", "edit")).toBe(true);
  expect(permissionAllows(perms, "member", "control")).toBe(true);
  expect(permissionAllows(perms, "member", "edit")).toBe(false);
});

test("permissionAllows never restricts the host", () => {
  const perms = {
    guest: { control: false, edit: false },
    member: { control: false, edit: false },
  };
  expect(permissionAllows(perms, "creator", "control")).toBe(true);
  expect(permissionAllows(perms, "creator", "edit")).toBe(true);
});
