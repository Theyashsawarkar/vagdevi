const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// the reader's scripts travel as plain files, not code for this app's bundle
config.resolver.assetExts.push("txt", "html", "woff2", "db", "wasm", "bcmap", "pfb", "icc");
module.exports = config;
