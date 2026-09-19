import { expect, test } from "bun:test";
import { resolveRoomId } from "../services/roomSync";

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
