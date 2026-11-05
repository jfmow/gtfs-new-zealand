// Metro config: the app imports TypeScript straight from ../packages/shared
// (linked with a `file:` dependency, no build step), so Metro has to watch it.
const path = require("path")
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)

config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../packages/shared")]

module.exports = config
