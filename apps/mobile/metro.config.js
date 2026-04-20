// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace roots
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];
// 2. Force Metro to resolve modules from the project or workspace
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Production optimizations
if (process.env.NODE_ENV === 'production') {
  // Enable minification
  config.transformer = {
    ...config.transformer,
    minifierConfig: {
      compress: {
        // Remove console logs in production
        drop_console: true,
        // Remove debugger statements
        drop_debugger: true,
        // More aggressive optimizations
        passes: 3,
      },
      mangle: {
        toplevel: true,
      },
      output: {
        comments: false,
        ascii_only: true,
      },
    },
  };
}

module.exports = config;
