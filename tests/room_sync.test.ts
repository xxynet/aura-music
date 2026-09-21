import { expect, test } from "bun:test";
import {
  deleteRoom,
  fetchRoomSnapshot,
  resolveRoomId,
  RoomMissingError,
} from "../services/roomSync";

test("resolveRoomId uses the room query param", () => {
  const target = resolveRoomId("?room=my-room");
  expect(target.id).toBe("my-room");
  expect(target.explicit).toBe(true);
});

test("resolveRoomId trims the room query param", () => {
  const target = resolveRoomId("?room=%20my-room%20");
  expect(target.id).toBe("my-room");
  expect(target.explicit).toBe(true);
});

test("resolveRoomId uses the implicit demo room without a param", () => {
  expect(resolveRoomId("")).toEqual({ id: "demo", explicit: false });
});

test("resolveRoomId ignores blank params", () => {
  expect(resolveRoomId("?room=")).toEqual({ id: "demo", explicit: false });
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
