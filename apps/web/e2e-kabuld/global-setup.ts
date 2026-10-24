import { ensureBuilt, killTestSessions } from "./helpers";

export default function setup() {
  ensureBuilt();
  return () => killTestSessions();
}
