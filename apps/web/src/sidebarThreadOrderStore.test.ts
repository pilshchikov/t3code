import { describe, expect, it } from "vite-plus/test";

import { applySidebarThreadOrder } from "./sidebarThreadOrderStore";

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
const items = (...values: string[]) => values.map((id) => ({ id }));
const getId = (item: { id: string }) => item.id;

describe("applySidebarThreadOrder", () => {
  it("returns the natural order when nothing has been arranged", () => {
    expect(ids(applySidebarThreadOrder({ items: items("a", "b", "c"), order: [], getId }))).toEqual(
      ["a", "b", "c"],
    );
  });

  it("rearranges the threads the user dragged", () => {
    const result = applySidebarThreadOrder({
      items: items("a", "b", "c"),
      order: ["c", "a", "b"],
      getId,
    });
    expect(ids(result)).toEqual(["c", "a", "b"]);
  });

  it("keeps a thread the arrangement has never seen in its natural slot", () => {
    const result = applySidebarThreadOrder({
      items: items("new", "a", "b", "c"),
      order: ["c", "b", "a"],
      getId,
    });
    expect(ids(result)).toEqual(["new", "c", "b", "a"]);
  });

  it("leaves gaps where arranged threads have disappeared", () => {
    const result = applySidebarThreadOrder({
      items: items("a", "new", "c"),
      order: ["c", "b", "a"],
      getId,
    });
    expect(ids(result)).toEqual(["c", "new", "a"]);
  });

  it("ignores an arrangement that covers fewer than two visible threads", () => {
    const result = applySidebarThreadOrder({
      items: items("a", "b"),
      order: ["b"],
      getId,
    });
    expect(ids(result)).toEqual(["a", "b"]);
  });
});
