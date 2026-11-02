// Stand-ins for the native modules the logger touches, so logic that logs can be tested in Node.
export default { expoConfig: { version: "test" } };
export const Platform = { Version: 0, OS: "android" };
export const AppState = { addEventListener: () => ({ remove() {} }) };
export const documentDirectory = "/tmp/";
export const cacheDirectory = "/tmp/";
export const makeDirectoryAsync = async () => undefined;
export const readAsStringAsync = async () => "";
export const writeAsStringAsync = async () => undefined;
export const readDirectoryAsync = async () => [];
export const deleteAsync = async () => undefined;
