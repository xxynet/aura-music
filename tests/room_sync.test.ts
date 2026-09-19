import { expect, test } from "bun:test";
import { resolveRoomId } from "../services/roomSync";

test("resolveRoomId prefers the room query param", () => {
  const target = resolveRoomId("?room=my-room", "old-room");
  expect(target.id).toBe("my-room");
  expect(target.explicit).toBe(true);
});

test("resolveRoomId trims the room query param", () => {
  const target = resolveRoomId("?room=%20my-room%20", null);
  expect(target.id).toBe("my-room");
  expect(target.explicit).toBe(true);
});

test("resolveRoomId falls back to a stored room and marks it explicit", () => {
  const target = resolveRoomId("", "stored-room");
  expect(target.id).toBe("stored-room");
  expect(target.explicit).toBe(true);
});

test("resolveRoomId uses the implicit demo room when nothing was joined", () => {
  const target = resolveRoomId("", null);
  expect(target.id).toBe("demo");
  expect(target.explicit).toBe(false);
});

test("resolveRoomId ignores blank params and stored values", () => {
  expect(resolveRoomId("?room=", "   ")).toEqual({ id: "demo", explicit: false });
});
