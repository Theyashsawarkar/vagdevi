import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = fileURLToPath(new URL("./test/native-stub.ts", import.meta.url));
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  resolve: { alias: { "react-native": stub, "expo-constants": stub, "expo-file-system/legacy": stub } },
});
